import { useMemo, type ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'

import type { GuestRrdPoint, GuestStatusCurrent } from '@/api/guest-core'
import type { GuestResource } from '@/api/types'
import { GlassCard } from '@/components/GlassCard'
import { Sparkline } from '@/components/Sparkline'
import { Skeleton } from '@/components/ui/skeleton'
import { DASH, formatBytes, formatPercent, formatRate, ratio } from '@/lib/format'

import { field, lastValue } from './rrd'

interface StatTilesProps {
  guest: GuestResource
  status: GuestStatusCurrent | undefined
  rrd: GuestRrdPoint[] | undefined
}

/**
 * The four live tiles at the top of the summary (CPU, 内存, 网络, 磁盘), each
 * with the last hour as a sparkline — the mockup's 2×2 grid on phones.
 */
export function StatTiles({ guest, status, rrd }: StatTilesProps) {
  const running = (status?.status ?? guest.status) === 'running'
  const points = rrd ?? []
  const series = useMemo(
    () => ({
      cpu: field(points, 'cpu'),
      mem: field(points, 'mem'),
      net: points.map((p) => (p.netin === undefined && p.netout === undefined ? null : (p.netin ?? 0) + (p.netout ?? 0))),
      netin: field(points, 'netin'),
      netout: field(points, 'netout'),
      io: points.map((p) => (p.diskread === undefined && p.diskwrite === undefined ? null : (p.diskread ?? 0) + (p.diskwrite ?? 0))),
      disk: field(points, 'disk'),
    }),
    [points],
  )
  const cpuPeak = Math.min(1, Math.max(0.05, ...series.cpu.map((v) => (v ?? 0) * 1.25)))
  // status/current samples CPU instantly (often 0); resources are averaged by pvestatd.
  const cpu = guest.cpu ?? status?.cpu
  const cpus = status?.cpus ?? guest.maxcpu
  const mem = status?.mem ?? guest.mem
  const maxmem = status?.maxmem ?? guest.maxmem
  const disk = status?.disk ?? guest.disk
  const maxdisk = status?.maxdisk ?? guest.maxdisk
  const lxc = guest.type === 'lxc'
  const netin = lastValue(series.netin)
  const netout = lastValue(series.netout)
  const loading = !status && !rrd

  return (
    <section aria-label="资源使用" className="grid grid-cols-2 gap-(--row-gap) lg:grid-cols-4">
      <Tile
        label="CPU"
        loading={loading}
        value={running ? formatPercent(cpu) : DASH}
        unit={cpus ? `${cpus} 核` : undefined}
        spark={<Sparkline values={series.cpu} max={cpuPeak} aria-label="最近一小时 CPU" color="var(--chart-1)" />}
      />
      <Tile
        label="内存"
        loading={loading}
        value={running ? formatBytes(mem) : DASH}
        unit={maxmem ? `/ ${formatBytes(maxmem)}` : undefined}
        spark={<Sparkline values={series.mem} max={maxmem || undefined} aria-label="最近一小时内存" color="var(--chart-4)" />}
      />
      <Tile
        label="网络"
        loading={loading}
        value={
          running && (netin !== null || netout !== null) ? (
            <span className="flex flex-col gap-0.5 text-sm leading-tight sm:flex-row sm:gap-3">
              <span className="inline-flex items-center gap-1">
                <ArrowDown className="size-3.5 text-chart-3" aria-label="入" />
                {formatRate(netin)}
              </span>
              <span className="inline-flex items-center gap-1">
                <ArrowUp className="size-3.5 text-chart-2" aria-label="出" />
                {formatRate(netout)}
              </span>
            </span>
          ) : (
            DASH
          )
        }
        spark={<Sparkline values={series.net} aria-label="最近一小时网络流量" color="var(--chart-3)" />}
      />
      {lxc ? (
        <Tile
          label="根磁盘"
          loading={loading}
          value={disk !== undefined && maxdisk ? formatPercent(ratio(disk, maxdisk)) : DASH}
          unit={maxdisk ? `${formatBytes(disk)} / ${formatBytes(maxdisk)}` : undefined}
          spark={<Sparkline values={series.disk} max={maxdisk || undefined} aria-label="最近一小时磁盘用量" color="var(--chart-5)" />}
        />
      ) : (
        <Tile
          label="磁盘 IO"
          loading={loading}
          value={running ? formatRate(lastValue(series.io)) : DASH}
          unit={maxdisk ? `启动盘 ${formatBytes(maxdisk)}` : undefined}
          spark={<Sparkline values={series.io} aria-label="最近一小时磁盘读写" color="var(--chart-5)" />}
        />
      )}
    </section>
  )
}

function Tile({
  label,
  value,
  unit,
  spark,
  loading,
}: {
  label: string
  value: ReactNode
  unit?: string
  spark: ReactNode
  loading?: boolean
}) {
  return (
    <GlassCard className="flex min-w-0 flex-col gap-1.5 px-3.5 py-3 sm:px-(--card-p) sm:py-(--card-p)">
      <span className="text-xs text-muted-foreground">{label}</span>
      {loading ? (
        <Skeleton className="h-7 w-20" />
      ) : (
        <div className="flex min-h-7 flex-wrap items-baseline gap-x-1.5 tabular">
          <span className="text-xl font-medium tracking-tight text-foreground sm:text-2xl">{value}</span>
          {unit && <span className="truncate text-xs text-muted-foreground">{unit}</span>}
        </div>
      )}
      <div className="mt-auto pt-1">{spark}</div>
    </GlassCard>
  )
}
