import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AlertTriangle, Box, Monitor, RefreshCw, Server, Settings2 } from 'lucide-react'

import { useClusterResources, useClusterStatus, useVersion } from '@/api/queries'
import { isGuest, isNode, isStorage, type ClusterResource } from '@/api/types'
import { useSession } from '@/api/useSession'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { UserMenu } from '@/components/layout/UserMenu'
import { CreateMenu } from '@/features/guest-create/CreateMenu'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { errorMessage } from '@/lib/errors'
import { byVmid } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { FILTERS, filterGuests, type GuestFilter } from './filter'
import { GuestList } from './GuestList'
import { NodeCard } from './NodeCard'

function useOverviewData(resources: ClusterResource[] | undefined) {
  return useMemo(() => {
    const all = resources ?? []
    const nodes = all.filter(isNode).sort((a, b) => a.node.localeCompare(b.node))
    const guests = all.filter(isGuest).sort(byVmid)
    const storages = all.filter(isStorage)
    const live = guests.filter((g) => g.template !== 1)
    return {
      nodes,
      guests,
      storages,
      stats: {
        nodesOnline: nodes.filter((n) => n.status === 'online').length,
        vms: live.filter((g) => g.type === 'qemu'),
        cts: live.filter((g) => g.type === 'lxc'),
      },
    }
  }, [resources])
}

export function OverviewPage() {
  const resources = useClusterResources()
  const { data: status } = useClusterStatus()
  const { data: version } = useVersion()
  const session = useSession()
  const [params, setParams] = useSearchParams()
  const filter = (FILTERS.some((f) => f.value === params.get('filter')) ? params.get('filter') : 'all') as GuestFilter

  const { nodes, guests, storages, stats } = useOverviewData(resources.data)
  const visible = useMemo(() => filterGuests(guests, filter), [guests, filter])
  const counts = useMemo(
    () => ({
      all: guests.length,
      running: guests.filter((g) => g.status === 'running').length,
      stopped: guests.filter((g) => g.status !== 'running').length,
    }),
    [guests],
  )

  const cluster = status?.find((e) => e.type === 'cluster')
  const subtitle = [
    cluster ? `集群 ${cluster.name}` : (session?.clustername ?? (nodes.length === 1 ? '单节点' : null)),
    version && `PVE ${version.version}`,
  ]
    .filter(Boolean)
    .join(' · ')

  const setFilter = (f: GuestFilter) => {
    const next = new URLSearchParams(params)
    if (f === 'all') next.delete('filter')
    else next.set('filter', f)
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="概览"
        description={subtitle || ' '}
        actions={
          <>
            <CreateMenu />
            <Button asChild variant="ghost" size="icon" className="rounded-full lg:hidden" aria-label="外观设置">
              <Link to="/settings/appearance">
                <Settings2 />
              </Link>
            </Button>
            <UserMenu className="lg:hidden" />
          </>
        }
      />

      {resources.isError && !resources.data ? (
        <GlassCard>
          <EmptyState
            icon={AlertTriangle}
            title="无法加载资源"
            description={errorMessage(resources.error)}
            action={
              <Button variant="outline" onClick={() => void resources.refetch()}>
                <RefreshCw /> 重试
              </Button>
            }
          />
        </GlassCard>
      ) : (
        <div className="grid gap-(--section-gap)">
          <section aria-label="统计" className="grid grid-cols-3 gap-(--row-gap)">
            <Stat icon={Server} label="节点" value={stats.nodesOnline} total={nodes.length} loading={resources.isPending} />
            <Stat
              icon={Monitor}
              label="虚拟机"
              value={stats.vms.filter((g) => g.status === 'running').length}
              total={stats.vms.length}
              loading={resources.isPending}
            />
            <Stat
              icon={Box}
              label="容器"
              value={stats.cts.filter((g) => g.status === 'running').length}
              total={stats.cts.length}
              loading={resources.isPending}
            />
          </section>

          <section aria-labelledby="nodes-heading">
            <SectionHeader title={<span id="nodes-heading">节点</span>} />
            <div className="grid gap-(--row-gap) sm:grid-cols-2 xl:grid-cols-3">
              {resources.isPending
                ? Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-56 rounded-2xl" />)
                : nodes.map((n) => (
                    <NodeCard key={n.id} node={n} storages={storages.filter((s) => s.node === n.node)} />
                  ))}
            </div>
          </section>

          <section aria-labelledby="guests-heading">
            <SectionHeader title={<span id="guests-heading">虚拟机与容器</span>}>
              <ToggleGroup
                type="single"
                value={filter}
                onValueChange={(v) => v && setFilter(v as GuestFilter)}
                variant="outline"
                size="sm"
                aria-label="筛选"
              >
                {FILTERS.map((f) => (
                  <ToggleGroupItem key={f.value} value={f.value} className="gap-1.5 px-3 text-xs">
                    {f.label}
                    <span className="text-muted-foreground tabular">{counts[f.value]}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </SectionHeader>
            <GlassCard flush className="overflow-hidden">
              {resources.isPending ? (
                <div className="divide-y divide-border/70">
                  {Array.from({ length: 5 }, (_, i) => (
                    <div key={i} className="flex items-center gap-3 px-(--card-p) py-4">
                      <Skeleton className="size-2 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : visible.length > 0 ? (
                <GuestList guests={visible} showNode={nodes.length > 1} />
              ) : (
                <EmptyState
                  icon={filter === 'all' ? Monitor : Box}
                  title={filter === 'all' ? '还没有虚拟机或容器' : `没有${filter === 'running' ? '运行中' : '已停止'}的客户机`}
                />
              )}
            </GlassCard>
          </section>
        </div>
      )}
    </>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  total,
  loading,
}: {
  icon: typeof Server
  label: string
  value: number
  total: number
  loading: boolean
}) {
  return (
    <GlassCard className="px-3.5 py-3 sm:px-(--card-p) sm:py-(--card-p)">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-14" />
      ) : (
        <div className="mt-1.5 flex items-baseline gap-1 tabular">
          <span className={cn('text-2xl font-medium', value > 0 && 'text-foreground')}>{value}</span>
          <span className="text-sm text-muted-foreground">/ {total}</span>
        </div>
      )}
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label === '节点' ? '在线' : '运行中'}</div>
    </GlassCard>
  )
}
