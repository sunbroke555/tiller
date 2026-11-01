// Pure logic of the disks tab: disk tree and labels, SMART attributes, zpool
// vdev tree, LVM tree, name validation and form → API params. Rules mirror
// the official UI (Proxmox.DiskList, PVE.node.Create*) and the API's own
// checks (PVE::API2::Disks::ZFS), so mistakes are caught before submitting.

import type {
  DiskEntry,
  DiskStorageKind,
  LvmPhysicalVolume,
  LvmTree,
  LvmVolumeGroup,
  RawSmartAttribute,
  SmartData,
  ZfsPoolDetail,
  ZfsVdev,
} from '@/api/node-disks'
import type { Params } from '@/api/client'

// ------------------------------------------------------------- disk list

export interface DiskNode extends DiskEntry {
  partitions: DiskEntry[]
}

const byDevpath = (a: { devpath: string }, b: { devpath: string }) =>
  a.devpath.localeCompare(b.devpath, undefined, { numeric: true })

/**
 * Group the flat list (partitions carry `parent`) into disks with their
 * partitions, sorted by device path (sdb2 before sdb10). Partitions of a disk
 * that is not listed become top-level entries.
 */
export function buildDiskTree(list: readonly DiskEntry[]): DiskNode[] {
  const disks = new Map<string, DiskNode>()
  for (const d of list) {
    if (d.parent) continue
    disks.set(d.devpath, { ...d, partitions: [...(d.partitions ?? [])] })
  }
  for (const d of list) {
    if (!d.parent) continue
    const parent = disks.get(d.parent)
    if (parent) parent.partitions.push(d)
    else disks.set(d.devpath, { ...d, partitions: [] })
  }
  const out = [...disks.values()].sort(byDevpath)
  for (const d of out) d.partitions.sort(byDevpath)
  return out
}

export function isPartition(d: DiskEntry): boolean {
  return !!d.parent || d.type === 'partition'
}

export function diskTypeLabel(type: string | undefined): string {
  switch (type) {
    case 'ssd':
      return 'SSD'
    case 'hdd':
      return 'HDD'
    case 'nvme':
      return 'NVMe'
    case 'usb':
      return 'USB'
    case 'partition':
      return '分区'
    case undefined:
    case '':
    case 'unknown':
      return '未知'
    default:
      return type
  }
}

const USED_LABEL: Record<string, string> = {
  partitions: '分区',
  mounted: '已挂载',
  'BIOS boot': 'BIOS 启动',
  bios: 'BIOS 启动',
  EFI: 'EFI',
  efi: 'EFI',
  LVM: 'LVM',
  lvm: 'LVM',
  ZFS: 'ZFS',
  zfs: 'ZFS',
  'ZFS reserved': 'ZFS 保留',
  zfsreserved: 'ZFS 保留',
  'Device Mapper': 'Device Mapper',
  unused: '未使用',
}

function cephUsage(d: DiskEntry): string[] {
  const types: string[] = []
  const osds = d['osdid-list'] ?? []
  if (osds.length > 0) for (const id of [...osds].sort((a, b) => a - b)) types.push(`OSD.${id}`)
  else if (typeof d.osdid === 'number' && d.osdid >= 0) types.push(`OSD.${d.osdid}`)
  if ((d.journals ?? 0) > 0) types.push('Journal')
  if ((d.db ?? 0) > 0) types.push('DB')
  if ((d.wal ?? 0) > 0) types.push('WAL')
  return types
}

/** "未使用", "LVM", "ext4", "分区", "Ceph (OSD.1)", "LVM, Ceph (DB)" … */
export function diskUsageLabel(d: DiskEntry): string {
  const used = d.used === 'filesystem' ? (d.filesystem ?? '文件系统') : d.used
  const base = used ? (USED_LABEL[used] ?? used) : ''
  const ceph = cephUsage(d)
  const cephText = ceph.length ? `Ceph (${ceph.join(', ')})` : ''
  if (base && cephText) return `${base}, ${cephText}`
  return base || cephText || '未使用'
}

/** Whether something uses the disk/partition (LVM, ZFS, a filesystem, partitions, Ceph…). */
export function diskInUse(d: DiskEntry): boolean {
  return (!!d.used && d.used !== 'unused') || cephUsage(d).length > 0 || truthy(d.mounted)
}

/** Official rule: only whole disks that nothing uses can get a new GPT. */
export function canInitGpt(d: DiskEntry): boolean {
  return !isPartition(d) && !diskInUse(d)
}

