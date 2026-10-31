// RRD helpers for the guest charts: turn rrddata samples into chart series,
// downsample long ranges and pick axis scales and labels.

import type { GuestRrdPoint } from '@/api/guest-core'
import type { RrdTimeframe } from '@/api/types'

export type RrdValue = number | null

export interface RrdSeries {
  key: string
  label: string
  /** CSS colour. */
  color: string
  values: RrdValue[]
  /** Drawn as a dashed line without fill (limits like "总内存"). */
  dashed?: boolean
}

function num(v: unknown): RrdValue {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Values of one field (null for gaps), optionally mapped. */
export function field(points: readonly GuestRrdPoint[], key: keyof GuestRrdPoint, map?: (v: number, p: GuestRrdPoint) => number): RrdValue[] {
  return points.map((p) => {
    const v = num(p[key])
    return v === null ? null : map ? map(v, p) : v
  })
}

/** True when a series has at least one real value. */
export function hasData(values: readonly RrdValue[]): boolean {
  return values.some((v) => v !== null)
}

/** Last non-null value. */
export function lastValue(values: readonly RrdValue[]): RrdValue {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i]
    if (v !== null && v !== undefined) return v
  }
  return null
}

/**
 * Keep at most `max` samples by averaging buckets (gaps stay gaps when a
 * whole bucket is empty). PVE returns 1440 points for "day".
 */
export function downsample<T extends { time: number }>(points: readonly T[], max: number): T[] {
  if (points.length <= max || max < 2) return [...points]
  const size = Math.ceil(points.length / max)
  const out: T[] = []
  for (let i = 0; i < points.length; i += size) {
    const bucket = points.slice(i, i + size)
    const merged: Record<string, unknown> = { time: bucket[bucket.length - 1]!.time }
    const keys = new Set(bucket.flatMap((p) => Object.keys(p)))
    keys.delete('time')
    for (const k of keys) {
      const vals = bucket.map((p) => num((p as Record<string, unknown>)[k])).filter((v): v is number => v !== null)
      if (vals.length) merged[k] = vals.reduce((a, b) => a + b, 0) / vals.length
    }
    out.push(merged as T)
  }
  return out
}

/** A "nice" axis maximum ≥ value: 1, 2, 2.5, 5 × 10^n. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const exp = Math.floor(Math.log10(value))
  const base = 10 ** exp
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (value <= m * base + 1e-12) return m * base
  }
  return 10 * base
}

/** Nice maximum in binary units for bytes: 1, 2, 4, 8 … × 1024^n, or decimal steps. */
export function niceBytesMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1024
  const exp = Math.floor(Math.log(value) / Math.log(1024))
  const base = 1024 ** Math.max(exp, 0)
  return niceMax(value / base) * base
}

export const TIMEFRAMES: { value: RrdTimeframe; label: string; short: string }[] = [
  { value: 'hour', label: '最近 1 小时', short: '时' },
  { value: 'day', label: '最近 1 天', short: '天' },
  { value: 'week', label: '最近 1 周', short: '周' },
  { value: 'month', label: '最近 1 月', short: '月' },
  { value: 'year', label: '最近 1 年', short: '年' },
]

/** Axis label for a unix time, depending on the range shown. */
export function timeLabel(epoch: number, timeframe: RrdTimeframe): string {
  const d = new Date(epoch * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (timeframe === 'hour' || timeframe === 'day') return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (timeframe === 'week' || timeframe === 'month') return `${d.getMonth() + 1}/${d.getDate()}`
  return `${d.getFullYear()}/${d.getMonth() + 1}`
}

/** Tooltip time: full date and time. */
export function tooltipTime(epoch: number): string {
  const d = new Date(epoch * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
