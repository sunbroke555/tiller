// Pure helpers for RRD charts (node, guest and storage history): units,
// axis/tooltip formatting per timeframe, and turning PVE rrddata samples into
// chart rows. Used by <RrdChart>; kept separate so they are unit-tested.

import type { RrdTimeframe } from '@/api/types'
import { DASH, formatBytes } from '@/lib/format'

/**
 * How values are shown:
 * - percent: values already in 0..100 (use `scale: 100` on a 0..1 field)
 * - bytes / bytesPerSecond: IEC units
 * - number: plain number (load average)
 */
export type RrdUnit = 'percent' | 'bytes' | 'bytesPerSecond' | 'number'

export type RrdCfValue = 'AVERAGE' | 'MAX'

export const RRD_TIMEFRAMES: readonly { value: RrdTimeframe; label: string; long: string }[] = [
  { value: 'hour', label: '小时', long: '最近一小时' },
  { value: 'day', label: '天', long: '最近一天' },
  { value: 'week', label: '周', long: '最近一周' },
  { value: 'month', label: '月', long: '最近一个月' },
  { value: 'year', label: '年', long: '最近一年' },
  { value: 'decade', label: '十年', long: '最近十年' },
]

export const RRD_CFS: readonly { value: RrdCfValue; label: string }[] = [
  { value: 'AVERAGE', label: '平均' },
  { value: 'MAX', label: '最大' },
]