export function truthy(v: number | boolean | string | undefined | null): boolean {
  return v === true || v === 1 || v === '1'
}

/** Remaining life in percent (100 − wearout), or null when unknown ("N/A"). */
export function wearoutLeft(wearout: number | string | undefined): number | null {
  if (wearout === undefined || wearout === null || wearout === '') return null
  const n = typeof wearout === 'number' ? wearout : Number(wearout)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, 100 - n))
}

export type HealthTone = 'ok' | 'warn' | 'bad' | 'unknown'

/** SMART health: "PASSED" / "OK" good, "FAILED…" bad, anything else unknown. */
export function smartHealthTone(health: string | undefined): HealthTone {
  const h = (health ?? '').trim().toUpperCase()
  if (h === 'PASSED' || h === 'OK') return 'ok'
  if (h.startsWith('FAIL')) return 'bad'
  return 'unknown'
}

export function smartHealthLabel(health: string | undefined): string {
  const h = (health ?? '').trim()
  if (!h || h.toUpperCase() === 'UNKNOWN') return '未知'
  return h
}

/** "/dev/disk/by-id/ata-Samsung…-part1" → "ata-Samsung…-part1"; "/dev/sdb" stays. */
export function shortDevice(name: string): string {
  const m = /^\/dev\/disk\/by-[a-z]+\/(.+)$/.exec(name)
  return m ? m[1]! : name
}

// ------------------------------------------------------------------ SMART

export interface SmartAttribute {
  id: number | null
  name: string
  /** The raw value (older APIs: `value`). */
  value: string
  /** Normalized value (older APIs: `value`). */
  normalized: string
  worst: string
  threshold: string
  flags: string
  /** smartctl WHEN_FAILED: "-" (never), "FAILING_NOW", "In_the_past". */
  fail: string
  failing: boolean
}

export type SmartView =
  | { kind: 'attributes'; health: string | undefined; attributes: SmartAttribute[] }
  | { kind: 'text'; health: string | undefined; text: string }
  | { kind: 'empty'; health: string | undefined }

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim())

export function parseSmartAttribute(a: RawSmartAttribute): SmartAttribute {
  const id = Number.parseInt(str(a.id), 10)
  const fail = str(a.fail)
  return {
    id: Number.isFinite(id) ? id : null,
    name: str(a.name),
    value: str(a.raw ?? a.value),
    normalized: str(a.normalized ?? a.value),
    worst: str(a.worst),
    threshold: str(a.threshold),
    flags: str(a.flags),
    fail,
    failing: fail !== '' && fail !== '-',
  }
}

/** Attribute table (ATA) or the text output (NVMe, SAS), like Proxmox.window.DiskSmart. */
export function parseSmart(data: SmartData | undefined | null): SmartView {
  const health = data?.health
  if (data?.type === 'text' || (!data?.attributes?.length && data?.text)) {
    return { kind: 'text', health, text: data?.text ?? '' }
  }
  if (data?.attributes?.length) {
    const attributes = data.attributes.map(parseSmartAttribute).sort((a, b) => (a.id ?? 9999) - (b.id ?? 9999))
    return { kind: 'attributes', health, attributes }
  }
  return { kind: 'empty', health }
}

// ------------------------------------------------------------------- ZFS

/** Pool / vdev state: ONLINE good; DEGRADED / REMOVED warn; FAULTED / UNAVAIL / OFFLINE bad. */
export function zfsHealthTone(state: string | undefined): HealthTone {
  switch ((state ?? '').toUpperCase()) {
    case 'ONLINE':
    case 'AVAIL':
      return 'ok'
    case 'DEGRADED':
    case 'REMOVED':
      return 'warn'
    case 'UNAVAIL':
    case 'FAULTED':
    case 'OFFLINE':
      return 'bad'
    default:
      return 'unknown'
  }
}

export interface ZfsVdevRow {
  /** Unique key: the path of names from the top. */
  key: string
  name: string
  depth: number
  state?: string
  read?: number
  write?: number
  cksum?: number
  msg?: string
  leaf: boolean
}

/**
 * The vdev tree as indented rows (the pool itself first, then mirror-0 /
 * raidz1-0 / disks, then sections such as logs, cache, spares).
 */
