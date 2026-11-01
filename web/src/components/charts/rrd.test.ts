import { describe, expect, it } from 'vitest'

import {
  buildRrdRows,
  formatRrdAxis,
  formatRrdTick,
  formatRrdTime,
  formatRrdValue,
  latestValue,
  maxValue,
  niceMax,
  rowsEmpty,
  rrdTicks,
} from './rrd'

describe('buildRrdRows', () => {
  const samples = [
    { time: 1793473500, cpu: 0.179, iowait: 0.000165, memused: 1503538517 },
    { time: 1793473440, cpu: 0.166, memused: 1506541568 },
    { time: 1793473560 }, // gap
  ]

  it('converts time to ms, scales, sorts and leaves gaps as null', () => {
    const rows = buildRrdRows(samples, [{ key: 'cpu', scale: 100 }, { key: 'iowait', scale: 100 }, { key: 'memused' }])
    expect(rows.map((r) => r.time)).toEqual([1793473440000, 1793473500000, 1793473560000])
    expect(rows[0]).toMatchObject({ cpu: 16.6, iowait: null })
    expect(rows[1]!.cpu).toBeCloseTo(17.9)
    expect(rows[2]).toMatchObject({ cpu: null, memused: null })
    expect(latestValue(rows, 'cpu')).toBeCloseTo(17.9)
  })

  it('custom accessors', () => {
    const rows = buildRrdRows([{ time: 1, arcsize: 960 }], [{ key: 'arc', value: (s) => (s.arcsize > 1024 ? s.arcsize : null) }])
    expect(rows[0]!.arc).toBeNull()
    expect(rowsEmpty(rows, ['arc'])).toBe(true)
    expect(buildRrdRows(undefined, [])).toEqual([])
  })

  it('max across series, stacked or not', () => {
    const rows = buildRrdRows(
      [
        { time: 1, a: 1, b: 2 },
        { time: 2, a: 3, b: 1 },
      ],
      [{ key: 'a' }, { key: 'b' }],
    )
    expect(maxValue(rows, ['a', 'b'])).toBe(3)
    expect(maxValue(rows, ['a', 'b'], true)).toBe(4)
  })
})

describe('formatting', () => {
  it('values with units', () => {
    expect(formatRrdValue(17.94, 'percent')).toBe('17.9%')
    expect(formatRrdValue(0.0165, 'percent')).toBe('0.02%')
    expect(formatRrdValue(0, 'percent')).toBe('0%')
    expect(formatRrdValue(55, 'percent')).toBe('55%')
    expect(formatRrdValue(1503538517, 'bytes')).toBe('1.4 GiB')
    expect(formatRrdValue(535.58, 'bytesPerSecond')).toBe('536 B/s')
    expect(formatRrdValue(0.399, 'number')).toBe('0.40')
    expect(formatRrdValue(null, 'number')).toBe('—')
  })

  it('compact axis labels', () => {
    expect(formatRrdAxis(50, 'percent')).toBe('50%')
    expect(formatRrdAxis(2.5, 'percent')).toBe('2.5%')
    expect(formatRrdAxis(0.25, 'percent')).toBe('0.25%')
    expect(formatRrdAxis(1024 ** 3 * 1.5, 'bytes')).toBe('1.5G')
    expect(formatRrdAxis(2048, 'bytesPerSecond')).toBe('2K/s')
    expect(formatRrdAxis(0, 'bytes')).toBe('0')
    expect(formatRrdAxis(0.25, 'number')).toBe('0.25')
  })

  it('nice axis maxima', () => {
    expect(niceMax(17.9, 'percent')).toBe(20)
    expect(niceMax(97, 'percent')).toBe(100)
    expect(niceMax(0, 'percent')).toBe(1)
    expect(niceMax(0.43, 'number')).toBe(0.5)
    expect(niceMax(3.1 * 1024 ** 3, 'bytes')).toBe(5 * 1024 ** 3)
    expect(niceMax(700, 'bytesPerSecond')).toBe(1000)
  })

  it('even Y ticks', () => {
    expect(rrdTicks(100)).toEqual([0, 25, 50, 75, 100])
    expect(rrdTicks(50)).toEqual([0, 10, 20, 30, 40, 50])
    expect(rrdTicks(2)).toEqual([0, 0.5, 1, 1.5, 2])
    expect(rrdTicks(5 * 1024 ** 3)).toEqual([0, 1, 2, 3, 4, 5].map((n) => n * 1024 ** 3))
    expect(rrdTicks(50 * 1024)).toHaveLength(6)
    expect(rrdTicks(0)).toEqual([0])
  })

  it('ticks and readout per timeframe', () => {
    const t = new Date(2026, 10, 1, 8, 5).getTime()
    expect(formatRrdTick(t, 'hour')).toBe('08:05')
    expect(formatRrdTick(t, 'week')).toBe('11-01')
    expect(formatRrdTick(t, 'year')).toBe('26-11')
    expect(formatRrdTick(t, 'decade')).toBe('2026')
    expect(formatRrdTime(t, 'day')).toBe('11-01 08:05')
    expect(formatRrdTime(t, 'month')).toBe('2026-11-01 08:05')
    expect(formatRrdTime(t, 'year')).toBe('2026-11-01')
  })
})
