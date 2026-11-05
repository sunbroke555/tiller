// Generic history chart for PVE rrddata (nodes, guests, storages).
//
//   const range = useRrdRange()                              // timeframe + AVERAGE/MAX, remembered per device
//   const { data } = useNodeRrdData(node, range.timeframe, range.cf)
//   <RrdRangePicker value={range} onChange={range.set} />
//   <RrdChart title="CPU" data={data} timeframe={range.timeframe} unit="percent"
//     series={[{ key: 'cpu', label: 'CPU', scale: 100 }, { key: 'iowait', label: 'IO 延迟', scale: 100, kind: 'line' }]} />
//
// The legend doubles as the readout: it shows the latest values, or the values
// under the finger / pointer, so nothing covers the chart on a phone.

import { memo, useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import type { RrdTimeframe } from '@/api/types'
import { GlassCard } from '@/components/GlassCard'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

import {
  RRD_CFS,
  RRD_TIMEFRAMES,
  buildRrdRows,
  formatRrdAxis,
  formatRrdTick,
  formatRrdTime,
  formatRrdValue,
  isRrdTimeframe,
  latestValue,
  maxValue,
  niceMax,
  rowsAllZero,
  rowsEmpty,
  rrdTicks,
  type RrdCfValue,
  type RrdRow,
  type RrdSeriesSpec,
  type RrdUnit,
} from './rrd'

export const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'] as const

export interface RrdSeries<T> extends RrdSeriesSpec<T> {
  label: string
  /** CSS colour; defaults to the theme chart palette in order. */
  color?: string
  /** 'area' (default): filled; 'line': a plain line on top (e.g. "available", "total"). */
  kind?: 'area' | 'line'
  /** Dashed line, for limits such as "total" or "max". */
  dashed?: boolean
}

export interface RrdChartProps<T extends { time: number }> {
  title: ReactNode
  /** Raw rrddata samples (time in unix seconds). */
  data: readonly T[] | undefined
  series: readonly RrdSeries<T>[]
  unit: RrdUnit
  timeframe: RrdTimeframe
  loading?: boolean
  error?: ReactNode
  /** Explain a missing metric instead of the generic empty state. */
  emptyMessage?: ReactNode
  /** Optional annotation when every series has data and all recorded values are zero. */
  zeroMessage?: ReactNode
  /** Fixed Y maximum (e.g. 100 for percent); default: rounded data maximum. */
  yMax?: number
  /** Extra fraction above the maximum; ticks still describe the unpadded range. */
  headroom?: number
  /** Stack the area series (e.g. used + cache). */
  stacked?: boolean
  /** Chart height in px (plot + axes). */
  height?: number
  /** Extra content in the header's right side. */
  headerExtra?: ReactNode
  /** Render without the card surface (when embedding in another card). */
  bare?: boolean
  className?: string
}

/** Recharts passes these to a custom tooltip content element. */
interface TooltipBridgeProps {
  active?: boolean
  label?: unknown
  onActive: (time: number | null) => void
}

/** Renders nothing; reports the hovered sample time so the legend can show it. */
function TooltipBridge({ active, label, onActive }: TooltipBridgeProps) {
  const time = active && typeof label === 'number' ? label : null
  useEffect(() => {
    onActive(time)
  }, [time, onActive])
  return null
}

interface AxisTickProps {
  x?: number
  y?: number
  payload?: { value: number }
  index?: number
  visibleTicksCount?: number
}

// Axis labels are short, single-line numbers. Native SVG text avoids
// Recharts' hidden DOM span and synchronous layout for every measured label.
function TimeAxisTick({ x, y, payload, index, visibleTicksCount, timeframe }: AxisTickProps & { timeframe: RrdTimeframe }) {
  if (!payload) return null
  const anchor = index === 0 ? 'start' : index === (visibleTicksCount ?? 0) - 1 ? 'end' : 'middle'
  return <text x={x} y={y} dy="0.71em" textAnchor={anchor} fontSize={10} fill="var(--muted-foreground)">{formatRrdTick(payload.value, timeframe)}</text>
}

function ValueAxisTick({ x, y, payload, unit }: AxisTickProps & { unit: RrdUnit }) {
  if (!payload) return null
  return <text x={x} y={y} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--muted-foreground)">{formatRrdAxis(payload.value, unit)}</text>
}