export function flattenZfsTree(detail: Pick<ZfsPoolDetail, 'children'> | undefined | null): ZfsVdevRow[] {
  const rows: ZfsVdevRow[] = []
  const walk = (list: readonly ZfsVdev[] | undefined, depth: number, prefix: string) => {
    for (const v of list ?? []) {
      const key = `${prefix}/${v.name}`
      const children = v.children ?? []
      rows.push({
        key,
        name: v.name,
        depth,
        state: v.state || undefined,
        read: v.read,
        write: v.write,
        cksum: v.cksum,
        msg: v.msg || undefined,
        leaf: children.length === 0 && (v.leaf === undefined || truthy(v.leaf)),
      })
      walk(children, depth + 1, key)
    }
  }
  walk(detail?.children, 0, '')
  return rows
}

/** Sum of read/write/checksum errors over all vdevs. */
export function zfsErrorCount(rows: readonly ZfsVdevRow[]): number {
  return rows.reduce((n, r) => n + (r.read ?? 0) + (r.write ?? 0) + (r.cksum ?? 0), 0)
}

export interface ZfsScanInfo {
  kind: 'scrub' | 'resilver' | 'none' | 'other'
  inProgress: boolean
  text: string
}

/** Classify `scan` ("scrub repaired 0B in 00:00:01 with 0 errors on …", "scrub in progress since …"). */
export function zfsScanInfo(scan: string | undefined): ZfsScanInfo {
  const text = (scan ?? '').trim()
  if (!text || /^none requested/i.test(text)) return { kind: 'none', inProgress: false, text }
  const inProgress = /in progress/i.test(text)
  if (/^scrub/i.test(text)) return { kind: 'scrub', inProgress, text }
  if (/^resilver/i.test(text)) return { kind: 'resilver', inProgress, text }
  return { kind: 'other', inProgress, text }
}

// ------------------------------------------------------------------- LVM

