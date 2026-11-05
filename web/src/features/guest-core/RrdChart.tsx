import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

import type { RrdTimeframe } from '@/api/types'
import { GlassCard } from '@/components/GlassCard'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { hasData, lastValue, niceBytesMax, niceMax, timeLabel, tooltipTime, type RrdSeries } from './rrd'

export type ChartScale = 'percent' | 'bytes' | 'number'

interface RrdChartProps {
  title: string
  times: readonly number[]
  series: readonly RrdSeries[]
  format: (value: number) => string
  /** How to round the axis maximum. */
  scale?: ChartScale
  /** Fixed axis maximum (e.g. 1 for CPU fraction of all cores). */
  max?: number
  /** Extra fraction above the maximum; capacity ticks stay at their real values. */
  headroom?: number
  /** Minimum axis maximum, so an idle guest is not a magnified flat line. */
  minMax?: number
  timeframe: RrdTimeframe
  loading?: boolean
  /** Right side of the header; defaults to the latest values. */
  headerExtra?: ReactNode
  /** Use the surrounding chart group's surface instead of another card. */
  embedded?: boolean
  className?: string
}

const H = 132
const PAD = { top: 8, right: 6, bottom: 20, left: 46 }

/**
 * Small dependency-free time series chart for RRD data: area + line per
 * series, three grid lines, time ticks, and a touch/hover cursor with the
 * values at that time. Lines keep 1.5px at any width (real pixel viewBox).
 */
