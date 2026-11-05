import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router'
import { ChevronRight, ChevronsUpDown, Database, Folder, Layers, ListTree, PanelsTopLeft, Search, Server, Tag, X } from 'lucide-react'

import { isPveApiError } from '@/api/client'
import { getInstanceScope } from '@/api/instance-scope'
import { instanceUrl, switchInstance, useInstances, type PveInstance } from '@/api/instances'
import { useInstanceResources } from '@/features/instances/useInstanceResources'
import type { GuestResource, StorageResource } from '@/api/types'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { TagChip, useTagStyle } from '@/components/TagChip'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { poolPath } from '@/features/pool/paths'
import { GUEST_TYPE_LABEL, guestName, guestPath, nodePath, statusLabel, storagePath } from '@/lib/resources'
import { orderTags, splitTags, type TagStyle } from '@/lib/tags'
import { cn } from '@/lib/utils'
import { useResourceTreeScroll } from './useResourceTreeScroll'

import {
  buildTree,
  loadTreePrefs,
  saveTreePrefs,
  sameTreeGuest,
  type TreeGroup,
  type TreeGrouping,
  type TreePrefs,
  type TreeGuestType,
} from './resourceTree'

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

const TreeInstance = createContext<PveInstance | undefined>(undefined)
type UpdatePrefs = (patch: Partial<TreePrefs> | ((prefs: TreePrefs) => Partial<TreePrefs>)) => void
const TYPES: { value: TreeGuestType; label: string }[] = [{ value: 'all', label: '全部' }, { value: 'qemu', label: '虚拟机' }, { value: 'lxc', label: '容器' }]
const matchesPath = (pathname: string, path: string) => pathname === path || pathname.startsWith(path + '/')

