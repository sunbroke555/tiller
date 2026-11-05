import { describe, expect, it } from 'vitest'

import type { AgentCpuStat, AgentDisk, AgentDiskStat } from '@/api/guest-core'

import {
  MAX_SAMPLE_GAP_MS,
  cpuBreakdown,
  diskRates,
  guestDiskRows,
  parseLoad,
  partitionParent,
  sampleGap,
  visibleDiskStats,
} from './agentStats'

const cpu = (i: number, v: Partial<AgentCpuStat>): AgentCpuStat => ({
  type: 'linux',
  cpu: i,
  user: 0,
  nice: 0,
  system: 0,
  idle: 0,
  iowait: 0,
  irq: 0,
  softirq: 0,
  steal: 0,
  guest: 0,
  guestnice: 0,
  ...v,
})

const disk = (name: string, stats: Record<string, number>): AgentDiskStat => ({ name, major: 8, minor: 0, stats })

describe('sampleGap', () => {
  it('needs two samples in time order and within the maximum gap', () => {
    expect(sampleGap(undefined, { at: 1000, data: null })).toBeNull()
    expect(sampleGap({ at: 1000, data: null }, undefined)).toBeNull()
    expect(sampleGap({ at: 1000, data: null }, { at: 1000, data: null })).toBeNull()
    expect(sampleGap({ at: 2000, data: null }, { at: 1000, data: null })).toBeNull()
    expect(sampleGap({ at: 0, data: null }, { at: MAX_SAMPLE_GAP_MS + 1, data: null })).toBeNull()
    expect(sampleGap({ at: 1000, data: null }, { at: 11_000, data: null })).toBe(10)
  })
})

describe('parseLoad', () => {
  it('keeps finite numbers and drops the rest', () => {
    expect(parseLoad({ load1m: 0.5, load5m: 0.25, load15m: 0.1 })).toEqual({ load1: 0.5, load5: 0.25, load15: 0.1 })
    expect(parseLoad({ load1m: 1.5 })).toEqual({ load1: 1.5, load5: undefined, load15: undefined })
    expect(parseLoad({ load1m: Number.NaN, load5m: 'x' as unknown as number })).toBeNull()
    expect(parseLoad({})).toBeNull()
    expect(parseLoad(null)).toBeNull()
    expect(parseLoad(undefined)).toBeNull()
  })
})