export function RrdChart({
  title,
  times,
  series,
  format,
  scale = 'number',
  max,
  headroom = 0,
  minMax,
  timeframe,
  loading,
  headerExtra,
  embedded = false,
  className,
}: RrdChartProps) {
  const id = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => setWidth(Math.round(entries[0]?.contentRect.width ?? el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const visible = series.filter((s) => hasData(s.values))
  const n = times.length

  const yMax = useMemo(() => {
    if (max !== undefined) return max
    const peak = Math.max(0, ...visible.flatMap((s) => s.values.filter((v): v is number => v !== null)))
    const floor = minMax ?? 0
    const target = Math.max(peak * 1.1, floor)
    return scale === 'bytes' ? niceBytesMax(target) : niceMax(target)
  }, [visible, max, minMax, scale])

  const plotW = Math.max(width - PAD.left - PAD.right, 10)
  const plotH = H - PAD.top - PAD.bottom
  const plotMax = yMax * (1 + headroom)
  const x = (i: number) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * plotW)
  const y = (v: number) => PAD.top + plotH - (Math.min(Math.max(v, 0), plotMax) / plotMax) * plotH

  const paths = useMemo(
    () =>
      visible.map((s) => {
        let line = ''
        let area = ''
        let start: number | null = null
        let last = 0
        s.values.forEach((v, i) => {
          if (v === null) {
            if (start !== null) area += `L${last.toFixed(1)},${PAD.top + plotH}L${start.toFixed(1)},${PAD.top + plotH}Z`
            start = null
            return
          }
          const px = x(i)
          const pt = `${px.toFixed(1)},${y(v).toFixed(1)}`
          if (start === null) {
            line += `M${pt}`
            area += `M${pt}`
            start = px
          } else {
            line += `L${pt}`
            area += `L${pt}`
          }
          last = px
        })
        if (start !== null) area += `L${last.toFixed(1)},${PAD.top + plotH}L${(start as number).toFixed(1)},${PAD.top + plotH}Z`
        return { s, line, area }
      }),
    // x/y depend on these:
    [visible, plotW, plotH, plotMax, n],
  )

  const ticks = useMemo(() => {
    if (n < 2) return []
    const count = width < 360 ? 3 : 5
    return Array.from({ length: count }, (_, k) => Math.round((k / (count - 1)) * (n - 1)))
  }, [n, width])

  const pick = (clientX: number) => {
    const rect = wrap.current?.getBoundingClientRect()
    if (!rect || n < 2) return
    const rel = (clientX - rect.left - PAD.left) / plotW
    setHover(Math.min(n - 1, Math.max(0, Math.round(rel * (n - 1)))))
  }

  const empty = !loading && visible.length === 0
  const hoverIdx = hover !== null && hover < n ? hover : null
  const Container = embedded ? 'div' : GlassCard

  return (
    <Container className={cn('min-w-0', embedded && 'p-4 sm:p-5', className)}>
      <div className="mb-3 grid min-h-16 content-start gap-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {headerExtra ?? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {series.map((s) => {
              const v = hoverIdx !== null ? s.values[hoverIdx] : lastValue(s.values)
              return (
                <span key={s.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span
                    aria-hidden
                    className={cn('inline-block h-0.5 w-3 rounded-full', s.dashed && 'h-0 border-t border-dashed')}
                    style={s.dashed ? { borderColor: s.color } : { background: s.color }}
                  />
                  {s.label}
                  <span className="text-foreground tabular">{v === null || v === undefined ? '—' : format(v)}</span>
                </span>
              )
            })}
          </div>
        )}
      </div>

      <div
        ref={wrap}
        className="relative touch-pan-y select-none"
        style={{ height: H }}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setHover(null)}
      >
        {loading && n === 0 ? (
          <Skeleton className="h-full w-full rounded-xl" />
        ) : empty ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground">
            暂无数据
          </div>
        ) : width > 0 ? (
          <svg width={width} height={H} role="img" aria-label={`${title}趋势图`} className="block overflow-visible">
            <defs>
              {paths.map(({ s }) => (
                <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.24} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            {[0, 0.5, 1].map((f) => {
              const gy = y(yMax * f)
              return (
                <g key={f}>
                  <line
                    x1={PAD.left}
                    x2={PAD.left + plotW}
                    y1={gy}
                    y2={gy}
                    stroke="var(--border)"
                    strokeDasharray={f === 0 ? undefined : '3 4'}
                  />
                  <text
                    x={PAD.left - 8}
                    y={gy}
                    dy="0.32em"
                    textAnchor="end"
                    className="fill-muted-foreground text-[10px] tabular"
                  >
                    {format(yMax * f)}
                  </text>
                </g>
              )
            })}
            {ticks.map((i, k) => (
              <text
                key={`${i}-${k}`}
                x={x(i)}
                y={H - 4}
                textAnchor={k === 0 ? 'start' : k === ticks.length - 1 ? 'end' : 'middle'}
                className="fill-muted-foreground text-[10px] tabular"
              >
                {timeLabel(times[i]!, timeframe)}
              </text>
            ))}
            {/* Reversed: the first series (the main one) is drawn on top. */}
            {[...paths].reverse().map(({ s, area }) =>
              s.dashed ? null : <path key={`a-${s.key}`} d={area} fill={`url(#${id}-${s.key})`} />,
            )}
            {/* Capacity lines remain visible even when usage reaches 100%. */}
            {[...paths.filter(({ s }) => !s.dashed).reverse(), ...paths.filter(({ s }) => s.dashed)].map(({ s, line }) => (
              <path
                key={`l-${s.key}`}
                d={line}
                fill="none"
                stroke={s.color}
                strokeWidth={1.5}
                strokeDasharray={s.dashed ? '4 4' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {hoverIdx !== null && (
              <g pointerEvents="none">
                <line
                  x1={x(hoverIdx)}
                  x2={x(hoverIdx)}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                  stroke="var(--muted-foreground)"
                  strokeOpacity={0.5}
                />
                {paths.map(({ s }) => {
                  const v = s.values[hoverIdx]
                  if (v === null || v === undefined || s.dashed) return null
                  return <circle key={s.key} cx={x(hoverIdx)} cy={y(v)} r={3.5} fill={s.color} stroke="var(--background)" strokeWidth={1.5} />
                })}
              </g>
            )}
          </svg>
        ) : null}

        {hoverIdx !== null && width > 0 && (
          <div
            aria-hidden
            className="surface-strong pointer-events-none absolute top-1 z-10 rounded-lg px-2 py-1 text-[11px] whitespace-nowrap text-muted-foreground shadow-float"
            style={
              x(hoverIdx) > width / 2
                ? { right: width - x(hoverIdx) + 8 }
                : { left: x(hoverIdx) + 8 }
            }
          >
            {tooltipTime(times[hoverIdx]!)}
          </div>
        )}
      </div>
    </Container>
  )
}