/** Volume groups sorted by name, each with its physical volumes. */
export function lvmVolumeGroups(tree: LvmTree | undefined | null): (LvmVolumeGroup & { children: LvmPhysicalVolume[] })[] {
  return [...(tree?.children ?? [])]
    .map((vg) => ({ ...vg, children: [...(vg.children ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** used / total in 0..1, or null when the total is unknown. */
export function fraction(used: number | undefined, total: number | undefined): number | null {
  if (!total || total <= 0 || used === undefined || !Number.isFinite(used)) return null
  return Math.max(0, Math.min(1, used / total))
}

/** "/mnt/pve/backup" → "backup" (the name DELETE …/directory/{name} wants). */
export function directoryName(path: string): string {
  return path.replace(/^\/mnt\/pve\//, '')
}

// ------------------------------------------------------------ validation

/** pve-storage-id: starts with a letter, ends with a letter or digit, [a-z0-9-_.] between. */
export const STORAGE_ID_RE = /^[a-z][a-z0-9\-_.]*[a-z0-9]$/i

export function storageIdError(name: string): string | null {
  const v = name.trim()
  if (!v) return '请输入名称'
  if (!STORAGE_ID_RE.test(v)) return '只能用字母、数字、- _ .，以字母开头、字母或数字结尾，至少 2 个字符'
  return null
}

/** Storage ID rules plus zpool_name_valid (reserved names, max length). */
export function zpoolNameError(name: string): string | null {
  const v = name.trim()
  if (/^(mirror|raidz|draid|spare)/.test(v) || v === 'log') return '不能使用保留的池名（mirror、raidz、draid、spare、log 开头）'
  if (v.length > 128) return '名称最长 128 个字符'
  return storageIdError(v)
}

export type ZfsRaidLevel = 'single' | 'mirror' | 'raid10' | 'raidz' | 'raidz2' | 'raidz3' | 'draid' | 'draid2' | 'draid3'

export const ZFS_RAID_LEVELS: readonly { value: ZfsRaidLevel; label: string; min: number; description: string }[] = [
  { value: 'single', label: '单盘', min: 1, description: '没有冗余' },
  { value: 'mirror', label: 'Mirror（镜像）', min: 2, description: '所有盘互为镜像' },
  { value: 'raid10', label: 'RAID10', min: 4, description: '两两镜像再条带，盘数为偶数' },
  { value: 'raidz', label: 'RAIDZ', min: 3, description: '单校验' },
  { value: 'raidz2', label: 'RAIDZ2', min: 4, description: '双校验' },
  { value: 'raidz3', label: 'RAIDZ3', min: 5, description: '三校验' },
  { value: 'draid', label: 'dRAID', min: 3, description: '分布式备盘，单校验' },
  { value: 'draid2', label: 'dRAID2', min: 4, description: '分布式备盘，双校验' },
  { value: 'draid3', label: 'dRAID3', min: 5, description: '分布式备盘，三校验' },
]

export const ZFS_COMPRESSION = ['on', 'off', 'gzip', 'lz4', 'lzjb', 'zle', 'zstd'] as const
export type ZfsCompression = (typeof ZFS_COMPRESSION)[number]

export const ZFS_ASHIFT_MIN = 9
export const ZFS_ASHIFT_MAX = 16
export const ZFS_ASHIFT_DEFAULT = 12

export function isDraid(level: ZfsRaidLevel): boolean {
  return level.startsWith('draid')
}

/** The API's device-count checks for a RAID level (null = fine). */
export function zfsDevicesError(level: ZfsRaidLevel, count: number, draid?: { data?: number; spares?: number }): string | null {
  const min = ZFS_RAID_LEVELS.find((l) => l.value === level)?.min ?? 1
  if (count === 0) return '请选择磁盘'
  if (level === 'single' && count > 1) return '单盘模式只能选择 1 块磁盘'
  if (level === 'raid10' && count % 2 !== 0) return 'RAID10 需要偶数块磁盘'
  if (count < min) return `${ZFS_RAID_LEVELS.find((l) => l.value === level)?.label ?? level} 至少需要 ${min} 块磁盘`
  if (isDraid(level)) {
    const need = min - 2 + (draid?.data ?? 0) + (draid?.spares ?? 0)
    if (count < need) return `当前 dRAID 配置至少需要 ${need} 块磁盘`
  }
  return null
}

export interface ZfsCreateForm {
  name: string
  raidlevel: ZfsRaidLevel
  /** In the chosen order (RAID10 pairs consecutive disks). */
  devices: readonly string[]
  ashift: number
  compression: ZfsCompression
  addStorage: boolean
  draidData?: number | undefined
  draidSpares?: number | undefined
}

export function zfsCreateParams(f: ZfsCreateForm): Params {
  const params: Params = {
    name: f.name.trim(),
    raidlevel: f.raidlevel,
    devices: f.devices.join(','),
    ashift: f.ashift,
    compression: f.compression,
    add_storage: f.addStorage ? 1 : 0,
  }
  if (isDraid(f.raidlevel) && (f.draidData !== undefined || f.draidSpares !== undefined)) {
    const parts: string[] = []
    if (f.draidData !== undefined) parts.push(`data=${f.draidData}`)
    if (f.draidSpares !== undefined) parts.push(`spares=${f.draidSpares}`)
    params['draid-config'] = parts.join(',')
  }
  return params
}

export type DirectoryFilesystem = 'ext4' | 'xfs'

export interface SimpleCreateForm {
  name: string
  device: string
  addStorage: boolean
  /** Directory only. */
  filesystem?: DirectoryFilesystem
}

/** LVM / LVM-Thin / directory create params. */
export function simpleCreateParams(kind: Exclude<DiskStorageKind, 'zfs'>, f: SimpleCreateForm): Params {
  const params: Params = { name: f.name.trim(), device: f.device, add_storage: f.addStorage ? 1 : 0 }
  if (kind === 'directory') params.filesystem = f.filesystem ?? 'ext4'
  return params
}

export interface DestroyOptions {
  cleanupDisks: boolean
  cleanupConfig: boolean
  /** LVM-Thin: the pool's volume group. */
  volumeGroup?: string
}

/** SafeDestroyStorage params: both cleanups as explicit 1/0. */
export function destroyParams(o: DestroyOptions): Params {
  const params: Params = { 'cleanup-disks': o.cleanupDisks ? 1 : 0, 'cleanup-config': o.cleanupConfig ? 1 : 0 }
  if (o.volumeGroup) params['volume-group'] = o.volumeGroup
  return params
}

export const STORAGE_KIND_LABEL: Record<DiskStorageKind, string> = {
  lvm: 'LVM 卷组',
  lvmthin: 'LVM-Thin 池',
  directory: '目录',
  zfs: 'ZFS 池',
}

/** "创建" + "ZFS 池" → "创建 ZFS 池"; "删除" + "目录" → "删除目录" (space only before Latin text). */
export function verbObject(verb: string, kind: DiskStorageKind): string {
  const label = STORAGE_KIND_LABEL[kind]
  return /^[A-Za-z]/.test(label) ? `${verb} ${label}` : `${verb}${label}`
}

/** Task titles (UPID types lvmcreate, zfsremove …). */
export function createTaskTitle(kind: DiskStorageKind, name: string): string {
  return `${verbObject('创建', kind)} ${name}`
}

export function destroyTaskTitle(kind: DiskStorageKind, name: string): string {
  return `${verbObject('删除', kind)} ${name}`
}
