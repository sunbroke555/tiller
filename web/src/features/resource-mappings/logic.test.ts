import { describe, expect, it } from 'vitest'

import type { HostPciDevice, HostUsbDevice } from '@/api/qemu-config'
import { repairUtf8, type ClusterMapping } from '@/api/resource-mappings'

import {
  checkDirItem,
  checkPciItem,
  checkUsbItem,
  cpuModelForm,
  createCpuModelParams,
  createMappingParams,
  globalMappingParams,
  groupByNode,
  nodeMappingParams,
  normalizePciSelection,
  parseMapItem,
  pciChoices,
  pciMapEntries,
  pciMapEntry,
  removalRequest,
  removeEntry,
  removeNodeEntries,
  replaceNodeEntries,
  sharedIommuGroups,
  updateCpuModelParams,
  usbMapEntry,
  validateCpuModelForm,
  validateDirPath,
  validateMappingId,
} from './logic'

const gpu: HostPciDevice = {
  id: '0000:01:00.0',
  class: '0x030000',
  vendor: '0x10de',
  device: '0x1eb8',
  vendor_name: 'NVIDIA Corporation',
  device_name: 'TU104GL [Tesla T4]',
  subsystem_vendor: '0x10de',
  subsystem_device: '0x12a2',
  iommugroup: 12,
  mdev: 1,
}
const gpuAudio: HostPciDevice = { ...gpu, id: '0000:01:00.1', class: '0x040300', device: '0x10f8', mdev: undefined }
const nic: HostPciDevice = { id: '0000:02:00.0', class: '0x020000', vendor: '0x8086', device: '0x1533', iommugroup: 13 }

describe('repairUtf8', () => {
  it('re-decodes UTF-8 read as Latin-1 and leaves other text alone', () => {
    const mangled = String.fromCharCode(...new TextEncoder().encode('e2e 网卡'))
    expect(repairUtf8(mangled)).toBe('e2e 网卡')
    expect(repairUtf8('e2e 网卡')).toBe('e2e 网卡')
    expect(repairUtf8('café')).toBe('café')
    expect(repairUtf8(undefined)).toBeUndefined()
  })
})

describe('map property strings', () => {
  const map = [
    'node=pve2,path=0000:01:00.0,id=10de:1eb8,iommugroup=12',
    'node=pve1,path=0000:01:00.0,id=10de:1eb8,subsystem-id=10de:12a2,iommugroup=12',
    'node=pve1,path=0000:02:00.0,id=10de:1eb8,iommugroup=14',
  ]

  it('parses entries and groups them by node', () => {
    expect(parseMapItem(map[1]!)).toMatchObject({ node: 'pve1', path: '0000:01:00.0', 'subsystem-id': '10de:12a2', iommugroup: '12' })
    const groups = groupByNode(map)
    expect(groups.map((g) => [g.node, g.items.length])).toEqual([
      ['pve1', 2],
      ['pve2', 1],
    ])
    expect(groups[0]!.items[1]!.raw).toBe(map[2])
  })

  it('keeps multi-path values (";") inside one entry', () => {
    expect(parseMapItem('node=a,path=0000:01:00.0;0000:02:00.0,id=10de:1eb8').path).toBe('0000:01:00.0;0000:02:00.0')
  })

  it('replaces and removes per node', () => {
    expect(replaceNodeEntries(map, 'pve1', ['node=pve1,path=x'])).toEqual([map[0], 'node=pve1,path=x'])
    expect(removeNodeEntries(map, 'pve2')).toEqual([map[1], map[2]])
    expect(removeEntry(map, map[2]!)).toEqual([map[0], map[1]])
  })

  it('deletes the mapping when the last entry goes', () => {
    const m: ClusterMapping = { id: 'gpu', map, digest: 'd1' }
    expect(removalRequest(m, [])).toEqual({ method: 'DELETE' })
    expect(removalRequest(m, [map[0]!])).toEqual({ method: 'PUT', params: { map: [map[0]], digest: 'd1' } })
  })
})

