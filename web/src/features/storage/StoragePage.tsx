import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQueries } from '@tanstack/react-query'
import { ChevronRight, CircleSlash, Database, Share2 } from 'lucide-react'

import { get, p } from '@/api/client'
import { useClusterResources } from '@/api/queries'
import { storageKeys } from '@/api/storage-browser'
import { isNode, isStorage, type NodeStorage, type StorageContent, type StorageResource } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { UsageBar } from '@/components/UsageBar'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CONTENT_ORDER, storageTypeLabel } from '@/features/storage-browser/labels'
import { formatBytes, formatUsage, ratio } from '@/lib/format'
import { storagePath } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { STORAGE_CONTENT_LABEL, storageContents } from './types'

/** Live per-node state (active / enabled) of every storage, keyed "node/storage". */
function useStorageStates(nodes: string[]) {
  const results = useQueries({
    queries: nodes.map((node) => ({
      queryKey: storageKeys.nodeList(node),
      queryFn: ({ signal }: { signal: AbortSignal }) => get<NodeStorage[]>(p`/nodes/${node}/storage`, undefined, { signal }),
      refetchInterval: 30_000,
      staleTime: 10_000,
    })),
  })
  return useMemo(() => {
    const map = new Map<string, NodeStorage>()
    results.forEach((r, i) => {
      for (const s of r.data ?? []) map.set(`${nodes[i]}/${s.storage}`, s)
    })
    return map
    // results is a new array each render; its data entries are stable.
  }, [nodes, ...results.map((r) => r.data)])
}

/** /storage — every storage of every node, grouped by node, filterable by content. */
export function StoragePage() {
  const { data, isPending } = useClusterResources({
    select: (all) => ({ storages: all.filter(isStorage), nodes: all.filter(isNode).map((n) => n.node).sort() }),
  })
  const [params, setParams] = useSearchParams()
  const nodes = useMemo(() => data?.nodes ?? [], [data?.nodes.join(',')])
  const states = useStorageStates(nodes)

  const available = useMemo(
    () => CONTENT_ORDER.filter((c) => (data?.storages ?? []).some((s) => storageContents(s.content).includes(c))),
    [data?.storages],
  )
  const filterParam = params.get('content') as StorageContent | null
  const filter = filterParam && available.includes(filterParam) ? filterParam : 'all'

  const groups = useMemo(() => {
    const byNode = new Map<string, StorageResource[]>()
    for (const s of data?.storages ?? []) {
      if (filter !== 'all' && !storageContents(s.content).includes(filter)) continue
      byNode.set(s.node, [...(byNode.get(s.node) ?? []), s])
    }
    return [...byNode.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([node, list]) => ({ node, list: list.sort((a, b) => a.storage.localeCompare(b.storage)) }))
  }, [data?.storages, filter])
  const count = data?.storages.length ?? 0

  const setFilter = (v: string) => {
    const next = new URLSearchParams(params)
    if (v === 'all') next.delete('content')
    else next.set('content', v)
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader title="存储" description={count ? `${count} 个存储 · ISO、模板、备份与磁盘` : '存储用量、内容、ISO 与备份'} />
      {available.length > 1 && (
        <div className="-mx-4 mb-(--section-gap) overflow-x-auto scrollbar-none px-4 sm:mx-0 sm:px-0">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={filter}
            onValueChange={(v) => v && setFilter(v)}
            aria-label="按内容筛选"
            className="w-max"
          >
            <ToggleGroupItem value="all" className="px-3 text-xs pointer-coarse:h-9">
              全部
            </ToggleGroupItem>
            {available.map((c) => (
              <ToggleGroupItem key={c} value={c} className="px-3 text-xs whitespace-nowrap pointer-coarse:h-9">
                {STORAGE_CONTENT_LABEL[c]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <GlassCard>
          <EmptyState
            icon={Database}
            title={count ? '没有符合条件的存储' : '没有存储'}
            description={count ? undefined : '当前账号看不到任何存储。'}
          />
        </GlassCard>
      ) : (
        <div className="grid gap-(--section-gap)">
          {groups.map((g) => (
            <section key={g.node} aria-label={`节点 ${g.node}`}>
              {nodes.length > 1 && <SectionHeader title={g.node} />}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.list.map((s) => (
                  <StorageCard key={s.id} storage={s} state={states.get(`${s.node}/${s.storage}`)} highlight={filter} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

function StorageCard({
  storage: s,
  state,
  highlight,
}: {
  storage: StorageResource
  state: NodeStorage | undefined
  highlight: StorageContent | 'all'
}) {
  const contents = storageContents(s.content)
  const used = state?.used ?? s.disk
  const total = state?.total ?? s.maxdisk
  const avail = state?.avail ?? (used !== undefined && total !== undefined ? total - used : undefined)
  const disabled = state?.enabled === 0
  const inactive = !disabled && (state ? state.active === 0 : s.status !== 'available')
  const shared = (state?.shared ?? s.shared) === 1
  return (
    <GlassCard asChild interactive>
      <Link to={storagePath(s.node, s.storage)} className="grid gap-3" aria-label={`存储 ${s.storage}`}>
        <div className="flex items-center gap-3">
          <ResourceIcon type="storage" variant="tile" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-foreground">{s.storage}</span>
              <StatusDot status={disabled || inactive ? 'inactive' : s.status} size="sm" pulse={false} />
            </div>
            <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              {storageTypeLabel(state?.type ?? s.plugintype)}
              {shared && (
                <span className="inline-flex items-center gap-0.5">
                  · <Share2 className="size-3" aria-hidden /> 共享
                </span>
              )}
            </div>
          </div>
          {(disabled || inactive) && (
            <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-destructive/12 px-2 text-[11px] text-destructive paper:bg-secondary">
              <CircleSlash className="size-3" aria-hidden />
              {disabled ? '已禁用' : '未激活'}
            </span>
          )}
          <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
        </div>
        <UsageBar value={ratio(used, total)} detail={formatUsage(used, total)} size="sm" />
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {contents.map((c) => (
              <span
                key={c}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px]',
                  c === highlight
                    ? 'bg-brand/15 text-brand-strong paper:bg-primary/15 paper:text-foreground'
                    : 'bg-secondary text-secondary-foreground',
                )}
              >
                {STORAGE_CONTENT_LABEL[c]}
              </span>
            ))}
          </div>
          {avail !== undefined && total ? (
            <span className="shrink-0 text-[11px] text-muted-foreground tabular">可用 {formatBytes(avail)}</span>
          ) : null}
        </div>
      </Link>
    </GlassCard>
  )
}
