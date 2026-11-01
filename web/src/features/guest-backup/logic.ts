// Pure helpers of the snapshot / backup / restore screens (unit tested in
// logic.test.ts). No React, no network.

import type { Params } from '@/api/client'
import type { Snapshot, VzdumpDefaults } from '@/api/guest-backup'
import type { GuestType } from '@/api/types'
import { parseMountPoint, parseVolumeId, tryParsePropertyString } from '@/lib/propstring'

// --------------------------------------------------------- snapshot tree

export const CURRENT = 'current'

export interface SnapshotRow {
  snap: Snapshot
  isCurrent: boolean
  /** Column of this row's node (0 = main line). */
  depth: number
  /** Columns whose line passes through this row (a chain continuing below). */
  rails: number[]
  /** First row of its chain: no line above the node (side branches get an elbow from depth-1). */
  first: boolean
  /** The chain continues below: line under the node. */
  hasNext: boolean
}

interface TreeNode {
  snap: Snapshot
  children: TreeNode[]
}

function order(s: Snapshot): number {
  if (s.name === CURRENT) return Number.POSITIVE_INFINITY
  return s.snaptime ?? Number.POSITIVE_INFINITY - 1
}

function containsCurrent(n: TreeNode): boolean {
  return n.snap.name === CURRENT || n.children.some(containsCurrent)
}

/**
 * Lay the snapshot list out as a timeline, oldest first, ending at "current":
 * a node's main child (the one leading to "current", else the newest)
 * continues on the same column; other children become side branches one
 * column to the right, listed right after their fork point. A linear history
 * (the common case) is a single straight line, which reads well on phones.
 */
export function buildSnapshotRows(list: readonly Snapshot[]): SnapshotRow[] {
  const nodes = new Map<string, TreeNode>()
  for (const s of list) nodes.set(s.name, { snap: s, children: [] })
  const roots: TreeNode[] = []
  for (const n of nodes.values()) {
    const parent = n.snap.parent ? nodes.get(n.snap.parent) : undefined
    if (parent && parent !== n) parent.children.push(n)
    else roots.push(n)
  }
  const byOrder = (a: TreeNode, b: TreeNode) => order(a.snap) - order(b.snap) || a.snap.name.localeCompare(b.snap.name)
  for (const n of nodes.values()) n.children.sort(byOrder)
  roots.sort(byOrder)

  const rows: SnapshotRow[] = []
  const seen = new Set<TreeNode>()
  const pickMain = (children: TreeNode[]) => children.find(containsCurrent) ?? children[children.length - 1]

  const walk = (n: TreeNode, depth: number, rails: number[], first: boolean) => {
    // Iterate down the main line; recurse into side branches.
    let node: TreeNode | undefined = n
    let isFirst = first
    while (node && !seen.has(node)) {
      seen.add(node)
      const main: TreeNode | undefined = node.children.length ? pickMain(node.children) : undefined
      rows.push({ snap: node.snap, isCurrent: node.snap.name === CURRENT, depth, rails, first: isFirst, hasNext: !!main })
      const sideRails = main ? [...rails, depth] : rails
      for (const side of node.children) if (side !== main) walk(side, depth + 1, sideRails, true)
      node = main
      isFirst = false
    }
  }

  // Several roots happen only with a broken parent chain: the one leading to
  // "current" is the main line, the others are listed before it.
  const mainRoot = roots.find(containsCurrent)
  for (const r of roots) if (r !== mainRoot) walk(r, 0, [], true)
  if (mainRoot) walk(mainRoot, 0, [], true)
  return rows
}

/** Number of real snapshots (without "current"). */
export function countSnapshots(list: readonly Snapshot[] | undefined): number {
  return (list ?? []).filter((s) => s.name !== CURRENT).length
}

/** Name of the snapshot the guest currently sits on (parent of "current"). */
export function currentParent(list: readonly Snapshot[] | undefined): string | undefined {
  return list?.find((s) => s.name === CURRENT)?.parent
}

// ------------------------------------------------------- snapshot names

