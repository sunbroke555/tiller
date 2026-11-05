// Response shapes captured from a PVE 9.2.25 node (pvesh), so the parsers stay
// pinned to what the API really returns rather than to the schema alone.

import { describe, expect, it } from 'vitest'

import { parseCephTime, releaseOptions } from '@/features/ceph/model'

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
