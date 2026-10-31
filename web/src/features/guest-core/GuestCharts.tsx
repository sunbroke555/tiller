import { useMemo, useState } from 'react'
import { ChartLine } from 'lucide-react'

import { useGuestRrd, type GuestRrdPoint, type RrdCf } from '@/api/guest-core'
import type { GuestType, RrdTimeframe } from '@/api/types'
import { SectionHeader } from '@/components/PageHeader'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatBytes, formatRate } from '@/lib/format'

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

  const charts = useMemo(() => buildCharts(downsample(data ?? [], MAX_POINTS), type), [data, type])
  const times = useMemo(() => downsample(data ?? [], MAX_POINTS).map((p) => p.time), [data])

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
      <div className="grid gap-(--row-gap) xl:grid-cols-2">
        {charts.map((c) => (
          <RrdChart key={c.key} title={c.title} times={times} series={c.series} format={c.format} scale={c.scale} minMax={c.minMax} max={c.max} timeframe={timeframe} loading={isPending} />
        ))}
      </div>
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
}

/** Chart definitions from rrddata samples (exported for tests). */
export function buildCharts(points: readonly GuestRrdPoint[], type: GuestType): ChartSpec[] {
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
    charts.push({
      key: 'disk',
      title: '根磁盘用量',
      series: [
        { key: 'disk', label: '已用', color: 'var(--chart-5)', values: field(points, 'disk') },
        { key: 'maxdisk', label: '容量', color: 'var(--muted-foreground)', values: field(points, 'maxdisk'), dashed: true },
      ],
      format: bytes,
      scale: 'bytes',
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
