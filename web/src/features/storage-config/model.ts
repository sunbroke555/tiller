// Pure logic of the storage editor: per-type metadata, the form model, the
// form → POST/PUT parameters mapping and client-side validation. Field rules
// follow the official UI (pvemanagerlib.js PVE.storage.*InputPanel and
// PVE.panel.StorageBase): which fields a type has, which can only be set at
// creation, defaults, and how checkboxes map to API keys.

import type { StorageDef, StorageType } from '@/api/storage-config'
import type { Params } from '@/api/client'
import type { StorageContent } from '@/api/types'
import { parsePruneBackups, pruneBackupsString, type PruneKeep } from '@/features/storage-browser/volumes'
import {
  configChanges,
  propBool,
  stringifyPropertyString,
  tryParsePropertyString,
  type ConfigValues,
} from '@/lib/propstring'

// ------------------------------------------------------------- type info

/** Content types in the official selector order. */
export const ALL_CONTENTS: readonly StorageContent[] = ['images', 'rootdir', 'iso', 'vztmpl', 'backup', 'snippets', 'import']

export type TypeGroup = 'local' | 'network' | 'backup'

export interface StorageTypeInfo {
  label: string
  /** One line in the type picker. */
  description: string
  group: TypeGroup
  /** Selectable content types; null = fixed by the type (no selector). */
  contents: readonly StorageContent[] | null
  /** Preselected content on create. */
  defaultContent: readonly StorageContent[]
  /** Can hold backups: the retention section applies (official canDoBackups). */
  backups: boolean
  /** Shows the "共享" checkbox (dir, lvm). */
  shared?: boolean
  /** qcow2/raw preallocation (dir, btrfs, nfs, cifs). */
  preallocation?: boolean
  /** snapshot-as-volume-chain (dir, nfs, cifs, lvm). */
  snapshotChain?: boolean
  /** Technology preview note. */
  preview?: string
}

const IMG_CT: readonly StorageContent[] = ['images', 'rootdir']

export const STORAGE_TYPE_INFO: Record<StorageType, StorageTypeInfo> = {
  dir: {
    label: '目录',
    description: '本机上的一个目录，可以放任何内容',
    group: 'local',
    contents: ALL_CONTENTS,
    defaultContent: ['images'],
    backups: true,
    shared: true,
    preallocation: true,
    snapshotChain: true,
  },
  lvm: {
    label: 'LVM',
    description: '卷组上的逻辑卷，可在共享 LUN 上使用',
    group: 'local',
    contents: IMG_CT,
    defaultContent: IMG_CT,
    backups: false,
    shared: true,
    snapshotChain: true,
  },
  lvmthin: {
    label: 'LVM-Thin',
    description: '精简池，支持快照和克隆',
    group: 'local',
    contents: IMG_CT,
    defaultContent: IMG_CT,
    backups: false,
  },
  btrfs: {
    label: 'BTRFS',
    description: 'BTRFS 文件系统上的目录（技术预览）',
    group: 'local',
    contents: ALL_CONTENTS,
    defaultContent: IMG_CT,
    backups: true,
    preallocation: true,
    preview: 'BTRFS 集成目前是技术预览。',
  },
  zfspool: {
    label: 'ZFS',
    description: '本机 ZFS 池，支持快照、精简置备',
    group: 'local',
    contents: IMG_CT,
    defaultContent: IMG_CT,
    backups: false,
  },
  nfs: {
    label: 'NFS',
    description: '挂载 NFS 服务器的导出目录',
    group: 'network',
    contents: ALL_CONTENTS,
    defaultContent: ['images'],
    backups: true,
    preallocation: true,
    snapshotChain: true,
  },
  cifs: {
    label: 'SMB/CIFS',
    description: '挂载 Windows / Samba 共享',
    group: 'network',
    contents: ALL_CONTENTS,
    defaultContent: ['images'],
    backups: true,
    preallocation: true,
    snapshotChain: true,
  },
  cephfs: {
    label: 'CephFS',
    description: 'Ceph 文件系统，放 ISO、模板和备份',
    group: 'network',
    contents: ['backup', 'iso', 'vztmpl', 'snippets', 'import'],
    defaultContent: ['backup'],
    backups: true,
  },
  rbd: {
    label: 'Ceph RBD',
    description: 'Ceph 块设备存储池',
    group: 'network',
    contents: IMG_CT,
    defaultContent: ['images'],
    backups: false,
  },
  iscsi: {
    label: 'iSCSI',
    description: '连接 iSCSI target，直接使用 LUN 或作为 LVM 的底层',
    group: 'network',
    contents: null,
    defaultContent: ['images'],
    backups: false,
  },
  iscsidirect: {
    label: 'iSCSI (libiscsi)',
    description: '用户态 libiscsi 直连 LUN（只用于虚拟机磁盘）',
    group: 'network',
    contents: null,
    defaultContent: ['images'],
    backups: false,
  },
  zfs: {
    label: 'ZFS over iSCSI',
    description: '远端 ZFS 存储，经 iSCSI 导出 zvol',
    group: 'network',
    contents: null,
    defaultContent: ['images'],
    backups: false,
  },
  pbs: {
    label: 'Proxmox Backup Server',
    description: '备份到 PBS，支持去重和客户端加密',
    group: 'backup',
    contents: null,
    defaultContent: ['backup'],
    backups: true,
  },
  esxi: {
    label: 'ESXi',
    description: '从 ESXi / vCenter 导入虚拟机',
    group: 'backup',
    contents: null,
    defaultContent: ['import'],
    backups: false,
  },
}