function RrdChartInner<T extends { time: number }>({
  title,
  data,
  series,
  unit,
  timeframe,
  loading,
  error,
  emptyMessage = '暂无数据',
  zeroMessage,
  yMax,
  headroom = 0,
  stacked,
  height = 176,
  headerExtra,
  bare,
  className,
}: RrdChartProps<T>) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [activeTime, setActiveTime] = useState<number | null>(null)
  const onActive = useCallback((t: number | null) => setActiveTime(t), [])

  const rows = useMemo(() => buildRrdRows(data, series), [data, series])
  const timeTicks = useMemo(() => {
    if (rows.length < 2) return rows.map((row) => row.time)
    const last = rows.length - 1
    return [...new Set([0, 1, 2, 3].map((i) => rows[Math.round(last * i / 3)]!.time))]
  }, [rows])
  const keys = useMemo(() => series.map((s) => s.key), [series])
  // Series without any value (e.g. ZFS ARC on a host without ZFS) stay out of legend and plot.
  const shown = useMemo(() => series.filter((s) => !rowsEmpty(rows, [s.key])), [rows, series])
  const empty = rows.length === 0 || rowsEmpty(rows, keys)
  const domainMax = useMemo(() => {
    if (yMax !== undefined) return yMax
    const areaKeys = shown.filter((s) => (s.kind ?? 'area') === 'area').map((s) => s.key)
    const lineKeys = shown.filter((s) => s.kind === 'line').map((s) => s.key)
    const m = Math.max(maxValue(rows, areaKeys, stacked), maxValue(rows, lineKeys))
    return niceMax(m * 1.08, unit)
  }, [rows, shown, stacked, unit, yMax])
  const yTicks = useMemo(() => rrdTicks(domainMax), [domainMax])
  const plotMax = domainMax * (1 + headroom)

  const activeRow: RrdRow | undefined = activeTime !== null ? rows.find((r) => r.time === activeTime) : undefined
  // Colour by position in `series`, so hiding an empty series does not shift the others.
  const colorOf = (s: RrdSeries<T>) => s.color ?? CHART_COLORS[Math.max(0, series.indexOf(s)) % CHART_COLORS.length]!

  const body = (
    <>
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="min-w-0 truncate text-sm font-medium">{title}</h3>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] text-muted-foreground tabular" aria-live="off">
            {activeRow ? formatRrdTime(activeRow.time, timeframe) : rows.length > 0 ? '当前' : ''}
          </span>
          {headerExtra}
        </div>
      </div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="图例">
        {(shown.length ? shown : series).map((s) => {
          const v = activeRow ? activeRow[s.key] : latestValue(rows, s.key)
          return (
            <li key={s.key} className="inline-flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden
                className={cn('inline-block shrink-0', s.kind === 'line' ? 'h-0.5 w-3 rounded-full' : 'size-2 rounded-[3px]')}
                style={{ background: colorOf(s) }}
              />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-medium text-foreground tabular">{formatRrdValue(v, unit)}</span>
            </li>
          )
        })}
      </ul>
      <div style={{ height }} className="relative -mx-1 select-none [-webkit-touch-callout:none]">
        {loading && !data ? (
          <Skeleton className="size-full rounded-xl" />
        ) : error ? (
          <div className="flex h-full items-center justify-center rounded-xl bg-foreground/[0.03] px-4 text-center text-xs text-muted-foreground paper:bg-secondary/50">
            {error}
          </div>
        ) : empty ? (
          <div className="flex h-full items-center justify-center rounded-xl bg-foreground/[0.03] text-xs text-muted-foreground paper:bg-secondary/50">
            {emptyMessage}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height }}>
            <ComposedChart
              data={rows}
              margin={{ top: 4, right: 6, bottom: 0, left: 0 }}
              onMouseLeave={() => setActiveTime(null)}
              accessibilityLayer={false}
            >
              <defs>
                {shown.map((s) => (
                  <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colorOf(s)} stopOpacity={0.32} />
                    <stop offset="100%" stopColor={colorOf(s)} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid
                vertical={false}
                stroke="var(--border)"
                strokeDasharray="3 4"
                // The default grid measures axis labels even for hidden
                // vertical lines. Our linear Y domain already gives every
                // horizontal position without another layout pass.
                horizontalCoordinatesGenerator={({ offset }) => yTicks.map((value) => offset.top + offset.height * (plotMax === 0 ? 0.5 : 1 - value / plotMax))}
                verticalCoordinatesGenerator={() => []}
              />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(v: number) => formatRrdTick(v, timeframe)}
                tick={<TimeAxisTick timeframe={timeframe} />}
                tickLine={false}
                axisLine={false}
                // A bounded tick count fits narrow cards without measuring
                // every candidate label to decide which ones to hide.
                ticks={timeTicks}
                interval={0}
                tickMargin={6}
                height={22}
              />
              <YAxis
                domain={[0, plotMax]}
                tickFormatter={(v: number) => formatRrdAxis(v, unit)}
                tick={<ValueAxisTick unit={unit} />}
                tickLine={false}
                axisLine={false}
                ticks={yTicks}
                interval={0}
                width={unit === 'bytesPerSecond' ? 50 : 40}
                allowDataOverflow
              />
              <Tooltip
                content={<TooltipBridge onActive={onActive} />}
                cursor={{ stroke: 'var(--muted-foreground)', strokeOpacity: 0.5, strokeWidth: 1 }}
                isAnimationActive={false}
              />
              {shown.map((s) =>
                (s.kind ?? 'area') === 'area' ? (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stackId={stacked ? 'stack' : undefined}
                    stroke={colorOf(s)}
                    strokeWidth={1.5}
                    fill={`url(#${uid}-${s.key})`}
                    fillOpacity={1}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0, fill: colorOf(s) }}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                ) : (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={colorOf(s)}
                    strokeWidth={1.5}
                    strokeDasharray={s.dashed ? '4 3' : undefined}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0, fill: colorOf(s) }}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                ),
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
        {!loading && !error && zeroMessage && rowsAllZero(rows, keys) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-12 text-center text-xs text-muted-foreground">
            {zeroMessage}
          </div>
        )}
      </div>
    </>
  )

  if (bare) return <div className={cn('min-w-0', className)}>{body}</div>
  return (
    <GlassCard className={cn('min-w-0', className)} role="figure" aria-label={typeof title === 'string' ? title : undefined}>
      {body}
    </GlassCard>
  )
}

