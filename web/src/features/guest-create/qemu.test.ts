import { describe, expect, it } from 'vitest'

import {
  applyOsType,
  bootOrder,
  buildQemuParams,
  cdromParam,
  cpuParam,
  diskParam,
  freeIndexes,
  initialQemuForm,
  netParam,
  newDisk,
  qemuStepOfParam,
  setDiskBus,
  setMemory,
  setScsihw,
  setVirtioIso,
  startupParam,
  validateQemuStep,
  type QemuForm,
} from './qemu'

function form(patch: Partial<QemuForm> = {}): QemuForm {
  const f = initialQemuForm('pve-lab')
  return {
    ...f,
    vmid: 3700,
    iso: 'local:iso/alpine.iso',
    isoStorage: 'local',
    bridge: 'vmbr0',
    disks: f.disks.map((d) => ({ ...d, storage: 'local-lvm' })),
    ...patch,
  }
}

describe('initialQemuForm', () => {
  it('starts with the official defaults for Linux', () => {
    const f = initialQemuForm('n1')
    expect(f.ostype).toBe('l26')
    expect(f.scsihw).toBe('virtio-scsi-single')
    expect(f.model).toBe('virtio')
    expect(f.memory).toBe(2048)
    expect(f.cputype).toBe('x86-64-v2-AES')
    expect(f.disks).toHaveLength(1)
    expect(f.disks[0]).toMatchObject({ bus: 'scsi', index: 0, size: 32, iothread: true, backup: true })
    expect(f.firewall).toBe(true)
  })
})

describe('buildQemuParams', () => {
  it('maps a default Linux VM like the official wizard', () => {
    expect(buildQemuParams(form({ name: 'web-01' }))).toEqual({
      vmid: 3700,
      name: 'web-01',
      ostype: 'l26',
      ide2: 'local:iso/alpine.iso,media=cdrom',
      scsihw: 'virtio-scsi-single',
      scsi0: 'local-lvm:32,iothread=on',
      sockets: 1,
      cores: 1,
      cpu: 'x86-64-v2-AES',
      memory: 2048,
      net0: 'virtio,bridge=vmbr0,firewall=1',
    })
  })

  it('omits empty optional values and sends flags only when set', () => {
    const p = buildQemuParams(form({ media: 'none', noNetwork: true, disks: [] }))
    expect(p).not.toHaveProperty('name')
    expect(p).not.toHaveProperty('pool')
    expect(p).not.toHaveProperty('onboot')
    expect(p).not.toHaveProperty('net0')
    expect(p).not.toHaveProperty('start')
    expect(p.ide2).toBe('none,media=cdrom')
  })

  it('maps general options: pool, tags, onboot, startup, HA, start', () => {
    const p = buildQemuParams(
      form({ pool: 'lab', tags: ['web', 'prod'], onboot: true, startupOrder: 2, startupUp: 30, haManaged: true, start: true }),
    )
    expect(p).toMatchObject({ pool: 'lab', tags: 'web;prod', onboot: 1, startup: 'order=2,up=30', 'ha-managed': 1, start: 1 })
  })

  it('ballooning: off → balloon=0, equal → nothing, lower → balloon+shares', () => {
    expect(buildQemuParams(form({ ballooning: false })).balloon).toBe(0)
    const eq = buildQemuParams(form({ memory: 4096, balloon: 4096, shares: 500 }))
    expect(eq).not.toHaveProperty('balloon')
    expect(eq).not.toHaveProperty('shares')
    expect(buildQemuParams(form({ memory: 4096, balloon: 1024, shares: 500 }))).toMatchObject({ balloon: 1024, shares: 500 })
    expect(buildQemuParams(form({ allowKsm: false }))['allow-ksm']).toBe(0)
  })

  it('UEFI with EFI disk and TPM state use "<storage>:1"', () => {
    const p = buildQemuParams(form({ bios: 'ovmf', efiDisk: true, efiStorage: 'local-lvm', tpm: true, tpmStorage: 'local-lvm', machine: 'q35' }))
    expect(p.bios).toBe('ovmf')
    expect(p.machine).toBe('q35')
    expect(p.efidisk0).toBe('local-lvm:1,efitype=4m,pre-enrolled-keys=1')
    expect(p.tpmstate0).toBe('local-lvm:1,version=v2.0')
  })

  it('no EFI disk unless OVMF; pinned machine version wins over the type', () => {
    const p = buildQemuParams(form({ bios: 'seabios', efiDisk: true, efiStorage: 'local-lvm', machine: 'q35', machineVersion: 'pc-q35-10.1' }))
    expect(p).not.toHaveProperty('efidisk0')
    expect(p.machine).toBe('pc-q35-10.1')
  })

  it('serial display adds the serial port', () => {
    const p = buildQemuParams(form({ vga: 'serial0' }))
    expect(p.vga).toBe('serial0')
    expect(p.serial0).toBe('socket')
  })

  it('maps CPU options', () => {
    const p = buildQemuParams(
      form({ sockets: 2, cores: 4, cputype: 'host', vcpus: 6, cpulimit: 2.5, cpuunits: 200, affinity: '0-3, 8', numa: true, cpuFlags: { pcid: '-', aes: '+' } }),
    )
    expect(p).toMatchObject({ sockets: 2, cores: 4, cpu: 'host,flags=+aes;-pcid', vcpus: 6, cpulimit: 2.5, cpuunits: 200, affinity: '0-3,8', numa: 1 })
    expect(buildQemuParams(form({ cpulimit: 0 }))).not.toHaveProperty('cpulimit')
  })

  it('maps several disks with their options', () => {
    const f = form()
    const second = { ...newDisk(f, 'virtio', 'local'), size: 10, format: 'qcow2' as const, cache: 'writeback', discard: true, backup: false, noReplicate: true, mbps_rd: 100 }
    const p = buildQemuParams({ ...f, disks: [...f.disks, second] })
    expect(p.scsi0).toBe('local-lvm:32,iothread=on')
    expect(p.virtio0).toBe('local:10,format=qcow2,cache=writeback,discard=on,iothread=on,backup=0,replicate=no,mbps_rd=100')
  })
})

