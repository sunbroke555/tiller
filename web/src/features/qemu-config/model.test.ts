import { describe, expect, it } from 'vitest'

import {
  busPreference,
  formatMiB,
  hardwareRows,
  hasCloudinitDrive,
  hwKind,
  hwSummary,
  maxUsbCount,
  nextFreeDrive,
  nextFreeKey,
  parseCpuFlags,
  parseMemory,
  splitPending,
  stringifyCpuFlags,
} from './model'

// Shape of the lab's VM 100 GET .../pending, plus pending changes.
const LAB_PENDING = [
  { key: 'boot', value: 'order=scsi0;net0' },
  { key: 'cores', value: 1 },
  { key: 'digest', value: 'c12a423c' },
  { key: 'memory', value: '128', pending: '256' },
  { key: 'balloon', pending: '0' },
  { key: 'name', value: 'tiny-vm' },
  { key: 'net0', value: 'virtio=BC:24:11:22:3A:D2,bridge=vmbr0' },
  { key: 'net1', pending: 'e1000,bridge=vmbr0,tag=5' },
  { key: 'scsi0', value: 'local-lvm:vm-100-disk-0,size=1G' },
  { key: 'scsi1', value: 'local-lvm:vm-100-disk-1,size=2G', delete: 1 as const },
  { key: 'ide2', value: 'none,media=cdrom' },
  { key: 'ide0', value: 'local-lvm:vm-100-cloudinit,media=cdrom' },
  { key: 'scsihw', value: 'virtio-scsi-single' },
  { key: 'unused0', value: 'local-lvm:vm-100-disk-5' },
  { key: 'ostype', value: 'l26' },
]

describe('splitPending', () => {
  it('builds the current and the pending-applied config', () => {
    const s = splitPending(LAB_PENDING)
    expect(s.current.memory).toBe('128')
    expect(s.next.memory).toBe('256')
    expect(s.current.cores).toBe('1')
    expect(s.next.balloon).toBe('0')
    expect(s.current.balloon).toBeUndefined()
    expect(s.next.scsi1).toBeUndefined()
    expect(s.current.scsi1).toBeDefined()
    expect([...s.pending].sort()).toEqual(['balloon', 'memory', 'net1', 'scsi1'])
    expect([...s.deleting]).toEqual(['scsi1'])
    expect(s.digest).toBe('c12a423c')
  })

  it('handles an empty response', () => {
    const s = splitPending(undefined)
    expect(s.current).toEqual({})
    expect(s.digest).toBeUndefined()
  })
})

describe('kinds and summaries', () => {
  it('classifies config keys', () => {
    expect(hwKind('scsi0', 'local-lvm:vm-100-disk-0,size=1G')).toBe('disk')
    expect(hwKind('ide2', 'local:iso/x.iso,media=cdrom')).toBe('cdrom')
    expect(hwKind('ide0', 'local-lvm:vm-100-cloudinit,media=cdrom')).toBe('cloudinit')
    expect(hwKind('net3', 'virtio,bridge=vmbr0')).toBe('net')
    expect(hwKind('hostpci0', '0000:01:00')).toBe('hostpci')
    expect(hwKind('efidisk0', 'x')).toBe('efidisk')
    expect(hwKind('tpmstate0', 'x')).toBe('tpmstate')
    expect(hwKind('unused12', 'x')).toBe('unused')
    expect(hwKind('name', 'x')).toBeNull()
    expect(hwKind('memory', 'x')).toBeNull() // core rows are built separately
  })

  it('parses memory in both forms', () => {
    expect(parseMemory('2048')).toBe(2048)
    expect(parseMemory('current=4096')).toBe(4096)
    expect(parseMemory(undefined)).toBe(512)
    expect(formatMiB(512)).toBe('512 MiB')
    expect(formatMiB(2048)).toBe('2 GiB')
    expect(formatMiB(1536)).toBe('1.5 GiB')
  })

  it('summarizes rows like the official renderers', () => {
    expect(hwSummary('memory', 'memory', { memory: '2048', balloon: '1024' })).toBe('2 GiB（最小 1 GiB）')
    expect(hwSummary('memory', 'memory', { memory: '2048', balloon: '0' })).toBe('2 GiB · 无 Ballooning')
    expect(hwSummary('processors', 'sockets', { sockets: '2', cores: '4', cpu: 'host' })).toBe('8 核 · 2 插槽 × 4 核 · host')
    expect(hwSummary('processors', 'sockets', {})).toBe('1 核 · kvm64（默认）')
    expect(hwSummary('bios', 'bios', {})).toBe('默认 (SeaBIOS)')
    expect(hwSummary('display', 'vga', { vga: 'qxl,memory=32' })).toBe('SPICE · 显存 32 MiB')
    expect(hwSummary('machine', 'machine', { machine: 'q35,viommu=intel' })).toBe('q35 · vIOMMU Intel')
    expect(hwSummary('scsihw', 'scsihw', { scsihw: 'virtio-scsi-single' })).toBe('VirtIO SCSI single')
    expect(hwSummary('disk', 'scsi0', { scsi0: 'local-lvm:vm-100-disk-0,iothread=1,size=32G,discard=on' })).toBe(
      'local-lvm:vm-100-disk-0 · 32 GiB · Discard · IO thread',
    )
    expect(hwSummary('cdrom', 'ide2', { ide2: 'none,media=cdrom' })).toBe('无介质')
    expect(hwSummary('net', 'net0', { net0: 'virtio=BC:24:11:22:3A:D2,bridge=vmbr0,tag=10,firewall=1' })).toBe(
      'VirtIO · BC:24:11:22:3A:D2 · vmbr0 · VLAN 10 · 防火墙',
    )
    expect(hwSummary('usb', 'usb0', { usb0: 'host=1234:abcd,usb3=1' })).toBe('设备 1234:abcd · USB 3')
    expect(hwSummary('usb', 'usb1', { usb1: 'spice' })).toBe('SPICE 端口重定向')
    expect(hwSummary('rng', 'rng0', { rng0: 'source=/dev/urandom' })).toBe('/dev/urandom · 1024 字节 / 1000 ms')
  })
})

