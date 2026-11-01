// Pure helpers of the storage browser: volume names and dates, upload and
// download validation, OCI references, prune retention, restore and import
// parameters. Semantics follow the official UI (pvemanagerlib.js).

import type { ChecksumAlgorithm, ImportMetadata, PruneEntry, StorageVolume, TransferContent, UrlMetadata } from '@/api/storage-browser'
import type { StorageContent } from '@/api/types'
import { stringifyPropertyString, tryParsePropertyString, type PropertyValue } from '@/lib/propstring'

// ---------------------------------------------------------------- volumes

/**
 * Display name of a volume (official render_storage_content):
 * "local:iso/debian.iso" → "debian.iso", "local-lvm:vm-100-disk-0" →
 * "vm-100-disk-0", import volumes keep their sub path after "import/".
 */
export function volumeName(v: Pick<StorageVolume, 'volid' | 'content'>): string {
  if (v.content === 'import') {
    return /^.*?:import\//.test(v.volid) ? v.volid.replace(/^.*?:import\//, '') : v.volid.replace(/^.*?:/, '')
  }
  return v.volid.replace(/^.*?:(.*?\/)?/, '')
}

const BACKUP_DATE_RE = /(\d{4})_(\d{2})_(\d{2})-(\d{2})_(\d{2})_(\d{2})/

/**
 * Unix seconds of a volume. Backups use the time in their name (what the
 * official UI shows), others `ctime`, which LVM-thin returns as a string.
 */
export function volumeTime(v: Pick<StorageVolume, 'volid' | 'content' | 'ctime'>): number | undefined {
  if (v.content === 'backup') {
    const m = BACKUP_DATE_RE.exec(v.volid)
    if (m) {
      const [, y, mo, d, h, mi, s] = m.map(Number) as [number, number, number, number, number, number, number]
      return Math.floor(new Date(y, mo - 1, d, h, mi, s).getTime() / 1000)
    }
  }
  const t = Number(v.ctime)
  return v.ctime !== undefined && v.ctime !== '' && Number.isFinite(t) && t > 0 ? t : undefined
}

export function volumeVmid(v: Pick<StorageVolume, 'vmid'>): number | undefined {
  const n = Number(v.vmid)
  return v.vmid !== undefined && v.vmid !== '' && Number.isInteger(n) && n > 0 ? n : undefined
}

/** Guest type of a backup (official volume_is_qemu_backup / volume_is_lxc_backup). */
export function backupGuestType(v: Pick<StorageVolume, 'volid' | 'format' | 'subtype'>): 'qemu' | 'lxc' | null {
  if (v.format === 'pbs-vm' || /:backup\/vzdump-qemu-/.test(v.volid) || v.subtype === 'qemu') return 'qemu'
  if (v.format === 'pbs-ct' || /:backup\/vzdump-(lxc|openvz)-/.test(v.volid) || v.subtype === 'lxc') return 'lxc'
  return null
}

/** Size in bytes and whether it is PBS's approximate size. */
export function volumeSize(v: Pick<StorageVolume, 'size' | 'approximate-size'>): { bytes?: number; approximate: boolean } {
  if (typeof v.size === 'number') return { bytes: v.size, approximate: false }
  if (typeof v['approximate-size'] === 'number') return { bytes: v['approximate-size'], approximate: true }
  return { approximate: false }
}

/** Import volumes: a whole guest (OVA/OVF/ESXi VMX) or a single disk image. */
export function importKind(format: string | undefined): 'guest' | 'disk' | null {
  if (format === 'ova' || format === 'ovf' || format === 'vmx') return 'guest'
  if (format === 'raw' || format === 'qcow2' || format === 'vmdk') return 'disk'
  return null
}

/** Newest first for backups; by name (numeric aware) otherwise. */
export function sortVolumes(list: readonly StorageVolume[], content: StorageContent | undefined): StorageVolume[] {
  const byName = (a: StorageVolume, b: StorageVolume) =>
    volumeName(a).localeCompare(volumeName(b), undefined, { numeric: true })
  if (content === 'backup') {
    return [...list].sort((a, b) => (volumeTime(b) ?? 0) - (volumeTime(a) ?? 0) || byName(a, b))
  }
  return [...list].sort(byName)
}

