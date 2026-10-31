// Option lists of the QEMU config editors, following the official UI
// (pvemanagerlib.js: kvm_vga_drivers, render_scsihw, CacheTypeSelector, …).

import type { SelectOption } from '@/components/form'

export type Arch = 'x86_64' | 'aarch64'

export const ARCH_LABEL: Record<Arch, string> = {
  x86_64: 'x86（64 位）',
  aarch64: 'ARM（64 位）',
}

/** Backend defaults per architecture (PVE.qemu.Architecture). */
export const DEFAULT_CPU: Record<Arch, string> = { x86_64: 'x86-64-v2-AES', aarch64: 'host' }
export const DEFAULT_MACHINE: Record<Arch, string> = { x86_64: 'i440fx', aarch64: 'virt' }
export const DEFAULT_CD_SLOT: Record<Arch, string> = { x86_64: 'ide2', aarch64: 'scsi2' }

export const VGA_TYPES: Record<string, string> = {
  std: '标准 VGA',
  vmware: 'VMware 兼容',
  qxl: 'SPICE',
  qxl2: 'SPICE 双显示器',
  qxl3: 'SPICE 三显示器',
  qxl4: 'SPICE 四显示器',
  serial0: '串口终端 0',
  serial1: '串口终端 1',
  serial2: '串口终端 2',
  serial3: '串口终端 3',
  virtio: 'VirtIO-GPU',
  'virtio-gl': 'VirGL GPU',
  cirrus: 'Cirrus Logic（旧）',
  none: '无',
}

/** Default display memory (MiB) per type, as the official placeholder shows it. */
export function vgaDefaultMemory(type: string | undefined): string {
  if (!type) return '默认'
  if (type === 'cirrus') return '4'
  if (type === 'std' || /^qxl\d?$/.test(type) || type === 'vmware') return '16'
  if (type.startsWith('virtio')) return '256'
  return '不适用'
}

export const SCSIHW: Record<string, string> = {
  lsi: 'LSI 53C895A',
  lsi53c810: 'LSI 53C810',
  megasas: 'MegaRAID SAS 8708EM2',
  'virtio-scsi-pci': 'VirtIO SCSI',
  'virtio-scsi-single': 'VirtIO SCSI single',
  pvscsi: 'VMware PVSCSI',
}

export const ALLOWED_SCSIHW: Record<Arch, string[]> = {
  x86_64: ['lsi', 'lsi53c810', 'megasas', 'virtio-scsi-pci', 'virtio-scsi-single', 'pvscsi'],
  aarch64: ['virtio-scsi-pci', 'virtio-scsi-single'],
}

export const BIOS: Record<string, string> = {
  seabios: 'SeaBIOS',
  ovmf: 'OVMF (UEFI)',
}

export const CACHE_OPTIONS: SelectOption[] = [
  { value: 'none', label: '无缓存', description: 'none' },
  { value: 'directsync', label: 'Direct sync' },
  { value: 'writethrough', label: 'Write through' },
  { value: 'writeback', label: 'Write back' },
  { value: 'unsafe', label: 'Write back（不安全）', description: 'unsafe' },
]

export const AIO_OPTIONS: SelectOption[] = [
  { value: 'io_uring', label: 'io_uring' },
  { value: 'native', label: 'native' },
  { value: 'threads', label: 'threads' },
]

export const DISK_FORMAT_LABEL: Record<string, string> = {
  raw: 'Raw 磁盘镜像 (raw)',
  qcow2: 'QEMU 镜像 (qcow2)',
  vmdk: 'VMware 镜像 (vmdk)',
}

export const BUS_LABEL: Record<string, string> = {
  ide: 'IDE',
  sata: 'SATA',
  scsi: 'SCSI',
  virtio: 'VirtIO Block',
}

/** Highest device count per bus (PVE.Utils.diskControllerMaxIDs). */
export const BUS_MAX: Record<string, number> = { ide: 4, sata: 6, scsi: 31, virtio: 16 }

export const ALLOWED_BUSES: Record<Arch, string[]> = {
  x86_64: ['ide', 'sata', 'virtio', 'scsi'],
  aarch64: ['sata', 'virtio', 'scsi'],
}

/** Device limits (PVE.Utils.hardware_counts). */
export const HW_MAX = {
  net: 32,
  usb: 14,
  usbOld: 5,
  hostpci: 16,
  serial: 4,
  virtiofs: 10,
  unused: 256,
} as const

export const NIC_MODEL_LABEL: Record<string, string> = {
  virtio: 'VirtIO（半虚拟化）',
  e1000: 'Intel E1000',
  e1000e: 'Intel E1000E',
  rtl8139: 'Realtek RTL8139',
  vmxnet3: 'VMware vmxnet3',
}

export interface OsTypeGroup {
  group: string
  items: { value: string; label: string }[]
}

export const OS_TYPES: OsTypeGroup[] = [
  {
    group: 'Linux',
    items: [
      { value: 'l26', label: 'Linux 6.x / 5.x / 4.x / 3.x / 2.6 内核' },
      { value: 'l24', label: 'Linux 2.4 内核' },
    ],
  },
  {
    group: 'Windows',
    items: [
      { value: 'win11', label: 'Windows 11 / 2022 / 2025' },
      { value: 'win10', label: 'Windows 10 / 2016 / 2019' },
      { value: 'win8', label: 'Windows 8.x / 2012 / 2012r2' },
      { value: 'win7', label: 'Windows 7 / 2008r2' },
      { value: 'w2k8', label: 'Windows Vista / 2008' },
      { value: 'wxp', label: 'Windows XP / 2003' },
      { value: 'w2k', label: 'Windows 2000' },
    ],
  },
  { group: 'Solaris', items: [{ value: 'solaris', label: 'Solaris 内核' }] },
  { group: '其他', items: [{ value: 'other', label: '其他' }] },
]

export const OS_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  OS_TYPES.flatMap((g) => g.items.map((i) => [i.value, i.label])),
)

export function isWindows(ostype: string | undefined): boolean {
  return !!ostype && OS_TYPES[1]!.items.some((i) => i.value === ostype)
}

/** VNC keyboard layouts (PVE::Tools::kvmkeymaps). */
export const KEYMAPS: Record<string, string> = {
  da: '丹麦语',
  de: '德语',
  'de-ch': '德语（瑞士）',
  'en-gb': '英语（英国）',
  'en-us': '英语（美国）',
  es: '西班牙语',
  fi: '芬兰语',
  fr: '法语',
  'fr-be': '法语（比利时）',
  'fr-ca': '法语（加拿大）',
  'fr-ch': '法语（瑞士）',
  hu: '匈牙利语',
  is: '冰岛语',
  it: '意大利语',
  ja: '日语',
  lt: '立陶宛语',
  mk: '马其顿语',
  nl: '荷兰语',
  no: '挪威语',
  pl: '波兰语',
  pt: '葡萄牙语',
  'pt-br': '葡萄牙语（巴西）',
  sl: '斯洛文尼亚语',
  sv: '瑞典语',
  tr: '土耳其语',
}

export const HOTPLUG_FEATURES = [
  { value: 'disk', label: '磁盘' },
  { value: 'network', label: '网络' },
  { value: 'usb', label: 'USB' },
  { value: 'memory', label: '内存' },
  { value: 'cpu', label: 'CPU' },
] as const

export const AUDIO_DEVICES = ['ich9-intel-hda', 'intel-hda', 'AC97'] as const

export const RNG_SOURCES = ['/dev/urandom', '/dev/random', '/dev/hwrng'] as const