describe('PCI entries', () => {
  it('builds the entry like the official picker', () => {
    expect(pciMapEntry('pve1', gpu)).toBe('node=pve1,path=0000:01:00.0,id=10de:1eb8,subsystem-id=10de:12a2,iommugroup=12')
    expect(pciMapEntry('pve1', { ...nic, iommugroup: -1 })).toBe('node=pve1,path=0000:02:00.0,id=8086:1533')
  })

  it('adds an "all functions" row for multi-function devices', () => {
    const choices = pciChoices([nic, gpuAudio, gpu])
    expect(choices.map((c) => [c.id, !!c.slot])).toEqual([
      ['0000:01:00', true],
      ['0000:01:00.0', false],
      ['0000:01:00.1', false],
      ['0000:02:00.0', false],
    ])
    expect(choices[0]).toMatchObject({ device: '0x1eb8', functions: 2, mdev: undefined })
    expect(pciMapEntries('n', ['0000:01:00'], choices)).toEqual(['node=n,path=0000:01:00,id=10de:1eb8,subsystem-id=10de:12a2,iommugroup=12'])
  })

  it('drops functions covered by a picked slot and keeps entries of vanished devices', () => {
    expect(normalizePciSelection(['0000:01:00.1', '0000:01:00', '0000:02:00.0'])).toEqual(['0000:01:00', '0000:02:00.0'])
    const prev = [parseMapItem('node=n,path=0000:09:00.0,id=1234:5678')]
    expect(pciMapEntries('n', ['0000:09:00.0'], pciChoices([gpu]), prev)).toEqual(['node=n,path=0000:09:00.0,id=1234:5678'])
  })

  it('warns about devices sharing an IOMMU group with unpicked ones', () => {
    const other = { ...nic, id: '0000:03:00.0', iommugroup: 12 }
    expect(sharedIommuGroups(['0000:01:00.0'], [gpu, gpuAudio, other])).toEqual(['0000:01:00.0'])
    expect(sharedIommuGroups(['0000:01:00'], [gpu, gpuAudio])).toEqual([])
    expect(sharedIommuGroups(['0000:01:00.0', '0000:01:00.1'], [gpu, gpuAudio])).toEqual([])
  })

  it('checks entries against the host list', () => {
    const ok = parseMapItem(pciMapEntry('n', gpu))
    expect(checkPciItem(ok, [gpu], true)).toEqual({ state: 'ok', messages: [] })
    // mdev flag on the mapping but the device has none
    expect(checkPciItem(parseMapItem(pciMapEntry('n', nic)), [nic], true).state).toBe('error')
    const moved = checkPciItem(ok, [{ ...gpu, iommugroup: 30 }], true)
    expect(moved.state).toBe('error')
    expect(moved.messages[0]).toContain('iommugroup')
    expect(checkPciItem(ok, [], true).messages).toEqual(['找不到 PCI 设备 0000:01:00.0'])
    // whole-slot path checks function .0
    expect(checkPciItem(parseMapItem('node=n,path=0000:01:00,id=10de:1eb8,subsystem-id=10de:12a2,iommugroup=12'), [gpu], true).state).toBe('ok')
  })
})

describe('USB entries', () => {
  const tablet: HostUsbDevice = { busnum: 1, devnum: 2, port: 0, level: 1, class: 0, vendid: '0627', prodid: '0001', usbpath: '1', product: 'QEMU USB Tablet' }

  it('maps by id or by port (recording the id found there)', () => {
    expect(usbMapEntry('n', 'id', '0627:0001', [])).toEqual({ entry: 'node=n,id=0627:0001' })
    expect(usbMapEntry('n', 'path', '1-1', [tablet])).toEqual({ entry: 'node=n,path=1-1,id=0627:0001' })
    expect(usbMapEntry('n', 'path', '1-2', [tablet])).toHaveProperty('error')
    expect(usbMapEntry('n', 'id', '627:1', [])).toHaveProperty('error')
  })

  it('checks entries', () => {
    expect(checkUsbItem(parseMapItem('node=n,id=0627:0001'), [tablet]).state).toBe('ok')
    expect(checkUsbItem(parseMapItem('node=n,path=1-1,id=046d:c52b'), [tablet]).state).toBe('error')
    expect(checkUsbItem(parseMapItem('node=n,id=046d:c52b'), [tablet]).messages[0]).toContain('046d:c52b')
  })
})

