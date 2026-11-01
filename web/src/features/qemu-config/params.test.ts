import { describe, expect, it } from 'vitest'

import {
  agentFormFrom,
  agentValue,
  bootDevices,
  bootValue,
  cdromValue,
  decodeSshKeys,
  diskOptionsFrom,
  displayValue,
  editDiskValue,
  encodeSshKeys,
  hotplugValue,
  importDiskValue,
  ipConfigFormFrom,
  ipConfigValue,
  machineFormFrom,
  machineValue,
  memoryFormFrom,
  memoryValues,
  netValue,
  newDiskValue,
  parseHotplug,
  parseSmbios,
  parseUsb,
  pciFormFrom,
  pciMdevSource,
  pciValue,
  processorFormFrom,
  processorValues,
  rngValue,
  sevFormFrom,
  sevValue,
  smbiosValue,
  spiceValue,
  sshKeyLabels,
  startupValue,
  tdxFormFrom,
  tdxValue,
  updateParams,
  usbValue,
  virtiofsValue,
} from './params'

describe('memory', () => {
  it('sends only the changed memory', () => {
    const cfg = { memory: '2048', digest: 'd1' }
    const f = memoryFormFrom(cfg)
    expect(f).toMatchObject({ memory: 2048, ballooning: true, balloon: 2048, allowKsm: true })
    expect(updateParams(cfg, memoryValues(cfg, f), cfg.digest)).toBeNull()
    expect(updateParams(cfg, memoryValues(cfg, { ...f, memory: 4096, balloon: 4096 }), cfg.digest)).toEqual({ memory: '4096', digest: 'd1' })
  })

  it('handles ballooning like the official editor', () => {
    const cfg = { memory: '4096', balloon: '1024', shares: '500' }
    const f = memoryFormFrom(cfg)
    expect(f.balloon).toBe(1024)
    // Disabling the balloon device: balloon=0, shares dropped.
    expect(updateParams(cfg, memoryValues(cfg, { ...f, ballooning: false }), undefined)).toEqual({ balloon: '0', delete: 'shares' })
    // min = max: balloon and shares deleted.
    expect(updateParams(cfg, memoryValues(cfg, { ...f, balloon: 4096 }), undefined)).toEqual({ delete: 'balloon,shares' })
    // KSM off writes 0, back on deletes the key.
    expect(updateParams(cfg, memoryValues(cfg, { ...f, allowKsm: false }), undefined)).toEqual({ 'allow-ksm': '0' })
  })

  it('keeps the PVE 9 current= form', () => {
    const cfg = { memory: 'current=2048' }
    expect(memoryValues(cfg, { ...memoryFormFrom(cfg), memory: 3072, balloon: 3072 }).memory).toBe('current=3072')
  })
})

describe('processor', () => {
  it('maps an unset x86 cpu to the backend default kvm64 and back', () => {
    const cfg = { cores: '2' }
    const f = processorFormFrom(cfg, 'x86_64')
    expect(f.cputype).toBe('kvm64')
    // Opening and saving without changes writes nothing.
    expect(updateParams(cfg, processorValues(cfg, f), undefined)).toBeNull()
    expect(updateParams(cfg, processorValues(cfg, { ...f, cputype: 'host', sockets: 2 }), undefined)).toEqual({ sockets: '2', cpu: 'host' })
  })

  it('keeps other cpu options and writes flags', () => {
    const cfg = { sockets: '1', cores: '4', cpu: 'host,hidden=1,flags=+aes' }
    const f = processorFormFrom(cfg, 'x86_64')
    expect(f.flags).toEqual({ aes: '+' })
    const v = processorValues(cfg, { ...f, flags: { aes: '+', pcid: '-' }, cpuunits: 100, cpulimit: 0, numa: true })
    expect(v.cpu).toBe('host,hidden=1,flags=+aes;-pcid')
    expect(v.cpuunits).toBe('') // default deleted
    expect(v.cpulimit).toBe('')
    expect(updateParams(cfg, v, 'x')).toEqual({ cpu: 'host,hidden=1,flags=+aes;-pcid', numa: '1', digest: 'x' })
  })

  it('puts the aarch64 backend default in front of options without a model', () => {
    const cfg = { arch: 'aarch64', cores: '2' }
    const f = processorFormFrom(cfg, 'aarch64')
    expect(f.cputype).toBeUndefined()
    expect(updateParams(cfg, processorValues(cfg, f), undefined)).toBeNull()
    expect(processorValues(cfg, { ...f, flags: { pdpe1gb: '+' } }).cpu).toBe('cortex-a57,flags=+pdpe1gb')
    const hidden = { arch: 'aarch64', cpu: 'hidden=1' }
    expect(processorValues(hidden, processorFormFrom(hidden, 'aarch64')).cpu).toBe('cortex-a57,hidden=1')
  })
})

