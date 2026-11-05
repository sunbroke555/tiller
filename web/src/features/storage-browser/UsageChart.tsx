import { useId, useMemo, useRef, useState, type PointerEvent } from 'react'

import type { StorageRrdPoint, StorageRrdTimeframe } from '@/api/storage-browser'
import { formatBytes, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { METRIC_TEXT, usageTone } from '@/lib/metric-status'
import { CAPACITY_HEADROOM, capacityAxisMax } from '@/components/charts/rrd'

const W = 1000
const H = 200

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/** Axis / tooltip time label suited to the timeframe. */
export function formatRrdTime(epoch: number, timeframe: StorageRrdTimeframe, detailed = false): string {
  const d = new Date(epoch * 1000)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (detailed) return timeframe === 'year' ? `${d.getFullYear()}-${md}` : `${md} ${hm}`
  switch (timeframe) {
    case 'hour':
    case 'day':
      return hm
    case 'week':
    case 'month':
      return md
    case 'year':
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  }
}

interface Series {
  points: { time: number; used?: number; total?: number }[]
  max: number
  plotMax: number
  usedPath: string
  areaPath: string
  totalPath: string
}

/** SVG paths with a capacity line and proportional headroom above real values. */
export function buildUsageSeries(raw: readonly StorageRrdPoint[]): Series | null {
  const points = raw
    .filter((p) => Number.isFinite(p.time))
    .map((p) => ({
      time: p.time,
      used: Number.isFinite(p.used) ? p.used : undefined,
      total: Number.isFinite(p.total) ? p.total : undefined,
    }))
  const values = points.flatMap((p) => [p.used, p.total]).filter((v): v is number => v !== undefined)
  if (points.length < 2 || values.length === 0) return null
  const capacity = capacityAxisMax(points.map((p) => p.total), points.map((p) => p.used))
  const max = capacity ?? (Math.max(0, ...values) || 1)
  const plotMax = max * (capacity ? 1 + CAPACITY_HEADROOM : 1)
  const x = (i: number) => (i / (points.length - 1)) * W
  const y = (v: number) => H * (1 - v / plotMax)

  const line = (key: 'used' | 'total') => {
    let d = ''
    let pen = false
    points.forEach((p, i) => {
      const v = p[key]
      if (v === undefined) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    })
    return d
  }

  // Area under "used", closed per gap-free segment.
  let area = ''
  let start: number | null = null
  let last = 0
  points.forEach((p, i) => {
    if (p.used === undefined) {
      if (start !== null) area += `L${x(last).toFixed(1)},${H}L${x(start).toFixed(1)},${H}Z`
      start = null
      return
    }
    area += `${start === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.used).toFixed(1)}`
    if (start === null) start = i
    last = i
  })
  if (start !== null) area += `L${x(last).toFixed(1)},${H}L${x(start).toFixed(1)},${H}Z`

  return { points, max, plotMax, usedPath: line('used'), areaPath: area, totalPath: line('total') }
}

interface UsageChartProps {
  data: readonly StorageRrdPoint[]
  timeframe: StorageRrdTimeframe
  className?: string
}

/** Storage usage over time: used (area) and total size (dashed line), with a touch/hover readout. */
export function UsageChart({ data, timeframe, className }: UsageChartProps) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const series = useMemo(() => buildUsageSeries(data), [data])

  if (!series) {
    return (
      <div className={cn('flex h-44 items-center justify-center text-sm text-muted-foreground sm:h-52', className)}>
        暂无用量数据
      </div>
    )
  }
  const { points, max, plotMax } = series
  const n = points.length

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
    setHover(Math.round(ratio * (n - 1)))
  }

  const hp = hover !== null ? points[hover] : undefined
  const hx = hover !== null ? (hover / (n - 1)) * 100 : 0
  const ticks = [points[0]!, points[Math.floor((n - 1) / 2)]!, points[n - 1]!]

  return (
    <div className={cn('grid gap-2', className)}>
      <div
        ref={ref}
        className="relative h-44 touch-pan-y select-none sm:h-52"
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`用量趋势，最大 ${formatBytes(max)}`}
      >
        {/* Grid lines with byte labels */}
        {[1, 0.5, 0].map((f) => (
          <div
            key={f}
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/80"
            style={{ top: `${(1 - max * f / plotMax) * 100}%` }}
          >
            <span className="absolute right-0 -translate-y-full pb-0.5 text-[10px] text-muted-foreground tabular">
              {f === 0 ? '0' : formatBytes(max * f)}
            </span>
          </div>
        ))}
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <path d={series.areaPath} fill={`url(#${id}-fill)`} />
          <path
            d={series.usedPath}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={series.totalPath}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth={1.5}
            strokeDasharray="5 5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {hp && (
          <>
            <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground/25" style={{ left: `${hx}%` }} />
            {hp.used !== undefined && (
              <div
                className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-(--chart-1)"
                style={{ left: `${hx}%`, top: `${(1 - hp.used / plotMax) * 100}%` }}
              />
            )}
            <div
              className={cn(
                'surface-strong pointer-events-none absolute top-1 z-10 grid min-w-36 gap-0.5 rounded-xl px-3 py-2 text-xs shadow-float',
                hx > 55 ? '-translate-x-[calc(100%+10px)]' : 'translate-x-2.5',
              )}
              style={{ left: `${hx}%` }}
            >
              <span className="text-muted-foreground tabular">{formatRrdTime(hp.time, timeframe, true)}</span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-(--chart-1)" aria-hidden />
                已用 <b className="ml-auto pl-2 font-medium tabular">{formatBytes(hp.used)}</b>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0 w-2 border-t border-dashed border-muted-foreground" aria-hidden />
                总量 <b className="ml-auto pl-2 font-medium tabular">{formatBytes(hp.total)}</b>
              </span>
              {hp.used !== undefined && hp.total ? (
                <span className={cn('text-right text-muted-foreground tabular', METRIC_TEXT[usageTone(hp.used / hp.total)])}>{formatPercent(hp.used / hp.total)}</span>
              ) : null}
            </div>
          </>
        )}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground tabular">
        {ticks.map((t, i) => (
          <span key={i}>{formatRrdTime(t.time, timeframe)}</span>
        ))}
      </div>
    </div>
  )
}
