// QEMU creation wizard: form model, OS defaults, validation and the
// form → POST /nodes/{node}/qemu parameter mapping. Pure logic, no React.
//
// Semantics follow the official wizard (PVE.qemu.CreateWizard and its input
// panels in pvemanagerlib.js): ide2 always holds the install medium, the
// optional VirtIO driver ISO goes to ide0 with an explicit boot order, the
// EFI and TPM state disks use "<storage>:1" (size is set by the backend),
// cpu defaults to x86-64-v2-AES, ballooning off means balloon=0.

import type { Params } from '@/api/client'
import { stringifyPropertyString, type PropertyValue } from '@/lib/propstring'

import { isCpuSet, isDnsName, isTag, isUnicastMac, type FieldErrors } from './validate'

// ------------------------------------------------------------- constants

export const QEMU_STEPS = [
  { id: 'general', label: '常规' },
  { id: 'os', label: '操作系统' },
  { id: 'system', label: '系统' },
  { id: 'disks', label: '磁盘' },
  { id: 'cpu', label: 'CPU' },
  { id: 'memory', label: '内存' },
  { id: 'network', label: '网络' },
  { id: 'confirm', label: '确认' },
] as const

export type QemuStepId = (typeof QEMU_STEPS)[number]['id']

export type OsBase = 'Linux' | 'Microsoft Windows' | 'Solaris Kernel' | 'Other'

/** PVE.Utils.kvm_ostypes */
export const OS_TYPES: Record<OsBase, readonly { value: string; label: string }[]> = {
  Linux: [
    { value: 'l26', label: '6.x - 2.6 内核' },
    { value: 'l24', label: '2.4 内核' },
  ],
  'Microsoft Windows': [
    { value: 'win11', label: '11 / 2022 / 2025' },
    { value: 'win10', label: '10 / 2016 / 2019' },
    { value: 'win8', label: '8.x / 2012 / 2012r2' },
    { value: 'win7', label: '7 / 2008r2' },
    { value: 'w2k8', label: 'Vista / 2008' },
    { value: 'wxp', label: 'XP / 2003' },
    { value: 'w2k', label: '2000' },
  ],
  'Solaris Kernel': [{ value: 'solaris', label: 'Solaris' }],
  Other: [{ value: 'other', label: '其他' }],
}

export const OS_BASE_LABEL: Record<OsBase, string> = {
  Linux: 'Linux',
  'Microsoft Windows': 'Windows',
  'Solaris Kernel': 'Solaris',
  Other: '其他',
}

export function osBaseOf(ostype: string): OsBase {
  for (const base of Object.keys(OS_TYPES) as OsBase[]) {
    if (OS_TYPES[base].some((o) => o.value === ostype)) return base
  }
  return 'Other'
}

export function ostypeLabel(ostype: string): string {
  const base = osBaseOf(ostype)
  const entry = OS_TYPES[base].find((o) => o.value === ostype)
  if (base === 'Linux') return `Linux ${entry?.label ?? ostype}`
  if (base === 'Microsoft Windows') return `Windows ${entry?.label ?? ostype}`
  return entry?.label === '其他' ? '其他' : (entry?.label ?? ostype)
}

export type DiskBus = 'scsi' | 'virtio' | 'sata' | 'ide'

/** Highest id + 1 per bus (PVE.Utils.diskControllerMaxIDs). */
export const BUS_MAX: Record<DiskBus, number> = { ide: 4, sata: 6, scsi: 31, virtio: 16 }

export const BUS_LABEL: Record<DiskBus, string> = { scsi: 'SCSI', virtio: 'VirtIO Block', sata: 'SATA', ide: 'IDE' }

/** PVE.qemu.OSDefaults (x86_64). */
export interface OsDefaults {
  busType: DiskBus
  networkCard: string
  scsihw: string
  machine?: string
  bios?: string
}

export function osDefaults(ostype: string): OsDefaults {
  const generic: OsDefaults = { busType: 'ide', networkCard: 'e1000', scsihw: 'virtio-scsi-single' }
  switch (ostype) {
    case 'l26':
      return { ...generic, busType: 'scsi', networkCard: 'virtio' }
    case 'w2k':
    case 'wxp':
      return { ...generic, networkCard: 'rtl8139', scsihw: '' }
    case 'win11':
      return { ...generic, machine: 'q35', bios: 'ovmf' }
    default:
      return generic
  }
}