export function isRrdTimeframe(v: unknown): v is RrdTimeframe {
  return RRD_TIMEFRAMES.some((t) => t.value === v)
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** X axis tick for a sample time (ms), coarser for longer timeframes. */
export function formatRrdTick(ms: number, timeframe: RrdTimeframe): string {
  const d = new Date(ms)
  switch (timeframe) {
    case 'hour':
    case 'day':
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`
    case 'week':
    case 'month':
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    case 'year':
      return `${d.getFullYear() % 100}-${pad(d.getMonth() + 1)}`
    case 'decade':
      return String(d.getFullYear())
  }
}

/** Full sample time for the readout: "11-01 08:30" or with the year for long ranges. */
export function formatRrdTime(ms: number, timeframe: RrdTimeframe): string {
  const d = new Date(ms)
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (timeframe === 'hour' || timeframe === 'day' || timeframe === 'week') return `${md} ${hm}`
  if (timeframe === 'month') return `${d.getFullYear()}-${md} ${hm}`
  return `${d.getFullYear()}-${md}`
}

/** Value with unit for legends and tooltips. */
export function formatRrdValue(v: number | null | undefined, unit: RrdUnit): string {
  if (!isNum(v)) return DASH
  switch (unit) {
    case 'percent': {
      const a = Math.abs(v)
      const d = a !== 0 && a < 0.1 ? 2 : a < 100 && !Number.isInteger(v) ? 1 : 0
      return `${v.toFixed(d)}%`
    }
    case 'bytes':
      return formatBytes(v)
    case 'bytesPerSecond':
      return `${formatBytes(v)}/s`
    case 'number':
      return v >= 100 ? v.toFixed(0) : v.toFixed(2)
  }
}

const SHORT_IEC = ['', 'K', 'M', 'G', 'T', 'P']

/** Compact Y axis label: "50%", "1.5G", "12K/s", "0.4". */
export function formatRrdAxis(v: number, unit: RrdUnit): string {
  if (!isNum(v)) return ''
  if (unit === 'percent') return `${Number(v.toFixed(v === 0 ? 0 : v < 1 ? 2 : v < 10 ? 1 : 0))}%`
  if (unit === 'number') return String(Number(v.toFixed(v < 10 ? 2 : 0)))
  let i = 0
  let x = Math.abs(v)
  while (x >= 1024 && i < SHORT_IEC.length - 1) {
    x /= 1024
    i++
  }
  const s = `${Number(x.toFixed(x < 10 && i > 0 ? 1 : 0))}${SHORT_IEC[i]}`
  return unit === 'bytesPerSecond' ? `${s}/s` : s
}

/** Round a maximum up to a pleasant axis end (1, 2, 2.5, 5 × 10^n; powers of 1024 for bytes). */
export function niceMax(max: number, unit: RrdUnit): number {
  if (!isNum(max) || max <= 0) return unit === 'percent' ? 1 : 1
  if (unit === 'bytes' || unit === 'bytesPerSecond') {
    let base = 1
    while (max / base >= 1024) base *= 1024
    return niceDecimal(max / base) * base
  }
  const n = niceDecimal(max)
  return unit === 'percent' ? Math.min(n, 100) || 100 : n
}

/**
 * Evenly spaced Y ticks from 0 to `max` (a niceMax result): 5 steps for
 * 2.5 / 5 leading digits (0.5, 1 …), otherwise 4 (0.25, 0.5 …).
 */
export function rrdTicks(max: number): number[] {
  if (!isNum(max) || max <= 0) return [0]
  const lead = max / 10 ** Math.floor(Math.log10(max))
  const leadBytes = (() => {
    let x = max
    while (x >= 1024) x /= 1024
    return x / 10 ** Math.floor(Math.log10(x))
  })()
  const five = (v: number) => Math.abs(v - 2.5) < 1e-9 || Math.abs(v - 5) < 1e-9
  const steps = five(lead) || five(leadBytes) ? 5 : 4
  return Array.from({ length: steps + 1 }, (_, i) => (max * i) / steps)
}

function niceDecimal(x: number): number {
  const exp = Math.floor(Math.log10(x))
  const f = x / 10 ** exp
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return step * 10 ** exp
}

export interface RrdSeriesSpec<T> {
  /** Row key, unique within the chart. */
  key: string
  /** Read the value from a sample; default `sample[key]`. */
  value?: (sample: T) => number | null | undefined
  /** Multiply (e.g. 100 for a 0..1 cpu fraction shown as percent). */
  scale?: number
}

export type RrdRow = { time: number } & Record<string, number | null>

/**
 * PVE samples ({ time: unix seconds, field… }) → chart rows ({ time: ms, key… }).
 * Missing or non-finite values become null so the chart shows a gap.
 */
export function buildRrdRows<T extends { time: number }>(samples: readonly T[] | undefined, series: readonly RrdSeriesSpec<T>[]): RrdRow[] {
  if (!samples) return []
  const rows: RrdRow[] = []
  for (const s of samples) {
    if (!isNum(s.time)) continue
    const row: RrdRow = { time: s.time * 1000 } as RrdRow
    for (const spec of series) {
      const raw = spec.value ? spec.value(s) : (s as unknown as Record<string, unknown>)[spec.key]
      row[spec.key] = isNum(raw) ? raw * (spec.scale ?? 1) : null
    }
    rows.push(row)
  }
  rows.sort((a, b) => a.time - b.time)
  return rows
}

/** True when no row has any value for these keys (e.g. a field this PVE version does not record). */
export function rowsEmpty(rows: readonly RrdRow[], keys: readonly string[]): boolean {
  return !rows.some((r) => keys.some((k) => isNum(r[k])))
}

/** Latest non-null value of a series. */
export function latestValue(rows: readonly RrdRow[], key: string): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i]![key]
    if (isNum(v)) return v
  }
  return null
}

/** Largest value across series (for the Y axis domain). */
export function maxValue(rows: readonly RrdRow[], keys: readonly string[], stacked = false): number {
  let max = 0
  for (const r of rows) {
    if (stacked) {
      const sum = keys.reduce((acc, k) => acc + (isNum(r[k]) ? r[k] : 0), 0)
      if (sum > max) max = sum
    } else {
      for (const k of keys) {
        const v = r[k]
        if (isNum(v) && v > max) max = v
      }
    }
  }
  return max
}
