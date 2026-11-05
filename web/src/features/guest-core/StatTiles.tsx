import { useMemo, type ReactNode } from 'react'

import type { GuestRrdPoint, GuestStatusCurrent } from '@/api/guest-core'
import type { GuestResource } from '@/api/types'
import { GlassCard } from '@/components/GlassCard'
import { UsageBar } from '@/components/UsageBar'
import { Skeleton } from '@/components/ui/skeleton'
import { DASH, formatBytes, formatPercent, formatRate, formatUptime, formatUsage, ratio } from '@/lib/format'
import { cn } from '@/lib/utils'
import { METRIC_TEXT, USAGE_HINT, usageTone, type MetricTone } from '@/lib/metric-status'

import { field, lastValue } from './rrd'

interface StatTilesProps {
  guest: GuestResource
  status: GuestStatusCurrent | undefined
  rrd: GuestRrdPoint[] | undefined
}

/** Live metrics and capacity bars, matching the node resource card. */
export function StatTiles({ guest, status, rrd }: StatTilesProps) {
  const running = (status?.status ?? guest.status) === 'running'
  const points = rrd ?? []
  const series = useMemo(
    () => ({
      netin: field(points, 'netin'),
      netout: field(points, 'netout'),
      io: points.map((p) => (p.diskread === undefined && p.diskwrite === undefined ? null : (p.diskread ?? 0) + (p.diskwrite ?? 0))),
    }),
    [points],
  )
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
  // Keep each number with its unit when the uptime wraps on a narrow card.
  const uptime = formatUptime(status?.uptime ?? guest.uptime).replace(/(\d+) /g, '$1\u00a0')
  const loading = !status && !rrd

  return (
    <GlassCard className="@container grid content-start gap-4" role="region" aria-label="资源使用" aria-busy={loading}>
      <h2 className="text-sm font-medium">资源使用</h2>
      <dl className="grid grid-cols-1 gap-2 @[14rem]:grid-cols-2 @[30rem]:grid-cols-4">
        <Tile
          label="CPU"
          loading={loading}
          value={running ? formatPercent(cpu) : DASH}
          unit={cpus ? `${cpus} 核` : undefined}
          tone={usageTone(running ? cpu : undefined)}
          hint={USAGE_HINT}
        />
        <Tile
          label="网络流入"
          loading={loading}
          value={running ? formatRate(netin) : DASH}
          unit={`流出 ${running ? formatRate(netout) : DASH}`}
        />
        <Tile
          label="磁盘 IO"
          loading={loading}
          value={running ? formatRate(lastValue(series.io)) : DASH}
          unit="读写合计"
        />
        <Tile label="运行时间" loading={loading} value={running ? uptime : DASH} />
      </dl>
      {loading ? (
        <div className="grid gap-3.5">
          {Array.from({ length: lxc ? 3 : 2 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : (
        <div className="grid gap-3.5">
          <UsageBar
            label="内存"
            wrapDetail
            value={running ? ratio(mem, maxmem) : null}
            detail={running ? formatUsage(mem, maxmem) : `总计 ${formatBytes(maxmem)}`}
            showPercent={running}
          />
          {lxc ? (
            <>
              <UsageBar
                label="根磁盘"
                wrapDetail
                value={ratio(disk, maxdisk)}
                detail={formatUsage(disk, maxdisk)}
              />
              {status?.maxswap !== 0 && (
                <UsageBar
                  label="交换分区"
                  wrapDetail
                  value={running ? ratio(status?.swap, status?.maxswap) : null}
                  detail={running ? formatUsage(status?.swap, status?.maxswap) : `总计 ${formatBytes(status?.maxswap)}`}
                  showPercent={running && !!status?.maxswap}
                />
              )}
            </>
          ) : maxdisk !== 0 && (
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-muted-foreground">启动磁盘</span>
              <span className="text-foreground/90 tabular">{formatBytes(maxdisk)}</span>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  )
}

function Tile({
  label,
  value,
  unit,
  loading,
  tone,
  hint,
}: {
  label: string
  value: ReactNode
  unit?: ReactNode
  loading?: boolean
  tone?: MetricTone
  hint?: string
}) {
  return (
    <div className="min-w-0 rounded-xl bg-foreground/[0.03] px-3 py-2.5 ring-1 ring-border/60 ring-inset paper:bg-secondary/50">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>
        {loading ? (
          <Skeleton className="mt-0.5 h-6 w-20 max-w-full" />
        ) : (
          <div title={hint} className={cn('mt-0.5 text-xl leading-tight font-medium tabular [overflow-wrap:anywhere]', tone && METRIC_TEXT[tone])}>{value}</div>
        )}
        {unit && <div className="mt-0.5 text-[11px] text-muted-foreground tabular [overflow-wrap:anywhere]">{unit}</div>}
      </dd>
    </div>
  )
}