describe('display and machine', () => {
  it('builds vga', () => {
    expect(displayValue('qxl', 32, undefined)).toBe('qxl,memory=32')
    expect(displayValue(undefined, undefined, undefined)).toBe('')
    expect(updateParams({ vga: 'std' }, { vga: displayValue(undefined, undefined, undefined) }, undefined)).toEqual({ delete: 'vga' })
  })

  it('builds machine strings', () => {
    expect(machineValue({}, { ...machineFormFrom({}), type: 'q35', viommu: 'intel' }, 'x86_64')).toBe('q35,viommu=intel')
    // vIOMMU without a type needs the explicit default "pc".
    expect(machineValue({}, { ...machineFormFrom({}), viommu: 'virtio' }, 'x86_64')).toBe('pc,viommu=virtio')
    expect(machineValue({ machine: 'q35' }, { ...machineFormFrom({ machine: 'q35' }), type: '' }, 'x86_64')).toBe('')
    expect(machineFormFrom({ machine: 'pc-q35-9.2+pve1,enable-s3=1' })).toMatchObject({ type: 'pc-q35-9.2+pve1', enableS3: true })
  })
})

describe('disks', () => {
  const opts = diskOptionsFrom(undefined, { iothread: true })
  it('creates new disks', () => {
    expect(newDiskValue('local-lvm', 32, 'raw', 'scsi', { ...opts, discard: true, ssd: true })).toBe(
      'local-lvm:32,format=raw,discard=on,iothread=1,ssd=1',
    )
    // SSD is not available on VirtIO Block, IO thread not on SATA.
    expect(newDiskValue('local-lvm', 8, undefined, 'virtio', { ...opts, ssd: true })).toBe('local-lvm:8,iothread=1')
    expect(newDiskValue('local-lvm', 8, undefined, 'sata', opts)).toBe('local-lvm:8')
  })

  it('imports disks', () => {
    expect(importDiskValue('local-lvm', 'local:import/disk.qcow2', 'raw', 'scsi', opts)).toBe(
      'local-lvm:0,import-from=local:import/disk.qcow2,format=raw,iothread=1',
    )
  })

  it('edits options and keeps unknown keys', () => {
    const value = 'local-lvm:vm-100-disk-0,size=32G,serial=ABC,iothread=1'
    const o = diskOptionsFrom(value)
    expect(o.iothread).toBe(true)
    expect(editDiskValue(value, 'scsi', { ...o, backup: false, mbps_rd: 100 })).toBe(
      'local-lvm:vm-100-disk-0,size=32G,serial=ABC,iothread=1,backup=0,mbps_rd=100',
    )
    expect(editDiskValue(value, 'scsi', o)).toBe(value)
  })

  it('builds CD-ROM drives', () => {
    expect(cdromValue(undefined, 'iso', 'local:iso/a.iso')).toBe('local:iso/a.iso,media=cdrom')
    expect(cdromValue('local:iso/a.iso,media=cdrom', 'none', undefined)).toBe('none,media=cdrom')
    expect(cdromValue(undefined, 'cdrom', undefined)).toBe('cdrom,media=cdrom')
  })
})

