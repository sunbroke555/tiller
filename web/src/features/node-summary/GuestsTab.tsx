import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, Monitor, Search, SearchX } from 'lucide-react'

import { useNodeGuests } from '@/api/node-summary'
import { useClusterResources } from '@/api/queries'
import { isGuest } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { NodeTabProps } from '@/features/node/types'
import { DEFAULT_QUERY, FILTERS, applyGuestQuery, filterGuests, narrowGuests, type GuestFilter } from '@/features/overview/filter'
import { GuestList } from '@/features/overview/GuestList'

/**
 * Node → 客户机: the VMs and CTs on this node (GET /nodes/{node}/qemu?full=1
 * and /lxc), with status chips and a text filter; "在概览中查看" opens the
 * overview filtered to this node (bulk selection, tags, sorting).
 */
export default function GuestsTab({ node }: NodeTabProps) {
  const guests = useNodeGuests(node)
  // The per-node index has no pool; take it from the cluster resources.
  const { data: pools } = useClusterResources({
    select: (all) => new Map(all.filter(isGuest).filter((g) => g.node === node && g.pool).map((g) => [g.id, g.pool!])),
  })
  const [status, setStatus] = useState<GuestFilter>('all')
  const [q, setQ] = useState('')

  const rows = useMemo(
    () => (guests.data ?? []).map((g) => (pools?.has(g.id) ? { ...g, pool: pools.get(g.id) } : g)),
    [guests.data, pools],
  )
  const narrowed = useMemo(() => narrowGuests(rows, { ...DEFAULT_QUERY, q }), [rows, q])
  const visible = useMemo(() => applyGuestQuery(rows, { ...DEFAULT_QUERY, status, q }), [rows, status, q])
  const counts: Record<GuestFilter, number> = {
    all: narrowed.length,
    running: filterGuests(narrowed, 'running').length,
    stopped: filterGuests(narrowed, 'stopped').length,
    template: filterGuests(narrowed, 'template').length,
  }
  const hasPools = rows.some((g) => g.pool)

  return (
    <section aria-label="客户机" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="按名称、VMID、标签过滤"
            aria-label="过滤客户机"
            className="pl-9"
          />
        </div>
        <Button asChild variant="outline" className="shrink-0 gap-1.5">
          <Link to={`/?node=${encodeURIComponent(node)}`}>
            在概览中查看 <ArrowUpRight aria-hidden />
          </Link>
        </Button>
      </div>
      <ToggleGroup
        type="single"
        value={status}
        onValueChange={(v) => v && setStatus(v as GuestFilter)}
        variant="outline"
        size="sm"
        aria-label="状态"
        className="flex-wrap justify-start"
      >
        {FILTERS.filter((f) => f.value !== 'template' || counts.template > 0 || status === 'template').map((f) => (
          <ToggleGroupItem key={f.value} value={f.value} className="gap-1.5 px-3 text-xs pointer-coarse:h-11">
            {f.label}
            <span className="text-muted-foreground tabular">{counts[f.value]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <GlassCard flush className="overflow-hidden">
        {guests.isPending ? (
          <LoadingRows rows={4} />
        ) : guests.isError && !guests.data ? (
          <ErrorState compact error={guests.error} onRetry={() => void guests.refetch()} />
        ) : visible.length > 0 ? (
          <GuestList guests={visible} showNode={false} showPool={hasPools} />
        ) : rows.length === 0 ? (
          <EmptyState icon={Monitor} title="这个节点上没有虚拟机或容器" />
        ) : (
          <EmptyState
            icon={SearchX}
            title="没有匹配的客户机"
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setQ('')
                  setStatus('all')
                }}
              >
                清除筛选
              </Button>
            }
          />
        )}
      </GlassCard>
    </section>
  )
}
