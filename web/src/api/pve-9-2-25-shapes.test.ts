// Response shapes captured from a PVE 9.2.25 node (pvesh), so the parsers stay
// pinned to what the API really returns rather than to the schema alone.

import { describe, expect, it } from 'vitest'

import { parseCephTime, releaseOptions } from '@/features/ceph/model'
import { cpuBreakdown, diskRates, guestDiskRows, parseLoad } from '@/features/guest-core/agentStats'

import { parseJournal } from './node-summary'

describe('GET /nodes/{node}/journal?structured=1&identifiers=1&units=1', () => {
  const sample = [
    { ids: ['pveproxy', 'systemd', 'kernel'], ty: 'identifiers' },
    { names: ['pveproxy.service', 'session-8.scope'], ty: 'units' },
    { c: 's=aa;i=8f43;b=bb;m=18010934;t=65f7d35d5d244;x=910f', ty: 'cursor' },
    { h: 'pve1', ty: 'host' },
    { id: 'systemd', msg: 'Reached target default.target - Main User Target.', p: 6, pid: 31219, t: 1793841239020100 },
    { id: 'pveproxy', msg: 'worker 1537 finished', p: 3, pid: 1535, t: 1793841239020131 },
    { c: 's=aa;i=8f45;b=bb;m=18012195;t=65f7d35d5eaa4;x=ad7a', ty: 'cursor' },
  ]

  it('reads entries, cursors, host and the completion lists', () => {
    const chunk = parseJournal(sample, true)
    expect(chunk.structured).toBe(true)
    expect(chunk.host).toBe('pve1')
    expect(chunk.firstCursor).toBe('s=aa;i=8f43;b=bb;m=18010934;t=65f7d35d5d244;x=910f')
    expect(chunk.lastCursor).toBe('s=aa;i=8f45;b=bb;m=18012195;t=65f7d35d5eaa4;x=ad7a')
    expect(chunk.identifiers).toEqual(['pveproxy', 'systemd', 'kernel'])
    expect(chunk.units).toEqual(['pveproxy.service', 'session-8.scope'])
    expect(chunk.lines.map((l) => [l.identifier, l.priority, l.pid, l.time, l.message])).toEqual([
      ['systemd', 6, 31219, 1793841239020100, 'Reached target default.target - Main User Target.'],
      ['pveproxy', 3, 1535, 1793841239020131, 'worker 1537 finished'],
    ])
  })
})

describe('GET /cluster/ceph/health-mute', () => {
  it('parses the ttl stamp Ceph returns (microseconds, +HHMM offset)', () => {
    expect(parseCephTime('2026-11-05T10:14:00.919418+0800')).toBe(Date.parse('2026-11-05T02:14:00.919Z'))
  })
})

describe('GET /nodes/{node}/ceph/releases', () => {
  it('marks unavailable releases and the default/unsupported flags', () => {
    const options = releaseOptions([
      { available: 0, 'is-default': 0, release: 'reef', unsupported: 0, version: '18.2' },
      { available: 1, 'is-default': 0, release: 'squid', unsupported: 0, version: '19.2' },
      { available: 1, 'is-default': 1, release: 'tentacle', unsupported: 0, version: '20.2' },
      { available: 1, 'is-default': 0, release: 'umbrella', unsupported: 1, version: '21.2' },
    ])
    const byName = (release: string) => options.find((o) => o.release === release)
    expect(byName('reef')?.unavailable).toBeTruthy()
    expect(byName('squid')?.unavailable).toBeNull()
    expect(byName('tentacle')?.isDefault).toBe(true)
    expect(byName('umbrella')?.preview).toBe(true)
  })
})

describe('GET /nodes/{node}/qemu/{vmid}/agent/get-* (Linux guest)', () => {
  it('reads get-load as load1m / load5m / load15m', () => {
    expect(parseLoad({ load15m: 1.388671875, load1m: 0.23681640625, load5m: 1.06005859375 })).toEqual({
      load1: 0.23681640625,
      load5: 1.06005859375,
      load15: 1.388671875,
    })
  })

  it('splits get-cpustats deltas into user / system / iowait / steal', () => {
    const cpu = (user: number, idle: number) => ({ cpu: 0, type: 'linux', user, nice: 0, system: 100, idle, iowait: 0, irq: 0, softirq: 0, steal: 0, guest: 0, guestnice: 0 })
    const b = cpuBreakdown([cpu(1000, 1000)], [cpu(1100, 1300)])
    expect(b?.user).toBeCloseTo(0.25)
  })

  it('nests partitions under their disk from get-disks', () => {
    const rows = guestDiskRows([
      { dependencies: [], name: '/dev/zram0', partition: false },
      { dependencies: ['/dev/sda'], name: '/dev/sda1', partition: true },
      {
        address: { bus: 0, 'bus-type': 'scsi', dev: '/dev/sda', serial: '0QEMU_QEMU_HARDDISK_drive-scsi0', target: 0, unit: 0 },
        dependencies: [],
        name: '/dev/sda',
        partition: false,
      },
    ])
    expect(rows.map((r) => [r.name, r.depth])).toEqual([
      ['zram0', 0],
      ['sda', 0],
      ['sda1', 1],
    ])
    expect(rows.find((r) => r.name === 'sda')?.bus).toBe('scsi')
  })

  it('computes get-diskstats rates for the whole disk, not its partitions', () => {
    const s = (name: string, minor: number, rs: number, ws: number) => ({ major: 8, minor, name, stats: { 'read-sectors': rs, 'write-sectors': ws, 'read-ios': rs / 8, 'write-ios': ws / 8 } })
    const rates = diskRates([s('sda', 0, 1000, 2000), s('sda1', 1, 100, 0)], [s('sda', 0, 1800, 4000), s('sda1', 1, 900, 0)], 10)
    expect(rates.map((r) => [r.name, r.readBps, r.writeBps])).toEqual([['sda', 800 * 512 / 10, 2000 * 512 / 10]])
  })
})
