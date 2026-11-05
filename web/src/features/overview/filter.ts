// Guest list filters of the overview (kept in the URL so links like
// "/?type=qemu&filter=running" or "/?type=lxc&filter=template" from the
// datacenter summary work). Status partitions the guests the way the
// datacenter counts them: running, stopped (not running, no template) and
// templates; the type filter matches VMs or CTs including their templates.

import { hasAllTags, splitTags } from '@/lib/tags'

export type GuestFilter = 'all' | 'running' | 'stopped' | 'template'
export type GuestTypeFilter = 'all' | 'qemu' | 'lxc'
export type GuestSort = 'vmid' | 'name' | 'cpu' | 'mem' | 'status' | 'node' | 'tags'
export type GuestSortDirection = 'asc' | 'desc'

export const FILTERS: { value: GuestFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '运行中' },
  { value: 'stopped', label: '已停止' },
  { value: 'template', label: '模板' },
]

export const TYPE_FILTERS: { value: GuestTypeFilter; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: 'qemu', label: '虚拟机' },
  { value: 'lxc', label: '容器' },
]

export const SORTS: { value: GuestSort; label: string }[] = [
  { value: 'vmid', label: 'VMID' },
  { value: 'name', label: '名称' },
  { value: 'status', label: '状态' },
  { value: 'node', label: '节点' },
  { value: 'tags', label: '标签' },
  { value: 'cpu', label: 'CPU' },
  { value: 'mem', label: '内存' },
]

/** "stopped" means every non-template guest that is not running (also paused); templates are their own group. */
export function filterGuests<T extends { status: string; template?: number | undefined }>(guests: T[], filter: GuestFilter): T[] {
  if (filter === 'running') return guests.filter((g) => g.status === 'running' && g.template !== 1)
  if (filter === 'stopped') return guests.filter((g) => g.status !== 'running' && g.template !== 1)
  if (filter === 'template') return guests.filter((g) => g.template === 1)
  return guests
}

export interface GuestQuery {
  status: GuestFilter
  type: GuestTypeFilter
  /** All of these tags (lower case). */
  tags: string[]
  node: string | null
  pool: string | null
  /** Free text: name, VMID, node, tags. */
  q: string
  sort: GuestSort
  /** Omitted in older links: usage sorts descending, other columns ascending. */
  direction?: GuestSortDirection
}

export function defaultGuestSortDirection(sort: GuestSort): GuestSortDirection {
  return sort === 'cpu' || sort === 'mem' ? 'desc' : 'asc'
}

export function guestSortDirection(query: Pick<GuestQuery, 'sort' | 'direction'>): GuestSortDirection {
  return query.direction ?? defaultGuestSortDirection(query.sort)
}

export const DEFAULT_QUERY: GuestQuery = { status: 'all', type: 'all', tags: [], node: null, pool: null, q: '', sort: 'vmid' }

function oneOf<T extends string>(v: string | null, values: readonly { value: T }[], fallback: T): T {
  return values.some((x) => x.value === v) ? (v as T) : fallback
}

export function readGuestQuery(params: URLSearchParams): GuestQuery {
  // Older links used type=template for "all templates".
  const legacyTemplate = params.get('type') === 'template'
  const direction = params.get('dir')
  return {
    status: legacyTemplate ? 'template' : oneOf(params.get('filter'), FILTERS, 'all'),
    type: oneOf(params.get('type'), TYPE_FILTERS, 'all'),
    tags: params.getAll('tag').flatMap((t) => splitTags(t)).map((t) => t.toLowerCase()),
    node: params.get('node') || null,
    pool: params.get('pool') || null,
    q: params.get('q') ?? '',
    sort: oneOf(params.get('sort'), SORTS, 'vmid'),
    ...(direction === 'asc' || direction === 'desc' ? { direction } : {}),
  }
}

