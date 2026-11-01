// Pure logic of the VM hardware view: pending split, row building, summaries
// and free-slot helpers. No React here (unit tested in model.test.ts).

import type { QemuPendingEntry } from '@/api/qemu-config'
import { parseDrive, parseListValue, parseQemuNet, propBool, tryParsePropertyString } from '@/lib/propstring'
import { parsePveSize } from '@/lib/size'

import {
  ALLOWED_BUSES,
  BIOS,
  BUS_MAX,
  BACKEND_CPU,
  DEFAULT_MACHINE,
  HW_MAX,
  NIC_MODEL_LABEL,
  SCSIHW,
  VGA_TYPES,
  type Arch,
} from './constants'

/** A VM config with every value as a string. */
export type Config = Record<string, string>

// --------------------------------------------------------------- pending

export interface PendingState {
  /** Values in effect now. */
  current: Config
  /** Values after the pending changes (what GET .../config returns). */
  next: Config
  /** Keys with a pending value or a pending deletion. */
  pending: Set<string>
  /** Keys whose deletion is pending. */
  deleting: Set<string>
  digest: string | undefined
}

/** Split GET .../pending into the current and the pending-applied config. */
export function splitPending(entries: readonly QemuPendingEntry[] | undefined): PendingState {
  const current: Config = {}
  const next: Config = {}
  const pending = new Set<string>()
  const deleting = new Set<string>()
  for (const e of entries ?? []) {
    const value = e.value === undefined || e.value === null ? undefined : String(e.value)
    const pend = e.pending === undefined || e.pending === null || e.pending === '' ? undefined : String(e.pending)
    if (value !== undefined) current[e.key] = value
    if (e.delete) {
      deleting.add(e.key)
      pending.add(e.key)
    } else if (pend !== undefined) {
      next[e.key] = pend
      pending.add(e.key)
    } else if (value !== undefined) {
      next[e.key] = value
    }
  }
  return { current, next, pending, deleting, digest: current.digest ?? next.digest }
}

// ---------------------------------------------------------------- values

/** "2048" or "current=2048" (PVE 9 property string) → MiB; default 512. */
export function parseMemory(value: string | undefined): number {
  if (!value) return 512
  const cur = tryParsePropertyString(value, 'current').current
  const n = Number(cur ?? value)
  return Number.isFinite(n) && n > 0 ? n : 512
}

/** MiB → "512 MiB", "2 GiB", "1.5 GiB". */
export function formatMiB(mib: number): string {
  if (mib >= 1024) {
    const g = mib / 1024
    return `${Number.isInteger(g) ? g : Math.round(g * 100) / 100} GiB`
  }
  return `${mib} MiB`
}

export function guestArch(cfg: Config): Arch {
  return cfg.arch === 'aarch64' ? 'aarch64' : 'x86_64'
}

/** Parse cpu: "[cputype=]host,flags=+aes;-pcid,hidden=1". */
export function parseCpu(value: string | undefined): Record<string, string> & { cputype?: string } {
  return tryParsePropertyString(value, 'cputype')
}

/** "+aes;-pcid" → { aes: '+', pcid: '-' }. */
export function parseCpuFlags(flags: string | undefined): Record<string, '+' | '-'> {
  const out: Record<string, '+' | '-'> = {}
  for (const f of parseListValue(flags)) {
    const sign = f[0]
    if ((sign === '+' || sign === '-') && f.length > 1) out[f.slice(1)] = sign
  }
  return out
}

export function stringifyCpuFlags(flags: Record<string, '+' | '-' | undefined>): string {
  return Object.entries(flags)
    .filter((e): e is [string, '+' | '-'] => e[1] === '+' || e[1] === '-')
    .map(([name, sign]) => `${sign}${name}`)
    .join(';')
}

// ----------------------------------------------------------------- kinds

export const DRIVE_RE = /^(ide|sata|scsi|virtio)(\d+)$/

export function isCloudinitDrive(value: string | undefined): boolean {
  return !!value && /vm-\d+-cloudinit/.test(value)
}

