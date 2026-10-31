import { describe, expect, it } from 'vitest'

import {
  DASH,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatRate,
  formatRelativeTime,
  formatUptime,
  formatUsage,
  ratio,
} from './format'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KiB'],
    [1536, '1.5 KiB'],
    [2147483648, '2.0 GiB'],
    [16531152896, '15.4 GiB'],
    [362777935872, '338 GiB'],
    [1024 ** 4 * 3.25, '3.3 TiB'],
    [1024 ** 3 * 1023.97, '1.0 TiB'],
  ])('%d → %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected)
  })

  it('handles invalid input', () => {
    expect(formatBytes(undefined)).toBe(DASH)
    expect(formatBytes(null)).toBe(DASH)
    expect(formatBytes(Number.NaN)).toBe(DASH)
    expect(formatBytes(-1)).toBe(DASH)
  })

  it('supports digits and rates', () => {
    expect(formatBytes(1536, 2)).toBe('1.50 KiB')
    expect(formatRate(1048576 * 12.3)).toBe('12.3 MiB/s')
    expect(formatRate(undefined)).toBe(DASH)
  })

  it('formats used/total pairs', () => {
    expect(formatUsage(9603649536, 16531152896)).toBe('8.9 GiB / 15.4 GiB')
    expect(formatUsage(1, 0)).toBe(DASH)
  })
})

describe('ratio and formatPercent', () => {
  it('clamps ratios', () => {
    expect(ratio(5, 10)).toBe(0.5)
    expect(ratio(15, 10)).toBe(1)
    expect(ratio(1, 0)).toBeNull()
    expect(ratio(undefined, 10)).toBeNull()
  })

  it('keeps one decimal below 10%', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.0075)).toBe('0.8%')
    expect(formatPercent(0.0999)).toBe('10.0%')
    expect(formatPercent(0.4567)).toBe('46%')
    expect(formatPercent(1)).toBe('100%')
    expect(formatPercent(0.4567, 1)).toBe('45.7%')
    expect(formatPercent(null)).toBe(DASH)
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0 秒'],
    [45, '45 秒'],
    [60, '1 分'],
    [3725, '1 小时 2 分'],
    [93784, '1 天 2 小时'],
    [86460, '1 天'],
    [1316093, '15 天 5 小时'],
  ])('%d → %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected)
  })

  it('supports more parts and invalid input', () => {
    expect(formatDuration(93784, 3)).toBe('1 天 2 小时 3 分')
    expect(formatDuration(-5)).toBe(DASH)
    expect(formatDuration(undefined)).toBe(DASH)
  })

  it('shows a dash for zero uptime', () => {
    expect(formatUptime(0)).toBe(DASH)
    expect(formatUptime(3600)).toBe('1 小时')
  })
})

describe('time', () => {
  const now = Date.UTC(2026, 10, 1, 12, 0, 0)
  const s = now / 1000
  it('formats relative times', () => {
    expect(formatRelativeTime(s - 10, now)).toBe('刚刚')
    expect(formatRelativeTime(s - 300, now)).toBe('5 分钟前')
    expect(formatRelativeTime(s - 3 * 3600, now)).toBe('3 小时前')
    expect(formatRelativeTime(s - 2 * 86400, now)).toBe('2 天前')
    expect(formatRelativeTime(undefined, now)).toBe(DASH)
  })

  it('formats absolute times in local time', () => {
    const local = new Date(2026, 0, 2, 3, 4).getTime() / 1000
    expect(formatDateTime(local)).toBe('2026-01-02 03:04')
  })
})