/** Search in name, format and notes; optionally only one VMID. */
export function filterVolumes(list: readonly StorageVolume[], query: string, vmid?: number): StorageVolume[] {
  const q = query.trim().toLowerCase()
  return list.filter((v) => {
    if (vmid !== undefined && volumeVmid(v) !== vmid) return false
    if (!q) return true
    return [volumeName(v), v.format, v.notes ?? '', String(v.vmid ?? '')].some((s) => s.toLowerCase().includes(q))
  })
}

/** Distinct VMIDs on the list, ascending (for the VMID filter). */
export function volumeVmids(list: readonly StorageVolume[]): number[] {
  return [...new Set(list.map(volumeVmid).filter((n): n is number => n !== undefined))].sort((a, b) => a - b)
}

export interface BackupGroup {
  type: 'qemu' | 'lxc'
  vmid: number
  count: number
}

/** Backup groups (type/vmid) for the prune dialog. */
export function backupGroups(list: readonly StorageVolume[]): BackupGroup[] {
  const groups = new Map<string, BackupGroup>()
  for (const v of list) {
    const type = backupGuestType(v)
    const vmid = volumeVmid(v)
    if (!type || vmid === undefined) continue
    const key = `${type}/${vmid}`
    const g = groups.get(key)
    if (g) g.count++
    else groups.set(key, { type, vmid, count: 1 })
  }
  return [...groups.values()].sort((a, b) => a.vmid - b.vmid || a.type.localeCompare(b.type))
}

export interface DeleteContext {
  /** VMIDs of guests that exist, with their node. */
  guests: ReadonlyMap<number, string>
  node: string
  shared: boolean
}

/**
 * Why a volume cannot be deleted, or null. Protected backups are locked;
 * a VM disk / CT volume still owned by an existing guest must be removed in
 * the guest's hardware (official ImageView: same node or shared storage).
 */
export function deleteBlockedReason(v: StorageVolume, ctx: DeleteContext): string | null {
  if (v.protected === 1) return '受保护的备份不能删除，先取消保护'
  if (v.content === 'images' || v.content === 'rootdir') {
    const vmid = volumeVmid(v)
    const owner = vmid !== undefined ? ctx.guests.get(vmid) : undefined
    if (vmid !== undefined && owner !== undefined && (ctx.shared || owner === ctx.node)) {
      return `客户机 ${vmid} 仍然存在，请在它的硬件页删除这块磁盘`
    }
  }
  return null
}

// ----------------------------------------------------------------- upload

/** Extensions the upload accepts per content type (official UploadToStorage). */
export const UPLOAD_EXTENSIONS: Record<TransferContent, readonly string[]> = {
  iso: ['.iso', '.img'],
  vztmpl: ['.tar.gz', '.tar.xz', '.tar.zst'],
  import: ['.ova', '.qcow2', '.raw', '.vmdk'],
}

/** Accepted for selection, renamed to the real extension (".img" → ".img.raw" for import). */
const EXTENSION_ALIASES: Partial<Record<TransferContent, Record<string, string>>> = {
  import: { '.img': '.raw' },
}

/** `accept` attribute for the file input. */
export function uploadAccept(content: TransferContent): string {
  return [...UPLOAD_EXTENSIONS[content], ...Object.keys(EXTENSION_ALIASES[content] ?? {})].join(',')
}

/** Target name for a picked file: no path, aliases expanded. */
export function uploadFilename(name: string, content: TransferContent): string {
  let base = name.replace(/^.*[/\\]/, '')
  for (const [alias, real] of Object.entries(EXTENSION_ALIASES[content] ?? {})) {
    if (base.toLowerCase().endsWith(alias)) base += real
  }
  return base
}