/** Focus on the current instance; search always spans every connection. */
export function ResourceTree() {
  const catalog = useInstances()
  const scope = getInstanceScope()
  const { pathname } = useLocation()
  const [prefs, setPrefsState] = useState<TreePrefs>(loadTreePrefs)
  const prefsRef = useRef(prefs)
  const [search, setSearch] = useState('')
  const setPrefs = useCallback<UpdatePrefs>((patch) => {
    const next = { ...prefsRef.current, ...(typeof patch === 'function' ? patch(prefsRef.current) : patch) }
    prefsRef.current = next
    saveTreePrefs(next)
    setPrefsState(next)
  }, [])
  const searching = search.trim().length > 0
  const active = catalog.data?.instances.find((i) => i.id === scope?.id && i.version === scope?.version) ?? catalog.data?.instances[0]
  const instances = searching || prefs.view === 'all' ? catalog.data?.instances : active ? [active] : []
  const scroll = useResourceTreeScroll(`${scope?.id ?? 'default'}:${scope?.version ?? ''}:${searching ? 'search' : prefs.view}:${prefs.group}:${prefs.guestType}`, pathname)
  const chooseInstance = (value: string) => {
    setSearch('')
    if (value === 'all') { setPrefs({ view: 'all' }); return }
    const instance = catalog.data?.instances.find((i) => i.id === value)
    if (!instance) return
    setPrefs({ view: 'current' })
    if (!instance.hasCredential) window.location.assign('/instances')
    else if (instance.id !== scope?.id || instance.version !== scope.version) switchInstance(instance)
  }

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
    <div ref={scroll} className="flex min-h-0 flex-1 flex-col">
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={`资源实例：${prefs.view === 'all' ? '全部实例' : active?.name ?? '选择实例'}`} className="mb-2 flex h-9 w-full shrink-0 items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/45 px-2.5 text-left text-[13px] outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring">
          {prefs.view === 'all' ? <Layers className="size-4 shrink-0 text-muted-foreground" /> : <Server className="size-4 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate font-medium">{prefs.view === 'all' ? '全部实例' : active?.name ?? '选择实例'}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-52">
          <DropdownMenuLabel className="text-xs text-muted-foreground">PVE 实例</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={prefs.view === 'all' ? 'all' : active?.id} onValueChange={chooseInstance}>
            {catalog.data?.instances.map((instance) => <DropdownMenuRadioItem key={instance.id} value={instance.id}><span className="truncate">{instance.name}</span></DropdownMenuRadioItem>)}
            <DropdownMenuSeparator />
            <DropdownMenuRadioItem value="all">全部实例</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><a href="/instances">管理实例</a></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="mb-1 flex shrink-0 items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            data-tree-filter="1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索名称、ID 或标签"
            aria-label="过滤资源树"
            className="h-8 w-full rounded-lg border border-sidebar-border/70 bg-transparent pr-6 pl-8 text-xs outline-none placeholder:text-muted-foreground hover:bg-sidebar-accent/60 focus:border-input focus:bg-(--field)"
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
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
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
      <div role="group" aria-label="筛选资源类型" className="mb-1.5 flex shrink-0 gap-0.5 border-b border-sidebar-border/60 pb-1.5">
        {TYPES.map((type) => <button key={type.value} type="button" aria-pressed={prefs.guestType === type.value} onClick={() => setPrefs({ guestType: type.value })} className={cn('rounded-md px-2.5 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring', prefs.guestType === type.value ? 'bg-sidebar-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/60')}>{type.label}</button>)}
      </div>
      {searching && <p className="px-2 pb-1 text-[11px] text-muted-foreground">正在搜索全部实例</p>}

      {/* Keep Radix's intrinsic-width content wrapper within the sidebar so long names truncate. */}
      <ScrollArea type="auto" className="resource-tree-scroll min-h-0 flex-1 pr-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
      {catalog.isPending ? (
        <div data-tree-loading className="space-y-2 px-2 pt-1">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-6" />)}
        </div>
      ) : catalog.isError && !catalog.data ? (
        <button type="button" className="px-3 py-2 text-xs text-destructive" onClick={() => void catalog.refetch()}>无法读取实例，点击重试</button>
      ) : !catalog.data?.instances.length ? (
        <a href="/instances" className="block px-3 py-2 text-xs text-brand-strong">添加 PVE 实例</a>
      ) : (
        <><ul className="peer/resource-tree space-y-1" role="tree" aria-label="资源树">
          {instances?.map((instance) => (
            <InstanceBranch key={`${instance.id}:${instance.version}`} instance={instance} prefs={prefs} search={search} setPrefs={setPrefs} flat={!searching && prefs.view === 'current'} />
          ))}
        </ul>{searching && <p className="hidden px-3 py-4 text-xs text-muted-foreground peer-empty/resource-tree:block">没有匹配的资源</p>}</>
      )}
      </ScrollArea>
    </div>
  )
}