export const RrdChart = memo(RrdChartInner) as typeof RrdChartInner

// ----------------------------------------------------------- range picker

export interface RrdRange {
  timeframe: RrdTimeframe
  cf: RrdCfValue
}

const RANGE_KEY = 'tiller:rrd-range'

function readRange(): RrdRange {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RANGE_KEY) ?? 'null') as Partial<RrdRange> | null
    return {
      timeframe: isRrdTimeframe(raw?.timeframe) ? raw.timeframe : 'hour',
      cf: raw?.cf === 'MAX' ? 'MAX' : 'AVERAGE',
    }
  } catch {
    return { timeframe: 'hour', cf: 'AVERAGE' }
  }
}

/** Chart timeframe and consolidation (AVERAGE/MAX), remembered on this device for all charts. */
export function useRrdRange(): RrdRange & { set: (next: Partial<RrdRange>) => void } {
  const [range, setRange] = useState<RrdRange>(readRange)
  const set = useCallback((next: Partial<RrdRange>) => {
    setRange((prev) => {
      const merged = { ...prev, ...next }
      try {
        window.localStorage.setItem(RANGE_KEY, JSON.stringify(merged))
      } catch {
        // private mode: keep it for this page only
      }
      return merged
    })
  }, [])
  return { ...range, set }
}

/** Timeframe (小时…十年) and 平均/最大 toggles. */
export function RrdRangePicker({
  value,
  onChange,
  className,
}: {
  value: RrdRange
  onChange: (next: Partial<RrdRange>) => void
  className?: string
}) {
  const item = 'h-8 px-2.5 text-xs pointer-coarse:h-10 pointer-coarse:px-3'
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value.timeframe}
        onValueChange={(v) => isRrdTimeframe(v) && onChange({ timeframe: v })}
        aria-label="时间范围"
      >
        {RRD_TIMEFRAMES.map((t) => (
          <ToggleGroupItem key={t.value} value={t.value} className={item} aria-label={t.long}>
            {t.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value.cf}
        onValueChange={(v) => (v === 'AVERAGE' || v === 'MAX') && onChange({ cf: v })}
        aria-label="取值方式"
      >
        {RRD_CFS.map((c) => (
          <ToggleGroupItem key={c.value} value={c.value} className={item}>
            {c.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