/** Error text for a target file name, or null when fine. */
export function validateFilename(name: string, content: TransferContent): string | null {
  const n = name.trim()
  if (!n) return '请输入文件名'
  if (/[/\\]/.test(n)) return '文件名不能包含路径'
  const exts = UPLOAD_EXTENSIONS[content]
  if (!exts.some((e) => n.toLowerCase().endsWith(e))) return `扩展名必须是 ${exts.join('、')}`
  return null
}

const CHECKSUM_HEX_LENGTH: Record<ChecksumAlgorithm, number> = {
  md5: 32,
  sha1: 40,
  sha224: 56,
  sha256: 64,
  sha384: 96,
  sha512: 128,
}

export const CHECKSUM_LABEL: Record<ChecksumAlgorithm, string> = {
  md5: 'MD5',
  sha1: 'SHA-1',
  sha224: 'SHA-224',
  sha256: 'SHA-256',
  sha384: 'SHA-384',
  sha512: 'SHA-512',
}

/** Error text for a checksum (hex of the algorithm's length), or null. */
export function validateChecksum(algorithm: ChecksumAlgorithm | undefined, value: string): string | null {
  if (!algorithm) return null
  const v = value.trim()
  if (!v) return '请输入校验和'
  const len = CHECKSUM_HEX_LENGTH[algorithm]
  if (!/^[0-9a-fA-F]+$/.test(v)) return '校验和只能包含十六进制字符'
  if (v.length !== len) return `${CHECKSUM_LABEL[algorithm]} 校验和应为 ${len} 位（当前 ${v.length} 位）`
  return null
}

// --------------------------------------------------------------- download

export const DOWNLOAD_COMPRESSIONS = ['gz', 'lzo', 'zst', 'bz2'] as const
export type DownloadCompression = (typeof DOWNLOAD_COMPRESSIONS)[number]

/**
 * File name and decompression after "查询 URL" (official DownloadUrlToStorage):
 * ISO "x.iso.gz" → "x.iso" + gz; import "disk.img" → "disk.img.raw".
 */
export function downloadDefaults(
  meta: UrlMetadata,
  content: TransferContent,
): { filename: string; compression: DownloadCompression | undefined } {
  let filename = meta.filename ?? ''
  let compression: DownloadCompression | undefined
  if (content === 'iso') {
    const m = /^(.+)\.(gz|lzo|zst|bz2)$/i.exec(filename)
    if (m) {
      filename = m[1]!
      compression = m[2]!.toLowerCase() as DownloadCompression
    }
  } else if (content === 'import' && filename.endsWith('.img')) {
    filename += '.raw'
  }
  return { filename, compression }
}

/** Last path segment of a URL, as a fallback file name before querying. */
export function filenameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
  } catch {
    return ''
  }
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\/\S+$/i.test(url.trim())
}

// -------------------------------------------------------------------- OCI

const OCI_RE = new RegExp(
  '^((?:[a-zA-Z\\d](?:[a-zA-Z\\d-]*[a-zA-Z\\d])?(?:\\.(?:[a-zA-Z\\d]' +
    '(?:[a-zA-Z\\d-]*[a-zA-Z\\d])?))*(?::\\d+)?/)?[a-z\\d]+(?:(?:[._]|__|-+)' +
    '[a-z\\d]+)*(?:/[a-z\\d]+(?:(?:[._]|__|-+)[a-z\\d]+)*)*)' +
    '(?::(\\w[\\w.-]{0,127}))?$',
)

/**
 * "docker.io/library/nginx:1.27" → { repository: "docker.io/library/nginx", tag: "1.27" };
 * null when invalid. The tag is optional.
 */
export function parseOciReference(value: string): { repository: string; tag?: string } | null {
  const m = OCI_RE.exec(value.trim())
  if (!m) return null
  return m[2] ? { repository: m[1]!, tag: m[2] } : { repository: m[1]! }
}

export function validOciTag(tag: string): boolean {
  return /^\w[\w.-]{0,127}$/.test(tag.trim())
}

// ------------------------------------------------------------------ prune

