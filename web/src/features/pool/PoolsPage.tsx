import { useMemo } from 'react'
import { Link } from 'react-router'
import { ChevronRight, Folder } from 'lucide-react'

import { useClusterResources } from '@/api/queries'
import { usePools } from '@/api/shell'
import { isGuest, type PoolResource } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { PageHeader } from '@/components/PageHeader'
import { ErrorCard, LoadingCards } from '@/components/QueryState'
import { ResourceIcon } from '@/components/ResourceIcon'
import { Button } from '@/components/ui/button'
import { UsageBar } from '@/components/UsageBar'
import { formatUsage, ratio } from '@/lib/format'

import { poolPath } from './paths'

/** /pool — every resource pool with member counts and usage. */
export default function PoolsPage() {
  const pools = usePools()
  const resources = useClusterResources()

  const rows = useMemo(() => {
    const all = resources.data ?? []
    const usage = new Map(all.filter((r): r is PoolResource => r.type === 'pool').map((r) => [r.pool, r]))
    const guests = all.filter(isGuest)
    return (pools.data ?? [])
      .map((p) => {
        const members = guests.filter((g) => g.pool === p.poolid)
        return {
          ...p,
          usage: usage.get(p.poolid) as (PoolResource & { cpu?: number; maxcpu?: number; mem?: number; maxmem?: number }) | undefined,
          guests: members.length,
          running: members.filter((g) => g.status === 'running').length,
        }
      })
      .sort((a, b) => a.poolid.localeCompare(b.poolid))
  }, [pools.data, resources.data])

  return (
    <>
      <PageHeader title="资源池" description="按用途分组的虚拟机、容器和存储" backTo="/" />
      {pools.isPending ? (
        <LoadingCards count={3} cardClassName="h-32" />
      ) : pools.isError ? (
        <ErrorCard error={pools.error} onRetry={() => void pools.refetch()} />
      ) : rows.length === 0 ? (
        <GlassCard>
          <EmptyState
            icon={Folder}
            title="还没有资源池"
            description="资源池在数据中心 → 权限与认证 → 资源池中创建。"
            action={
              <Button variant="outline" asChild>
                <Link to="/datacenter/permissions/pools">去创建</Link>
              </Button>
            }
          />
        </GlassCard>
      ) : (
        <div className="grid gap-(--row-gap) sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <GlassCard key={p.poolid} asChild interactive>
              <Link to={poolPath(p.poolid)} className="group">
                <div className="flex items-center gap-3">
                  <ResourceIcon type="pool" variant="tile" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.poolid}</div>
                    <div className="truncate text-xs text-muted-foreground">{p.comment || '没有说明'}</div>
                  </div>
                  <ChevronRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5" />
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  <span className="text-foreground tabular">{p.running}</span> / <span className="tabular">{p.guests}</span> 台客户机运行中
                </div>
                {p.usage?.maxmem ? (
                  <UsageBar className="mt-3" label="内存" size="sm" value={ratio(p.usage.mem, p.usage.maxmem)} detail={formatUsage(p.usage.mem, p.usage.maxmem)} />
                ) : null}
              </Link>
            </GlassCard>
          ))}
        </div>
      )}
    </>
  )
}