export function isCdromDrive(value: string | undefined): boolean {
  return !!value && /(^|,)media=cdrom(,|$)/.test(value)
}

export type HwKind =
  | 'arch'
  | 'memory'
  | 'processors'
  | 'bios'
  | 'display'
  | 'machine'
  | 'scsihw'
  | 'disk'
  | 'cdrom'
  | 'cloudinit'
  | 'efidisk'
  | 'tpmstate'
  | 'unused'
  | 'vmstate'
  | 'net'
  | 'usb'
  | 'hostpci'
  | 'serial'
  | 'audio'
  | 'rng'
  | 'virtiofs'

export type HwSection = 'system' | 'storage' | 'network' | 'devices'

export const HW_SECTION_LABEL: Record<HwSection, string> = {
  system: '系统',
  storage: '存储',
  network: '网络',
  devices: '其他设备',
}

/** Kind of a config key, or null when it is not a hardware row. */
export function hwKind(key: string, value: string | undefined): HwKind | null {
  if (DRIVE_RE.test(key)) {
    if (isCloudinitDrive(value)) return 'cloudinit'
    if (isCdromDrive(value)) return 'cdrom'
    return 'disk'
  }
  if (/^net\d+$/.test(key)) return 'net'
  if (/^usb\d+$/.test(key)) return 'usb'
  if (/^hostpci\d+$/.test(key)) return 'hostpci'
  if (/^serial\d+$/.test(key)) return 'serial'
  if (/^virtiofs\d+$/.test(key)) return 'virtiofs'
  if (/^unused\d+$/.test(key)) return 'unused'
  switch (key) {
    case 'arch':
      return 'arch'
    case 'efidisk0':
      return 'efidisk'
    case 'tpmstate0':
      return 'tpmstate'
    case 'audio0':
      return 'audio'
    case 'rng0':
      return 'rng'
    case 'vmstate':
      return 'vmstate'
    default:
      return null
  }
}

const SECTION: Record<HwKind, HwSection> = {
  arch: 'system',
  memory: 'system',
  processors: 'system',
  bios: 'system',
  display: 'system',
  machine: 'system',
  scsihw: 'system',
  disk: 'storage',
  cdrom: 'storage',
  cloudinit: 'storage',
  efidisk: 'storage',
  tpmstate: 'storage',
  unused: 'storage',
  vmstate: 'storage',
  net: 'network',
  usb: 'devices',
  hostpci: 'devices',
  serial: 'devices',
  audio: 'devices',
  rng: 'devices',
  virtiofs: 'devices',
}

const KIND_ORDER: Record<HwKind, number> = {
  arch: 1,
  memory: 2,
  processors: 3,
  bios: 4,
  display: 5,
  machine: 6,
  scsihw: 7,
  disk: 10,
  cdrom: 10,
  cloudinit: 10,
  efidisk: 20,
  tpmstate: 22,
  unused: 99,
  vmstate: 100,
  net: 15,
  usb: 25,
  hostpci: 30,
  serial: 35,
  audio: 40,
  rng: 45,
  virtiofs: 50,
}

const BUS_ORDER: Record<string, number> = { ide: 0, sata: 1, scsi: 2, virtio: 3 }

/** Sort key inside a kind group: bus, then the device number. */
function slotOrder(key: string): [number, number] {
  const drive = DRIVE_RE.exec(key)
  if (drive) return [BUS_ORDER[drive[1]!] ?? 9, Number(drive[2])]
  const n = /(\d+)$/.exec(key)
  return [0, n ? Number(n[1]) : 0]
}

/** Config keys shown by the multi-key rows. */
export const MEMORY_KEYS = ['memory', 'balloon', 'shares', 'allow-ksm'] as const
export const PROCESSOR_KEYS = ['sockets', 'cores', 'cpu', 'numa', 'vcpus', 'cpulimit', 'cpuunits', 'affinity'] as const

