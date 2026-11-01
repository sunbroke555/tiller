import { useState, type ReactNode } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'

import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { TagFilterChip } from '@/components/TagChip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

import { DEFAULT_QUERY, SORTS, TYPE_FILTERS, activeFilterCount, type GuestQuery } from './filter'

interface GuestFilterBarProps {
  query: GuestQuery
  onChange: (q: GuestQuery) => void
  tags: { tag: string; count: number }[]
  nodes: string[]
  pools: string[]
}

/** Search, tag chips and the "筛选" panel (type, node, pool, sort) above the guest list. */
export function GuestFilterBar({ query, onChange, tags, nodes, pools }: GuestFilterBarProps) {
  const desktop = useIsDesktop()
  const [open, setOpen] = useState(false)
  const count = activeFilterCount(query)
  const set = (patch: Partial<GuestQuery>) => onChange({ ...query, ...patch })
  const toggleTag = (t: string) =>
    set({ tags: query.tags.includes(t) ? query.tags.filter((x) => x !== t) : [...query.tags, t] })
  const anything = count > 0 || query.tags.length > 0 || query.q.trim() !== ''

  const panel = (
    <FilterPanel
      query={query}
      set={set}
      nodes={nodes}
      pools={pools}
      onReset={() => onChange({ ...DEFAULT_QUERY, status: query.status, q: query.q, tags: query.tags })}
    />
  )
  const trigger = (onClick?: () => void) => (
    <Button variant="outline" className="relative shrink-0 gap-1.5" aria-label="筛选与排序" onClick={onClick}>
      <SlidersHorizontal />
      <span className="hidden sm:inline">筛选</span>
      {count > 0 && (
        <span className="inline-flex min-w-4.5 items-center justify-center rounded-full bg-brand px-1 text-[10px] leading-4.5 font-semibold text-(--brand-contrast) tabular">
          {count}
        </span>
      )}
    </Button>
  )

  return (
    <div className="mb-3 grid gap-2.5">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={query.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="按名称、VMID、标签过滤"
            aria-label="过滤客户机"
            className="pl-9"
          />
        </div>
        {desktop ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{trigger()}</PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              {panel}
            </PopoverContent>
          </Popover>
        ) : (
          <>
            {trigger(() => setOpen(true))}
            <ResponsiveDialog
              open={open}
              onOpenChange={setOpen}
              title="筛选与排序"
              footer={
                <Button className="w-full" onClick={() => setOpen(false)}>
                  完成
                </Button>
              }
            >
              {panel}
            </ResponsiveDialog>
          </>
        )}
        {anything && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label="清除筛选"
            title="清除筛选"
            onClick={() => onChange({ ...DEFAULT_QUERY, status: query.status })}
          >
            <X />
          </Button>
        )}
      </div>
      {tags.length > 0 && (
        <div role="group" aria-label="按标签筛选" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 scrollbar-none sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {tags.map(({ tag, count: n }) => (
            <TagFilterChip key={tag} tag={tag} count={n} selected={query.tags.includes(tag)} onToggle={() => toggleTag(tag)} />
          ))}
        </div>
      )}
    </div>
  )
}

function FilterPanel({
  query,
  set,
  nodes,
  pools,
  onReset,
}: {
  query: GuestQuery
  set: (patch: Partial<GuestQuery>) => void
  nodes: string[]
  pools: string[]
  onReset: () => void
}) {
  return (
    <div className="grid gap-4">
      <Group label="类型">
        {TYPE_FILTERS.map((t) => (
          <Choice key={t.value} selected={query.type === t.value} onClick={() => set({ type: t.value })}>
            {t.label}
          </Choice>
        ))}
      </Group>
      {nodes.length > 1 && (
        <Group label="节点">
          <Choice selected={!query.node} onClick={() => set({ node: null })}>
            全部
          </Choice>
          {nodes.map((n) => (
            <Choice key={n} selected={query.node === n} onClick={() => set({ node: n })}>
              {n}
            </Choice>
          ))}
        </Group>
      )}
      {pools.length > 0 && (
        <Group label="资源池">
          <Choice selected={!query.pool} onClick={() => set({ pool: null })}>
            全部
          </Choice>
          {pools.map((p) => (
            <Choice key={p} selected={query.pool === p} onClick={() => set({ pool: p })}>
              {p}
            </Choice>
          ))}
        </Group>
      )}
      <Group label="排序">
        {SORTS.map((s) => (
          <Choice key={s.value} selected={query.sort === s.value} onClick={() => set({ sort: s.value })}>
            {s.label}
          </Choice>
        ))}
      </Group>
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onReset} disabled={activeFilterCount(query) === 0}>
          重置
        </Button>
      </div>
    </div>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label}>
      <div className="mb-2 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center rounded-full border px-3 text-xs transition-colors pointer-coarse:h-10 pointer-coarse:px-3.5 pointer-coarse:text-sm',
        selected
          ? 'border-brand/50 bg-brand/12 font-medium text-foreground paper:border-brand paper:bg-brand/10'
          : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