export const PRUNE_KEYS = ['keep-last', 'keep-hourly', 'keep-daily', 'keep-weekly', 'keep-monthly', 'keep-yearly'] as const
export type PruneKey = (typeof PRUNE_KEYS)[number]
export type PruneKeep = Partial<Record<PruneKey, number>>

export const PRUNE_LABEL: Record<PruneKey | 'keep-all', string> = {
  'keep-last': '最近',
  'keep-hourly': '每小时',
  'keep-daily': '每天',
  'keep-weekly': '每周',
  'keep-monthly': '每月',
  'keep-yearly': '每年',
  'keep-all': '全部保留',
}

/** Storage retention "keep-last=3,keep-daily=7" → { keep-last: 3, … }. */
export function parsePruneBackups(value: string | undefined): PruneKeep {
  const props = tryParsePropertyString(value)
  const out: PruneKeep = {}
  for (const k of PRUNE_KEYS) {
    const n = Number(props[k])
    if (props[k] !== undefined && Number.isInteger(n) && n > 0) out[k] = n
  }
  return out
}

/** { keep-last: 3 } → "keep-last=3"; "" when nothing is set. */
export function pruneBackupsString(keep: PruneKeep): string {
  const props: Record<string, PropertyValue> = {}
  for (const k of PRUNE_KEYS) {
    const n = keep[k]
    if (n !== undefined && Number.isFinite(n) && n > 0) props[k] = Math.floor(n)
  }
  return stringifyPropertyString(props)
}

/**
 * Parameters for GET (preview) and DELETE (prune) /prunebackups. Without
 * keep options PVE falls back to the storage's retention settings, so send
 * keep-all=1 instead to make "nothing set" mean "keep everything".
 */
export function pruneParams(keep: PruneKeep, group?: { type: 'qemu' | 'lxc'; vmid: number }) {
  const s = pruneBackupsString(keep)
  return {
    'prune-backups': s || 'keep-all=1',
    ...(group ? { type: group.type, vmid: group.vmid } : {}),
  }
}

/**
 * Why each kept backup is kept, like the official dialog: rules are applied
 * newest first in the order keep-last, hourly, daily, weekly, monthly,
 * yearly; "keep-last: 2" means the second backup kept by keep-last.
 * Backups are counted per group (type/vmid).
 */
export function pruneKeepReasons(entries: readonly PruneEntry[], keep: PruneKeep): Map<string, string> {
  const reasons = new Map<string, string>()
  const groups = new Map<string, PruneEntry[]>()
  for (const e of entries) {
    const key = `${e.type}/${e.vmid ?? ''}`
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  const rules: (PruneKey | 'keep-all')[] = [...PRUNE_KEYS.filter((k) => (keep[k] ?? 0) > 0), 'keep-all']
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => b.ctime - a.ctime)
    let ruleIndex = 0
    let counter = 0
    for (const e of sorted) {
      if (e.mark !== 'keep') continue
      const rule = rules[ruleIndex]!
      if (rule === 'keep-all') {
        reasons.set(e.volid, PRUNE_LABEL['keep-all'])
        continue
      }
      counter++
      reasons.set(e.volid, `${PRUNE_LABEL[rule]} ${counter}`)
      if (counter >= (keep[rule] ?? 0)) {
        ruleIndex = Math.min(ruleIndex + 1, rules.length - 1)
        counter = 0
      }
    }
  }
  return reasons
}

// ---------------------------------------------------------------- restore

export interface BackupConfigInfo {
  name?: string
  memory?: number
  cores?: number
  sockets?: number
  /** False when a backed up disk has no storage hint or its storage is missing on the node. */
  storagesKnown: boolean
  /** Storages referenced by the backed up disks (#qmdump#map). */
  storages: string[]
}

/**
 * Parse `vzdump/extractconfig` output for the restore defaults (official
 * Restore window): name/hostname, memory, cores, sockets and the disk map.
 */
