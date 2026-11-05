import { describe, expect, it } from 'vitest'

import { buildCharts } from './GuestCharts'

const gib = 1024 ** 3

describe('guest memory chart scale', () => {
  it.each(['qemu', 'lxc'] as const)('anchors a 2 GiB %s chart at capacity with a little headroom', (type) => {
    const memory = buildCharts([{ time: 1, maxmem: 2 * gib, mem: 1.9 * gib }], type).find((c) => c.key === 'mem')!
    expect(memory.max).toBe(2 * gib)
    expect(memory.headroom).toBe(0.08)
    expect(memory.series.find((s) => s.key === 'maxmem')!.dashed).toBe(true)
    expect(memory.format(memory.max!)).toBe('2.0 GiB')
  })

  it('keeps history before a memory reduction and VM host overhead visible', () => {
    expect(buildCharts([
      { time: 1, maxmem: 4 * gib, mem: 3 * gib },
      { time: 2, maxmem: 2 * gib, mem: gib },
    ], 'qemu').find((c) => c.key === 'mem')!.max).toBe(4 * gib)
    expect(buildCharts([{ time: 1, maxmem: 2 * gib, memhost: 2.1 * gib }], 'qemu').find((c) => c.key === 'mem')!.max).toBe(2.1 * gib)
  })

  it('keeps the largest capacity even when long ranges are downsampled', () => {
    const points = Array.from({ length: 1440 }, (_, time) => ({ time, maxmem: (time === 0 ? 4 : 2) * gib, mem: gib }))
    const memory = buildCharts(points, 'qemu').find((c) => c.key === 'mem')!
    expect(memory.max).toBe(4 * gib)
    expect(memory.series[0]!.values.length).toBeLessThanOrEqual(240)
  })

  it('retains automatic scaling when capacity is unknown and for rates', () => {
    const charts = buildCharts([{ time: 1, mem: gib, netin: 1024 }], 'qemu')
    expect(charts.find((c) => c.key === 'mem')!.max).toBeUndefined()
    expect(charts.find((c) => c.key === 'mem')!.headroom).toBeUndefined()
    expect(charts.find((c) => c.key === 'net')!.max).toBeUndefined()
    expect(charts.find((c) => c.key === 'net')!.headroom).toBeUndefined()
  })

  it('gives container root disks the same capacity line and headroom', () => {
    const disk = buildCharts([{ time: 1, maxdisk: 8 * gib, disk: 7 * gib }], 'lxc').find((c) => c.key === 'disk')!
    expect(disk.max).toBe(8 * gib)
    expect(disk.headroom).toBe(0.08)
    expect(disk.series.find((s) => s.key === 'maxdisk')!.dashed).toBe(true)
  })
})