export function isWindows(ostype: string): boolean {
  return osBaseOf(ostype) === 'Microsoft Windows'
}

/** Memory the official wizard starts with for this OS (MiB). */
export function defaultMemory(ostype: string): number {
  return ostype === 'win11' ? 4096 : 2048
}

export const DEFAULT_CPU_TYPE = 'x86-64-v2-AES'

export const VGA_OPTIONS = [
  { value: 'std', label: '标准 VGA' },
  { value: 'vmware', label: 'VMware 兼容' },
  { value: 'qxl', label: 'SPICE' },
  { value: 'qxl2', label: 'SPICE 双显示器' },
  { value: 'qxl3', label: 'SPICE 三显示器' },
  { value: 'qxl4', label: 'SPICE 四显示器' },
  { value: 'serial0', label: '串口终端 0' },
  { value: 'serial1', label: '串口终端 1' },
  { value: 'serial2', label: '串口终端 2' },
  { value: 'serial3', label: '串口终端 3' },
  { value: 'virtio', label: 'VirtIO-GPU' },
  { value: 'virtio-gl', label: 'VirGL GPU' },
  { value: 'none', label: '无' },
] as const

export const SCSIHW_OPTIONS = [
  { value: 'lsi', label: 'LSI 53C895A' },
  { value: 'lsi53c810', label: 'LSI 53C810' },
  { value: 'megasas', label: 'MegaRAID SAS 8708EM2' },
  { value: 'virtio-scsi-pci', label: 'VirtIO SCSI' },
  { value: 'virtio-scsi-single', label: 'VirtIO SCSI single' },
  { value: 'pvscsi', label: 'VMware PVSCSI' },
] as const

export function scsihwLabel(v: string): string {
  return SCSIHW_OPTIONS.find((o) => o.value === v)?.label ?? (v ? v : '默认 (LSI 53C895A)')
}

export const CACHE_OPTIONS = [
  { value: 'directsync', label: 'Direct sync' },
  { value: 'writethrough', label: 'Write through' },
  { value: 'writeback', label: 'Write back' },
  { value: 'unsafe', label: 'Write back（不安全）' },
  { value: 'none', label: '无缓存' },
] as const

export const AIO_OPTIONS = [
  { value: 'io_uring', label: 'io_uring' },
  { value: 'native', label: 'native' },
  { value: 'threads', label: 'threads' },
] as const

/** NIC models offered by the official UI (PVE.form.NetworkCardSelector). */
export const NIC_MODEL_OPTIONS = [
  { value: 'virtio', label: 'VirtIO（半虚拟化）' },
  { value: 'e1000', label: 'Intel E1000' },
  { value: 'e1000e', label: 'Intel E1000E' },
  { value: 'rtl8139', label: 'Realtek RTL8139' },
  { value: 'vmxnet3', label: 'VMware vmxnet3' },
] as const

export function nicModelLabel(v: string): string {
  return NIC_MODEL_OPTIONS.find((o) => o.value === v)?.label ?? v
}

// ------------------------------------------------------------------ form

export type MediaType = 'iso' | 'cdrom' | 'none'

export type CpuFlagState = '+' | '-'

export type DiskFormat = 'raw' | 'qcow2' | 'vmdk'

export interface QemuDisk {
  /** Stable key for React lists. */
  key: string
  bus: DiskBus
  index: number
  storage: string
  /** GiB */
  size: number | undefined
  /** Only for storages that support more than one format. */
  format: DiskFormat | ''
  cache: string
  discard: boolean
  iothread: boolean
  ssd: boolean
  readonly: boolean
  backup: boolean
  /** Skip replication. */
  noReplicate: boolean
  aio: string
  mbps_rd?: number | undefined
  mbps_wr?: number | undefined
  iops_rd?: number | undefined
  iops_wr?: number | undefined
  mbps_rd_max?: number | undefined
  mbps_wr_max?: number | undefined
  iops_rd_max?: number | undefined
  iops_wr_max?: number | undefined
}