describe('directory entries', () => {
  it('validates paths', () => {
    expect(validateDirPath('/var/lib/e2e-rm-dir')).toBeUndefined()
    expect(validateDirPath('relative')).toBeTruthy()
    expect(validateDirPath('/a,b')).toBeTruthy()
  })
  it('turns node checks into a status', () => {
    expect(checkDirItem([])).toEqual({ state: 'ok', messages: [] })
    expect(checkDirItem([{ severity: 'error', message: 'Invalid configuration: Path /x does not exist\n' }])).toEqual({
      state: 'error',
      messages: ['Path /x does not exist'],
    })
  })
})

describe('mapping params', () => {
  it('creates with flags only when set', () => {
    expect(createMappingParams(' gpu ', ['node=a,path=x'], '', { mdev: false, liveMigration: true })).toEqual({
      id: 'gpu',
      map: ['node=a,path=x'],
      'live-migration-capable': 1,
    })
    expect(createMappingParams('share', ['node=a,path=/x'], ' 共享 ')).toEqual({ id: 'share', map: ['node=a,path=/x'], description: '共享' })
  })

  it('edits mapping-wide fields with delete and digest', () => {
    const m: ClusterMapping = { id: 'gpu', map: ['node=a,path=1'], description: 'old', mdev: 1, digest: 'd' }
    expect(globalMappingParams(m, 'old', { mdev: true, liveMigration: false })).toBeNull()
    expect(globalMappingParams(m, '', { mdev: false, liveMigration: true })).toEqual({
      'live-migration-capable': '1',
      delete: 'description,mdev',
      digest: 'd',
      map: ['node=a,path=1'],
    })
    expect(globalMappingParams({ id: 'u', description: 'a' }, 'b')).toEqual({ description: 'b', map: [] })
  })

  it('replaces one node and keeps the others', () => {
    const m: ClusterMapping = { id: 'gpu', map: ['node=a,path=1', 'node=b,path=2'], digest: 'd' }
    expect(nodeMappingParams(m, 'a', ['node=a,path=1'])).toBeNull()
    expect(nodeMappingParams(m, 'a', ['node=a,path=3'])).toEqual({ map: ['node=b,path=2', 'node=a,path=3'], digest: 'd' })
    expect(nodeMappingParams(m, 'c', ['node=c,path=4'])?.map).toEqual(['node=a,path=1', 'node=b,path=2', 'node=c,path=4'])
  })

  it('validates ids', () => {
    expect(validateMappingId('e2e-rm-gpu')).toBeUndefined()
    expect(validateMappingId('1gpu')).toBeTruthy()
    expect(validateMappingId('g')).toBeTruthy()
  })
})

describe('custom CPU models', () => {
  const model = {
    cputype: 'custom-win',
    'reported-model': 'Skylake-Server',
    flags: '-pcid;+aes',
    hidden: 1 as const,
    'phys-bits': 'host',
    digest: 'd',
  }

  it('creates without empty fields', () => {
    const f = { ...cpuModelForm(), name: 'custom-e2e', reportedModel: 'host', flags: { aes: '+' as const, pcid: undefined } }
    expect(createCpuModelParams(f)).toEqual({ cputype: 'e2e', 'reported-model': 'host', flags: '+aes' })
  })

  it('round-trips a model and sends only changes', () => {
    const f = cpuModelForm(model)
    expect(f).toMatchObject({ name: 'win', hidden: true, physBits: 'host', flags: { aes: '+', pcid: '-' } })
    expect(updateCpuModelParams(model, f)).toBeNull()
    expect(updateCpuModelParams(model, { ...f, hidden: false, physBits: '42', level: 30, flags: { aes: '+' } })).toEqual({
      'phys-bits': '42',
      level: '30',
      flags: '+aes',
      delete: 'hidden',
      digest: 'd',
    })
    // reported-model can't be deleted: an empty field leaves it alone
    expect(updateCpuModelParams(model, { ...f, reportedModel: '' })).toBeNull()
  })

  it('validates', () => {
    const f = cpuModelForm()
    expect(validateCpuModelForm(f, true)).toMatchObject({ name: '必填', reportedModel: '必填' })
    expect(validateCpuModelForm({ ...f, name: 'x1', reportedModel: 'host', physBits: '7', hvVendorId: 'too-long-vendor' }, true)).toEqual({
      physBits: expect.any(String),
      hvVendorId: expect.any(String),
    })
    expect(validateCpuModelForm({ ...f, physBits: 'host' }, false)).toEqual({})
  })
})