function InstanceBranch({ instance, prefs, search, setPrefs, flat }: {
  instance: PveInstance
  prefs: TreePrefs
  search: string
  setPrefs: UpdatePrefs
  flat: boolean
}) {
  const key = `instance:${instance.id}:${instance.version}`
  const searching = search.trim().length > 0
  const scope = getInstanceScope()
  const active = instance.id === scope?.id && instance.version === scope.version
  const open = flat || searching || !(prefs.collapsed[key] ?? !active)
  // The current page shares this query; keep it available to reveal deep links
  // even when its instance branch was previously collapsed.
  const resources = useInstanceResources(instance, open || active)
  const { pathname } = useLocation()
  const revealed = useRef('')
  const groups = useMemo(() => {
    // An instance name can qualify a search, e.g. "机房 A 101".
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const remaining = words.filter((word) => !instance.name.toLowerCase().includes(word))
    return buildTree(resources.data ?? [], searching ? { ...prefs, group: 'node', showStorage: true, showTemplates: true } : prefs, remaining.join(' '))
  }, [resources.data, prefs, search, searching, instance.name])
  useEffect(() => {
    const revealKey = `${pathname}:${prefs.group}:${prefs.view}`
    if (!active || !resources.data || searching || revealed.current === revealKey) return
    const groups = buildTree(resources.data, { ...prefs, guestType: 'all', showStorage: true, showTemplates: true })
    const selected = groups.find((g) => g.guests.some((guest) => matchesPath(pathname, guestPath(guest))) || g.storages.some((storage) => matchesPath(pathname, storagePath(storage.node, storage.storage))) || (g.node && matchesPath(pathname, nodePath(g.node.node))))
    revealed.current = revealKey
    if (!selected) return
    const guest = selected.guests.find((g) => matchesPath(pathname, guestPath(g)))
    const storage = selected.storages.find((s) => matchesPath(pathname, storagePath(s.node, s.storage)))
    const groupKey = `${key}/${selected.key}`
    setPrefs((previous) => ({
      collapsed: { ...previous.collapsed, [key]: false, [groupKey]: false, ...(guest?.template === 1 ? { [`${groupKey}/templates`]: false } : {}), ...(storage ? { [`${groupKey}/storage`]: false } : {}) },
      ...((guest && previousTypeMismatch(prefs.guestType, guest.type)) || (storage && prefs.guestType !== 'all') ? { guestType: 'all' as const } : {}),
    }))
  }, [active, resources.data, searching, pathname, key, prefs, setPrefs])
  const error = isPveApiError(resources.error) && resources.error.status === 403 ? '权限不足' : '连接异常'
  if (searching && instance.hasCredential && resources.data && !resources.isError && groups.length === 0) return null
  const contents = <>
    {!instance.hasCredential ? <li className="px-3 py-2 text-xs"><a href="/instances" className="text-brand-strong">配置登录凭据</a></li>
      : resources.isPending ? <li data-tree-loading role="status" className="px-3 py-2 text-xs text-muted-foreground">正在连接…</li>
      : <>
        {resources.isError && <li className="px-3 py-2 text-xs text-destructive"><button type="button" onClick={() => void resources.refetch()}>{error}，点击重试</button></li>}
        {groups.map((group) => {
          const groupKey = `${key}/${group.key}`
          const expanded = searching || !prefs.collapsed[groupKey]
          return <GroupItem key={group.key} group={group} groupKey={groupKey} prefs={prefs} searching={searching} open={expanded} setPrefs={setPrefs} />
        })}
        {!resources.isError && groups.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">{searching ? '没有匹配的资源' : '没有资源'}</li>}
      </>}
  </>
  if (flat) return <TreeInstance.Provider value={instance}>{contents}</TreeInstance.Provider>
  return (
    <TreeInstance.Provider value={instance}>
      <li role="treeitem" aria-expanded={open} aria-label={`实例 ${instance.name}`}>
        <div className="flex items-center">
          <button type="button" aria-label={`${open ? '折叠' : '展开'}实例 ${instance.name}`} onClick={() => setPrefs((p) => ({ collapsed: { ...p.collapsed, [key]: open } }))}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          </button>
          <a href={instance.hasCredential ? instanceUrl(instance) : '/instances'} title={instance.name}
            className={cn(rowClass({ isActive: active }), 'flex-1 font-medium')}>
            <Server className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{instance.name}</span>
            {active && <span className="shrink-0 text-[10px] font-normal text-brand-strong">当前</span>}
            <StatusDot status={resources.isError ? 'error' : resources.data ? 'online' : 'unknown'} size="sm" pulse={false} />
          </a>
        </div>
        {open && <ul role="group" className="mt-0.5 ml-3 space-y-1 border-l border-sidebar-border pl-2">{contents}</ul>}
      </li>
    </TreeInstance.Provider>
  )
}

function previousTypeMismatch(filter: TreeGuestType, type: string) { return filter !== 'all' && filter !== type }

/** Cross-instance links load a new document to keep requests and consoles pinned. */
function ResourceLink({ to, children, className, title, ariaLabel, end }: {
  to: string
  children: ReactNode
  className?: string | ((state: { isActive: boolean }) => string)
  title?: string
  ariaLabel?: string
  end?: boolean
}) {
  const instance = useContext(TreeInstance)!
  const scope = getInstanceScope()
  if (instance.id === scope?.id && instance.version === scope.version) {
    return <NavLink to={to} className={className} title={title} aria-label={ariaLabel} end={end}>{children}</NavLink>
  }
  return <a href={instanceUrl(instance, to)} className={typeof className === 'function' ? className({ isActive: false }) : className} title={title} aria-label={ariaLabel}>{children}</a>
}

function GroupItem({ group, groupKey, prefs, searching, open, setPrefs }: { group: TreeGroup; groupKey: string; prefs: TreePrefs; searching: boolean; open: boolean; setPrefs: UpdatePrefs }) {
  const guests = group.guests.filter((g) => g.template !== 1)
  const templates = group.guests.filter((g) => g.template === 1)
  const count = guests.length
  return (
    <li role="treeitem" aria-expanded={open} aria-label={group.label}>
      <div className="flex items-center">
        <button
          type="button"
          aria-label={open ? `折叠 ${group.label}` : `展开 ${group.label}`}
          onClick={() => setPrefs((p) => ({ collapsed: { ...p.collapsed, [groupKey]: open } }))}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </button>
        <GroupLabel group={group} count={count} />
      </div>
      {open && (
        <ul role="group" className="mt-0.5 mb-2 ml-3 space-y-0.5 border-l border-sidebar-border pl-5">
          {guests.map((g) => (
            <li key={`${group.key}/${g.id}`} role="treeitem">
              <GuestRow guest={g} showNode={group.kind !== 'node'} />
            </li>
          ))}
          {templates.length > 0 && <ResourceSection label="模板" icon={PanelsTopLeft} count={templates.length} sectionKey={`${groupKey}/templates`} prefs={prefs} searching={searching} setPrefs={setPrefs}>
            {templates.map((g) => <li key={g.id} role="treeitem"><GuestRow guest={g} showNode={group.kind !== 'node'} /></li>)}
          </ResourceSection>}
          {group.storages.length > 0 && <ResourceSection label="存储" icon={Database} count={group.storages.length} sectionKey={`${groupKey}/storage`} prefs={prefs} searching={searching} setPrefs={setPrefs}>
          {group.storages.map((s) => (
            <li key={`${group.key}/${s.id}`} role="treeitem">
              <StorageRow storage={s} showNode={group.kind !== 'node'} />
            </li>
          ))}
          </ResourceSection>}
          {count === 0 && !templates.length && !group.storages.length && (
            <li className="px-2 py-1 text-xs text-muted-foreground">{group.kind === 'node' ? '没有客户机' : '没有成员'}</li>
          )}
        </ul>
      )}
    </li>
  )
}

function ResourceSection({ label, icon: Icon, count, sectionKey, prefs, searching, setPrefs, children }: {
  label: string; icon: typeof Database; count: number; sectionKey: string; prefs: TreePrefs; searching: boolean; setPrefs: UpdatePrefs; children: ReactNode
}) {
  const open = searching || prefs.collapsed[sectionKey] === false
  return <li role="treeitem" aria-label={label} aria-expanded={open} className="mt-1">
    <button type="button" onClick={() => setPrefs((p) => ({ collapsed: { ...p.collapsed, [sectionKey]: open } }))} aria-label={`${open ? '折叠' : '展开'}${label}`} aria-expanded={open} className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs text-muted-foreground outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring">
      <Icon className="size-3.5 shrink-0" /><span>{label}</span><span className="ml-auto tabular">{count}</span><ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
    </button>
    {open && <ul role="group" className="ml-3 space-y-0.5 border-l border-sidebar-border/70 pl-2">{children}</ul>}
  </li>
}

function GroupLabel({ group, count }: { group: TreeGroup; count: number }) {
  const style = useTagStyle(useContext(TreeInstance))
  const cls = (s: { isActive: boolean }) => cn(rowClass(s), 'flex-1 font-medium')
  const badge = <span className="ml-auto text-[11px] font-normal text-muted-foreground tabular">{count}</span>
  switch (group.kind) {
    case 'node':
      return (
        <ResourceLink to={nodePath(group.label)} className={(s) => cn(cls(s), 'font-semibold text-foreground')} end={false} title={`节点 · ${group.label} · ${statusLabel(group.node?.status)}`}>
          <ResourceIcon type="node" className="size-4 text-foreground/80" />
          <span className="min-w-0 flex-1 truncate">{group.label}</span>
          {badge}
          <StatusDot status={group.node?.status} size="sm" pulse={false} />
        </ResourceLink>
      )
    case 'pool':
      return (
        <ResourceLink to={poolPath(group.label)} className={cls}>
          <ResourceIcon type="pool" className="size-3.5" />
          <span className="truncate">{group.label}</span>
          {badge}
        </ResourceLink>
      )
    case 'tag':
      return (
        <ResourceLink to={`/?tag=${encodeURIComponent(group.label)}`} className={cn(rowClass({ isActive: false }), 'flex-1')}>
          <TagChip tag={group.label} tagStyle={style} />
          {badge}
        </ResourceLink>
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

// Memoized: the 5 s resource poll changes cpu/mem of every running guest,
// which the tree does not show.
const GuestRow = memo(function GuestRow({ guest: g, showNode }: { guest: GuestResource; showNode: boolean }) {
  const style = useTagStyle(useContext(TreeInstance))
  const tags = orderTags(splitTags(g.tags), style)
  const tagSummary = tags.length ? `标签：${tags.join('、')}` : undefined
  const template = g.template === 1
  const title = [
    `${GUEST_TYPE_LABEL[g.type]}${template ? '模板' : ''}`,
    `${g.vmid} · ${guestName(g)}`,
    g.node,
    !template && statusLabel(g.status),
    tagSummary,
  ].filter(Boolean).join(' · ')
  return (
    <ResourceLink to={guestPath(g)} className={(s) => cn(rowClass(s), showNode && 'h-10')} title={title} ariaLabel={`${GUEST_TYPE_LABEL[g.type]}${template ? '模板' : ''} ${g.vmid} ${guestName(g)} ${template ? '' : statusLabel(g.status)}`}>
      <ResourceIcon type={g.type} template={template} className="size-3.5 text-foreground/80" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate leading-4">{guestName(g)}</span>
        {showNode && <span className="truncate text-[11px] leading-3.5 text-muted-foreground">{g.node}</span>}
      </span>
      {tags.length > 0 && <ResourceTags tags={tags} style={style} />}
      <span className="min-w-8 shrink-0 text-right text-[11px] text-muted-foreground tabular">{g.vmid}</span>
      <span className="flex h-4 w-2 shrink-0 items-center justify-end">
        {!template && <StatusDot status={g.status} size="sm" pulse={false} />}
      </span>
    </ResourceLink>
  )
}, (a, b) => a.showNode === b.showNode && sameTreeGuest(a.guest, b.guest))

function ResourceTags({ tags, style }: { tags: string[]; style: TagStyle }) {
  const [hoveredTag, setHoveredTag] = useState<string>()
  const summary = `标签：${tags.join('、')}`
  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span
          className="flex shrink-0 items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={0}
          aria-label={summary}
          // Empty titles suppress both the row's inherited title and native tag tooltips.
          title=""
          onFocus={() => setHoveredTag(undefined)}
          onPointerMove={(event) => setHoveredTag((event.target as HTMLElement).closest<HTMLElement>('[data-resource-tag]')?.dataset.resourceTag)}
        >
          <span className="flex items-center gap-0.5">
            {tags.slice(0, 3).map((tag) => (
              <TagChip key={tag} tag={tag} shape="dense" tagStyle={style} title="" data-resource-tag={tag} className="h-2.5 w-1 rounded-[1px]" />
            ))}
          </span>
        </span>
      </HoverCardTrigger>
      <HoverCardContent role="tooltip" side="right" align="center" sideOffset={8} collisionPadding={12} className="w-auto max-w-72 px-3 py-2 text-xs wrap-anywhere" onClick={(event) => event.stopPropagation()}>
        {hoveredTag ? `标签：${hoveredTag}` : summary}
      </HoverCardContent>
    </HoverCard>
  )
}

function StorageRow({ storage: s, showNode }: { storage: StorageResource; showNode: boolean }) {
  return (
    <ResourceLink to={storagePath(s.node, s.storage)} className={rowClass} title={`存储 · ${s.storage} · ${s.node} · ${statusLabel(s.status)}`}>
      <ResourceIcon type="storage" className="size-4" />
      <span className={cn('min-w-0 flex-1 truncate', s.status !== 'available' && 'text-muted-foreground')}>{s.storage}</span>
      {showNode && <span className="truncate text-[11px] text-muted-foreground">{s.node}</span>}
      {s.status !== 'available' && <StatusDot status={s.status} size="sm" pulse={false} />}
    </ResourceLink>
  )
}