export interface QemuForm {
  // General
  node: string
  vmid: number | undefined
  name: string
  pool: string
  tags: string[]
  onboot: boolean
  startupOrder: number | undefined
  startupUp: number | undefined
  startupDown: number | undefined
  haManaged: boolean
  // OS
  media: MediaType
  isoStorage: string
  iso: string
  ostype: string
  virtioIso: boolean
  virtioIsoStorage: string
  virtioIsoVolume: string
  // System
  vga: string
  machine: '' | 'q35'
  /** Pinned machine version id ("pc-q35-10.1"); '' = latest. */
  machineVersion: string
  bios: '' | 'seabios' | 'ovmf'
  efiDisk: boolean
  efiStorage: string
  efiFormat: DiskFormat | ''
  efiPreEnrolledKeys: boolean
  scsihw: string
  agent: boolean
  tpm: boolean
  tpmStorage: string
  tpmVersion: 'v2.0' | 'v1.2'
  // Disks
  disks: QemuDisk[]
  // CPU
  sockets: number | undefined
  cores: number | undefined
  cputype: string
  vcpus: number | undefined
  cpulimit: number | undefined
  cpuunits: number | undefined
  affinity: string
  numa: boolean
  cpuFlags: Record<string, CpuFlagState>
  // Memory (MiB)
  memory: number | undefined
  ballooning: boolean
  balloon: number | undefined
  shares: number | undefined
  allowKsm: boolean
  // Network
  noNetwork: boolean
  bridge: string
  vlan: number | undefined
  model: string
  macaddr: string
  firewall: boolean
  disconnect: boolean
  mtu: number | undefined
  rate: number | undefined
  queues: number | undefined
  // Confirm
  start: boolean
}

let diskSeq = 0
function diskKey() {
  diskSeq += 1
  return `disk-${diskSeq}`
}

/** iothread is on by default where it helps: VirtIO Block, or SCSI on a virtio-scsi-single controller. */
export function defaultIothread(bus: DiskBus, scsihw: string): boolean {
  return bus === 'virtio' || (bus === 'scsi' && scsihw === 'virtio-scsi-single')
}

/** Drive keys already used by the CD drives. */
export function reservedDriveKeys(form: Pick<QemuForm, 'virtioIso'>): string[] {
  return form.virtioIso ? ['ide2', 'ide0'] : ['ide2']
}

/** Free indexes on a bus, given the other disks and the CD drives. */
export function freeIndexes(form: Pick<QemuForm, 'disks' | 'virtioIso'>, bus: DiskBus, exceptKey?: string): number[] {
  const used = new Set([
    ...reservedDriveKeys(form),
    ...form.disks.filter((d) => d.key !== exceptKey).map((d) => `${d.bus}${d.index}`),
  ])
  const out: number[] = []
  for (let i = 0; i < BUS_MAX[bus]; i++) if (!used.has(`${bus}${i}`)) out.push(i)
  return out
}

export function newDisk(form: Pick<QemuForm, 'disks' | 'virtioIso' | 'scsihw'>, bus: DiskBus, storage = ''): QemuDisk {
  const index = freeIndexes(form, bus)[0] ?? 0
  return {
    key: diskKey(),
    bus,
    index,
    storage,
    size: 32,
    format: '',
    cache: '',
    discard: false,
    iothread: defaultIothread(bus, form.scsihw),
    ssd: false,
    readonly: false,
    backup: true,
    noReplicate: false,
    aio: '',
  }
}

export function totalDiskSlots(): number {
  // Every bus id minus ide2 (the install medium).
  return Object.values(BUS_MAX).reduce((a, b) => a + b, 0) - 1
}

export function initialQemuForm(node = ''): QemuForm {
  const ostype = 'l26'
  const os = osDefaults(ostype)
  const base: QemuForm = {
    node,
    vmid: undefined,
    name: '',
    pool: '',
    tags: [],
    onboot: false,
    startupOrder: undefined,
    startupUp: undefined,
    startupDown: undefined,
    haManaged: false,
    media: 'iso',
    isoStorage: '',
    iso: '',
    ostype,
    virtioIso: false,
    virtioIsoStorage: '',
    virtioIsoVolume: '',
    vga: '',
    machine: '',
    machineVersion: '',
    bios: '',
    efiDisk: true,
    efiStorage: '',
    efiFormat: '',
    efiPreEnrolledKeys: true,
    scsihw: os.scsihw,
    agent: false,
    tpm: false,
    tpmStorage: '',
    tpmVersion: 'v2.0',
    disks: [],
    sockets: 1,
    cores: 1,
    cputype: DEFAULT_CPU_TYPE,
    vcpus: undefined,
    cpulimit: undefined,
    cpuunits: undefined,
    affinity: '',
    numa: false,
    cpuFlags: {},
    memory: defaultMemory(ostype),
    ballooning: true,
    balloon: defaultMemory(ostype),
    shares: undefined,
    allowKsm: true,
    noNetwork: false,
    bridge: '',
    vlan: undefined,
    model: os.networkCard,
    macaddr: '',
    firewall: true,
    disconnect: false,
    mtu: undefined,
    rate: undefined,
    queues: undefined,
    start: false,
  }
  return { ...base, disks: [newDisk(base, os.busType)] }
}