describe('devices', () => {
  it('builds NICs with the model=MAC quirk', () => {
    const f = { model: 'virtio', macaddr: 'bc:24:11:00:00:01', bridge: 'vmbr0', tag: 10, firewall: true, disconnect: false, rate: undefined, queues: 4, mtu: 1, trunks: '20, 30' }
    expect(netValue({}, f)).toBe('virtio=BC:24:11:00:00:01,bridge=vmbr0,tag=10,firewall=1,queues=4,mtu=1,trunks=20;30')
    expect(netValue({ bridge: 'vmbr1', firewall: '1' }, { ...f, macaddr: '', firewall: false, tag: undefined, queues: undefined, mtu: undefined, trunks: '' })).toBe(
      'virtio,bridge=vmbr0',
    )
  })

  it('builds USB values', () => {
    expect(usbValue('spice', undefined, false)).toBe('spice')
    expect(usbValue('device', '1234:abcd', true)).toBe('host=1234:abcd,usb3=1')
    expect(usbValue('mapped', 'kbd', false)).toBe('mapping=kbd')
    expect(parseUsb('host=1-2.3')).toEqual({ mode: 'port', id: '1-2.3', usb3: false })
    expect(parseUsb('mapping=kbd,usb3=1')).toEqual({ mode: 'mapped', id: 'kbd', usb3: true })
  })

  it('builds PCI values', () => {
    const f = pciFormFrom('01:00')
    expect(f).toMatchObject({ mode: 'raw', host: '0000:01:00.0', allFunctions: true, rombar: true })
    expect(pciValue('01:00', f)).toBe('01:00')
    expect(pciValue(undefined, { ...f, allFunctions: false, pcie: true, primaryGpu: true, rombar: false })).toBe('01:00.0,x-vga=1,pcie=1,rombar=0')
    expect(pciValue(undefined, { ...pciFormFrom(undefined), mapping: 'gpu' })).toBe('mapping=gpu')
    expect(pciValue(undefined, { ...pciFormFrom(undefined), mapping: 'vgpu', mdev: 'nvidia-63' })).toBe('mapping=vgpu,mdev=nvidia-63')
  })

  it('loads mdev types for mdev devices and mdev mappings only', () => {
    const devices = [{ id: '0000:01:00.0', mdev: 1 }, { id: '0000:02:00.0' }]
    const maps = [{ id: 'vgpu', mdev: 1 }, { id: 'vgpu2', mdev: true }, { id: 'nic' }]
    const raw = (host: string) => pciMdevSource({ mode: 'raw', host, mapping: undefined }, devices, maps)
    const mapped = (mapping: string | undefined) => pciMdevSource({ mode: 'mapped', host: undefined, mapping }, devices, maps)
    expect(raw('0000:01:00.0')).toBe('0000:01:00.0')
    expect(raw('0000:02:00.0')).toBeUndefined()
    expect(mapped('vgpu')).toBe('vgpu')
    expect(mapped('vgpu2')).toBe('vgpu2')
    expect(mapped('nic')).toBeUndefined()
    expect(mapped(undefined)).toBeUndefined()
    // Mappings not loaded yet: nothing to ask for.
    expect(pciMdevSource({ mode: 'mapped', host: undefined, mapping: 'vgpu' }, devices, undefined)).toBeUndefined()
  })

  it('builds RNG and virtiofs values', () => {
    expect(rngValue('/dev/urandom', 1024, undefined)).toBe('/dev/urandom')
    expect(rngValue('/dev/urandom', undefined, undefined)).toBe('/dev/urandom,max_bytes=0')
    expect(rngValue('/dev/random', 2048, 500)).toBe('/dev/random,max_bytes=2048,period=500')
    expect(virtiofsValue({ dirid: 'share', cache: 'never', xattr: true, acl: true, directIo: false })).toBe('share,cache=never,expose-acl=1')
  })
})

