import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Box, ListChecks, Monitor, Plus, SearchX, Server, Settings2 } from 'lucide-react'

import { usePermissions } from '@/api/permissions'
import { useClusterResources, useClusterStatus, useVersion } from '@/api/queries'
import { isGuest, isNode, isStorage, type ClusterResource } from '@/api/types'
import { useSession } from '@/api/useSession'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { InstallBanner } from '@/components/layout/InstallBanner'
import { UserMenu } from '@/components/layout/UserMenu'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { ErrorCard, LoadingRows } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CreateMenu } from '@/features/guest-create/CreateMenu'
import { BulkSelectionBar } from '@/features/guest-lifecycle/BulkSelectionBar'
import { DEFAULT_GLOBAL_PERMISSIONS } from '@/lib/permissions'
import { byVmid, createGuestPath } from '@/lib/resources'
import { collectTags } from '@/lib/tags'
import { cn } from '@/lib/utils'

import {
  DEFAULT_QUERY,
  FILTERS,
  applyGuestQuery,
  filterGuests,
  narrowGuests,
  readGuestQuery,
  writeGuestQuery,
  type GuestFilter,
  type GuestQuery,
} from './filter'
import { GuestFilterBar } from './GuestFilterBar'
import { GuestList } from './GuestList'
import { NodeCard } from './NodeCard'

