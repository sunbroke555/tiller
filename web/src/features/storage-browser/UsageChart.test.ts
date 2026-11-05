import { describe, expect, it } from 'vitest'

import { buildUsageSeries } from './UsageChart'

const gib = 1024 ** 3
const ys = (path: string) => [...path.matchAll(/[ML][\d.-]+,([\d.-]+)/g)].map((m) => Number(m[1]))

describe('storage capacity chart', () => {
  it('keeps real capacity labels and leaves space above a full disk', () => {
    const series = buildUsageSeries([{ time: 1, total: 2 * gib, used: 2 * gib }, { time: 2, total: 2 * gib, used: 2 * gib }])!
    expect(series.max).toBe(2 * gib)
    expect(series.plotMax).toBeCloseTo(2 * gib * 1.08)
    expect(ys(series.totalPath)).toEqual([14.8, 14.8])
    expect(series.usedPath).toBe(series.totalPath)
  })

  it('keeps historical capacity changes and above-capacity readings within the plot', () => {
    const series = buildUsageSeries([{ time: 1, total: 4 * gib, used: 3 * gib }, { time: 2, total: 2 * gib, used: 2.2 * gib }])!
    expect(series.max).toBe(4 * gib)
    for (const y of [...ys(series.usedPath), ...ys(series.totalPath)]) {
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThanOrEqual(200)
    }
    const overflow = buildUsageSeries([{ time: 1, total: 2 * gib, used: 2.2 * gib }, { time: 2, total: 2 * gib, used: 2.2 * gib }])!
    expect(overflow.max).toBe(2.2 * gib)
    expect(Math.min(...ys(overflow.usedPath))).toBeGreaterThan(0)
  })

  it('handles absent capacity and zero readings without invalid coordinates', () => {
    const series = buildUsageSeries([{ time: 1, used: 0 }, { time: 2, used: 0 }])!
    expect(series.totalPath).toBe('')
    expect(series.usedPath).toBe('M0.0,200.0L1000.0,200.0')
    expect(series.plotMax).toBe(series.max)
    expect(buildUsageSeries([{ time: 1 }, { time: 2 }])).toBeNull()
  })
})
