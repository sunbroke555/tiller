import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink } from 'react-router'
import { ChevronRight, Folder, ListTree, Search, Tag, X } from 'lucide-react'

import { useClusterResources } from '@/api/queries'
import type { GuestResource, StorageResource } from '@/api/types'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { TagChip, useTagStyle } from '@/components/TagChip'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { poolPath } from '@/features/pool/paths'
import { guestName, guestPath, nodePath, storagePath } from '@/lib/resources'
import { orderTags, splitTags } from '@/lib/tags'
import { cn } from '@/lib/utils'

import { buildTree, loadTreePrefs, saveTreePrefs, type TreeGroup, type TreeGrouping, type TreePrefs } from './resourceTree'

const GROUPINGS: { value: TreeGrouping; label: string; icon: typeof ListTree }[] = [
  { value: 'node', label: '按节点', icon: ListTree },
  { value: 'pool', label: '按资源池', icon: Folder },
  { value: 'tag', label: '按标签', icon: Tag },
]

const rowClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-[13px] transition-colors',
    isActive ? 'bg-sidebar-accent text-foreground' : 'text-foreground/80 hover:bg-sidebar-accent/70 hover:text-foreground',
  )

/** Desktop sidebar tree: grouped by node, pool or tag, with a quick filter. */
export function ResourceTree() {
  const { data, isPending, isError } = useClusterResources()
  const [prefs, setPrefsState] = useState<TreePrefs>(loadTreePrefs)
  const [search, setSearch] = useState('')
  const setPrefs = (patch: Partial<TreePrefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch }
      saveTreePrefs(next)
      return next
    })
  const groups = useMemo(() => buildTree(data ?? [], prefs, search), [data, prefs, search])
  const searching = search.trim().length > 0

  // Escape in the filter clears it.
  useEffect(() => {
    if (!searching) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (e.target as HTMLElement | null)?.dataset?.treeFilter) setSearch('')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searching])

  const current = GROUPINGS.find((g) => g.value === prefs.group)!

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1.5 flex items-center gap-1 px-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            data-tree-filter="1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="过滤资源"
            aria-label="过滤资源树"
            className="h-7 w-full rounded-lg border border-transparent bg-transparent pr-6 pl-7 text-[13px] outline-none placeholder:text-muted-foreground hover:bg-sidebar-accent/60 focus:border-input focus:bg-(--field)"
          />
          {searching && (
            <button
              type="button"
              aria-label="清除过滤"
              onClick={() => setSearch('')}
              className="absolute top-1/2 right-1 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`分组方式：${current.label}`}
            title={`分组方式：${current.label}`}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <current.icon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel className="text-xs text-muted-foreground">分组</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={prefs.group} onValueChange={(v) => setPrefs({ group: v as TreeGrouping })}>
              {GROUPINGS.map((g) => (
                <DropdownMenuRadioItem key={g.value} value={g.value}>
                  {g.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={prefs.showStorage} onCheckedChange={(v) => setPrefs({ showStorage: v === true })}>
              显示存储
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={prefs.showTemplates} onCheckedChange={(v) => setPrefs({ showTemplates: v === true })}>
              显示模板
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ScrollArea className="min-h-0 flex-1 pr-1">
      {isPending ? (
        <div className="space-y-2 px-2 pt-1">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      ) : isError && !data ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">无法加载资源</p>
      ) : groups.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{searching ? '没有匹配的资源' : '没有资源'}</p>
      ) : (
        <ul className="space-y-0.5" role="tree" aria-label="资源树">
          {groups.map((group) => {
            const open = searching || !prefs.collapsed[group.key]
            return (
              <GroupItem
                key={group.key}
                group={group}
                open={open}
                onToggle={() => setPrefs({ collapsed: { ...prefs.collapsed, [group.key]: open } })}
              />
            )
          })}
        </ul>
      )}
      </ScrollArea>
    </div>
  )
}

function GroupItem({ group, open, onToggle }: { group: TreeGroup; open: boolean; onToggle: () => void }) {
  const count = group.guests.length + group.storages.length
  return (
    <li role="treeitem" aria-expanded={open} aria-label={group.label}>
      <div className="flex items-center">
        <button
          type="button"
          aria-label={open ? `折叠 ${group.label}` : `展开 ${group.label}`}
          onClick={onToggle}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </button>
        <GroupLabel group={group} count={count} />
      </div>
      {open && (
        <ul role="group" className="mt-0.5 ml-[11px] space-y-0.5 border-l border-sidebar-border pl-2.5">
          {group.guests.map((g) => (
            <li key={`${group.key}/${g.id}`} role="treeitem">
              <GuestRow guest={g} showNode={group.kind !== 'node'} />
            </li>
          ))}
          {group.storages.map((s) => (
            <li key={`${group.key}/${s.id}`} role="treeitem">
              <StorageRow storage={s} showNode={group.kind !== 'node'} />
            </li>
          ))}
          {count === 0 && (
            <li className="px-2 py-1 text-xs text-muted-foreground">{group.kind === 'node' ? '没有客户机' : '没有成员'}</li>
          )}
        </ul>
      )}
    </li>
  )
}

function GroupLabel({ group, count }: { group: TreeGroup; count: number }) {
  const cls = (s: { isActive: boolean }) => cn(rowClass(s), 'flex-1 font-medium')
  const badge = <span className="ml-auto text-[11px] font-normal text-muted-foreground tabular">{count}</span>
  switch (group.kind) {
    case 'node':
      return (
        <NavLink to={nodePath(group.label)} className={cls} end={false}>
          <ResourceIcon type="node" className="size-3.5" />
          <span className="truncate">{group.label}</span>
          <StatusDot status={group.node?.status} size="sm" pulse={false} className="ml-auto" />
        </NavLink>
      )
    case 'pool':
      return (
        <NavLink to={poolPath(group.label)} className={cls}>
          <ResourceIcon type="pool" className="size-3.5" />
          <span className="truncate">{group.label}</span>
          {badge}
        </NavLink>
      )
    case 'tag':
      return (
        <Link to={`/?tag=${encodeURIComponent(group.label)}`} className={cn(rowClass({ isActive: false }), 'flex-1')}>
          <TagChip tag={group.label} />
          {badge}
        </Link>
      )
    default:
      return (
        <span className="flex h-8 flex-1 items-center gap-2 px-2 text-[13px] text-muted-foreground">
          <span className="truncate">{group.label}</span>
          {badge}
        </span>
      )
  }
}

function GuestRow({ guest: g, showNode }: { guest: GuestResource; showNode: boolean }) {
  const style = useTagStyle()
  const tags = orderTags(splitTags(g.tags), style).slice(0, 3)
  return (
    <NavLink to={guestPath(g)} className={rowClass} title={showNode ? `${guestName(g)} · ${g.node}` : guestName(g)}>
      <StatusDot status={g.template === 1 ? 'template' : g.status} size="sm" pulse={false} />
      <span className="w-8 shrink-0 text-[11px] text-muted-foreground tabular">{g.vmid}</span>
      <span className={cn('truncate', g.status !== 'running' && 'text-muted-foreground')}>{guestName(g)}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {tags.map((t) => (
          <TagChip key={t} tag={t} shape="dense" tagStyle={style} className="w-2.5" />
        ))}
        {g.template === 1 && <ResourceIcon type={g.type} template className="size-3" />}
      </span>
    </NavLink>
  )
}

function StorageRow({ storage: s, showNode }: { storage: StorageResource; showNode: boolean }) {
  return (
    <NavLink to={storagePath(s.node, s.storage)} className={rowClass}>
      <ResourceIcon type="storage" className="size-3.5" />
      <span className={cn('truncate', s.status !== 'available' && 'text-muted-foreground')}>{s.storage}</span>
      {showNode && <span className="truncate text-[11px] text-muted-foreground">{s.node}</span>}
      {s.status !== 'available' && <StatusDot status={s.status} size="sm" pulse={false} className="ml-auto" />}
    </NavLink>
  )
}