export const TYPE_GROUP_LABEL: Record<TypeGroup, string> = {
  local: '本地',
  network: '网络 / 共享',
  backup: '备份与导入',
}

export const ISCSI_PROVIDERS = [
  { value: 'comstar', label: 'Comstar' },
  { value: 'istgt', label: 'istgt' },
  { value: 'iet', label: 'IET' },
  { value: 'LIO', label: 'LIO' },
] as const

export const PREALLOCATION_OPTIONS = [
  { value: 'off', label: '关闭 (off)' },
  { value: 'metadata', label: '元数据 (metadata)' },
  { value: 'falloc', label: '完全 (posix_fallocate)' },
  { value: 'full', label: '完全 (full)' },
] as const

export const NFS_VERSIONS = ['3', '4', '4.1', '4.2'] as const
export const SMB_VERSIONS = ['2.0', '2.1', '3', '3.0', '3.11'] as const

// ------------------------------------------------------------------ form

export type CryptMode = 'keep' | 'none' | 'autogen' | 'upload'

export interface StorageForm {
  type: StorageType
  storage: string
  enable: boolean
  /** Node restriction; [] = all nodes. */
  nodes: string[]
  content: string[]
  shared: boolean
  path: string
  /** Server; for PBS and ESXi "host[:port]" (port split off on submit). */
  server: string
  export: string
  share: string
  subdir: string
  domain: string
  username: string
  /** New password; on edit empty = unchanged. */
  password: string
  /** SMB protocol version; '' = default. */
  smbversion: string
  /** NFS version from options vers=…; '' = default. */
  nfsversion: string
  /** Other NFS mount options, kept as they were. */
  otherOptions: string[]
  vgname: string
  /** LVM on create: iSCSI storage holding the base volume; '' = existing VG. */
  baseStorage: string
  /** LVM on create: base volume (LUN volid). */
  base: string
  thinpool: string
  pool: string
  blocksize: string
  sparse: boolean
  saferemove: boolean
  /** LVM on-volume-remove discard=1 (newer PVE only; hidden otherwise, so it stays false). */
  discardOnRemove: boolean
  portal: string
  target: string
  /** iSCSI: use LUNs directly (content images vs none). */
  luns: boolean
  iscsiprovider: string
  comstar_tg: string
  comstar_hg: string
  lio_tpg: string
  writecache: boolean
  monhost: string
  keyring: string
  fsName: string
  namespace: string
  krbd: boolean
  /** Ceph: use the PVE-managed (hyper-converged) cluster. */
  pveceph: boolean
  datastore: string
  fingerprint: string
  cryptMode: CryptMode
  /** Uploaded PBS key (JSON). */
  cryptKey: string
  masterPubkey: string
  skipCertVerification: boolean
  /** '' = default (metadata). */
  preallocation: string
  snapshotChain: boolean
  keepAll: boolean
  keep: PruneKeep
  maxProtected: number | undefined
}