/**
 * Switch the guest OS and apply its defaults like the official wizard:
 * disk bus (only with a single disk), NIC model, SCSI controller,
 * machine/BIOS (q35 + OVMF + TPM for Windows 11) and memory (when unchanged).
 */
export function applyOsType(form: QemuForm, ostype: string): QemuForm {
  const prev = osDefaults(form.ostype)
  const next = osDefaults(ostype)
  let disks = form.disks
  const busType: DiskBus = form.virtioIso ? 'scsi' : next.busType
  const nextScsihw = next.scsihw
  if (disks.length === 1) {
    const d = disks[0]!
    if (d.bus !== busType) {
      const others = { disks: [] as QemuDisk[], virtioIso: form.virtioIso }
      const index = freeIndexes(others, busType)[0] ?? 0
      disks = [{ ...d, bus: busType, index, iothread: defaultIothread(busType, nextScsihw), ssd: busType === 'virtio' ? false : d.ssd }]
    }
  }
  const memoryUnchanged = form.memory === defaultMemory(form.ostype)
  const memory = memoryUnchanged ? defaultMemory(ostype) : form.memory
  return {
    ...form,
    ostype,
    disks: disks.map((d) => (d.bus === 'scsi' ? { ...d, iothread: defaultIothread('scsi', nextScsihw) } : d)),
    model: form.virtioIso ? 'virtio' : next.networkCard,
    scsihw: nextScsihw,
    machine: (next.machine ?? '') as QemuForm['machine'],
    machineVersion: prev.machine === next.machine ? form.machineVersion : '',
    bios: (next.bios ?? '') as QemuForm['bios'],
    tpm: ostype === 'win11' ? true : form.ostype === 'win11' ? false : form.tpm,
    virtioIso: isWindows(ostype) ? form.virtioIso : false,
    memory,
    balloon: memoryUnchanged && form.balloon === form.memory ? memory : form.balloon,
  }
}

/**
 * The extra VirtIO driver ISO (Windows only) goes to ide0; like the official
 * wizard it switches the disk bus to SCSI and the NIC to VirtIO.
 */
export function setVirtioIso(form: QemuForm, on: boolean): QemuForm {
  if (on === form.virtioIso) return form
  const next = { ...form, virtioIso: on }
  const busType: DiskBus = on ? 'scsi' : osDefaults(form.ostype).busType
  // A disk sitting on ide0 must move away.
  let disks = form.disks.map((d) => {
    if (on && d.bus === 'ide' && d.index === 0) {
      const index = freeIndexes({ disks: form.disks.filter((x) => x.key !== d.key), virtioIso: true }, 'ide')[0]
      return index === undefined ? d : { ...d, index }
    }
    return d
  })
  if (disks.length === 1) {
    const d = disks[0]!
    if (d.bus !== busType) {
      const index = freeIndexes({ disks: [], virtioIso: on }, busType)[0] ?? 0
      disks = [{ ...d, bus: busType, index, iothread: defaultIothread(busType, form.scsihw), ssd: busType === 'virtio' ? false : d.ssd }]
    }
  }
  return { ...next, disks, model: on ? 'virtio' : osDefaults(form.ostype).networkCard }
}

/** Change the SCSI controller; SCSI disks follow the iothread default. */
export function setScsihw(form: QemuForm, scsihw: string): QemuForm {
  return {
    ...form,
    scsihw,
    disks: form.disks.map((d) => (d.bus === 'scsi' ? { ...d, iothread: defaultIothread('scsi', scsihw) } : d)),
  }
}