describe('hardwareRows', () => {
  const rows = hardwareRows(splitPending(LAB_PENDING))
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]))

  it('always has the system rows, in official order', () => {
    expect(rows.slice(0, 6).map((r) => r.id)).toEqual(['memory', 'processors', 'bios', 'display', 'machine', 'scsihw'])
  })

  it('marks pending changes, additions and removals', () => {
    expect(byId.memory!.status).toBe('changed')
    expect(byId.memory!.summary).toBe('128 MiB')
    expect(byId.memory!.pendingSummary).toBe('256 MiB · 无 Ballooning')
    expect(byId.net1!.status).toBe('added')
    expect(byId.net1!.pendingSummary).toContain('VLAN 5')
    expect(byId.scsi1!.status).toBe('removed')
    expect(byId.scsi0!.status).toBe('unchanged')
  })

  it('orders storage by bus then number and groups sections', () => {
    const storage = rows.filter((r) => r.section === 'storage').map((r) => r.id)
    expect(storage).toEqual(['ide0', 'ide2', 'scsi0', 'scsi1', 'unused0'])
    expect(byId.ide0!.kind).toBe('cloudinit')
    expect(rows.filter((r) => r.section === 'network').map((r) => r.id)).toEqual(['net0', 'net1'])
  })
})

describe('free slots', () => {
  const cfg = { scsi0: 'a', scsi1: 'b', ide2: 'none,media=cdrom', ostype: 'l26' }
  it('prefers the bus already in use', () => {
    expect(busPreference(cfg)[0]).toBe('scsi')
    expect(busPreference({ ostype: 'win10' })[0]).toBe('ide')
    expect(busPreference({ arch: 'aarch64' })).not.toContain('ide')
  })
  it('finds the next free slot', () => {
    expect(nextFreeDrive(cfg, ['scsi'])).toEqual({ bus: 'scsi', index: 2 })
    expect(nextFreeKey({ net0: 'x', net1: 'y' }, 'net', 32)).toBe('net2')
    expect(nextFreeKey({ audio0: 'x' }, 'audio', 1)).toBeUndefined()
  })
  it('knows the USB limit', () => {
    expect(maxUsbCount({ ostype: 'l26' })).toBe(14)
    expect(maxUsbCount({ ostype: 'l26', machine: 'pc-i440fx-6.2' })).toBe(5)
    expect(maxUsbCount({ ostype: 'win7' })).toBe(5)
    expect(maxUsbCount({})).toBe(5)
  })
  it('detects a cloud-init drive', () => {
    expect(hasCloudinitDrive(splitPending(LAB_PENDING))).toBe(true)
    expect(hasCloudinitDrive(splitPending([{ key: 'ide2', value: 'none,media=cdrom' }]))).toBe(false)
  })
})

describe('cpu flags', () => {
  it('round-trips the flags list', () => {
    expect(parseCpuFlags('+aes;-pcid')).toEqual({ aes: '+', pcid: '-' })
    expect(stringifyCpuFlags({ aes: '+', pcid: '-', md_clear: undefined })).toBe('+aes;-pcid')
  })
})