export function parseBackupConfig(text: string, availableStorages?: ReadonlySet<string>): BackupConfigInfo {
  const info: BackupConfigInfo = { storagesKnown: true, storages: [] }
  for (const line of text.split('\n')) {
    // Snapshot sections follow the main config: stop there.
    if (/^\[.*\]\s*$/.test(line)) break
    const m = /^([^:]+):\s*(\S+)\s*$/.exec(line)
    if (!m) continue
    const [, key, value] = m as unknown as [string, string, string]
    if (key === '#qmdump#map') {
      const map = /^(\S+):(\S+):(\S*):(\S*):$/.exec(value)
      const storage = map?.[3] ?? ''
      if (storage) info.storages.push(storage)
      if (!storage || (availableStorages && !availableStorages.has(storage))) info.storagesKnown = false
    } else if (key === 'name' || key === 'hostname') {
      info.name = value
    } else if (key === 'memory' || key === 'cores' || key === 'sockets') {
      const n = Number(value)
      if (Number.isFinite(n)) info[key] = n
    }
  }
  return info
}

export interface RestoreForm {
  type: 'qemu' | 'lxc'
  volid: string
  vmid: number
  /** Target storage; empty = from the backup (VMs only). */
  storage?: string
  /** KiB/s; undefined = storage default, 0 = unlimited. */
  bwlimit?: number
  unique: boolean
  start: boolean
  liveRestore?: boolean
  /** Containers: keep the backup's privilege level, or force it. */
  unprivileged?: 'keep' | '1' | '0'
  name?: string
  cores?: number
  sockets?: number
  memory?: number
}

/** POST /nodes/{node}/qemu|lxc parameters of a restore (official Restore window). */
export function restoreParams(f: RestoreForm): Record<string, string | number> {
  const params: Record<string, string | number> = { vmid: f.vmid }
  if (f.unique) params.unique = 1
  if (f.start && !f.liveRestore) params.start = 1
  if (f.liveRestore && f.type === 'qemu') params['live-restore'] = 1
  if (f.storage) params.storage = f.storage
  if (f.bwlimit !== undefined && Number.isFinite(f.bwlimit)) params.bwlimit = f.bwlimit
  if (f.cores) params.cores = f.cores
  if (f.memory) params.memory = f.memory
  if (f.sockets && f.type === 'qemu') params.sockets = f.sockets
  const name = f.name?.trim()
  if (f.type === 'lxc') {
    if (name) params.hostname = name
    params.ostemplate = f.volid
    params.restore = 1
    if (f.unprivileged && f.unprivileged !== 'keep') params.unprivileged = Number(f.unprivileged)
  } else {
    if (name) params.name = name
    params.archive = f.volid
  }
  return params
}

// ----------------------------------------------------------------- import

export interface ImportDiskRow {
  /** Drive key of the source guest (scsi0, sata1, efidisk0 …). */
  id: string
  volid: string
  size?: number
  enabled: boolean
  /** Target storage; unset = the default storage. */
  storage?: string | undefined
  /** Format on that storage; unset = the default format. */
  format?: string | undefined
}

export interface ImportNetRow {
  id: string
  model: string
  macaddr?: string | undefined
  /** Bridge on this node; unset = the default bridge. */
  bridge?: string | undefined
  tag?: number | undefined
  enabled: boolean
}

export interface ImportCdRow {
  /** Slot (ide2, sata0 …). */
  id: string
  enabled: boolean
  /** ISO volume; unset = empty drive. */
  iso?: string | undefined
  /**
   * Extra drive for the VirtIO driver ISO (only offered for Windows, like the
   * official wizard when the source has no CD-ROM).
   */
  extra?: boolean
}

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id, undefined, { numeric: true })