/** PVE snapshot names: pve-configid, at most 40 characters. */
export const SNAPSHOT_NAME_RE = /^[a-z][a-z0-9_-]+$/i
export const SNAPSHOT_NAME_MAX = 40

/** Error text for an invalid snapshot name, or null when it is fine. */
export function validateSnapshotName(name: string, existing: readonly string[] = []): string | null {
  const n = name.trim()
  if (!n) return '请输入快照名称'
  if (n.length < 2) return '名称至少 2 个字符'
  if (n.length > SNAPSHOT_NAME_MAX) return `名称最多 ${SNAPSHOT_NAME_MAX} 个字符`
  if (!/^[a-z]/i.test(n)) return '名称需以字母开头'
  if (!SNAPSHOT_NAME_RE.test(n)) return '只能包含字母、数字、- 和 _'
  if (n.toLowerCase() === CURRENT) return '“current” 是保留名称'
  if (existing.includes(n)) return `已存在名为 ${n} 的快照`
  return null
}

/** Suggested name for a new snapshot: "snap-20261101-0830". */
export function suggestSnapshotName(now: Date = new Date(), existing: readonly string[] = []): string {
  const pad = (v: number) => String(v).padStart(2, '0')
  const base = `snap-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  if (!existing.includes(base)) return base
  for (let i = 2; ; i++) if (!existing.includes(`${base}-${i}`)) return `${base}-${i}`
}

/** Is the QEMU guest agent enabled in this config value ("1", "enabled=1,fstrim…")? */
export function agentEnabled(agent: string | number | undefined | null): boolean {
  if (agent === undefined || agent === null || agent === '') return false
  const parsed = tryParsePropertyString(String(agent), 'enabled')
  return parsed.enabled === '1' || parsed.enabled === 'true' || parsed.enabled === 'yes' || parsed.enabled === 'on'
}

// ------------------------------------------------------------- backup now

export type BackupMode = 'snapshot' | 'suspend' | 'stop'
/** "0" = no compression (API value). */
export type BackupCompress = 'zstd' | 'lzo' | 'gzip' | '0'
export type NotificationMode = 'notification-system' | 'legacy-sendmail'
export type PbsChangeDetection = 'data' | 'metadata' | 'legacy'

export const NOTES_TEMPLATE_VARS = ['guestname', 'vmid', 'node', 'cluster'] as const

/** Like PVE.Utils.escapeNotesTemplate: "\" → "\\", newline → "\n". */
export function escapeNotesTemplate(value: string): string {
  return value.replace(/(\\|\n)/g, (m) => (m === '\\' ? '\\\\' : '\\n'))
}

/** Like PVE.Utils.unEscapeNotesTemplate. */
export function unescapeNotesTemplate(value: string): string {
  return value.replace(/(\\\\|\\n)/g, (m) => (m === '\\\\' ? '\\' : '\n'))
}

export interface BackupNowForm {
  storage: string
  mode: BackupMode
  compress: BackupCompress
  protected: boolean
  /** Unescaped (real newlines). */
  notesTemplate: string
  notificationMode: NotificationMode
  mailto: string
  /** Prune older backups by the storage's retention afterwards. */
  prune: boolean
  /** CT + PBS only; undefined = default. */
  pbsChangeDetection?: PbsChangeDetection
}

/** POST /nodes/{node}/vzdump parameters for one guest (as the official dialog sends them). */
export function vzdumpParams(vmid: number, form: BackupNowForm, ctx: { type: GuestType; pbs: boolean }): Params {
  const params: Params = {
    vmid,
    storage: form.storage,
    mode: form.mode,
    // The API default is remove=1 (prune): always say what the user chose.
    remove: form.prune ? 1 : 0,
    'notification-mode': form.notificationMode,
  }
  // PBS always compresses with zstd and rejects other values.
  if (!ctx.pbs) params.compress = form.compress
  if (form.notificationMode === 'legacy-sendmail' && form.mailto.trim()) params.mailto = form.mailto.trim()
  if (form.protected) params.protected = 1
  if (form.notesTemplate.trim()) params['notes-template'] = escapeNotesTemplate(form.notesTemplate)
  if (ctx.pbs && ctx.type === 'lxc' && form.pbsChangeDetection) params['pbs-change-detection-mode'] = form.pbsChangeDetection
  return params
}

/** Initial notification mode from vzdump defaults (like the official dialog). */
export function notificationModeFromDefaults(d: Pick<VzdumpDefaults, 'notification-mode' | 'mailto'> | undefined): NotificationMode {
  const mode = d?.['notification-mode'] ?? 'auto'
  if (mode === 'legacy-sendmail') return 'legacy-sendmail'
  if (mode === 'notification-system') return 'notification-system'
  return d?.mailto ? 'legacy-sendmail' : 'notification-system'
}

export const RETENTION_KEYS = [
  ['keep-last', '最近'],
  ['keep-hourly', '每小时'],
  ['keep-daily', '每天'],
  ['keep-weekly', '每周'],
  ['keep-monthly', '每月'],
  ['keep-yearly', '每年'],
] as const

export interface Retention {
  keepAll: boolean
  /** Configured keep-* values in display order. */
  keeps: { key: string; label: string; value: number }[]
}

/** prune-backups ("keep-last=3,keep-daily=7" or an object) → retention. null when not set. */
export function parseRetention(value: VzdumpDefaults['prune-backups']): Retention | null {
  if (value === undefined || value === null || value === '') return null
  const map: Record<string, string> =
    typeof value === 'string'
      ? tryParsePropertyString(value)
      : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]))
  const keepAll = map['keep-all'] === '1'
  const keeps = RETENTION_KEYS.flatMap(([key, label]) => {
    const n = Number(map[key])
    return Number.isFinite(n) && n > 0 ? [{ key, label, value: n }] : []
  })
  return { keepAll, keeps }
}

/** "保留最近 3 个、每天 7 个". */
export function describeRetention(r: Retention): string {
  if (r.keepAll || r.keeps.length === 0) return '保留全部备份'
  return `保留${r.keeps.map((k) => `${k.label} ${k.value} 个`).join('、')}`
}

// ---------------------------------------------------------- backup config

export interface BackupConfigInfo {
  /** Config lines in order (comments and the #qmdump# map kept as-is). */
  lines: { key: string; value: string }[]
  name?: string
  memory?: string
  cores?: string
  sockets?: string
  unprivileged?: boolean
  /** Storages the backed-up disks came from ("" for raw devices). */
  storages: string[]
}

/**
 * Parse /vzdump/extractconfig output. QEMU archives list their disks as
 * "#qmdump#map:scsi0:drive-scsi0:local-lvm:raw:"; LXC configs have rootfs/mpN.
 * Snapshot sections ("[snap]") are ignored.
 */
export function parseBackupConfig(text: string | null | undefined): BackupConfigInfo {
  const info: BackupConfigInfo = { lines: [], storages: [] }
  if (!text) return info
  let inSnapshot = false
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (!line) continue
    if (/^\[.+\]$/.test(line)) {
      inSnapshot = true
      info.lines.push({ key: line, value: '' })
      continue
    }
    const m = /^([^:]+):\s?(.*)$/.exec(line)
    if (!m) {
      info.lines.push({ key: line, value: '' })
      continue
    }
    const key = m[1]!.trim()
    const value = m[2]!.trim()
    info.lines.push({ key, value })
    if (inSnapshot) continue
    if (key === '#qmdump#map') {
      const map = /^(\S+):(\S+):(\S*):(\S*):$/.exec(value)
      info.storages.push(map?.[3] ?? '')
    } else if (key === 'name' || key === 'hostname') {
      info.name = value
    } else if (key === 'memory' || key === 'cores' || key === 'sockets') {
      info[key] = value
    } else if (key === 'unprivileged') {
      info.unprivileged = value === '1'
    } else if (key === 'rootfs' || /^mp\d+$/.test(key)) {
      const vol = parseMountPoint(value).volume
      // Bind mounts (/path) are not restored; skip them.
      if (vol && !vol.startsWith('/')) info.storages.push(parseVolumeId(vol)?.storage ?? '')
    }
  }
  return info
}

/**
 * Whether every disk of the backup names a storage that exists on the node;
 * if not, restoring needs an explicit target storage.
 */
export function allStoragesAvailable(info: BackupConfigInfo, available: readonly string[]): boolean {
  return info.storages.every((s) => !!s && available.includes(s))
}

// ---------------------------------------------------------------- restore

export interface RestoreForm {
  /** Overwrite this existing guest (force=1), or create `vmid`. */
  overwrite: boolean
  vmid: number
  /** Target storage; empty = from the backup (QEMU only). */
  storage?: string
  /** MiB/s; undefined = storage default, 0 = unlimited. */
  bwlimitMiB?: number
  unique: boolean
  start: boolean
  haManaged: boolean
  /** QEMU + PBS: start at once, restore in the background. */
  liveRestore: boolean
  /** LXC: keep from backup, or force unprivileged (1) / privileged (0). */
  unprivileged: 'keep' | '1' | '0'
  name?: string
  memory?: number
  cores?: number
  sockets?: number
}

/** POST /nodes/{node}/qemu (archive) or /nodes/{node}/lxc (ostemplate + restore) parameters. */
export function restoreParams(type: GuestType, volid: string, form: RestoreForm): Params {
  const params: Params = { vmid: form.vmid }
  if (form.overwrite) params.force = 1
  if (form.storage) params.storage = form.storage
  if (form.bwlimitMiB !== undefined && Number.isFinite(form.bwlimitMiB)) params.bwlimit = Math.round(form.bwlimitMiB * 1024)
  if (form.unique) params.unique = 1
  const live = type === 'qemu' && form.liveRestore
  if (live) params['live-restore'] = 1
  else if (form.start) params.start = 1
  if (form.haManaged) params['ha-managed'] = 1
  const name = form.name?.trim()
  if (name) params[type === 'lxc' ? 'hostname' : 'name'] = name
  if (form.memory !== undefined) params.memory = form.memory
  if (form.cores !== undefined) params.cores = form.cores
  if (type === 'qemu' && form.sockets !== undefined) params.sockets = form.sockets
  if (type === 'lxc') {
    params.ostemplate = volid
    params.restore = 1
    if (form.unprivileged !== 'keep') params.unprivileged = Number(form.unprivileged)
  } else {
    params.archive = volid
  }
  return params
}

/** DNS-name check of the official restore dialog (name / hostname override). */
export function validateGuestName(name: string): string | null {
  const n = name.trim()
  if (!n) return null
  return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(n)
    ? null
    : '只能包含字母、数字、- 和 .，且不能以 - 开头或结尾'
}

// -------------------------------------------------------------- display

/** "vma.zst" → "VMA · ZSTD", "tar.gz" → "TAR · GZIP", "pbs-vm" → "PBS". */
export function formatBackupFormat(format: string | undefined): string {
  if (!format) return '备份'
  if (format.startsWith('pbs')) return 'PBS'
  const [kind, comp] = format.split('.')
  const COMP: Record<string, string> = { zst: 'ZSTD', lzo: 'LZO', gz: 'GZIP' }
  if (format === 'tgz') return 'TAR · GZIP'
  const head = (kind ?? format).toUpperCase()
  return comp ? `${head} · ${COMP[comp] ?? comp.toUpperCase()}` : head
}

/** Name of a backup volume for headings: the file name or the PBS snapshot path. */
export function backupFileName(volid: string): string {
  const vol = parseVolumeId(volid)?.volume ?? volid
  return vol.replace(/^backup\//, '')
}

/** First line of a multi-line text, trimmed. */
export function firstLine(text: string | undefined | null): string {
  return (text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? ''
}

/** pxar file types (Proxmox.Schema.pxarFileTypes). */
export const PXAR_TYPE_LABEL: Record<string, string> = {
  b: '块设备',
  c: '字符设备',
  d: '目录',
  f: '文件',
  h: '硬链接',
  l: '符号链接',
  p: 'FIFO',
  s: '套接字',
  v: '虚拟',
}

/** Types that can be downloaded (directories as an archive). */
export function fileRestoreDownloadable(type: string): boolean {
  return type === 'f' || type === 'h' || type === 'd'
}