describe('cpuBreakdown', () => {
  it('returns nothing without a previous sample', () => {
    expect(cpuBreakdown(undefined, [cpu(0, { user: 10 })])).toBeNull()
    expect(cpuBreakdown(null, null)).toBeNull()
  })

  it('splits the time across all CPUs', () => {
    const prev = [cpu(0, { user: 100, idle: 1000 }), cpu(1, { system: 50, idle: 1000 })]
    const cur = [
      cpu(0, { user: 140, nice: 10, idle: 1040, iowait: 10 }),
      cpu(1, { system: 70, irq: 5, softirq: 5, idle: 1060, steal: 10 }),
    ]
    // Deltas: user 40 + nice 10, system 20 + irq 5 + softirq 5, idle 40 + 60, iowait 10, steal 10 → total 200.
    const b = cpuBreakdown(prev, cur)!
    expect(b.cpus).toBe(2)
    expect(b.user).toBeCloseTo(0.25)
    expect(b.system).toBeCloseTo(0.15)
    expect(b.idle).toBeCloseTo(0.5)
    expect(b.iowait).toBeCloseTo(0.05)
    expect(b.steal).toBeCloseTo(0.05)
    expect(b.busy).toBeCloseTo(0.45)
  })

  it('does not count guest time twice', () => {
    const b = cpuBreakdown([cpu(0, { user: 0, idle: 0, guest: 0 })], [cpu(0, { user: 50, idle: 50, guest: 50 })])!
    expect(b.user).toBeCloseTo(0.5)
    expect(b.idle).toBeCloseTo(0.5)
  })

  it('skips CPUs whose counters went backwards (guest reboot)', () => {
    const prev = [cpu(0, { user: 5000, idle: 9000 }), cpu(1, { user: 100, idle: 100 })]
    const cur = [cpu(0, { user: 10, idle: 20 }), cpu(1, { user: 150, idle: 150 })]
    const b = cpuBreakdown(prev, cur)!
    expect(b.cpus).toBe(1)
    expect(b.user).toBeCloseTo(0.5)
    for (const v of [b.user, b.system, b.iowait, b.steal, b.idle, b.busy]) expect(v).toBeGreaterThanOrEqual(0)
  })

  it('returns null when every CPU reset or no time passed', () => {
    expect(cpuBreakdown([cpu(0, { user: 100, idle: 100 })], [cpu(0, { user: 1, idle: 1 })])).toBeNull()
    expect(cpuBreakdown([cpu(0, { user: 100 })], [cpu(0, { user: 100 })])).toBeNull()
  })

  it('matches CPUs by index and ignores hot-plugged ones', () => {
    const prev = [cpu(1, { user: 0, idle: 0 })]
    const cur = [cpu(0, { user: 999, idle: 0 }), cpu(1, { user: 10, idle: 30 })]
    const b = cpuBreakdown(prev, cur)!
    expect(b.cpus).toBe(1)
    expect(b.user).toBeCloseTo(0.25)
  })

  it('tolerates missing fields and missing cpu numbers', () => {
    const prev: AgentCpuStat[] = [{ user: 10, idle: 10 }, {} as AgentCpuStat]
    const cur: AgentCpuStat[] = [{ user: 20, idle: 40, system: 5 }, { user: 3 }]
    const b = cpuBreakdown(prev, cur)!
    // CPU 0: user 10, idle 30 (system has no previous value); CPU 1: nothing comparable.
    expect(b.cpus).toBe(1)
    expect(b.user).toBeCloseTo(0.25)
    expect(b.idle).toBeCloseTo(0.75)
    expect(b.system).toBe(0)
  })
})

describe('diskRates', () => {
  it('computes bytes per second from 512-byte sectors and IOPS', () => {
    const prev = [disk('sda', { 'read-sectors': 1000, 'write-sectors': 2000, 'read-ios': 10, 'write-ios': 20 })]
    const cur = [disk('sda', { 'read-sectors': 3000, 'write-sectors': 2000, 'read-ios': 60, 'write-ios': 25 })]
    expect(diskRates(prev, cur, 10)).toEqual([
      { name: 'sda', readBps: (2000 * 512) / 10, writeBps: 0, readIops: 5, writeIops: 0.5 },
    ])
  })

  it('returns nothing for the first sample or a bad interval', () => {
    const cur = [disk('sda', { 'read-sectors': 1, 'read-ios': 1 })]
    expect(diskRates(undefined, cur, 10)).toEqual([])
    expect(diskRates(cur, cur, 0)).toEqual([])
  })

  it('skips disks whose counters reset and disks that are new', () => {
    const prev = [disk('sda', { 'read-sectors': 5000, 'read-ios': 50 }), disk('vda', { 'read-sectors': 0, 'read-ios': 1 })]
    const cur = [
      disk('sda', { 'read-sectors': 10, 'read-ios': 1 }),
      disk('vda', { 'read-sectors': 512, 'read-ios': 2 }),
      disk('vdb', { 'read-sectors': 512, 'read-ios': 2 }),
    ]
    const r = diskRates(prev, cur, 1)
    expect(r.map((d) => d.name)).toEqual(['vda'])
    expect(r[0]?.readBps).toBe(512 * 512)
  })

  it('reports missing counters as null', () => {
    const prev = [disk('vda', { 'read-ios': 1 })]
    const cur = [disk('vda', { 'read-ios': 11 })]
    expect(diskRates(prev, cur, 10)).toEqual([{ name: 'vda', readBps: null, writeBps: null, readIops: 1, writeIops: null }])
  })

  it('drops a disk without any usable counter', () => {
    const prev: AgentDiskStat[] = [{ name: 'vda' }]
    const cur: AgentDiskStat[] = [{ name: 'vda', stats: {} }]
    expect(diskRates(prev, cur, 10)).toEqual([])
  })
})