/** Move a disk to another bus (next free index, bus-dependent options reset). */
export function setDiskBus(form: QemuForm, key: string, bus: DiskBus): QemuForm {
  return {
    ...form,
    disks: form.disks.map((d) => {
      if (d.key !== key || d.bus === bus) return d
      const index = freeIndexes(form, bus, key)[0] ?? 0
      return {
        ...d,
        bus,
        index,
        iothread: defaultIothread(bus, form.scsihw),
        ssd: bus === 'virtio' ? false : d.ssd,
        readonly: bus === 'virtio' || bus === 'scsi' ? d.readonly : false,
      }
    }),
  }
}

/** Memory change: the minimum memory follows when it was equal (official behaviour). */
export function setMemory(form: QemuForm, memory: number | undefined): QemuForm {
  const follow = form.balloon === undefined || form.balloon === form.memory || (memory !== undefined && form.balloon > memory)
  return { ...form, memory, balloon: follow ? memory : form.balloon }
}

// ------------------------------------------------------------ validation

export interface QemuValidationContext {
  /** VmidInput's availability check. */
  vmidState?: 'checking' | 'free' | 'taken' | 'invalid' | 'unknown'
  /** Max cores of the node, for a hint-level check. */
  nodeCpus?: number
}

export function validateQemuStep(step: QemuStepId, form: QemuForm, ctx: QemuValidationContext = {}): FieldErrors {
  const e: FieldErrors = {}
  switch (step) {
    case 'general': {
      if (!form.node) e.node = '请选择节点'
      if (form.vmid === undefined) e.vmid = '请输入 VM ID'
      else if (ctx.vmidState === 'taken') e.vmid = `ID ${form.vmid} 已被使用`
      else if (ctx.vmidState === 'invalid' || form.vmid < 100) e.vmid = 'ID 需在 100 到 999999999 之间'
      else if (ctx.vmidState === 'checking') e.vmid = '正在检查 ID 是否可用…'
      if (form.name && !isDnsName(form.name)) e.name = '名称只能包含字母、数字、连字符和点，且不能以连字符开头或结尾'
      const bad = form.tags.find((t) => !isTag(t))
      if (bad) e.tags = `标签“${bad}”无效：只能包含字母、数字、_ - + .`
      break
    }
    case 'os':
      if (form.media === 'iso') {
        if (!form.isoStorage) e.isoStorage = '请选择存储'
        else if (!form.iso) e.ide2 = '请选择 ISO 镜像'
      }
      if (form.virtioIso && !form.virtioIsoVolume) e.ide0 = '请选择 VirtIO 驱动 ISO'
      break
    case 'system':
      if (form.bios === 'ovmf' && form.efiDisk && !form.efiStorage) e.efidisk0 = '请选择 EFI 磁盘的存储'
      if (form.tpm && !form.tpmStorage) e.tpmstate0 = '请选择 TPM 的存储'
      break
    case 'disks':
      for (const d of form.disks) {
        const id = `${d.bus}${d.index}`
        if (!d.storage) e[id] = '请选择存储'
        else if (d.size === undefined || d.size <= 0) e[id] = '请输入磁盘大小'
        else if (reservedDriveKeys(form).includes(id)) e[id] = `${id} 已被光驱占用`
        else if (form.disks.some((o) => o !== d && o.bus === d.bus && o.index === d.index)) e[id] = `${id} 重复`
      }
      break
    case 'cpu': {
      if (!form.sockets || form.sockets < 1) e.sockets = '至少 1 个插槽'
      if (!form.cores || form.cores < 1) e.cores = '至少 1 个核心'
      const total = (form.sockets ?? 1) * (form.cores ?? 1)
      if (form.vcpus !== undefined && (form.vcpus < 1 || form.vcpus > total)) e.vcpus = `vCPU 需在 1 到 ${total} 之间`
      if (form.cpulimit !== undefined && (form.cpulimit < 0 || form.cpulimit > 128)) e.cpulimit = 'CPU 限制需在 0 到 128 之间'
      if (form.cpuunits !== undefined && (form.cpuunits < 1 || form.cpuunits > 10000)) e.cpuunits = 'CPU 权重需在 1 到 10000 之间'
      if (form.affinity && !isCpuSet(form.affinity)) e.affinity = '格式如 0-3,8'
      break
    }
    case 'memory':
      if (form.memory === undefined || form.memory < 16) e.memory = '内存至少 16 MiB'
      if (form.ballooning && form.balloon !== undefined && form.memory !== undefined && form.balloon > form.memory)
        e.balloon = '最小内存不能大于内存'
      if (form.ballooning && form.balloon === undefined) e.balloon = '请输入最小内存'
      if (form.shares !== undefined && (form.shares < 0 || form.shares > 50000)) e.shares = '份额需在 0 到 50000 之间'
      break
    case 'network':
      if (!form.noNetwork) {
        if (!form.bridge) e.bridge = '请选择网桥'
        if (form.vlan !== undefined && (form.vlan < 1 || form.vlan > 4094)) e.tag = 'VLAN 需在 1 到 4094 之间'
        if (form.macaddr && !isUnicastMac(form.macaddr)) e.macaddr = 'MAC 地址格式不对（例如 BC:24:11:12:34:56，需为单播地址）'
        if (form.mtu !== undefined && form.mtu !== 1 && (form.mtu < 576 || form.mtu > 65520))
          e.mtu = 'MTU 需不小于 576，或填 1 继承网桥的 MTU'
        if (form.queues !== undefined && (form.queues < 1 || form.queues > 64)) e.queues = '多队列需在 1 到 64 之间'
      }
      break
    case 'confirm':
      break
  }
  return e
}