describe('drive helpers', () => {
  it('cdromParam', () => {
    expect(cdromParam('iso', 'local:iso/x.iso')).toBe('local:iso/x.iso,media=cdrom')
    expect(cdromParam('cdrom', '')).toBe('cdrom,media=cdrom')
    expect(cdromParam('none', 'ignored')).toBe('none,media=cdrom')
  })

  it('diskParam drops options the bus cannot have', () => {
    const base = { ...newDisk(initialQemuForm(), 'sata', 's'), size: 8, iothread: true, readonly: true, ssd: true }
    expect(diskParam(base)).toBe('s:8,ssd=on')
    expect(diskParam({ ...base, bus: 'virtio' })).toBe('s:8,iothread=on,ro=on')
  })

  it('cpuParam always names a model', () => {
    expect(cpuParam('', {})).toBe('x86-64-v2-AES')
    expect(cpuParam('kvm64', { 'nested-virt': '+' })).toBe('kvm64,flags=+nested-virt')
  })

  it('netParam: model=MAC quirk, vlan, options', () => {
    const f = form({ macaddr: 'bc:24:11:aa:bb:cc', vlan: 20, firewall: false, disconnect: true, mtu: 1, rate: 12.5, queues: 4 })
    expect(netParam(f)).toBe('virtio=BC:24:11:AA:BB:CC,bridge=vmbr0,tag=20,link_down=1,mtu=1,rate=12.5,queues=4')
    // MTU only for virtio
    expect(netParam({ ...f, model: 'e1000', macaddr: '' })).toBe('e1000,bridge=vmbr0,tag=20,link_down=1,rate=12.5,queues=4')
  })

  it('startupParam', () => {
    expect(startupParam()).toBeUndefined()
    expect(startupParam(1, undefined, 60)).toBe('order=1,down=60')
  })
})

