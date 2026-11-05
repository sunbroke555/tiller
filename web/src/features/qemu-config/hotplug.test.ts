import { describe, expect, it } from 'vitest'
import { classifyOnlineChange, onlineApplyParams, verifiedOnlineKeys } from './hotplug'
import { splitPending } from './model'
import type { QemuPendingEntry } from '@/api/qemu-config'

const state = (entries: QemuPendingEntry[]) => splitPending([{ key: 'digest', value: 'snapshot-a' }, ...entries])
const check = (entries: QemuPendingEntry[], key: string, machine?: string) => classifyOnlineChange(state(entries), key, machine)

describe('online eligibility uses active PVE config', () => {
  it('does not use pending CPU/memory hotplug flags, topology or NUMA', () => {
    expect(check([{ key: 'hotplug', value: 'disk', pending: 'cpu,memory' }, { key: 'memory', value: 2048, pending: 4096 }], 'memory').mode).toBe('restart')
    expect(check([{ key: 'hotplug', value: 'cpu' }, { key: 'cores', value: 1, pending: 2 }, { key: 'vcpus', value: 1, pending: 2 }], 'vcpus').mode).toBe('restart')
    expect(check([{ key: 'hotplug', value: 'memory' }, { key: 'numa', value: 0, pending: 1 }, { key: 'memory', value: 2048, pending: 4096 }], 'memory').mode).toBe('restart')
  })
  it.each(['cores', 'sockets', 'cpu', 'machine', 'bios', 'scsihw', 'efidisk0', 'hostpci0', 'numa0'])('%s requires a fresh start', (key) => {
    expect(check([{ key, value: 'old', pending: 'new' }, { key: 'hotplug', value: 'cpu,memory,disk,network,usb' }], key).mode).toBe('restart')
  })
  it('allows online memory and vCPU when prerequisites are already active', () => {
    expect(check([{ key: 'hotplug', value: 'memory' }, { key: 'numa', value: 1 }, { key: 'memory', value: 2048, pending: 4096 }], 'memory').mode).toBe('online')
    expect(check([{ key: 'hotplug', value: 'cpu' }, { key: 'cores', value: 4 }, { key: 'vcpus', value: 2, pending: 3 }], 'vcpus').mode).toBe('online')
  })
  it('allows an in-place network rate change with hotplug disabled, but not a new device', () => {
    const net = 'virtio=BC:24:11:00:00:01,bridge=vmbr0'
    expect(check([{ key: 'hotplug', value: 0 }, { key: 'net0', value: net, pending: `${net},rate=10` }], 'net0').mode).toBe('online')
    expect(check([{ key: 'hotplug', value: 0 }, { key: 'net1', pending: net }], 'net1').mode).toBe('restart')
    expect(check([{ key: 'net1', pending: net }], 'net1').mode).toBe('online')
  })
  it('distinguishes disk throttling from cache / IO-thread changes', () => {
    const disk = 'local-lvm:vm-3400-disk-0,size=1G'
    expect(check([{ key: 'hotplug', value: 0 }, { key: 'scsi0', value: disk, pending: `${disk},mbps=10` }], 'scsi0').mode).toBe('online')
    expect(check([{ key: 'scsi0', value: disk, pending: `${disk},cache=writeback` }], 'scsi0').mode).toBe('restart')
    expect(check([{ key: 'scsi0', value: disk, pending: `${disk},serial=new` }], 'scsi0').mode).toBe('manual')
    expect(check([{ key: 'sata0', pending: disk }], 'sata0').mode).toBe('restart')
    expect(check([{ key: 'ide2', value: 'none,media=cdrom', pending: 'local:iso/test.iso,media=cdrom' }], 'ide2').mode).toBe('online')
  })
  it('requires a known running machine and supported guest type for USB', () => {
    const entries: QemuPendingEntry[] = [{ key: 'usb0', pending: 'spice' }, { key: 'ostype', value: 'l26' }]
    expect(check(entries, 'usb0').mode).toBe('manual')
    expect(check(entries, 'usb0', 'pc-i440fx-6.2').mode).toBe('restart')
    expect(check(entries, 'usb0', 'pc-q35-10.1+pve0').mode).toBe('online')
  })
  it('does not bulk replay deletions, unknown fields, or balloon device enablement', () => {
    expect(check([{ key: 'scsi0', value: 'disk', delete: 2 }], 'scsi0').mode).toBe('manual')
    expect(check([{ key: 'balloon', value: 0, pending: 1024 }], 'balloon').mode).toBe('restart')
    expect(check([{ key: 'future-option', pending: 1 }], 'future-option').mode).toBe('manual')
  })
  it('Guest Agent enablement requires a restart; fstrim can update online', () => {
    expect(check([{ key: 'agent', value: 0, pending: 1 }], 'agent').mode).toBe('restart')
    expect(check([{ key: 'agent', value: '1,fstrim_cloned_disks=0', pending: '1,fstrim_cloned_disks=1' }], 'agent').mode).toBe('online')
  })
})

describe('selected retry and read-back', () => {
  it('sends only permitted, eligible pending values, with the original digest', () => {
    const s = state([{ key: 'cpulimit', value: 1, pending: 2 }, { key: 'cores', value: 1, pending: 2 }, { key: 'net0', pending: 'virtio,bridge=vmbr0' }, { key: 'scsi0', value: 'disk', delete: 2 }])
    const changes = [...s.pending].map((k) => classifyOnlineChange(s, k))
    expect(onlineApplyParams(s, changes, (p) => p === 'VM.Config.CPU')).toEqual({ digest: 'snapshot-a', cpulimit: '2' })
    expect(onlineApplyParams(s, changes, () => false)).toBeNull()
    expect(onlineApplyParams({ ...s, digest: undefined }, changes, () => true)).toBeNull()
    expect(onlineApplyParams({ ...s, current: { ...s.current, lock: 'backup' } }, changes, () => true)).toBeNull()
  })
  it('does not claim pending, reverted, or concurrently changed values applied', () => {
    const params = { digest: 'old', cpulimit: '2', cpuunits: '200', shares: '100' }
    const fresh = state([{ key: 'cpulimit', value: 2 }, { key: 'cpuunits', value: 100, pending: 200 }, { key: 'shares', value: 50 }])
    expect(verifiedOnlineKeys(params, fresh)).toEqual(['cpulimit'])
  })
})
