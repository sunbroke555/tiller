import { useMemo, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { Box, ChevronRight, Cpu, Database, MemoryStick, Monitor } from 'lucide-react'

import { usePool, type PoolMember } from '@/api/shell'
import type { GuestResource, StorageResource } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { ErrorCard, LoadingRows } from '@/components/QueryState'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { Skeleton } from '@/components/ui/skeleton'
import { UsageBar } from '@/components/UsageBar'
import { PoolManageActions, PoolPermissions } from '@/features/access-control/PoolManage'
import { GuestList } from '@/features/overview/GuestList'
import { formatUsage, ratio } from '@/lib/format'
import { byVmid, statusLabel, storagePath } from '@/lib/resources'

import { poolIdFromSplat } from './paths'

/** /pool/:poolid (nested pools: /pool/parent/child) — pool summary and members. */
export default function PoolPage() {
  const params = useParams()
  const poolid = poolIdFromSplat(params['*'])
  const pool = usePool(poolid)

  const { guests, storages, stats } = useMemo(() => {
    const members: PoolMember[] = pool.data?.members ?? []
    const guests = members.filter((m): m is GuestResource => m.type === 'qemu' || m.type === 'lxc').sort(byVmid)
    const storages = members.filter((m): m is StorageResource => m.type === 'storage').sort((a, b) => a.storage.localeCompare(b.storage))
    const running = guests.filter((g) => g.status === 'running')
    const live = guests.filter((g) => g.template !== 1)
    return {
      guests,
      storages,
      stats: {
        running: running.length,
        total: live.length,
        templates: guests.length - live.length,
        cpuUsed: running.reduce((s, g) => s + (g.cpu ?? 0) * (g.maxcpu ?? 0), 0),
        cpuTotal: running.reduce((s, g) => s + (g.maxcpu ?? 0), 0),
        memUsed: running.reduce((s, g) => s + (g.mem ?? 0), 0),
        memTotal: running.reduce((s, g) => s + (g.maxmem ?? 0), 0),
        diskUsed: storages.reduce((s, x) => s + (x.disk ?? 0), 0),
        diskTotal: storages.reduce((s, x) => s + (x.maxdisk ?? 0), 0),
      },
    }
  }, [pool.data])

  const header = (
    <PageHeader
      backTo="/pool"
      eyebrow={
        <span className="inline-flex items-center gap-1.5">
          <ResourceIcon type="pool" className="size-3.5" /> 资源池
        </span>
      }
      title={poolid}
      description={pool.data ? pool.data.comment || '没有说明' : ' '}
      actions={pool.data ? <PoolManageActions pool={pool.data} /> : undefined}
    />
  )

  if (pool.isError && !pool.data) {
    return (
      <>
        {header}
        <ErrorCard error={pool.error} onRetry={() => void pool.refetch()} title="无法加载资源池" />
      </>
    )
  }

  return (
    <>
      {header}
      <div className="grid gap-(--section-gap)">
        <section aria-label="概要" className="grid gap-(--row-gap) sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Monitor} label="客户机运行中" loading={pool.isPending}>
            <span className="text-2xl font-medium tabular">{stats.running}</span>
            <span className="text-sm text-muted-foreground tabular"> / {stats.total}</span>
            {stats.templates > 0 && <div className="text-[11px] text-muted-foreground">另有 {stats.templates} 个模板</div>}
          </StatCard>
          <StatCard icon={Cpu} label="CPU" loading={pool.isPending}>
            <UsageBar value={ratio(stats.cpuUsed, stats.cpuTotal)} detail={stats.cpuTotal ? `${stats.cpuTotal} 核` : '无运行中'} />
          </StatCard>
          <StatCard icon={MemoryStick} label="内存" loading={pool.isPending}>
            <UsageBar value={ratio(stats.memUsed, stats.memTotal)} detail={stats.memTotal ? formatUsage(stats.memUsed, stats.memTotal) : '无运行中'} />
          </StatCard>
          <StatCard icon={Database} label="存储" loading={pool.isPending}>
            {storages.length ? (
              <UsageBar value={ratio(stats.diskUsed, stats.diskTotal)} detail={formatUsage(stats.diskUsed, stats.diskTotal)} />
            ) : (
              <span className="text-sm text-muted-foreground">没有存储成员</span>
            )}
          </StatCard>
        </section>

        <section aria-labelledby="pool-guests">
          <SectionHeader title={<span id="pool-guests">虚拟机与容器</span>}>
            {!pool.isPending && <span className="text-xs text-muted-foreground tabular">{guests.length} 个</span>}
          </SectionHeader>
          <GlassCard flush className="overflow-hidden">
            {pool.isPending ? (
              <LoadingRows rows={3} />
            ) : guests.length ? (
              <GuestList guests={guests} showNode={new Set(guests.map((g) => g.node)).size > 1} />
            ) : (
              <EmptyState icon={Box} title="这个资源池里没有客户机" />
            )}
          </GlassCard>
        </section>

        {storages.length > 0 && (
          <section aria-labelledby="pool-storage">
            <SectionHeader title={<span id="pool-storage">存储</span>} />
            <GlassCard flush className="overflow-hidden">
              <ul className="divide-y divide-border/70">
                {storages.map((s) => (
                  <li key={s.id}>
                    <Link
                      to={storagePath(s.node, s.storage)}
                      className="group flex min-h-14 items-center gap-3 px-(--card-p) py-(--row-py) transition-colors hover:bg-foreground/[0.03]"
                    >
                      <StatusDot status={s.status} pulse={false} />
                      <ResourceIcon type="storage" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{s.storage}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {s.node} · {s.plugintype ?? '存储'} · {statusLabel(s.status)}
                        </div>
                      </div>
                      <UsageBar className="hidden w-48 sm:block" size="sm" value={ratio(s.disk, s.maxdisk)} detail={formatUsage(s.disk, s.maxdisk)} />
                      <ChevronRight className="size-4 shrink-0 text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            </GlassCard>
          </section>
        )}

        {pool.data && <PoolPermissions poolid={poolid} />}
      </div>
    </>
  )
}

function StatCard({
  icon: Icon,
  label,
  loading,
  children,
}: {
  icon: typeof Monitor
  label: string
  loading: boolean
  children: ReactNode
}) {
  return (
    <GlassCard>
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      {loading ? <Skeleton className="h-7" /> : children}
    </GlassCard>
  )
}