/** Write a query back into URL params (defaults are left out to keep links short). */
export function writeGuestQuery(params: URLSearchParams, query: GuestQuery): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const k of ['filter', 'type', 'tag', 'node', 'pool', 'q', 'sort', 'dir']) next.delete(k)
  if (query.status !== 'all') next.set('filter', query.status)
  if (query.type !== 'all') next.set('type', query.type)
  for (const t of query.tags) next.append('tag', t)
  if (query.node) next.set('node', query.node)
  if (query.pool) next.set('pool', query.pool)
  if (query.q.trim()) next.set('q', query.q)
  if (query.sort !== 'vmid') next.set('sort', query.sort)
  if (guestSortDirection(query) !== defaultGuestSortDirection(query.sort)) next.set('dir', guestSortDirection(query))
  return next
}

/** Number of narrowing filters besides status (for the "筛选" badge). */
export function activeFilterCount(q: GuestQuery): number {
  return (q.type !== 'all' ? 1 : 0) + (q.node ? 1 : 0) + (q.pool ? 1 : 0) + (q.sort !== 'vmid' || guestSortDirection(q) !== 'asc' ? 1 : 0)
}

interface FilterableGuest {
  vmid: number
  name?: string | undefined
  type: string
  status: string
  node: string
  pool?: string | undefined
  tags?: string | undefined
  template?: number | undefined
  cpu?: number | undefined
  mem?: number | undefined
}

const STATUS_RANK: Record<string, number> = { running: 0, paused: 1, suspended: 1, prelaunch: 1, stopped: 2 }

/** Everything except the status filter (so the status counts reflect the other filters). */
export function narrowGuests<T extends FilterableGuest>(guests: readonly T[], q: GuestQuery): T[] {
  const text = q.q.trim().toLowerCase()
  return guests.filter((g) => {
    if (q.type !== 'all' && g.type !== q.type) return false
    if (q.node && g.node !== q.node) return false
    if (q.pool && g.pool !== q.pool) return false
    if (!hasAllTags(g, q.tags)) return false
    if (text) {
      const hay = `${g.vmid} ${g.name ?? ''} ${g.node} ${g.pool ?? ''} ${splitTags(g.tags).join(' ')}`.toLowerCase()
      if (!text.split(/\s+/).every((w) => hay.includes(w))) return false
    }
    return true
  })
}

export function sortGuests<T extends FilterableGuest>(guests: readonly T[], sort: GuestSort, direction = defaultGuestSortDirection(sort)): T[] {
  const byVmid = (a: T, b: T) => a.vmid - b.vmid
  const list = [...guests]
  const factor = direction === 'asc' ? 1 : -1
  const compareText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  const byText = (value: (g: T) => string) => list.sort((a, b) => {
    const x = value(a), y = value(b)
    // Empty values remain at the end in either direction.
    if (!x || !y) return x ? -1 : y ? 1 : byVmid(a, b)
    return factor * compareText(x, y) || byVmid(a, b)
  })
  switch (sort) {
    case 'name':
      return byText((g) => g.name || `${g.type === 'lxc' ? 'CT' : 'VM'} ${g.vmid}`)
    case 'node':
      return byText((g) => g.node)
    case 'tags':
      return byText((g) => splitTags(g.tags).map((t) => t.toLowerCase()).sort(compareText).join('\0'))
    case 'status':
      return list.sort((a, b) => factor * ((a.template === 1 ? 4 : STATUS_RANK[a.status] ?? 3) - (b.template === 1 ? 4 : STATUS_RANK[b.status] ?? 3)) || byVmid(a, b))
    case 'cpu':
    case 'mem':
      return list.sort((a, b) => {
        const metric = (g: T) => g.status === 'running' && g.template !== 1 && typeof g[sort] === 'number' && Number.isFinite(g[sort]) && g[sort]! >= 0 ? g[sort]! : null
        const x = metric(a), y = metric(b)
        if (x === null || y === null) return x === null ? y === null ? byVmid(a, b) : 1 : -1
        return factor * (x - y) || byVmid(a, b)
      })
    default:
      return list.sort((a, b) => factor * byVmid(a, b))
  }
}

/** Full pipeline: narrow, then status, then sort. */
export function applyGuestQuery<T extends FilterableGuest>(guests: readonly T[], q: GuestQuery): T[] {
  return sortGuests(filterGuests(narrowGuests(guests, q), q.status), q.sort, guestSortDirection(q))
}