export function kindTitle(kind: HwKind, key: string): string {
  switch (kind) {
    case 'arch':
      return 'vCPU 架构'
    case 'memory':
      return '内存'
    case 'processors':
      return '处理器'
    case 'bios':
      return 'BIOS'
    case 'display':
      return '显示'
    case 'machine':
      return '机器类型'
    case 'scsihw':
      return 'SCSI 控制器'
    case 'disk':
      return `硬盘 (${key})`
    case 'cdrom':
      return `CD/DVD 光驱 (${key})`
    case 'cloudinit':
      return `Cloud-Init 驱动器 (${key})`
    case 'efidisk':
      return 'EFI 磁盘'
    case 'tpmstate':
      return 'TPM 状态'
    case 'unused':
      return `未使用的磁盘 ${key.replace('unused', '')}`
    case 'vmstate':
      return '休眠状态'
    case 'net':
      return `网络设备 (${key})`
    case 'usb':
      return `USB 设备 (${key})`
    case 'hostpci':
      return `PCI 设备 (${key})`
    case 'serial':
      return `串口 (${key})`
    case 'audio':
      return '音频设备'
    case 'rng':
      return 'VirtIO RNG'
    case 'virtiofs':
      return `Virtiofs (${key})`
  }
}

// ------------------------------------------------------------- summaries

const join = (parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' · ')

function memorySummary(cfg: Config): string {
  const memory = parseMemory(cfg.memory)
  const balloon = cfg.balloon === undefined ? undefined : Number(cfg.balloon)
  return join([
    balloon !== undefined && balloon > 0 && balloon !== memory
      ? `${formatMiB(memory)}（最小 ${formatMiB(balloon)}）`
      : formatMiB(memory),
    balloon === 0 && '无 Ballooning',
    cfg.shares && `份额 ${cfg.shares}`,
    cfg['allow-ksm'] === '0' && '禁用 KSM',
  ])
}

function processorSummary(cfg: Config, arch: Arch): string {
  const sockets = Number(cfg.sockets ?? 1) || 1
  const cores = Number(cfg.cores ?? 1) || 1
  const cpu = parseCpu(cfg.cpu)
  const type = cpu.cputype ?? BACKEND_CPU[arch]
  return join([
    `${sockets * cores} 核`,
    sockets > 1 ? `${sockets} 插槽 × ${cores} 核` : null,
    cpu.cputype ? type.replace(/^custom-/, '自定义 ') : `${type}（默认）`,
    cpu.flags && `标志 ${cpu.flags}`,
    propBool(cfg.numa) && 'NUMA',
    cfg.vcpus && `vCPU ${cfg.vcpus}`,
    cfg.cpulimit && cfg.cpulimit !== '0' && `限制 ${cfg.cpulimit}`,
    cfg.cpuunits && `权重 ${cfg.cpuunits}`,
    cfg.affinity && `亲和 ${cfg.affinity}`,
  ])
}

function displaySummary(value: string | undefined): string {
  if (!value) return '默认'
  const vga = tryParsePropertyString(value, 'type')
  return join([
    vga.type ? (VGA_TYPES[vga.type] ?? vga.type) : '默认',
    vga.memory && `显存 ${vga.memory} MiB`,
    vga.clipboard === 'vnc' && 'VNC 剪贴板',
  ])
}

export function machineSummary(value: string | undefined, arch: Arch): string {
  const m = tryParsePropertyString(value, 'type')
  return join([
    m.type || `默认 (${DEFAULT_MACHINE[arch]})`,
    m.viommu && `vIOMMU ${m.viommu === 'intel' ? 'Intel' : 'VirtIO'}`,
    m['aw-bits'] && `地址位宽 ${m['aw-bits']}`,
    m['enable-s3'] === '1' && 'S3',
    m['enable-s4'] === '1' && 'S4',
  ])
}

function sizeOf(drive: Record<string, string>): string | null {
  if (!drive.size) return null
  const bytes = parsePveSize(drive.size)
  if (bytes === null) return drive.size
  const g = bytes / 1024 ** 3
  if (g >= 1) return `${Number.isInteger(g) ? g : Math.round(g * 100) / 100} GiB`
  return `${Math.round(bytes / 1024 ** 2)} MiB`
}