/** Which wizard step shows a given API parameter (for server-side errors). */
export function qemuStepOfParam(param: string): QemuStepId {
  if (['node', 'vmid', 'name', 'pool', 'tags', 'onboot', 'startup', 'ha-managed'].includes(param)) return 'general'
  if (['ide2', 'ide0', 'ostype', 'isoStorage'].includes(param)) return 'os'
  if (['vga', 'machine', 'bios', 'efidisk0', 'scsihw', 'agent', 'tpmstate0'].includes(param) || /^serial\d$/.test(param))
    return 'system'
  if (/^(?:scsi|virtio|sata|ide)\d+$/.test(param)) return 'disks'
  if (['sockets', 'cores', 'cpu', 'vcpus', 'cpulimit', 'cpuunits', 'affinity', 'numa'].includes(param)) return 'cpu'
  if (['memory', 'balloon', 'shares', 'allow-ksm'].includes(param)) return 'memory'
  if (/^net\d+$/.test(param) || ['bridge', 'tag', 'macaddr', 'mtu', 'queues'].includes(param)) return 'network'
  return 'confirm'
}

// --------------------------------------------------------------- params

function flag(on: boolean, value: PropertyValue = 'on'): PropertyValue {
  return on ? value : undefined
}

export function diskParam(d: QemuDisk): string {
  const supportsIothread = d.bus === 'virtio' || d.bus === 'scsi'
  return stringifyPropertyString(
    {
      file: `${d.storage}:${d.size ?? 0}`,
      format: d.format || undefined,
      cache: d.cache || undefined,
      discard: flag(d.discard),
      iothread: flag(d.iothread && supportsIothread),
      ssd: flag(d.ssd && d.bus !== 'virtio'),
      ro: flag(d.readonly && supportsIothread),
      backup: d.backup ? undefined : 0,
      replicate: d.noReplicate ? 'no' : undefined,
      aio: d.aio || undefined,
      mbps_rd: d.mbps_rd,
      mbps_rd_max: d.mbps_rd_max,
      mbps_wr: d.mbps_wr,
      mbps_wr_max: d.mbps_wr_max,
      iops_rd: d.iops_rd,
      iops_rd_max: d.iops_rd_max,
      iops_wr: d.iops_wr,
      iops_wr_max: d.iops_wr_max,
    },
    'file',
  )
}

export function cdromParam(media: MediaType, iso: string): string {
  const file = media === 'iso' ? iso : media === 'cdrom' ? 'cdrom' : 'none'
  return `${file},media=cdrom`
}

export function cpuParam(cputype: string, flags: Record<string, CpuFlagState>): string {
  const list = Object.entries(flags)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, state]) => `${state}${name}`)
  return stringifyPropertyString({ cputype: cputype || DEFAULT_CPU_TYPE, flags: list }, 'cputype')
}