describe('visibleDiskStats', () => {
  it('hides virtual devices, idle devices and partitions of listed disks', () => {
    const list = [
      disk('loop0', { 'read-ios': 5 }),
      disk('ram0', { 'read-ios': 5 }),
      disk('sr0', { 'read-ios': 0, 'write-ios': 0 }),
      disk('sda', { 'read-ios': 5 }),
      disk('sda1', { 'read-ios': 5 }),
      disk('nvme0n1', { 'write-ios': 1 }),
      disk('nvme0n1p2', { 'write-ios': 1 }),
      disk('vdb1', { 'read-ios': 3 }),
      disk('dm-0', { 'read-ios': 3 }),
      disk('vdc', { 'read-ios': 0, 'write-ios': 0 }),
      { name: 'vdd' },
      { name: '' },
    ]
    expect(visibleDiskStats(list).map((d) => d.name)).toEqual(['sda', 'nvme0n1', 'vdb1', 'dm-0', 'vdd'])
    expect(visibleDiskStats(null)).toEqual([])
  })

  it('knows common partition names', () => {
    expect(partitionParent('sda1')).toBe('sda')
    expect(partitionParent('xvdb12')).toBe('xvdb')
    expect(partitionParent('nvme0n1p3')).toBe('nvme0n1')
    expect(partitionParent('mmcblk0p1')).toBe('mmcblk0')
    expect(partitionParent('nvme0n1')).toBeNull()
    expect(partitionParent('dm-0')).toBeNull()
    expect(partitionParent('sda')).toBeNull()
  })
})

describe('guestDiskRows', () => {
  it('puts partitions under their disk and keeps the details that exist', () => {
    const list: AgentDisk[] = [
      { name: '/dev/sda1', partition: true, dependencies: ['/dev/sda'] },
      { name: '/dev/sda', partition: false, address: { 'bus-type': 'scsi', serial: ' drive-scsi0 ' } },
      { name: '/dev/dm-0', partition: false, dependencies: ['/dev/sda1'], alias: 'vg0-root' },
      { name: '/dev/nvme0n1', partition: false, address: { 'bus-type': 'unknown' }, smart: { type: 'nvme', temperature: 310 } },
      { name: '/dev/vdb2', partition: true, dependencies: ['/dev/vdb'] },
    ]
    expect(guestDiskRows(list)).toEqual([
      { name: 'sda', partition: false, depth: 0, alias: undefined, serial: 'drive-scsi0', bus: 'scsi', temperature: undefined },
      { name: 'sda1', partition: true, depth: 1, alias: undefined, serial: undefined, bus: undefined, temperature: undefined },
      { name: 'dm-0', partition: false, depth: 0, alias: 'vg0-root', serial: undefined, bus: undefined, temperature: undefined },
      { name: 'nvme0n1', partition: false, depth: 0, alias: undefined, serial: undefined, bus: undefined, temperature: 37 },
      { name: 'vdb2', partition: true, depth: 0, alias: undefined, serial: undefined, bus: undefined, temperature: undefined },
    ])
  })

  it('survives dependency cycles and junk entries', () => {
    const list = [
      { name: '/dev/a', partition: true, dependencies: ['/dev/b'] },
      { name: '/dev/b', partition: true, dependencies: ['/dev/a'] },
      null,
      { partition: false },
    ] as unknown as AgentDisk[]
    expect(guestDiskRows(list).map((r) => r.name).sort()).toEqual(['a', 'b'])
    expect(guestDiskRows(undefined)).toEqual([])
  })
})