const flag = (v: unknown) => v === 1 || v === '1' || v === true

function list(v: string | undefined): string[] {
  return (v ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** "pbs.lan:8007" / "[fe80::1]:8007" / "10.0.0.1" → { server, port }. */
export function parseHostPort(value: string): { server: string; port?: number } | null {
  const v = value.trim()
  if (!v || /\s/.test(v)) return null
  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(v)
  if (bracket) return withPort(bracket[1]!, bracket[2])
  // Bare IPv6 (two or more colons): no port.
  if ((v.match(/:/g) ?? []).length >= 2) return /^[0-9a-f:.]+$/i.test(v) ? { server: v } : null
  const m = /^([a-z0-9][a-z0-9.-]*)(?::(\d+))?$/i.exec(v)
  return m ? withPort(m[1]!, m[2]) : null
}

function withPort(server: string, port: string | undefined) {
  if (port === undefined) return { server }
  const n = Number(port)
  return n >= 1 && n <= 65535 ? { server, port: n } : null
}

/** server + port → the "host[:port]" field value. */
export function formatHostPort(server: string | undefined, port: number | undefined): string {
  if (!server) return ''
  if (port === undefined) return server
  return `${server.includes(':') ? `[${server}]` : server}:${port}`
}

/** Form for a new storage of `type`, or for editing `def`. */
export function initialForm(type: StorageType, def?: StorageDef): StorageForm {
  const info = STORAGE_TYPE_INFO[type]
  const prune = def ? tryParsePropertyString(def['prune-backups']) : {}
  const options = list(def?.options?.replace(/\s/g, '')).filter(Boolean)
  const vers = options.find((o) => o.startsWith('vers='))
  const content = def ? list(def.content).filter((c) => c !== 'none') : [...info.defaultContent]
  return {
    type,
    storage: def?.storage ?? '',
    enable: def ? !flag(def.disable) : true,
    nodes: list(def?.nodes),
    content,
    shared: flag(def?.shared),
    path: def?.path ?? '',
    server: type === 'pbs' || type === 'esxi' ? formatHostPort(def?.server, def?.port) : (def?.server ?? ''),
    export: def?.export ?? '',
    share: def?.share ?? '',
    subdir: def?.subdir ?? '',
    domain: def?.domain ?? '',
    username: def?.username ?? (type === 'cephfs' || type === 'rbd' ? 'admin' : ''),
    password: '',
    smbversion: def?.smbversion && def.smbversion !== 'default' ? def.smbversion : '',
    nfsversion: vers ? vers.slice('vers='.length) : '',
    otherOptions: options.filter((o) => !o.startsWith('vers=')),
    vgname: def?.vgname ?? '',
    baseStorage: '',
    base: def?.base ?? '',
    thinpool: def?.thinpool ?? '',
    pool: def?.pool ?? (type === 'rbd' && !def ? 'rbd' : ''),
    blocksize: def?.blocksize ?? (type === 'zfs' && !def ? '4k' : ''),
    sparse: flag(def?.sparse),
    saferemove: flag(def?.saferemove),
    discardOnRemove: volumeRemoveDiscard(def?.['on-volume-remove']),
    portal: def?.portal ?? '',
    target: def?.target ?? '',
    luns: def ? list(def.content).includes('images') : true,
    iscsiprovider: def?.iscsiprovider ?? 'comstar',
    comstar_tg: def?.comstar_tg ?? '',
    comstar_hg: def?.comstar_hg ?? '',
    lio_tpg: def?.lio_tpg ?? '',
    writecache: !flag(def?.nowritecache),
    monhost: def?.monhost ?? '',
    keyring: '',
    fsName: def?.['fs-name'] ?? '',
    namespace: def?.namespace ?? '',
    krbd: flag(def?.krbd),
    // Existing storages without monitors are the PVE-managed cluster.
    pveceph: def ? !def.monhost : false,
    datastore: def?.datastore ?? '',
    fingerprint: def?.fingerprint ?? '',
    cryptMode: def?.['encryption-key'] ? 'keep' : 'none',
    cryptKey: '',
    masterPubkey: '',
    skipCertVerification: flag(def?.['skip-cert-verification']),
    preallocation: def?.preallocation ?? '',
    snapshotChain: flag(def?.['snapshot-as-volume-chain']),
    keepAll: def ? prune['keep-all'] === '1' : true,
    keep: parsePruneBackups(def?.['prune-backups']),
    maxProtected: typeof def?.['max-protected-backups'] === 'number' ? def['max-protected-backups'] : undefined,
  }
}

// ---------------------------------------------------------- field rules

/** ZFS over iSCSI providers that have a write cache switch. */
export const hasWriteCacheOption = (provider: string) => provider === 'comstar' || provider === 'istgt'

/** Preallocation applies only while the storage holds VM images. */
export const preallocationActive = (f: StorageForm) =>
  !!STORAGE_TYPE_INFO[f.type].preallocation && f.content.includes('images')

/**
 * snapshot-as-volume-chain can be switched on edit only for LVM (official:
 * other types must not change it once volumes exist).
 */
export const snapshotChainEditable = (type: StorageType, create: boolean) => create || type === 'lvm'

/** LVM on-volume-remove ("[discard=<1|0>]"): whether removed volumes are discarded. */
export function volumeRemoveDiscard(value: string | undefined): boolean {
  return propBool(tryParsePropertyString(value).discard)
}

/**
 * New on-volume-remove value for the discard switch. Other options are kept,
 * an equal value keeps its spelling; null = unset (PVE wants at least one
 * option when the property is present, so an empty string becomes a delete).
 */
export function onVolumeRemoveValue(discard: boolean, before: string | undefined): string | null {
  if (discard && before && volumeRemoveDiscard(before)) return before
  const props = { ...tryParsePropertyString(before) }
  if (discard) props.discard = '1'
  else delete props.discard
  return stringifyPropertyString(props) || null
}

/** Storages whose node restriction cannot change (official: `local`). */
export const nodesLocked = (storage: string) => storage === 'local'

export interface FixedField {
  label: string
  value: string
}

/** Settings shown read-only when editing (set at creation, cannot change). */
export function fixedFields(def: StorageDef): FixedField[] {
  const t = def.type
  const rows: [string, unknown][] = []
  const add = (label: string, value: unknown) => rows.push([label, value])
  switch (t) {
    case 'dir':
    case 'btrfs':
      add('路径', def.path)
      break
    case 'nfs':
      add('服务器', def.server)
      add('导出路径', def.export)
      break
    case 'cifs':
      add('服务器', def.server)
      add('共享', def.share)
      add('用户名', def.username || '访客')
      add('域', def.domain)
      add('子目录', def.subdir)
      break
    case 'lvm':
      add('卷组', def.vgname)
      add('底层卷', def.base)
      break
    case 'lvmthin':
      add('卷组', def.vgname)
      add('精简池', def.thinpool)
      break
    case 'zfspool':
      add('ZFS 池', def.pool)
      break
    case 'iscsi':
    case 'iscsidirect':
      add('Portal', def.portal)
      add('Target', def.target)
      break
    case 'zfs':
      add('Portal', def.portal)
      add('池', def.pool)
      add('块大小', def.blocksize)
      add('Target', def.target)
      add('iSCSI 提供方', def.iscsiprovider)
      add('Target 组', def.comstar_tg)
      add('主机组', def.comstar_hg)
      add('Target portal 组', def.lio_tpg)
      break
    case 'cephfs':
      add('文件系统', def['fs-name'])
      add('用户名', def.monhost ? def.username : undefined)
      break
    case 'rbd':
      add('池', def.pool)
      add('命名空间', def.namespace)
      add('用户名', def.monhost ? def.username : undefined)
      break
    case 'pbs':
      add('服务器', formatHostPort(def.server, def.port))
      add('用户名', def.username)
      add('数据存储', def.datastore)
      add('命名空间', def.namespace || '根')
      break
    case 'esxi':
      add('服务器', formatHostPort(def.server, def.port))
      break
  }
  return rows
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([label, value]) => ({ label, value: String(value) }))
}

/** What the list shows in the "路径 / 目标" column (official: target, else path). */
export function storageLocation(def: StorageDef): string {
  switch (def.type) {
    case 'nfs':
      return def.server && def.export ? `${def.server}:${def.export}` : (def.path ?? '')
    case 'cifs':
      return def.server && def.share ? `//${def.server}/${def.share}${def.subdir ? def.subdir : ''}` : (def.path ?? '')
    case 'lvm':
      return def.vgname ?? ''
    case 'lvmthin':
      return def.vgname && def.thinpool ? `${def.vgname}/${def.thinpool}` : (def.vgname ?? '')
    case 'zfspool':
      return def.pool ?? ''
    case 'rbd':
      return def.namespace ? `${def.pool ?? ''}/${def.namespace}` : (def.pool ?? '')
    case 'cephfs':
      return def['fs-name'] ?? def.path ?? ''
    case 'pbs':
      return [def.server, def.datastore].filter(Boolean).join(':') + (def.namespace ? `/${def.namespace}` : '')
    case 'esxi':
      return def.server ?? ''
    default:
      return def.target ?? def.path ?? ''
  }
}

// ------------------------------------------------------------ validation

export type FormErrors = Partial<Record<string, string>>

const STORAGE_ID = /^[a-z][a-z0-9\-_.]*[a-z0-9]$/i
const FINGERPRINT = /^([A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/

/** official PVE.Utils.validateZfsBlocksize: power of 2 between 512 and 16m, k/m suffix. */
export function zfsBlocksizeError(value: string): string | null {
  if (!value) return null
  const m = /^([1-9][0-9]*)([km])?$/i.exec(value.trim())
  if (!m) return '格式不对，例如 16k'
  let bytes = Number(m[1])
  const suffix = m[2]?.toLowerCase()
  if (suffix === 'k') bytes *= 1024
  else if (suffix === 'm') bytes *= 1024 * 1024
  if (bytes < 512 || (bytes & (bytes - 1)) !== 0 || bytes > 16 * 1024 * 1024) return '必须是 2 的幂，介于 512 和 16m 之间'
  return null
}

/** A PBS key file: JSON with a `data` member. */
export function pbsKeyError(text: string): string | null {
  if (!text.trim()) return '请粘贴或选择密钥文件'
  try {
    const key = JSON.parse(text) as { data?: unknown }
    if (!key || typeof key !== 'object' || key.data === undefined) return '这不是 Proxmox Backup 密钥'
  } catch {
    return '无法解析密钥（需要 JSON 格式的密钥文件）'
  }
  return null
}

function monhostError(v: string): string | null {
  const hosts = list(v)
  if (!hosts.length) return '请填写监视器地址'
  return hosts.every((h) => parseHostPort(h) !== null) ? null : '地址格式不对，多个用逗号或空格分隔'
}

/**
 * Client-side checks (PVE validates again). Keys are API parameter names so
 * the messages sit under the matching fields.
 */
export function validateForm(f: StorageForm, create: boolean): FormErrors {
  const e: FormErrors = {}
  const info = STORAGE_TYPE_INFO[f.type]
  const need = (key: string, value: string, msg: string) => {
    if (!value.trim()) e[key] = msg
  }
  if (create) {
    if (!f.storage.trim()) e.storage = '请填写 ID'
    else if (!STORAGE_ID.test(f.storage.trim())) e.storage = '以字母开头、字母或数字结尾，中间可用字母、数字和 - _ .'
  }
  if (info.contents && f.content.length === 0) e.content = '至少选择一种内容'

  if (create) {
    switch (f.type) {
      case 'dir':
      case 'btrfs':
        need('path', f.path, '请填写目录')
        if (f.path.trim() && !f.path.trim().startsWith('/')) e.path = '需要绝对路径，例如 /mnt/data'
        break
      case 'nfs':
        need('server', f.server, '请填写服务器')
        need('export', f.export, '请填写或扫描导出路径')
        break
      case 'cifs':
        need('server', f.server, '请填写服务器')
        need('share', f.share, '请填写或扫描共享')
        if (f.subdir.trim() && !f.subdir.trim().startsWith('/')) e.subdir = '以 / 开头，例如 /backup'
        break
      case 'lvm':
        need('vgname', f.vgname, f.baseStorage ? '请填写新卷组的名称' : '请选择卷组')
        if (f.baseStorage) need('base', f.base, '请选择底层卷')
        break
      case 'lvmthin':
        need('vgname', f.vgname, '请选择卷组')
        need('thinpool', f.thinpool, '请选择精简池')
        break
      case 'zfspool':
        need('pool', f.pool, '请选择 ZFS 池')
        break
      case 'iscsi':
      case 'iscsidirect':
        need('portal', f.portal, '请填写 Portal')
        need('target', f.target, '请填写或扫描 Target')
        break
      case 'zfs':
        need('portal', f.portal, '请填写 Portal')
        need('pool', f.pool, '请填写池')
        need('blocksize', f.blocksize, '请填写块大小')
        need('target', f.target, '请填写 Target')
        if (f.iscsiprovider === 'LIO') need('lio_tpg', f.lio_tpg, 'LIO 需要 target portal 组')
        break
      case 'cephfs':
        if (f.pveceph) need('fs-name', f.fsName, '请选择文件系统')
        else {
          const m = monhostError(f.monhost)
          if (m) e.monhost = m
          need('keyring', f.keyring, '请填写密钥')
        }
        break
      case 'rbd':
        need('pool', f.pool, '请填写池')
        if (!f.pveceph) {
          const m = monhostError(f.monhost)
          if (m) e.monhost = m
          need('keyring', f.keyring, '请填写 keyring')
        }
        break
      case 'pbs':
        if (!f.server.trim()) e.server = '请填写服务器'
        else if (!parseHostPort(f.server)) e.server = '地址或端口不对，例如 pbs.lan 或 10.0.0.5:8007'
        if (!f.username.trim()) e.username = '请填写用户名'
        else if (!/\S+@\w+/.test(f.username)) e.username = '格式：用户@域，例如 admin@pbs 或 user@pbs!token'
        need('password', f.password, '请填写密码或 API 令牌密钥')
        need('datastore', f.datastore, '请填写或扫描数据存储')
        break
      case 'esxi':
        if (!f.server.trim()) e.server = '请填写服务器'
        else if (!parseHostPort(f.server)) e.server = '地址或端口不对'
        need('username', f.username, '请填写用户名')
        need('password', f.password, '请填写密码')
        break
    }
  } else {
    if ((f.type === 'cephfs' || f.type === 'rbd') && !f.pveceph) {
      const m = monhostError(f.monhost)
      if (m) e.monhost = m
    }
    if (f.type === 'esxi') need('username', f.username, '请填写用户名')
  }

  if (f.type === 'zfspool' || f.type === 'zfs') {
    const b = zfsBlocksizeError(f.blocksize)
    if (b) e.blocksize = b
  }
  if (f.type === 'pbs') {
    if (f.fingerprint.trim() && !FINGERPRINT.test(f.fingerprint.trim())) e.fingerprint = '需要 SHA-256 指纹：32 组十六进制，用冒号分隔'
    if (f.cryptMode === 'upload') {
      const k = pbsKeyError(f.cryptKey)
      if (k) e['encryption-key'] = k
    }
  }
  if (info.backups && f.maxProtected !== undefined && f.maxProtected < -1) e['max-protected-backups'] = '最小为 -1（不限）'
  return e
}

// ---------------------------------------------------------------- params

/** A boolean as an API value: true → 1, false → unset. */
const on = (b: boolean) => (b ? 1 : null)
const text = (s: string) => (s.trim() === '' ? null : s.trim())

/** Keep the loaded spelling when a list holds the same items (no needless write). */
function sameSet(a: string, b: string | undefined): boolean {
  const x = list(a).sort().join(',')
  const y = list(b).sort().join(',')
  return x === y
}

function retentionValues(f: StorageForm, before: StorageDef | undefined): ConfigValues {
  const str = f.keepAll ? 'keep-all=1' : pruneBackupsString(f.keep)
  let prune: string | null = str || null
  // Same settings in a different key order: leave the stored string alone.
  if (prune && before?.['prune-backups']) {
    const a = tryParsePropertyString(prune)
    const b = tryParsePropertyString(before['prune-backups'])
    const norm = (m: Record<string, string>) =>
      Object.entries(m)
        .filter(([k, v]) => !(k === 'keep-all' && v === '0'))
        .sort(([x], [y]) => x.localeCompare(y))
        .join(';')
    if (norm(a) === norm(b)) prune = before['prune-backups']
  }
  return { 'prune-backups': prune, 'max-protected-backups': f.maxProtected ?? null }
}

/**
 * The settings the form manages for its type, as API keys. `create` decides
 * which fixed fields are included. null = unset.
 */
export function formValues(f: StorageForm, create: boolean, before?: StorageDef): ConfigValues {
  const info = STORAGE_TYPE_INFO[f.type]
  const v: ConfigValues = {}

  // Common (PVE.panel.StorageBase).
  if (!nodesLocked(f.storage)) {
    const nodes = f.nodes.join(',')
    v.nodes = before && sameSet(nodes, before.nodes) ? (before.nodes ?? null) : text(nodes)
  }
  v.disable = on(!f.enable)
  if (info.contents) {
    const content = info.contents.filter((c) => f.content.includes(c)).join(',')
    v.content = before && sameSet(content, before.content) ? (before.content ?? null) : text(content)
  }
  if (info.shared) v.shared = on(f.shared)
  if (preallocationActive(f)) v.preallocation = text(f.preallocation)
  if (info.snapshotChain && snapshotChainEditable(f.type, create)) v['snapshot-as-volume-chain'] = on(f.snapshotChain)
  if (info.backups) Object.assign(v, retentionValues(f, before))

  switch (f.type) {
    case 'dir':
    case 'btrfs':
      if (create) v.path = text(f.path)
      break
    case 'nfs': {
      if (create) {
        v.server = text(f.server)
        v.export = text(f.export)
      }
      const opts = [...f.otherOptions, ...(f.nfsversion ? [`vers=${f.nfsversion}`] : [])].join(',')
      v.options = before && sameSet(opts, before.options) ? (before.options ?? null) : text(opts)
      break
    }
    case 'cifs':
      if (create) {
        v.server = text(f.server)
        v.share = text(f.share)
        v.username = text(f.username)
        v.domain = text(f.domain)
        v.subdir = text(f.subdir)
      }
      v.smbversion = text(f.smbversion)
      break
    case 'lvm':
      if (create) {
        v.vgname = text(f.vgname)
        if (f.baseStorage) v.base = text(f.base)
      }
      v.saferemove = on(f.saferemove)
      // Only ever non-null when switched on or already configured: older PVE rejects the key.
      v['on-volume-remove'] = onVolumeRemoveValue(f.discardOnRemove, before?.['on-volume-remove'])
      break
    case 'lvmthin':
      if (create) {
        v.vgname = text(f.vgname)
        v.thinpool = text(f.thinpool)
      }
      break
    case 'zfspool':
      if (create) v.pool = text(f.pool)
      v.sparse = on(f.sparse)
      v.blocksize = text(f.blocksize)
      break
    case 'iscsi':
      if (create) {
        v.portal = text(f.portal)
        v.target = text(f.target)
      }
      v.content = f.luns ? 'images' : 'none'
      break
    case 'iscsidirect':
      if (create) {
        v.portal = text(f.portal)
        v.target = text(f.target)
        v.content = 'images'
      }
      break
    case 'zfs':
      if (create) {
        v.content = 'images'
        v.portal = text(f.portal)
        v.pool = text(f.pool)
        v.blocksize = text(f.blocksize)
        v.target = text(f.target)
        v.iscsiprovider = f.iscsiprovider
        if (f.iscsiprovider === 'comstar') {
          v.comstar_tg = text(f.comstar_tg)
          v.comstar_hg = text(f.comstar_hg)
        }
        if (f.iscsiprovider === 'LIO') v.lio_tpg = text(f.lio_tpg)
      }
      v.sparse = on(f.sparse)
      if (hasWriteCacheOption(f.iscsiprovider)) v.nowritecache = on(!f.writecache)
      break
    case 'cephfs':
      if (!f.pveceph) v.monhost = text(f.monhost)
      if (create) {
        v['fs-name'] = text(f.fsName)
        if (!f.pveceph) {
          v.username = text(f.username)
          v.keyring = text(f.keyring)
        }
      }
      break
    case 'rbd':
      if (!f.pveceph) v.monhost = text(f.monhost)
      if (create) {
        v.pool = text(f.pool)
        v.namespace = text(f.namespace)
        if (!f.pveceph) {
          v.username = text(f.username)
          v.keyring = text(f.keyring)
        }
      }
      v.krbd = on(f.krbd)
      break
    case 'pbs': {
      if (create) {
        const hp = parseHostPort(f.server)
        v.server = hp?.server ?? text(f.server)
        v.port = hp?.port ?? null
        v.username = text(f.username)
        v.datastore = text(f.datastore)
        v.namespace = text(f.namespace)
        v.content = 'backup'
      }
      v.fingerprint = text(f.fingerprint)
      break
    }
    case 'esxi': {
      if (create) {
        const hp = parseHostPort(f.server)
        v.server = hp?.server ?? text(f.server)
        v.port = hp?.port ?? null
      }
      v.username = text(f.username)
      v['skip-cert-verification'] = on(f.skipCertVerification)
      break
    }
  }
  return v
}

/** Secrets and one-shot settings that are sent, never diffed. */
function writeOnlyParams(f: StorageForm, create: boolean, before?: StorageDef): { set: Params; del: string[] } {
  const set: Params = {}
  const del: string[] = []
  const pw = f.password
  if (pw !== '' && (f.type === 'cifs' || f.type === 'pbs' || f.type === 'esxi')) set.password = pw
  if (f.type === 'pbs') {
    if (f.cryptMode === 'autogen') set['encryption-key'] = 'autogen'
    else if (f.cryptMode === 'upload') set['encryption-key'] = f.cryptKey.trim()
    else if (f.cryptMode === 'none' && !create && before?.['encryption-key']) del.push('encryption-key')
    if (create && f.cryptMode !== 'none' && f.masterPubkey.trim()) {
      // PVE expects the PEM base64-encoded once more.
      set['master-pubkey'] = encodeBase64(f.masterPubkey.trim() + '\n')
    }
  }
  return { set, del }
}

function encodeBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** POST /storage parameters for a new storage. */
export function createParams(f: StorageForm): Params {
  const params: Params = { storage: f.storage.trim(), type: f.type }
  for (const [k, val] of Object.entries(formValues(f, true))) {
    if (val === null || val === undefined || val === '') continue
    params[k] = typeof val === 'boolean' ? (val ? 1 : 0) : val
  }
  return { ...params, ...writeOnlyParams(f, true).set }
}

/**
 * PUT /storage/{id} parameters: only changed keys, cleared keys in `delete`,
 * the digest of the loaded config. null when nothing changed.
 */
export function updateParams(f: StorageForm, before: StorageDef): Params | null {
  const values = formValues(f, false, before)
  const { set, delete: cleared } = configChanges(before as ConfigValues, values)
  const extra = writeOnlyParams(f, false, before)
  const del = [...cleared, ...extra.del]
  if (Object.keys(set).length === 0 && del.length === 0 && Object.keys(extra.set).length === 0) return null
  const params: Params = { ...set, ...extra.set }
  if (del.length) params.delete = del.join(',')
  if (before.digest) params.digest = before.digest
  return params
}

/** PUT parameters that only switch `disable` (row action), with the list digest. */
export function toggleParams(def: StorageDef, enable: boolean): Params {
  const params: Params = enable ? { delete: 'disable' } : { disable: 1 }
  if (def.digest) params.digest = def.digest
  return params
}

/** One-line summary of a retention setting for the list. */
export function retentionSummary(value: string | undefined): string | null {
  if (!value) return null
  const props = tryParsePropertyString(value)
  if (props['keep-all'] === '1') return '全部保留'
  const keep = parsePruneBackups(value)
  const parts: string[] = []
  const label: Record<string, string> = {
    'keep-last': '最近',
    'keep-hourly': '每小时',
    'keep-daily': '每天',
    'keep-weekly': '每周',
    'keep-monthly': '每月',
    'keep-yearly': '每年',
  }
  for (const [k, n] of Object.entries(keep)) parts.push(`${label[k]} ${n}`)
  return parts.length ? parts.join(' · ') : null
}