function useOverviewData(resources: ClusterResource[] | undefined) {
  return useMemo(() => {
    const all = resources ?? []
    const nodes = all.filter(isNode).sort((a, b) => a.node.localeCompare(b.node))
    const guests = all.filter(isGuest).sort(byVmid)
    const storages = all.filter(isStorage)
    const live = guests.filter((g) => g.template !== 1)
    const pools = [...new Set(guests.map((g) => g.pool).filter((p): p is string => !!p))].sort()
    return {
      nodes,
      guests,
      storages,
      pools,
      tags: collectTags(guests),
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
  const perms = usePermissions()
  const [params, setParams] = useSearchParams()
  const query = useMemo(() => readGuestQuery(params), [params])

  const { nodes, guests, storages, pools, tags, stats } = useOverviewData(resources.data)
  const narrowed = useMemo(() => narrowGuests(guests, query), [guests, query])
  const visible = useMemo(() => applyGuestQuery(guests, query), [guests, query])
  const counts = useMemo(
    () => ({
      all: narrowed.length,
      running: filterGuests(narrowed, 'running').length,
      stopped: filterGuests(narrowed, 'stopped').length,
      template: filterGuests(narrowed, 'template').length,
    }),
    [narrowed],
  )
  const canCreate = perms.can(DEFAULT_GLOBAL_PERMISSIONS['create-qemu']!)

  // Selection mode for bulk actions (area guest-lifecycle).
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const selectedGuests = useMemo(() => guests.filter((g) => selected.has(g.id)), [guests, selected])
  // Stable: memoized rows compare it by identity.
  const toggleSelected = useCallback(
    (g: { id: string }) =>
      setSelected((s) => {
        const next = new Set(s)
        if (next.has(g.id)) next.delete(g.id)
        else next.add(g.id)
        return next
      }),
    [],
  )
  const exitSelection = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  const cluster = status?.find((e) => e.type === 'cluster')
  const subtitle = [
    cluster ? `集群 ${cluster.name}` : (session?.clustername ?? (nodes.length === 1 ? '单节点' : null)),
    version && `PVE ${version.version}`,
  ]
    .filter(Boolean)
    .join(' · ')

  const setQuery = (q: GuestQuery) => setParams(writeGuestQuery(params, q), { replace: true })
  const setFilter = (f: GuestFilter) => setQuery({ ...query, status: f })
  const filtered = query.tags.length > 0 || query.q.trim() !== '' || query.type !== 'all' || !!query.node || !!query.pool

  return (
    <>
      <PageHeader
        title="概览"
        description={subtitle || ' '}
        actions={
          <>
            {canCreate && <CreateMenu />}
            <Button asChild variant="ghost" size="icon" className="rounded-full lg:hidden" aria-label="外观设置">
              <Link to="/settings/appearance">
                <Settings2 />
              </Link>
            </Button>
            <UserMenu className="lg:hidden" />
          </>
        }
      />

      <InstallBanner className="mb-(--section-gap)" />

      {resources.isError && !resources.data ? (
        <ErrorCard error={resources.error} onRetry={() => void resources.refetch()} title="无法加载资源" />
      ) : (
        <div className="grid gap-(--section-gap)">
          <section aria-label="统计" className="grid grid-cols-3 gap-(--row-gap)">
            <Stat to="/datacenter" icon={Server} label="节点" value={stats.nodesOnline} total={nodes.length} loading={resources.isPending} />
            <Stat
              to="/?type=qemu"
              icon={Monitor}
              label="虚拟机"
              value={stats.vms.filter((g) => g.status === 'running').length}
              total={stats.vms.length}
              loading={resources.isPending}
            />
            <Stat
              to="/?type=lxc"
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
              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup
                  type="single"
                  value={query.status}
                  onValueChange={(v) => v && setFilter(v as GuestFilter)}
                  variant="outline"
                  size="sm"
                  aria-label="状态"
                >
                  {FILTERS.filter((f) => f.value !== 'template' || counts.template > 0 || query.status === 'template').map((f) => (
                    <ToggleGroupItem key={f.value} value={f.value} className="gap-1.5 px-3 text-xs pointer-coarse:h-11">
                      {f.label}
                      <span className="text-muted-foreground tabular">{counts[f.value]}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {guests.length > 0 && (
                  <Button
                    type="button"
                    variant={selecting ? 'secondary' : 'outline'}
                    size="sm"
                    aria-pressed={selecting}
                    onClick={() => (selecting ? exitSelection() : setSelecting(true))}
                    className="text-xs pointer-coarse:h-11"
                  >
                    <ListChecks /> {selecting ? '完成' : '多选'}
                  </Button>
                )}
              </div>
            </SectionHeader>
            {selecting && <BulkSelectionBar selected={selectedGuests} onExit={exitSelection} canMigrate={nodes.length > 1} />}
            {guests.length > 0 && (
              <GuestFilterBar
                query={query}
                onChange={setQuery}
                tags={tags}
                nodes={nodes.map((n) => n.node)}
                pools={pools}
              />
            )}
            <GlassCard flush className="overflow-hidden">
              {resources.isPending ? (
                <LoadingRows rows={5} />
              ) : visible.length > 0 ? (
                <GuestList
                  guests={visible}
                  showNode={nodes.length > 1}
                  showPool={!query.pool && pools.length > 0}
                  selected={selecting ? selected : undefined}
                  onToggle={selecting ? toggleSelected : undefined}
                />
              ) : filtered ? (
                <EmptyState
                  icon={SearchX}
                  title="没有匹配的客户机"
                  description="换个关键字或标签试试。"
                  action={
                    <Button variant="outline" onClick={() => setQuery({ ...DEFAULT_QUERY })}>
                      清除筛选
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={query.status === 'all' ? Monitor : Box}
                  title={
                    query.status === 'all'
                      ? '还没有虚拟机或容器'
                      : query.status === 'template'
                        ? '没有模板'
                        : `没有${query.status === 'running' ? '运行中' : '已停止'}的客户机`
                  }
                  action={
                    query.status === 'all' && canCreate ? (
                      <Button asChild variant="outline">
                        <Link to={createGuestPath('qemu')}>
                          <Plus /> 创建虚拟机
                        </Link>
                      </Button>
                    ) : undefined
                  }
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
  to,
  icon: Icon,
  label,
  value,
  total,
  loading,
}: {
  to: string
  icon: typeof Server
  label: string
  value: number
  total: number
  loading: boolean
}) {
  return (
    <GlassCard asChild interactive className="px-3.5 py-3 sm:px-(--card-p) sm:py-(--card-p)">
      <Link to={to} aria-label={`${label}：${label === '节点' ? '在线' : '运行中'} ${value}，共 ${total}`}>
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
      </Link>
    </GlassCard>
  )
}