/** Highest index used on a bus (ide/sata) by the given drive keys; -1 if none. */
function maxIndex(bus: 'ide' | 'sata', keys: readonly string[]): number {
  let max = -1
  for (const k of keys) {
    const m = new RegExp(`^${bus}(\\d+)$`).exec(k)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

/** SATA has slots 0–5 (PVE.Utils.diskControllerMaxIDs). */
const SATA_SLOTS = 6

/** Slot for the extra VirtIO driver CD (official calculateAdditionalCDIdx); '' when IDE and SATA are full. */
export function extraCdSlot(keys: readonly string[]): string {
  const ide = maxIndex('ide', keys)
  if (ide < 0) return 'ide0'
  if (ide < 2) return 'ide2'
  const sata = maxIndex('sata', keys)
  return sata < SATA_SLOTS - 1 ? `sata${sata + 1}` : ''
}

export interface ImportRows {
  disks: ImportDiskRow[]
  nets: ImportNetRow[]
  cdroms: ImportCdRow[]
}

/** Disk, NIC and CD/DVD rows of an import-metadata answer (official GuestImport load). */
export function importRows(meta: ImportMetadata): ImportRows {
  const disks: ImportDiskRow[] = Object.entries(meta.disks ?? {})
    .map(([id, value]) =>
      typeof value === 'object' && value
        ? { id, volid: value.volid, size: value.size, enabled: true }
        : { id, volid: '', enabled: true },
    )
    .sort(byId)
  const nets: ImportNetRow[] = Object.entries(meta.net ?? {})
    .map(([id, n]) => {
      const tag = n.tag !== undefined && n.tag !== '' ? Number(n.tag) : undefined
      return {
        id,
        model: n.model ?? 'virtio',
        macaddr: n.macaddr,
        bridge: n.bridge,
        tag: tag !== undefined && Number.isFinite(tag) ? tag : undefined,
        enabled: true,
      }
    })
    .sort(byId)
  // CD-ROMs point at the source host's media: keep the drive, pick an ISO here.
  const cdroms: ImportCdRow[] = Object.entries(meta['create-args'])
    .filter(([, v]) => typeof v === 'string' && /media=cdrom/.test(v))
    .map(([id]) => ({ id, enabled: true }))
    .sort(byId)
  if (cdroms.length === 0) {
    const slot = extraCdSlot([...Object.keys(meta['create-args']), ...disks.map((d) => d.id)])
    if (slot) cdroms.push({ id: slot, enabled: true, extra: true })
  }
  return { disks, nets, cdroms }
}

/** NICs keep their source bridge only if it exists on the target node; others use the default bridge. */
export function keepKnownBridges(nets: readonly ImportNetRow[], bridges: readonly string[]): ImportNetRow[] {
  return nets.map((n) => (n.bridge && !bridges.includes(n.bridge) ? { ...n, bridge: undefined } : n))
}

export function isWindowsOs(ostype: string | undefined): boolean {
  return /^(win|w2k|wxp|wvista)/.test(ostype ?? '')
}

/** The extra driver CD shows only for Windows guests. */
export function visibleCdRows(cdroms: readonly ImportCdRow[], ostype: string | undefined): ImportCdRow[] {
  return cdroms.filter((c) => !c.extra || isWindowsOs(ostype))
}

/**
 * "VirtIO-SCSI 准备" (official onPrepareVirtioChange): SCSI disks move to
 * free SATA slots so Windows boots without VirtIO drivers; the controller
 * becomes VirtIO SCSI single for disks added later. A disk that finds no
 * free SATA slot maps to itself (the dialog warns about it).
 */
export function virtioDiskMap(meta: ImportMetadata, rows: ImportRows, ostype: string | undefined): Record<string, string> {
  const keys = [
    ...Object.keys(meta['create-args']),
    ...rows.disks.map((d) => d.id),
    ...rows.cdroms.filter((c) => !c.extra).map((c) => c.id),
  ]
  const sata = maxIndex('sata', keys)
  const extraSata = isWindowsOs(ostype) && rows.cdroms.some((c) => c.extra && c.id.startsWith('sata'))
  const map: Record<string, string> = {}
  for (const d of rows.disks) {
    const m = /^scsi(\d+)$/.exec(d.id)
    if (!m) continue
    const idx = Number(m[1]) + sata + 1 + (extraSata ? 1 : 0)
    map[d.id] = idx < SATA_SLOTS ? `sata${idx}` : d.id
  }
  return map
}

/** Controller to preselect: VirtIO SCSI single when preparing a Windows guest, else the source's ('' = PVE default). */
export function importScsihw(meta: ImportMetadata, ostype: string | undefined, prepareVirtio: boolean): string {
  if (prepareVirtio && isWindowsOs(ostype)) return 'virtio-scsi-single'
  const src = meta['create-args'].scsihw
  return typeof src === 'string' && src !== '__default__' ? src : ''
}

/** "VirtIO-SCSI 准备" starts on for Windows guests with UEFI (official default). */
export function defaultPrepareVirtio(meta: ImportMetadata): boolean {
  const args = meta['create-args']
  return isWindowsOs(String(args.ostype ?? '')) && String(args.bios ?? '').includes('ovmf')
}

/** Storage types whose disks can be qcow2 (others store raw only). */
const QCOW2_STORAGE_TYPES = new Set(['dir', 'nfs', 'cifs', 'glusterfs'])

export function diskFormatFor(storageType: string | undefined): 'qcow2' | 'raw' {
  return storageType && QCOW2_STORAGE_TYPES.has(storageType) ? 'qcow2' : 'raw'
}

/** Official GuestImport CPU type default when the source names none. */
export const IMPORT_DEFAULT_CPU = 'x86-64-v2-AES'

export interface ImportForm {
  vmid: number
  name?: string
  sockets?: number | undefined
  cores?: number | undefined
  memory?: number | undefined
  /** Default target storage for the disks. */
  storage: string
  /** Default format; unset = from the storage type (storageType). */
  format?: string | undefined
  storageType?: string | undefined
  /** Default bridge for NICs without one. */
  bridge: string
  /** OS type override; unset = the source's. */
  ostype?: string | undefined
  /** SCSI controller: unset = the source's, '' = PVE default. */
  scsihw?: string | undefined
  /** Map SCSI disks to SATA (Windows, see virtioDiskMap). */
  prepareVirtio?: boolean
  liveImport: boolean
  /** OVA: where the archive is extracted while importing. */
  workingStorage?: string | undefined
  /** Let PVE generate new MAC addresses. */
  uniqueMacs: boolean
  disks: ImportDiskRow[]
  nets: ImportNetRow[]
  /** CD/DVD drives; unset = keep the source's drives, empty. */
  cdroms?: ImportCdRow[]
}

/**
 * POST /nodes/{node}/qemu parameters for an OVA/OVF/ESXi import (official
 * GuestImport onGetValues): the metadata's create-args, overridden by the
 * form; every enabled disk as "<storage>:0,import-from=<volid>,format=…" on
 * its own or the default storage (moved to SATA when preparing for VirtIO,
 * with the boot order following), NICs with model, MAC, bridge and VLAN,
 * and CD/DVD drives with their ISO.
 */
export function importParams(meta: ImportMetadata, f: ImportForm): Record<string, string | number> {
  const config: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(meta['create-args'])) {
    if (typeof v === 'string' && /media=cdrom/.test(v)) config[k] = 'none,media=cdrom'
    else config[k] = v
  }
  config.vmid = f.vmid
  const name = f.name?.trim()
  if (name) config.name = name
  if (f.sockets) config.sockets = f.sockets
  if (f.cores) config.cores = f.cores
  if (f.memory) config.memory = f.memory
  if (f.ostype) config.ostype = f.ostype
  if (config.cpu === undefined) config.cpu = IMPORT_DEFAULT_CPU
  if (f.scsihw !== undefined) {
    if (f.scsihw) config.scsihw = f.scsihw
    else delete config.scsihw
  }

  const ostype = typeof config.ostype === 'string' ? config.ostype : undefined
  const rows: ImportRows = { disks: f.disks, nets: f.nets, cdroms: f.cdroms ?? [] }
  const diskMap = f.prepareVirtio && isWindowsOs(ostype) ? virtioDiskMap(meta, rows, ostype) : {}
  const defaultFormat = f.format ?? diskFormatFor(f.storageType)
  // Only "order=a;b" boot strings follow renamed disks (not the legacy "cdn" form).
  const boot = tryParsePropertyString(typeof config.boot === 'string' && /(^|,)order=/.test(config.boot) ? config.boot : undefined)
  const order = boot.order ? boot.order.split(';') : null
  for (const d of f.disks) {
    if (!d.enabled) continue
    const id = diskMap[d.id] ?? d.id
    if (id !== d.id && order) {
      const i = order.indexOf(d.id)
      if (i !== -1) order[i] = id
    }
    const file = `${d.storage || f.storage}:0`
    const format = d.format ?? defaultFormat
    if (d.id === 'efidisk0') {
      config[id] = stringifyPropertyString({ file, efitype: '4m', format }, 'file')
      continue
    }
    if (!d.volid) continue
    config[id] = stringifyPropertyString({ file, 'import-from': d.volid, format }, 'file')
  }
  if (order) config.boot = stringifyPropertyString({ ...boot, order: order.join(';') })

  for (const n of f.nets) {
    if (!n.enabled) continue
    const head = !f.uniqueMacs && n.macaddr ? `${n.model}=${n.macaddr}` : n.model
    config[n.id] = [head, `bridge=${n.bridge || f.bridge}`, n.tag !== undefined ? `tag=${n.tag}` : null].filter(Boolean).join(',')
  }
  if (f.cdroms) {
    for (const c of visibleCdRows(f.cdroms, ostype)) {
      if (!c.enabled) {
        delete config[c.id]
        continue
      }
      config[c.id] = `${c.iso || 'none'},media=cdrom`
    }
  }
  if (f.liveImport) config['live-restore'] = 1
  if (f.workingStorage) config['import-working-storage'] = f.workingStorage
  for (const [k, v] of Object.entries(config)) if (v === '__default__') delete config[k]
  return config
}

export interface DiskImportForm {
  vmid: number
  name?: string
  cores: number
  memory: number
  storage: string
  /** Disk format; unset = from the storage type. */
  format?: string | undefined
  storageType?: string | undefined
  bridge: string
  volid: string
}

/** A new VM around one imported disk image (raw / qcow2 / vmdk). */
export function diskImportParams(f: DiskImportForm): Record<string, string | number> {
  const params: Record<string, string | number> = {
    vmid: f.vmid,
    cores: f.cores,
    memory: f.memory,
    ostype: 'l26',
    scsihw: 'virtio-scsi-single',
    scsi0: stringifyPropertyString(
      { file: `${f.storage}:0`, 'import-from': f.volid, format: f.format ?? diskFormatFor(f.storageType) },
      'file',
    ),
    net0: `virtio,bridge=${f.bridge}`,
    boot: 'order=scsi0',
  }
  const name = f.name?.trim()
  if (name) params.name = name
  return params
}

/** Chinese text for an import-metadata warning. */
export function importWarningText(w: { type: string; key?: string; value?: string; message?: string }): string {
  const k = w.key ?? '?'
  const v = w.value ?? '?'
  switch (w.type) {
    case 'cdrom-image-ignored':
      return `CD-ROM 镜像 ${v} 无法导入，已忽略（${k}）`
    case 'efi-state-lost':
      return 'EFI 状态无法导入，可能需要重新配置启动项'
    case 'guest-is-running':
      return '源虚拟机正在运行，导入前请先关机'
    case 'nvme-unsupported':
      return `NVMe 磁盘 ${k} 不受支持，已改为 SCSI`
    case 'ovmf-with-lsi-unsupported':
      return 'OVMF 固件不支持 LSI 控制器，请改用其他 SCSI 控制器'
    case 'serial-port-socket-only':
      return `串口 ${k} 只能作为 socket 导入`
    case 'ova-needs-extracting':
      return '导入 OVA 需要先解包，会临时占用工作存储的空间'
    default:
      return w.message ?? w.type
  }
}
