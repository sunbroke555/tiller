import { describe, expect, it } from 'vitest'

import { DEFAULT_QUERY, activeFilterCount, applyGuestQuery, narrowGuests, readGuestQuery, writeGuestQuery } from './filter'

const g = (vmid: number, extra: Record<string, unknown> = {}) =>
  ({ vmid, name: `g${vmid}`, type: 'qemu', status: 'stopped', node: 'pve', ...extra }) as {
    vmid: number
    name: string
    type: string
    status: string
    node: string
    pool?: string
    tags?: string
    template?: number
    cpu?: number
    mem?: number
  }

const guests = [
  g(100, { tags: 'test;demo' }),
  g(101, { status: 'running', pool: 'lab', cpu: 0.5, mem: 10 }),
  g(200, { type: 'lxc', status: 'running', name: 'alpine', cpu: 0.1, mem: 50, tags: 'Demo' }),
  g(9000, { template: 1, name: 'tpl' }),
  g(300, { node: 'pve2', name: 'web-01' }),
]

describe('guest query in the URL', () => {
  it('reads defaults and values, ignoring junk', () => {
    expect(readGuestQuery(new URLSearchParams(''))).toEqual(DEFAULT_QUERY)
    const q = readGuestQuery(new URLSearchParams('filter=running&type=lxc&tag=Demo&tag=a;b&node=pve&pool=lab&q=x&sort=cpu'))
    expect(q).toEqual({ status: 'running', type: 'lxc', tags: ['demo', 'a', 'b'], node: 'pve', pool: 'lab', q: 'x', sort: 'cpu' })
    expect(readGuestQuery(new URLSearchParams('filter=bogus&type=bogus&sort=bogus'))).toEqual(DEFAULT_QUERY)
  })

  it('reads per-type templates and the old type=template links', () => {
    expect(readGuestQuery(new URLSearchParams('type=lxc&filter=template'))).toMatchObject({ type: 'lxc', status: 'template' })
    expect(readGuestQuery(new URLSearchParams('type=template'))).toMatchObject({ type: 'all', status: 'template' })
    expect(writeGuestQuery(new URLSearchParams(''), { ...DEFAULT_QUERY, type: 'qemu', status: 'template' }).toString()).toBe(
      'filter=template&type=qemu',
    )
  })

  it('writes only non-defaults and keeps other params', () => {
    const p = writeGuestQuery(new URLSearchParams('keep=1&tag=old'), { ...DEFAULT_QUERY, tags: ['demo'], type: 'qemu' })
    expect(p.toString()).toBe('keep=1&type=qemu&tag=demo')
    expect(activeFilterCount({ ...DEFAULT_QUERY, type: 'qemu', pool: 'x', sort: 'name' })).toBe(3)
  })
})

describe('filtering', () => {
  it('narrows by type (with its templates), tag, node, pool and text', () => {
    const ids = (q: Partial<typeof DEFAULT_QUERY>) => narrowGuests(guests, { ...DEFAULT_QUERY, ...q }).map((x) => x.vmid)
    expect(ids({ type: 'qemu' })).toEqual([100, 101, 9000, 300])
    expect(ids({ type: 'lxc' })).toEqual([200])
    expect(ids({ tags: ['demo'] })).toEqual([100, 200])
    expect(ids({ tags: ['demo', 'test'] })).toEqual([100])
    expect(ids({ node: 'pve2' })).toEqual([300])
    expect(ids({ pool: 'lab' })).toEqual([101])
    expect(ids({ q: 'web' })).toEqual([300])
    expect(ids({ q: '200' })).toEqual([200])
    expect(ids({ q: 'demo g100' })).toEqual([100])
  })

  it('applies status and sorts', () => {
    const run = (q: Partial<typeof DEFAULT_QUERY>) => applyGuestQuery(guests, { ...DEFAULT_QUERY, ...q }).map((x) => x.vmid)
    expect(run({ status: 'running' })).toEqual([101, 200])
    expect(run({ status: 'stopped' })).toEqual([100, 300])
    expect(run({ status: 'template' })).toEqual([9000])
    expect(run({ status: 'template', type: 'qemu' })).toEqual([9000])
    expect(run({ status: 'template', type: 'lxc' })).toEqual([])
    expect(run({ status: 'stopped', type: 'qemu' })).toEqual([100, 300])
    expect(run({ sort: 'cpu' }).slice(0, 2)).toEqual([101, 200])
    expect(run({ sort: 'mem' }).slice(0, 2)).toEqual([200, 101])
    expect(run({ sort: 'name' })).toEqual([200, 100, 101, 9000, 300])
    expect(run({ sort: 'status' }).slice(0, 2)).toEqual([101, 200])
  })
})