function diskSummary(value: string): string {
  const d = parseDrive(value)
  return join([
    d.file,
    sizeOf(d),
    d.format && d.format !== 'raw' && d.format,
    d.cache && `缓存 ${d.cache}`,
    d.discard === 'on' && 'Discard',
    propBool(d.iothread) && 'IO thread',
    propBool(d.ssd) && 'SSD',
    propBool(d.ro) && '只读',
    d.backup === '0' && '不备份',
    d.replicate === '0' && '不复制',
    d.aio && `AIO ${d.aio}`,
    (d.mbps_rd || d.mbps_wr || d.iops_rd || d.iops_wr) && '限速',
  ])
}

function cdromSummary(value: string): string {
  const d = parseDrive(value)
  if (d.file === 'none' || !d.file) return '无介质'
  if (d.file === 'cdrom') return '物理光驱'
  return d.file
}

function netSummary(value: string): string {
  const n = parseQemuNet(value)
  if (!n) return value
  const o = n.options
  return join([
    NIC_MODEL_LABEL[n.model]?.split('（')[0] ?? n.model,
    n.macaddr,
    o.bridge,
    o.tag && `VLAN ${o.tag}`,
    propBool(o.firewall) && '防火墙',
    propBool(o.link_down) && '已断开',
    o.rate && `限速 ${o.rate} MB/s`,
    o.queues && `${o.queues} 队列`,
    o.mtu && `MTU ${o.mtu === '1' ? '继承网桥' : o.mtu}`,
    o.trunks && `Trunks ${o.trunks}`,
  ])
}

function usbSummary(value: string): string {
  if (value === 'spice' || value.startsWith('spice,')) return 'SPICE 端口重定向'
  const u = tryParsePropertyString(value, 'host')
  const usb3 = propBool(u.usb3) ? 'USB 3' : null
  if (u.mapping) return join([`映射 ${u.mapping}`, usb3])
  if (u.host === 'spice') return join(['SPICE 端口重定向', usb3])
  if (u.host && /^[0-9a-f]{4}:[0-9a-f]{4}$/i.test(u.host)) return join([`设备 ${u.host}`, usb3])
  if (u.host) return join([`端口 ${u.host}`, usb3])
  return value
}

function pciSummary(value: string): string {
  const h = tryParsePropertyString(value, 'host')
  return join([
    h.mapping ? `映射 ${h.mapping}` : h.host,
    h.mdev && `mdev ${h.mdev}`,
    propBool(h['x-vga']) && '主 GPU',
    propBool(h.pcie) && 'PCIe',
    h.rombar === '0' && 'ROM-Bar 关闭',
  ])
}

function efiSummary(value: string): string {
  const d = parseDrive(value)
  return join([
    d.file,
    sizeOf(d),
    d.efitype && `类型 ${d.efitype}`,
    propBool(d['pre-enrolled-keys']) && '预注册密钥',
    d['ms-cert'] && `微软证书 ${d['ms-cert']}`,
  ])
}

function rngSummary(value: string): string {
  const r = tryParsePropertyString(value, 'source')
  const max = r.max_bytes
  return join([
    r.source,
    max === '0' ? '不限速' : `${max ?? 1024} 字节 / ${r.period ?? 1000} ms`,
  ])
}

function virtiofsSummary(value: string): string {
  const v = tryParsePropertyString(value, 'dirid')
  return join([
    v.dirid,
    v.cache && `缓存 ${v.cache}`,
    propBool(v['expose-acl']) ? 'ACL' : propBool(v['expose-xattr']) && 'xattr',
    propBool(v['direct-io']) && 'Direct IO',
  ])
}