export function netParam(form: Pick<QemuForm, 'model' | 'macaddr' | 'bridge' | 'vlan' | 'firewall' | 'disconnect' | 'mtu' | 'rate' | 'queues'>): string {
  const head = form.macaddr ? `${form.model}=${form.macaddr.toUpperCase()}` : form.model
  const rest = stringifyPropertyString({
    bridge: form.bridge,
    tag: form.vlan,
    firewall: form.firewall ? 1 : undefined,
    link_down: form.disconnect ? 1 : undefined,
    mtu: form.model === 'virtio' ? form.mtu : undefined,
    rate: form.rate || undefined,
    queues: form.queues,
  })
  return rest ? `${head},${rest}` : head
}

export function startupParam(order?: number, up?: number, down?: number): string | undefined {
  const parts: string[] = []
  if (order !== undefined) parts.push(`order=${order}`)
  if (up !== undefined) parts.push(`up=${up}`)
  if (down !== undefined) parts.push(`down=${down}`)
  return parts.length ? parts.join(',') : undefined
}

/**
 * The official wizard's calculateBootOrder: with a second CD drive (ide0)
 * the backend's default order would miss it, so send it explicitly:
 * first hard disk, ide2 (installer), ide0 (drivers), net0.
 */
export function bootOrder(form: QemuForm): string | undefined {
  if (!form.virtioIso) return undefined
  const order: string[] = []
  const busOrder: DiskBus[] = ['ide', 'scsi', 'virtio', 'sata']
  const first = [...form.disks].sort((a, b) => busOrder.indexOf(a.bus) - busOrder.indexOf(b.bus) || a.index - b.index)[0]
  if (first) order.push(`${first.bus}${first.index}`)
  order.push('ide2', 'ide0')
  if (!form.noNetwork) order.push('net0')
  return `order=${order.join(';')}`
}

/** All parameters of POST /nodes/{node}/qemu (node itself is the path). */
export function buildQemuParams(form: QemuForm): Params {
  const params: Params = {
    vmid: form.vmid,
    name: form.name.trim() || undefined,
    pool: form.pool || undefined,
    tags: form.tags.length ? form.tags.join(';') : undefined,
    onboot: form.onboot ? 1 : undefined,
    startup: startupParam(form.startupOrder, form.startupUp, form.startupDown),
    'ha-managed': form.haManaged ? 1 : undefined,
    // OS
    ostype: form.ostype,
    ide2: cdromParam(form.media, form.iso),
    ide0: form.virtioIso && form.virtioIsoVolume ? `${form.virtioIsoVolume},media=cdrom` : undefined,
    boot: bootOrder(form),
    // System
    vga: form.vga || undefined,
    machine: form.machineVersion || form.machine || undefined,
    bios: form.bios || undefined,
    efidisk0:
      form.bios === 'ovmf' && form.efiDisk && form.efiStorage
        ? stringifyPropertyString(
            {
              file: `${form.efiStorage}:1`,
              efitype: '4m',
              'pre-enrolled-keys': form.efiPreEnrolledKeys ? 1 : 0,
              format: form.efiFormat || undefined,
            },
            'file',
          )
        : undefined,
    scsihw: form.scsihw || undefined,
    agent: form.agent ? 1 : undefined,
    tpmstate0:
      form.tpm && form.tpmStorage ? stringifyPropertyString({ file: `${form.tpmStorage}:1`, version: form.tpmVersion }, 'file') : undefined,
    // CPU
    sockets: form.sockets,
    cores: form.cores,
    cpu: cpuParam(form.cputype, form.cpuFlags),
    vcpus: form.vcpus,
    cpulimit: form.cpulimit ? form.cpulimit : undefined,
    cpuunits: form.cpuunits,
    affinity: form.affinity.replace(/\s+/g, '') || undefined,
    numa: form.numa ? 1 : undefined,
    // Memory
    memory: form.memory,
    'allow-ksm': form.allowKsm ? undefined : 0,
    // Network
    net0: form.noNetwork ? undefined : netParam(form),
    start: form.start ? 1 : undefined,
  }
  if (!form.ballooning) params.balloon = 0
  else if (form.balloon !== undefined && form.balloon !== form.memory) {
    params.balloon = form.balloon
    if (form.shares !== undefined) params.shares = form.shares
  }
  if (form.vga.startsWith('serial')) params[`serial${form.vga.slice(6)}`] = 'socket'
  for (const d of form.disks) params[`${d.bus}${d.index}`] = diskParam(d)
  // Drop empty values so the confirm list and the request stay clean.
  for (const k of Object.keys(params)) if (params[k] === undefined || params[k] === '') delete params[k]
  return params
}