describe('OS defaults', () => {
  it('Windows 10: IDE disk, e1000, memory unchanged default', () => {
    const f = applyOsType(form(), 'win10')
    expect(f.disks[0]).toMatchObject({ bus: 'ide', index: 0, iothread: false })
    expect(f.model).toBe('e1000')
    expect(f.machine).toBe('')
    expect(f.tpm).toBe(false)
  })

  it('Windows 11: q35 + OVMF + TPM + 4 GiB, and back again', () => {
    const w = applyOsType(form(), 'win11')
    expect(w).toMatchObject({ machine: 'q35', bios: 'ovmf', tpm: true, memory: 4096, balloon: 4096 })
    const l = applyOsType(w, 'l26')
    expect(l).toMatchObject({ machine: '', bios: '', tpm: false, memory: 2048, model: 'virtio' })
    expect(l.disks[0]?.bus).toBe('scsi')
  })

  it('keeps a memory the user changed', () => {
    const f = applyOsType(form({ memory: 1024, balloon: 1024 }), 'win11')
    expect(f.memory).toBe(1024)
  })

  it('does not touch the bus with several disks', () => {
    const f0 = form()
    const two = { ...f0, disks: [...f0.disks, newDisk(f0, 'sata', 'local-lvm')] }
    const f = applyOsType(two, 'win10')
    expect(f.disks.map((d) => d.bus)).toEqual(['scsi', 'sata'])
  })

  it('Windows 2000/XP: rtl8139 and the default SCSI controller', () => {
    const f = applyOsType(form(), 'wxp')
    expect(f.model).toBe('rtl8139')
    expect(f.scsihw).toBe('')
  })

  it('VirtIO driver ISO: ide0, SCSI disk, VirtIO NIC, explicit boot order', () => {
    const w = setVirtioIso(applyOsType(form(), 'win10'), true)
    expect(w.disks[0]).toMatchObject({ bus: 'scsi', index: 0 })
    expect(w.model).toBe('virtio')
    const p = buildQemuParams({ ...w, virtioIsoVolume: 'local:iso/virtio-win.iso' })
    expect(p.ide0).toBe('local:iso/virtio-win.iso,media=cdrom')
    expect(p.boot).toBe('order=scsi0;ide2;ide0;net0')
    const off = setVirtioIso(w, false)
    expect(off.disks[0]?.bus).toBe('ide')
    expect(bootOrder(off)).toBeUndefined()
  })

  it('leaving Windows drops the driver ISO', () => {
    const w = setVirtioIso(applyOsType(form(), 'win10'), true)
    expect(applyOsType(w, 'l26').virtioIso).toBe(false)
  })
})

describe('disk ids', () => {
  it('skips ide2 (installer) and ide0 with the driver ISO', () => {
    const f = { ...form(), disks: [] }
    expect(freeIndexes(f, 'ide')).toEqual([0, 1, 3])
    expect(freeIndexes({ ...f, virtioIso: true }, 'ide')).toEqual([1, 3])
  })

  it('setDiskBus picks a free index and resets bus options', () => {
    const f0 = form()
    const f = { ...f0, disks: [...f0.disks, { ...newDisk(f0, 'sata', 'x'), ssd: true }] }
    const moved = setDiskBus(f, f.disks[1]!.key, 'scsi')
    expect(moved.disks[1]).toMatchObject({ bus: 'scsi', index: 1, iothread: true })
    const virtio = setDiskBus(f, f.disks[1]!.key, 'virtio')
    expect(virtio.disks[1]).toMatchObject({ bus: 'virtio', index: 0, ssd: false })
  })

  it('setScsihw updates iothread of SCSI disks', () => {
    expect(setScsihw(form(), 'lsi').disks[0]?.iothread).toBe(false)
    expect(setScsihw(form(), 'virtio-scsi-single').disks[0]?.iothread).toBe(true)
  })
})

