import { useMemo, useState } from 'react'
import { ChartLine, ChevronDown } from 'lucide-react'

import { useGuestRrd, type GuestRrdPoint, type RrdCf } from '@/api/guest-core'
import type { GuestType, RrdTimeframe } from '@/api/types'
import { SectionHeader } from '@/components/PageHeader'
import { GlassCard } from '@/components/GlassCard'
import { CAPACITY_HEADROOM, capacityAxisMax } from '@/components/charts/rrd'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatBytes, formatRate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { RrdChart } from './RrdChart'
import { downsample, field, hasData, TIMEFRAMES, type RrdSeries } from './rrd'

const MAX_POINTS = 240

const pct = (v: number) => `${v >= 10 || v === 0 ? v.toFixed(0) : v.toFixed(1)}%`
const bytes = (v: number) => formatBytes(v, v >= 10 * 1024 ** 3 ? 0 : 1)
const rate = (v: number) => formatRate(v)

interface GuestChartsProps {
  node: string
  type: GuestType
  vmid: number
}

/** RRD charts with range (时/天/周/月/年) and average/peak switches. */
export function GuestCharts({ node, type, vmid }: GuestChartsProps) {
  const [timeframe, setTimeframe] = useState<RrdTimeframe>('hour')
  const [cf, setCf] = useState<RrdCf>('AVERAGE')
  const { data, isPending } = useGuestRrd(node, type, vmid, timeframe, cf)

  const charts = useMemo(() => buildCharts(data ?? [], type), [data, type])
  const times = useMemo(() => downsample(data ?? [], MAX_POINTS).map((p) => p.time), [data])
  const primary = charts.filter((c) => c.key !== 'disk' && c.key !== 'psi')
  const additional = charts.filter((c) => c.key === 'disk' || c.key === 'psi')
  const renderChart = (c: ChartSpec, i: number) => (
    <RrdChart
      key={c.key}
      title={c.title}
      times={times}
      series={c.series}
      format={c.format}
      scale={c.scale}
      minMax={c.minMax}
      max={c.max}
      headroom={c.headroom}
      timeframe={timeframe}
      loading={isPending}
      embedded
      className={cn('border-border/60', i > 0 && 'border-t', i === 1 && 'md:border-t-0', i % 2 === 1 && 'md:border-l')}
    />
  )

  return (
    <section aria-labelledby="guest-charts-heading">
      <SectionHeader
        title={
          <span id="guest-charts-heading" className="inline-flex items-center gap-2">
            <ChartLine className="size-4" aria-hidden />
            资源历史
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value={timeframe}
            onValueChange={(v) => v && setTimeframe(v as RrdTimeframe)}
            variant="outline"
            size="sm"
            aria-label="时间范围"
          >
            {TIMEFRAMES.map((t) => (
              <ToggleGroupItem key={t.value} value={t.value} aria-label={t.label} title={t.label} className="min-w-9 px-2.5 text-xs pointer-coarse:h-10 pointer-coarse:min-w-10">
                {t.short}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup
            type="single"
            value={cf}
            onValueChange={(v) => v && setCf(v as RrdCf)}
            variant="outline"
            size="sm"
            aria-label="取值方式"
          >
            <ToggleGroupItem value="AVERAGE" className="px-2.5 text-xs pointer-coarse:h-10">
              平均
            </ToggleGroupItem>
            <ToggleGroupItem value="MAX" className="px-2.5 text-xs pointer-coarse:h-10">
              峰值
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </SectionHeader>
      <GlassCard flush>
        <div className="grid md:grid-cols-2">{primary.map(renderChart)}</div>
        {additional.length > 0 && (
          <details className="group border-t border-border/60">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-b-2xl px-4 py-3 text-xs text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-5 [&::-webkit-details-marker]:hidden">
              <span>{additional.map((c) => c.key === 'psi' ? '资源压力（PSI）' : c.title).join(' · ')}</span>
              <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className={cn('grid border-t border-border/60', additional.length > 1 && 'md:grid-cols-2')}>
              {additional.map(renderChart)}
            </div>
          </details>
        )}
      </GlassCard>
    </section>
  )
}

interface ChartSpec {
  key: string
  title: string
  series: RrdSeries[]
  format: (v: number) => string
  scale: 'percent' | 'bytes' | 'number'
  minMax?: number
  max?: number
  headroom?: number
}

/** Chart definitions from rrddata samples (exported for tests). */
export function buildCharts(rawPoints: readonly GuestRrdPoint[], type: GuestType): ChartSpec[] {
  const points = downsample(rawPoints, MAX_POINTS)
  // Preserve real capacity changes before averaging long history ranges.
  const memoryMax = capacityAxisMax(field(rawPoints, 'maxmem'), [
    ...field(rawPoints, 'mem'), ...(type === 'qemu' ? field(rawPoints, 'memhost') : []),
  ])
  const charts: ChartSpec[] = [
    {
      key: 'cpu',
      title: 'CPU 使用率',
      series: [{ key: 'cpu', label: 'CPU', color: 'var(--chart-1)', values: field(points, 'cpu', (v) => v * 100) }],
      format: pct,
      scale: 'percent',
      minMax: 5,
    },
    {
      key: 'mem',
      title: '内存',
      series: [
        { key: 'mem', label: '已用', color: 'var(--chart-4)', values: field(points, 'mem') },
        ...(type === 'qemu'
          ? [{ key: 'memhost', label: '主机侧', color: 'var(--chart-2)', values: field(points, 'memhost') }]
          : []),
        { key: 'maxmem', label: '总量', color: 'var(--muted-foreground)', values: field(points, 'maxmem'), dashed: true },
      ],
      format: bytes,
      scale: 'bytes',
      max: memoryMax,
      headroom: memoryMax ? CAPACITY_HEADROOM : undefined,
    },
    {
      key: 'net',
      title: '网络流量',
      series: [
        { key: 'netin', label: '入', color: 'var(--chart-3)', values: field(points, 'netin') },
        { key: 'netout', label: '出', color: 'var(--chart-2)', values: field(points, 'netout') },
      ],
      format: rate,
      scale: 'bytes',
      minMax: 1024,
    },
    {
      key: 'io',
      title: '磁盘读写',
      series: [
        { key: 'diskread', label: '读', color: 'var(--chart-1)', values: field(points, 'diskread') },
        { key: 'diskwrite', label: '写', color: 'var(--chart-5)', values: field(points, 'diskwrite') },
      ],
      format: rate,
      scale: 'bytes',
      minMax: 1024,
    },
  ]
  if (type === 'lxc') {
    const diskMax = capacityAxisMax(field(rawPoints, 'maxdisk'), field(rawPoints, 'disk'))
    charts.push({
      key: 'disk',
      title: '根磁盘用量',
      series: [
        { key: 'disk', label: '已用', color: 'var(--chart-5)', values: field(points, 'disk') },
        { key: 'maxdisk', label: '容量', color: 'var(--muted-foreground)', values: field(points, 'maxdisk'), dashed: true },
      ],
      format: bytes,
      scale: 'bytes',
      max: diskMax,
      headroom: diskMax ? CAPACITY_HEADROOM : undefined,
    })
  }
  const psi: RrdSeries[] = [
    { key: 'pressurecpusome', label: 'CPU', color: 'var(--chart-1)', values: field(points, 'pressurecpusome') },
    { key: 'pressureiosome', label: 'IO', color: 'var(--chart-5)', values: field(points, 'pressureiosome') },
    { key: 'pressurememorysome', label: '内存', color: 'var(--chart-4)', values: field(points, 'pressurememorysome') },
  ]
  if (psi.some((s) => hasData(s.values))) {
    charts.push({ key: 'psi', title: '资源压力（PSI some）', series: psi, format: pct, scale: 'percent', minMax: 1 })
  }
  return charts
}
