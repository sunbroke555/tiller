// Guest list filters of the overview (kept in the URL so links like
// "/?type=qemu&filter=running" from the datacenter summary work).

import { hasAllTags, splitTags } from '@/lib/tags'

export type GuestFilter = 'all' | 'running' | 'stopped'
export type GuestTypeFilter = 'all' | 'qemu' | 'lxc' | 'template'
export type GuestSort = 'vmid' | 'name' | 'cpu' | 'mem' | 'status'

export const FILTERS: { value: GuestFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '运行中' },
  { value: 'stopped', label: '已停止' },
]

export const TYPE_FILTERS: { value: GuestTypeFilter; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: 'qemu', label: '虚拟机' },
  { value: 'lxc', label: '容器' },
  { value: 'template', label: '模板' },
]

export const SORTS: { value: GuestSort; label: string }[] = [
  { value: 'vmid', label: 'VMID' },
  { value: 'name', label: '名称' },
  { value: 'status', label: '状态' },
  { value: 'cpu', label: 'CPU' },
  { value: 'mem', label: '内存' },
]

/** "stopped" means everything not running (paused, templates …). */
export function filterGuests<T extends { status: string }>(guests: T[], filter: GuestFilter): T[] {
  if (filter === 'running') return guests.filter((g) => g.status === 'running')
  if (filter === 'stopped') return guests.filter((g) => g.status !== 'running')
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
}

export const DEFAULT_QUERY: GuestQuery = { status: 'all', type: 'all', tags: [], node: null, pool: null, q: '', sort: 'vmid' }

function oneOf<T extends string>(v: string | null, values: readonly { value: T }[], fallback: T): T {
  return values.some((x) => x.value === v) ? (v as T) : fallback
}

export function readGuestQuery(params: URLSearchParams): GuestQuery {
  return {
    status: oneOf(params.get('filter'), FILTERS, 'all'),
    type: oneOf(params.get('type'), TYPE_FILTERS, 'all'),
    tags: params.getAll('tag').flatMap((t) => splitTags(t)).map((t) => t.toLowerCase()),
    node: params.get('node') || null,
    pool: params.get('pool') || null,
    q: params.get('q') ?? '',
    sort: oneOf(params.get('sort'), SORTS, 'vmid'),
  }
}

/** Write a query back into URL params (defaults are left out to keep links short). */
export function writeGuestQuery(params: URLSearchParams, query: GuestQuery): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const k of ['filter', 'type', 'tag', 'node', 'pool', 'q', 'sort']) next.delete(k)
  if (query.status !== 'all') next.set('filter', query.status)
  if (query.type !== 'all') next.set('type', query.type)
  for (const t of query.tags) next.append('tag', t)
  if (query.node) next.set('node', query.node)
  if (query.pool) next.set('pool', query.pool)
  if (query.q.trim()) next.set('q', query.q)
  if (query.sort !== 'vmid') next.set('sort', query.sort)
  return next
}

/** Number of narrowing filters besides status (for the "筛选" badge). */
export function activeFilterCount(q: GuestQuery): number {
  return (q.type !== 'all' ? 1 : 0) + (q.node ? 1 : 0) + (q.pool ? 1 : 0) + (q.sort !== 'vmid' ? 1 : 0)
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
    if (q.type === 'template' ? g.template !== 1 : q.type !== 'all' && (g.type !== q.type || g.template === 1)) return false
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

export function sortGuests<T extends FilterableGuest>(guests: readonly T[], sort: GuestSort): T[] {
  const byVmid = (a: T, b: T) => a.vmid - b.vmid
  const list = [...guests]
  switch (sort) {
    case 'name':
      return list.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true }) || byVmid(a, b))
    case 'status':
      return list.sort((a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) || byVmid(a, b))
    case 'cpu':
      return list.sort((a, b) => (b.status === 'running' ? (b.cpu ?? 0) : -1) - (a.status === 'running' ? (a.cpu ?? 0) : -1) || byVmid(a, b))
    case 'mem':
      return list.sort((a, b) => (b.status === 'running' ? (b.mem ?? 0) : -1) - (a.status === 'running' ? (a.mem ?? 0) : -1) || byVmid(a, b))
    default:
      return list.sort(byVmid)
  }
}

/** Full pipeline: narrow, then status, then sort. */
export function applyGuestQuery<T extends FilterableGuest>(guests: readonly T[], q: GuestQuery): T[] {
  return sortGuests(filterGuests(narrowGuests(guests, q), q.status), q.sort)
}