describe('options', () => {
  it('startup and hotplug', () => {
    expect(startupValue({ order: 2, up: 30, down: undefined })).toBe('order=2,up=30')
    expect(parseHotplug(undefined)).toEqual(['disk', 'network', 'usb'])
    expect(parseHotplug('0')).toEqual([])
    expect(parseHotplug('1')).toEqual(['disk', 'network', 'usb'])
    expect(hotplugValue(['usb', 'disk', 'network'])).toBe('')
    expect(hotplugValue([])).toBe('0')
    expect(hotplugValue(['disk', 'cpu', 'memory'])).toBe('disk,memory,cpu')
  })

  it('agent', () => {
    expect(agentFormFrom(undefined)).toEqual({ enabled: false, fstrim: false, freezeFs: true, type: undefined })
    expect(agentFormFrom('1,freeze-fs-on-backup=0').freezeFs).toBe(false)
    expect(agentValue(undefined, { enabled: true, fstrim: true, freezeFs: true, type: undefined })).toBe('1,fstrim_cloned_disks=1')
    expect(agentValue('1,freeze-fs-on-backup=0', { enabled: true, fstrim: false, freezeFs: false, type: 'isa' })).toBe('1,freeze-fs=0,type=isa')
  })

  it('smbios base64 round trip', () => {
    const v = smbiosValue({ uuid: 'abc', manufacturer: 'Pve 中文', product: '', version: '', serial: 'S1', sku: '', family: '' })
    expect(v).toMatch(/^uuid=abc,manufacturer=[^,]+,serial=UzE=,base64=1$/)
    expect(parseSmbios(v)).toMatchObject({ uuid: 'abc', manufacturer: 'Pve 中文', serial: 'S1' })
    expect(parseSmbios('uuid=x,manufacturer=plain').manufacturer).toBe('plain')
  })

  it('spice, sev, tdx', () => {
    expect(spiceValue({ foldersharing: true, videostreaming: 'off' })).toBe('foldersharing=1')
    expect(spiceValue({ foldersharing: false, videostreaming: 'off' })).toBe('')
    expect(sevValue({ ...sevFormFrom(undefined), type: 'std', debug: false })).toBe('std,no-debug=1')
    expect(sevValue({ ...sevFormFrom(undefined), type: 'snp', smt: false })).toBe('snp,allow-smt=0')
    expect(sevValue({ ...sevFormFrom('std'), type: undefined })).toBe('')
    expect(tdxValue({ ...tdxFormFrom(undefined), enabled: true })).toBe('tdx,attestation=1,vsock-cid=2,vsock-port=4050')
    expect(tdxValue(tdxFormFrom(undefined))).toBe('')
  })

  it('boot order', () => {
    const cfg = {
      boot: 'order=scsi0;net0',
      scsi0: 'local-lvm:vm-1-disk-0',
      ide2: 'local:iso/a.iso,media=cdrom',
      ide0: 'local-lvm:vm-1-cloudinit,media=cdrom',
      net0: 'virtio,bridge=vmbr0',
      usb0: 'spice',
    }
    const list = bootDevices(cfg)
    expect(list.map((d) => `${d.key}:${d.enabled ? 1 : 0}`)).toEqual(['scsi0:1', 'net0:1', 'ide2:0'])
    expect(bootValue([list[2]!, { ...list[0]!, enabled: true }, { ...list[1]!, enabled: false }].map((d, i) => (i === 0 ? { ...d, enabled: true } : d)))).toBe(
      'order=ide2;scsi0',
    )
    // Legacy "cdn" with bootdisk.
    expect(bootDevices({ boot: 'dc', bootdisk: 'scsi0', scsi0: 'x', ide2: 'none,media=cdrom' }).map((d) => d.key)).toEqual(['ide2', 'scsi0'])
  })
})

describe('cloud-init', () => {
  it('ipconfig', () => {
    expect(ipConfigFormFrom('ip=dhcp,ip6=auto')).toMatchObject({ ipv4: 'dhcp', ipv6: 'auto' })
    expect(ipConfigValue({ ipv4: 'static', ip: '10.0.0.2/24', gw: '10.0.0.1', ipv6: 'none', ip6: '', gw6: '' })).toBe('ip=10.0.0.2/24,gw=10.0.0.1')
    expect(ipConfigValue({ ipv4: 'none', ip: '', gw: '', ipv6: 'none', ip6: '', gw6: '' })).toBe('')
  })

  it('sshkeys are URL encoded', () => {
    const keys = 'ssh-ed25519 AAAAC3Nz me@laptop'
    const enc = encodeSshKeys(keys)
    expect(enc).toBe('ssh-ed25519%20AAAAC3Nz%20me%40laptop%0A')
    expect(decodeSshKeys(enc).trim()).toBe(keys)
    expect(encodeSshKeys('  ')).toBe('')
    expect(sshKeyLabels(`${keys}\nssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ`)).toEqual(['me@laptop', 'ssh-rsa …ABAAABgQ'])
  })
})