/** One-line description of a hardware row from a config. */
export function hwSummary(kind: HwKind, key: string, cfg: Config): string {
  const arch = guestArch(cfg)
  const value = cfg[key]
  switch (kind) {
    case 'arch':
      return value === 'aarch64' ? 'ARM（64 位）' : value === 'x86_64' ? 'x86（64 位）' : '默认（主机架构）'
    case 'memory':
      return memorySummary(cfg)
    case 'processors':
      return processorSummary(cfg, arch)
    case 'bios':
      return value ? (BIOS[value] ?? value) : `默认 (${arch === 'aarch64' ? 'OVMF (UEFI)' : 'SeaBIOS'})`
    case 'display':
      return displaySummary(value)
    case 'machine':
      return machineSummary(value, arch)
    case 'scsihw':
      return value ? (SCSIHW[value] ?? value) : '默认 (LSI 53C895A)'
  }
  if (value === undefined) return ''
  switch (kind) {
    case 'disk':
    case 'cloudinit':
    case 'tpmstate':
      return kind === 'tpmstate'
        ? join([parseDrive(value).file, parseDrive(value).version])
        : diskSummary(value)
    case 'cdrom':
      return cdromSummary(value)
    case 'efidisk':
      return efiSummary(value)
    case 'net':
      return netSummary(value)
    case 'usb':
      return usbSummary(value)
    case 'hostpci':
      return pciSummary(value)
    case 'serial':
      return value === 'socket' ? 'Socket' : value
    case 'audio': {
      const a = tryParsePropertyString(value, 'device')
      return join([a.device, a.driver === 'none' ? '无后端' : (a.driver ?? 'spice').toUpperCase()])
    }
    case 'rng':
      return rngSummary(value)
    case 'virtiofs':
      return virtiofsSummary(value)
    default:
      return value
  }
}

// ------------------------------------------------------------------ rows

export type HwRowStatus = 'unchanged' | 'changed' | 'added' | 'removed'

export interface HwRow {
  /** Row id: the config key, or "memory" / "processors" / "display". */
  id: string
  /** Main config key (efidisk0, scsi0, vga, memory, sockets, …). */
  key: string
  kind: HwKind
  /** Keys this row covers (revert sends all of them). */
  keys: string[]
  section: HwSection
  title: string
  /** Summary of the value in effect (empty for rows that only exist as pending). */
  summary: string
  /** Summary after the pending change, when it differs. */
  pendingSummary?: string
  status: HwRowStatus
}

const CORE_ROWS: { id: string; key: string; kind: HwKind; keys: readonly string[] }[] = [
  { id: 'memory', key: 'memory', kind: 'memory', keys: MEMORY_KEYS },
  { id: 'processors', key: 'sockets', kind: 'processors', keys: PROCESSOR_KEYS },
  { id: 'bios', key: 'bios', kind: 'bios', keys: ['bios'] },
  { id: 'display', key: 'vga', kind: 'display', keys: ['vga'] },
  { id: 'machine', key: 'machine', kind: 'machine', keys: ['machine'] },
  { id: 'scsihw', key: 'scsihw', kind: 'scsihw', keys: ['scsihw'] },
]

function rowStatus(state: PendingState, key: string, keys: readonly string[], always: boolean): HwRowStatus {
  if (!keys.some((k) => state.pending.has(k))) return 'unchanged'
  if (always) return 'changed'
  const before = state.current[key] !== undefined
  const after = state.next[key] !== undefined
  if (!before && after) return 'added'
  if (before && !after) return 'removed'
  return 'changed'
}