describe('setMemory', () => {
  it('minimum memory follows when equal or larger', () => {
    expect(setMemory(form({ memory: 2048, balloon: 2048 }), 4096).balloon).toBe(4096)
    expect(setMemory(form({ memory: 4096, balloon: 1024 }), 8192).balloon).toBe(1024)
    expect(setMemory(form({ memory: 4096, balloon: 3072 }), 2048).balloon).toBe(2048)
  })
})

describe('validateQemuStep', () => {
  it('general: vmid required and must be free; name is a DNS name; tags', () => {
    expect(validateQemuStep('general', form({ vmid: undefined }))).toHaveProperty('vmid')
    expect(validateQemuStep('general', form(), { vmidState: 'taken' }).vmid).toMatch(/已被使用/)
    expect(validateQemuStep('general', form(), { vmidState: 'checking' })).toHaveProperty('vmid')
    expect(validateQemuStep('general', form({ name: 'bad name' }))).toHaveProperty('name')
    expect(validateQemuStep('general', form({ name: 'web-01.lan' }))).toEqual({})
    expect(validateQemuStep('general', form({ tags: ['ok', 'no way'] }))).toHaveProperty('tags')
    expect(validateQemuStep('general', form({ node: '' }))).toHaveProperty('node')
  })

  it('os: ISO required for ISO media', () => {
    expect(validateQemuStep('os', form({ iso: '' }))).toHaveProperty('ide2')
    expect(validateQemuStep('os', form({ iso: '', media: 'none' }))).toEqual({})
    expect(validateQemuStep('os', form({ virtioIso: true }))).toHaveProperty('ide0')
  })

  it('system: EFI and TPM storages', () => {
    expect(validateQemuStep('system', form({ bios: 'ovmf' }))).toHaveProperty('efidisk0')
    expect(validateQemuStep('system', form({ bios: 'ovmf', efiDisk: false }))).toEqual({})
    expect(validateQemuStep('system', form({ tpm: true }))).toHaveProperty('tpmstate0')
  })

  it('disks: storage and size per disk', () => {
    const f = form()
    expect(validateQemuStep('disks', { ...f, disks: [{ ...f.disks[0]!, storage: '' }] })).toHaveProperty('scsi0')
    expect(validateQemuStep('disks', { ...f, disks: [{ ...f.disks[0]!, size: undefined }] })).toHaveProperty('scsi0')
    expect(validateQemuStep('disks', f)).toEqual({})
  })

  it('cpu, memory and network ranges', () => {
    expect(validateQemuStep('cpu', form({ vcpus: 3 }))).toHaveProperty('vcpus')
    expect(validateQemuStep('cpu', form({ affinity: 'abc' }))).toHaveProperty('affinity')
    expect(validateQemuStep('memory', form({ memory: 1024, balloon: 2048 }))).toHaveProperty('balloon')
    expect(validateQemuStep('memory', form({ ballooning: false, memory: 1024, balloon: 2048 }))).toEqual({})
    expect(validateQemuStep('network', form({ macaddr: '01:00:5E:00:00:01' }))).toHaveProperty('macaddr')
    expect(validateQemuStep('network', form({ vlan: 5000 }))).toHaveProperty('tag')
    expect(validateQemuStep('network', form({ mtu: 100 }))).toHaveProperty('mtu')
    expect(validateQemuStep('network', form({ bridge: '', noNetwork: true }))).toEqual({})
  })
})

describe('qemuStepOfParam', () => {
  it('maps API parameters to wizard steps', () => {
    expect(qemuStepOfParam('vmid')).toBe('general')
    expect(qemuStepOfParam('ide2')).toBe('os')
    expect(qemuStepOfParam('efidisk0')).toBe('system')
    expect(qemuStepOfParam('virtio3')).toBe('disks')
    expect(qemuStepOfParam('cpu')).toBe('cpu')
    expect(qemuStepOfParam('balloon')).toBe('memory')
    expect(qemuStepOfParam('net0')).toBe('network')
    expect(qemuStepOfParam('whatever')).toBe('confirm')
  })
})