/** All hardware rows in display order. */
export function hardwareRows(state: PendingState): HwRow[] {
  const rows: (HwRow & { order: [number, number, number] })[] = []
  for (const core of CORE_ROWS) {
    const status = rowStatus(state, core.key, core.keys, true)
    const summary = hwSummary(core.kind, core.key, state.current)
    const pendingSummary = status === 'unchanged' ? undefined : hwSummary(core.kind, core.key, state.next)
    rows.push({
      id: core.id,
      key: core.key,
      kind: core.kind,
      keys: [...core.keys],
      section: SECTION[core.kind],
      title: kindTitle(core.kind, core.key),
      summary,
      pendingSummary: pendingSummary !== summary ? pendingSummary : undefined,
      status,
      order: [KIND_ORDER[core.kind], 0, 0],
    })
  }
  const keys = new Set([...Object.keys(state.current), ...Object.keys(state.next), ...state.deleting])
  for (const key of keys) {
    const value = state.next[key] ?? state.current[key]
    const kind = hwKind(key, value)
    if (!kind) continue
    const status = rowStatus(state, key, [key], false)
    const summary = state.current[key] !== undefined ? hwSummary(kind, key, state.current) : ''
    const after = state.next[key] !== undefined ? hwSummary(kind, key, state.next) : ''
    const [a, b] = slotOrder(key)
    rows.push({
      id: key,
      key,
      kind,
      keys: [key],
      section: SECTION[kind],
      title: kindTitle(kind, key),
      summary,
      pendingSummary: status === 'changed' && after !== summary ? after : status === 'added' ? after : undefined,
      status,
      order: [KIND_ORDER[kind], a, b],
    })
  }
  rows.sort((x, y) => x.order[0] - y.order[0] || x.order[1] - y.order[1] || x.order[2] - y.order[2])
  return rows.map(({ order: _order, ...row }) => row)
}

// ------------------------------------------------------------- free slots

/** Bus preference for new disks: the most used bus first, then by OS type. */
export function busPreference(cfg: Config): string[] {
  const arch = guestArch(cfg)
  const allowed = ALLOWED_BUSES[arch]
  const virtioOs = cfg.ostype === 'l26' || arch === 'aarch64'
  const priority: Record<string, number> = virtioOs
    ? { scsi: 4, virtio: 3, sata: 2, ide: 1 }
    : { ide: 4, sata: 3, scsi: 2, virtio: 1 }
  const used: Record<string, number> = { ide: 0, sata: 0, scsi: 0, virtio: 0 }
  for (const [key, value] of Object.entries(cfg)) {
    const m = DRIVE_RE.exec(key)
    if (m && !isCdromDrive(value)) used[m[1]!]! += 1
  }
  return [...allowed].sort((a, b) => used[b]! - used[a]! || priority[b]! - priority[a]!)
}

/** First free "<bus><n>" on the given buses, or undefined. */
export function nextFreeDrive(cfg: Config, buses: readonly string[]): { bus: string; index: number } | undefined {
  for (const bus of buses) {
    for (let i = 0; i < (BUS_MAX[bus] ?? 0); i++) {
      if (cfg[`${bus}${i}`] === undefined) return { bus, index: i }
    }
  }
  return undefined
}

/** First free "<prefix><n>" below max, or undefined. */
export function nextFreeKey(cfg: Config, prefix: string, max: number): string | undefined {
  for (let i = 0; i < max; i++) {
    if (cfg[`${prefix}${i}`] === undefined) return `${prefix}${i}`
  }
  return undefined
}

/** Maximum USB devices: 14 for Linux / Windows ≥8 on machine ≥7.1, else 5. */
export function maxUsbCount(cfg: Config): number {
  const ostype = cfg.ostype
  if (!ostype) return HW_MAX.usbOld
  const m = /-(\d+)\.(\d+)/.exec(cfg.machine ?? '')
  const newMachine = !m || Number(m[1]) > 7 || (Number(m[1]) === 7 && Number(m[2]) >= 1)
  if (newMachine) {
    if (ostype === 'l26') return HW_MAX.usb
    const win = /^win(\d+)$/.exec(ostype)
    if (win && Number(win[1]) > 7) return HW_MAX.usb
  }
  return HW_MAX.usbOld
}

export function countKeys(cfg: Config, re: RegExp): number {
  return Object.keys(cfg).filter((k) => re.test(k)).length
}

export function hasCloudinitDrive(state: PendingState): boolean {
  return [...Object.entries(state.current), ...Object.entries(state.next)].some(
    ([k, v]) => DRIVE_RE.test(k) && isCloudinitDrive(v),
  )
}

/** Size in whole GiB of a drive string ("32G" → 32); undefined when unknown. */
export function driveSizeGiB(value: string | undefined): number | undefined {
  const bytes = parsePveSize(parseDrive(value).size)
  return bytes === null ? undefined : bytes / 1024 ** 3
}

