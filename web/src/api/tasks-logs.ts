// Task history, running tasks and the cluster log (area tasks-logs).
//
// Endpoints:
//   GET /cluster/tasks          recent tasks of every node (no filters, running ones included)
//   GET /nodes/{node}/tasks     full history of one node: start/limit paging with `total`,
//                               typefilter, statusfilter, userfilter, vmid, since/until, source
//   GET /cluster/log            pmxcfs cluster log (max)
//
// Single-task status, log and stop live in ./tasks (shared contracts).

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { get, p, requestEnvelope, type Params } from './client'
import { POLL, queryKeys, useTasks } from './queries'
import { taskState, type TaskState } from './tasks'
import type { ClusterTask } from './types'

// ------------------------------------------------------------------ types

/** GET /nodes/{node}/tasks entry. Active tasks (source=active|all) carry status "RUNNING". */
export interface NodeTask extends ClusterTask {
  pid?: number
  pstart?: number
}

/** GET /cluster/log entry. */
export interface ClusterLogEntry {
  /** "<uid>:<node>", unique. */
  id: string
  uid: number | string
  node: string
  pid: number
  /** syslog priority 0 (emerg) … 7 (debug). */
  pri: number
  /** Service, e.g. "pvedaemon", "qm", "vzdump". */
  tag: string
  /** Unix seconds. */
  time: number
  user: string
  msg: string
}

// ---------------------------------------------------------------- filters

/** Status choices of the task filters. */
export type TaskStatusFilter = TaskState

export const TASK_STATUS_FILTERS: readonly { value: TaskStatusFilter; label: string }[] = [
  { value: 'running', label: '运行中' },
  { value: 'error', label: '失败' },
  { value: 'warning', label: '警告' },
  { value: 'ok', label: '成功' },
]

/** Relative time ranges offered as presets. */
export type TaskTimeRange = '1d' | '3d' | '7d' | '30d'

export const TASK_TIME_RANGES: readonly { value: TaskTimeRange; label: string; days: number }[] = [
  { value: '1d', label: '24 小时', days: 1 },
  { value: '3d', label: '3 天', days: 3 },
  { value: '7d', label: '7 天', days: 7 },
  { value: '30d', label: '30 天', days: 30 },
]

export interface TaskFilters {
  /** Node history (/nodes/{node}/tasks); unset = recent tasks of the cluster. */
  node?: string
  /** Exact task type, e.g. "qmstart". */
  type?: string
  status?: TaskStatusFilter
  /** Case-insensitive substring of the user ("root" matches root@pam), like PVE's userfilter. */
  user?: string
  vmid?: number
  /** Relative range; wins over from/to. */
  range?: TaskTimeRange
  /** Custom range: local dates "YYYY-MM-DD", both inclusive. */
  from?: string
  to?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function localDate(date: string): Date | null {
  if (!DATE_RE.test(date)) return null
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const out = new Date(y, m - 1, d)
  // Date rolls 2026-13-45 over into 2027; reject instead.
  return out.getFullYear() === y && out.getMonth() === m - 1 && out.getDate() === d ? out : null
}

/** "YYYY-MM-DD" of a Date in local time (for <input type="date">). */
export function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The time filter as Unix seconds (since inclusive, until inclusive). */
export function resolveTimeRange(f: Pick<TaskFilters, 'range' | 'from' | 'to'>, nowMs = Date.now()): { since?: number; until?: number } {
  if (f.range) {
    const days = TASK_TIME_RANGES.find((r) => r.value === f.range)?.days
    return days ? { since: Math.floor(nowMs / 1000) - days * 86400 } : {}
  }
  const out: { since?: number; until?: number } = {}
  const from = f.from ? localDate(f.from) : null
  const to = f.to ? localDate(f.to) : null
  if (from) out.since = Math.floor(from.getTime() / 1000)
  if (to) {
    // End of that day: PVE drops tasks with starttime > until.
    const next = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1)
    out.until = Math.floor(next.getTime() / 1000) - 1
  }
  return out
}

const FILTER_KEYS = ['node', 'type', 'status', 'user', 'vmid', 'range', 'from', 'to'] as const

/** Read filters from the URL (?status=error&type=qmstart&range=7d…); invalid values are dropped. */
export function filtersFromSearch(search: URLSearchParams): TaskFilters {
  const f: TaskFilters = {}
  const node = search.get('node')?.trim()
  if (node) f.node = node
  const type = search.get('type')?.trim()
  if (type) f.type = type
  const status = search.get('status')
  if (TASK_STATUS_FILTERS.some((s) => s.value === status)) f.status = status as TaskStatusFilter
  const user = search.get('user')?.trim()
  if (user) f.user = user
  const vmid = Number(search.get('vmid'))
  if (Number.isInteger(vmid) && vmid > 0) f.vmid = vmid
  const range = search.get('range')
  if (TASK_TIME_RANGES.some((r) => r.value === range)) f.range = range as TaskTimeRange
  else {
    const from = search.get('from')
    const to = search.get('to')
    if (from && localDate(from)) f.from = from
    if (to && localDate(to)) f.to = to
  }
  return f
}

/** Write filters into URL params, keeping unrelated params of `base`. */
export function filtersToSearch(f: TaskFilters, base?: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(base)
  for (const k of FILTER_KEYS) out.delete(k)
  if (f.node) out.set('node', f.node)
  if (f.type) out.set('type', f.type)
  if (f.status) out.set('status', f.status)
  if (f.user) out.set('user', f.user)
  if (f.vmid) out.set('vmid', String(f.vmid))
  if (f.range) out.set('range', f.range)
  else {
    if (f.from) out.set('from', f.from)
    if (f.to) out.set('to', f.to)
  }
  return out
}

/** How many filters besides status and node are set (badge on the filter button). */
export function countExtraFilters(f: TaskFilters): number {
  return [f.type, f.user, f.vmid, f.range || f.from || f.to].filter(Boolean).length
}

/**
 * Query parameters for GET /nodes/{node}/tasks.
 * - running → source=active (only active tasks; PVE files them as status "unknown")
 * - ok / warning / error → statusfilter (archived tasks). PVE files "unexpected
 *   status" as "unknown"; this UI counts it as failed, so error asks for both.
 * - no status → source=all, so running tasks are listed on top of the history
 */
export function nodeTaskParams(f: TaskFilters, start: number, limit: number, nowMs = Date.now()): Params {
  const { since, until } = resolveTimeRange(f, nowMs)
  return {
    start,
    limit,
    source: f.status === 'running' ? 'active' : f.status ? 'archive' : 'all',
    statusfilter: f.status === 'error' ? 'error,unknown' : f.status && f.status !== 'running' ? f.status : undefined,
    typefilter: f.type,
    userfilter: f.user,
    vmid: f.vmid,
    since,
    until,
  }
}

/** Client-side version of the node filters, for /cluster/tasks (which has none). */
export function matchesTaskFilters(task: ClusterTask, f: TaskFilters, nowMs = Date.now()): boolean {
  if (f.node && task.node !== f.node) return false
  if (f.type && task.type !== f.type) return false
  if (f.user && !task.user.toLowerCase().includes(f.user.toLowerCase())) return false
  if (f.vmid && task.id !== String(f.vmid)) return false
  const { since, until } = resolveTimeRange(f, nowMs)
  if (since !== undefined && task.starttime < since) return false
  if (until !== undefined && task.starttime > until) return false
  if (f.status && taskState(task) !== f.status) return false
  return true
}

// ------------------------------------------------------------- requests

/** Active tasks come back as status "RUNNING"; drop it so they look like /cluster/tasks entries. */
export function normalizeNodeTask(task: NodeTask): NodeTask {
  if (task.status === 'RUNNING') {
    const rest = { ...task }
    delete rest.status
    return rest
  }
  return task
}

export async function fetchNodeTasks(
  node: string,
  f: TaskFilters,
  start: number,
  limit: number,
  signal?: AbortSignal,
): Promise<{ tasks: NodeTask[]; total: number }> {
  const env = await requestEnvelope<NodeTask[]>('GET', p`/nodes/${node}/tasks`, nodeTaskParams(f, start, limit), { signal })
  const tasks = (env.data ?? []).map(normalizeNodeTask)
  return { tasks, total: typeof env.total === 'number' ? env.total : start + tasks.length }
}

export const tasksLogsKeys = {
  history: (node: string, f: TaskFilters) =>
    [...queryKeys.node(node), 'tasks', 'history', { ...f, node: undefined }] as const,
  clusterLog: (max: number) => ['pve', 'cluster', 'log', max] as const,
}

export const TASK_PAGE_SIZE = 50

/** Poll interval of a task list while it shows running tasks. */
const FAST_POLL_MS = 3_000

const isRunning = (t: ClusterTask) => taskState(t) === 'running'

export interface TaskHistory {
  tasks: ClusterTask[]
  /** Server total (node history); undefined for the cluster list. */
  total: number | undefined
  source: 'node' | 'cluster'
  isPending: boolean
  isError: boolean
  error: Error | null
  isFetching: boolean
  hasMore: boolean
  isFetchingMore: boolean
  loadMore: () => void
  refetch: () => void
}

/**
 * Rows of the node history in display order: the polled first page, then
 * `retained` (rows of earlier first pages that newer tasks pushed down;
 * running ones are left out, their state would go stale), then the older
 * pages loaded on demand. Duplicates keep the first (freshest) copy.
 */
export function mergeHistoryRows(head: readonly NodeTask[], retained: readonly NodeTask[], older: readonly NodeTask[]): NodeTask[] {
  const seen = new Set<string>()
  const out: NodeTask[] = []
  const add = (t: NodeTask) => {
    if (seen.has(t.upid)) return
    seen.add(t.upid)
    out.push(t)
  }
  head.forEach(add)
  for (const t of retained) if (!isRunning(t)) add(t)
  older.forEach(add)
  return out
}

interface OlderTasks {
  /** Node + filters these rows belong to. */
  key: string
  retained: NodeTask[]
  pages: NodeTask[]
  /** The last page came back short: nothing older is left. */
  exhausted: boolean
}

const emptyOlder = (key: string): OlderTasks => ({ key, retained: [], pages: [], exhausted: false })

interface LoadMoreState {
  key: string
  loading: boolean
  error: Error | null
}

/**
 * Node history. Only the first page is polled; "加载更多" appends older
 * pages that are not refetched (refetching every loaded page would cost one
 * request per page every few seconds). The next page starts at the number of
 * rows shown, so rows that new tasks push down overlap (deduplicated) instead
 * of leaving a gap.
 */
function useNodeTaskHistory(node: string | undefined, filters: TaskFilters, pageSize: number) {
  const queryKey = tasksLogsKeys.history(node ?? '', filters)
  const key = JSON.stringify(queryKey)
  const head = useQuery({
    queryKey: [...queryKey, 'head', pageSize],
    queryFn: ({ signal }) => fetchNodeTasks(node!, filters, 0, pageSize, signal),
    enabled: !!node,
    refetchInterval: (q) => (q.state.data?.tasks.some(isRunning) ? FAST_POLL_MS : POLL.tasks),
    placeholderData: keepPreviousData,
  })
  const [olderState, setOlder] = useState<OlderTasks>(() => emptyOlder(key))
  const [moreState, setMore] = useState<LoadMoreState>({ key, loading: false, error: null })
  // Another node or other filters: start over (state adjusted while rendering).
  if (olderState.key !== key) setOlder(emptyOlder(key))
  if (moreState.key !== key) setMore({ key, loading: false, error: null })
  const older = olderState.key === key ? olderState : emptyOlder(key)
  const more = moreState.key === key ? moreState : { key, loading: false, error: null }

  const headTasks = head.data?.tasks ?? []
  const tasks = mergeHistoryRows(headTasks, older.retained, older.pages)
  const total = head.data?.total

  const loadMore = async () => {
    if (!node || more.loading) return
    const offset = tasks.length
    // Keep what the first page shows now: newer tasks may push these rows
    // past the first page before the page below is merged in.
    const retained = mergeHistoryRows(headTasks, older.retained, [])
    setMore({ key, loading: true, error: null })
    try {
      const page = await fetchNodeTasks(node, filters, offset, pageSize)
      setOlder((prev) =>
        prev.key === key ? { key, retained, pages: [...prev.pages, ...page.tasks], exhausted: page.tasks.length < pageSize } : prev,
      )
      setMore((prev) => (prev.key === key ? { key, loading: false, error: null } : prev))
    } catch (e) {
      setMore((prev) => (prev.key === key ? { key, loading: false, error: e instanceof Error ? e : new Error(String(e)) } : prev))
    }
  }

  return {
    tasks,
    total,
    isPending: head.isPending,
    isError: head.isError || !!more.error,
    error: head.error ?? more.error,
    isFetching: head.isFetching || more.loading,
    hasMore: !older.exhausted && total !== undefined && tasks.length < total,
    isFetchingMore: more.loading,
    loadMore: () => void loadMore(),
    refetch: () => void head.refetch(),
  }
}

/**
 * Task history for the filters: node history with server-side filters and
 * paging when `filters.node` is set, otherwise the cluster's recent tasks
 * filtered here. Both refresh every 10 s, every 3 s while tasks run (the node
 * history only its first page).
 */
export function useTaskHistory(filters: TaskFilters, { pageSize = TASK_PAGE_SIZE }: { pageSize?: number } = {}): TaskHistory {
  const node = filters.node
  const history = useNodeTaskHistory(node, filters, pageSize)
  const cluster = useTasks({
    enabled: !node,
    refetchInterval: (q) => (q.state.data?.some(isRunning) ? FAST_POLL_MS : POLL.tasks),
  })

  if (node) return { ...history, source: 'node' }
  const now = Date.now()
  return {
    tasks: (cluster.data ?? []).filter((t) => matchesTaskFilters(t, filters, now)),
    total: undefined,
    source: 'cluster',
    isPending: cluster.isPending,
    isError: cluster.isError,
    error: cluster.error,
    isFetching: cluster.isFetching,
    hasMore: false,
    isFetchingMore: false,
    loadMore: () => undefined,
    refetch: () => void cluster.refetch(),
  }
}

// --------------------------------------------------------- running tasks

export interface RunningTask {
  upid: string
  node: string
  type: string
  id: string
  user: string
  starttime: number
  /** From the tracker when the task was started in this UI. */
  title?: string
  lastLine?: string
  progress?: number
}

interface TrackedLike {
  upid: string
  node: string
  title: string
  state: TaskState
  lastLine?: string
  progress?: number
}

interface UpidLike {
  node: string
  type: string
  id: string
  user: string
  starttime: number
}

/**
 * Running tasks from /cluster/tasks merged with the tasks this UI tracks.
 * The tracker is fresher (1.5 s polls vs 10 s): its running tasks are added
 * right away and its finished ones hide stale "running" cluster entries.
 */
export function mergeRunningTasks(
  cluster: readonly ClusterTask[] | undefined,
  tracked: readonly TrackedLike[],
  parse: (upid: string) => UpidLike | null,
): RunningTask[] {
  const byUpid = new Map<string, RunningTask>()
  const finished = new Set(tracked.filter((t) => t.state !== 'running').map((t) => t.upid))
  for (const t of cluster ?? []) {
    if (finished.has(t.upid) || taskState(t) !== 'running') continue
    byUpid.set(t.upid, { upid: t.upid, node: t.node, type: t.type, id: t.id, user: t.user, starttime: t.starttime })
  }
  for (const t of tracked) {
    if (t.state !== 'running') continue
    const known = byUpid.get(t.upid)
    const parsed = known ?? parse(t.upid)
    if (!parsed) continue
    byUpid.set(t.upid, {
      upid: t.upid,
      node: t.node,
      type: parsed.type,
      id: parsed.id,
      user: parsed.user,
      starttime: parsed.starttime,
      title: t.title,
      ...(t.lastLine !== undefined ? { lastLine: t.lastLine } : {}),
      ...(t.progress !== undefined ? { progress: t.progress } : {}),
    })
  }
  return [...byUpid.values()].sort((a, b) => b.starttime - a.starttime)
}

/** Recent failed tasks (exit status is an error) since `sinceSec`. */
export function recentFailures(cluster: readonly ClusterTask[] | undefined, sinceSec: number): ClusterTask[] {
  return (cluster ?? []).filter((t) => t.starttime >= sinceSec && taskState(t) === 'error')
}

// ------------------------------------------------------------ cluster log

export const LOG_MAX_OPTIONS = [50, 200, 500] as const

export function fetchClusterLog(max: number, signal?: AbortSignal): Promise<ClusterLogEntry[]> {
  return get<ClusterLogEntry[]>('/cluster/log', { max }, { signal })
}

/** Newest first; uid breaks ties within one second. */
export function sortClusterLog(entries: readonly ClusterLogEntry[]): ClusterLogEntry[] {
  return [...entries].sort((a, b) => b.time - a.time || Number(b.uid) - Number(a.uid))
}

/** Live cluster log, polled every 5 s unless paused. */
export function useClusterLog(max: number, { paused = false, enabled = true }: { paused?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: tasksLogsKeys.clusterLog(max),
    queryFn: async ({ signal }) => sortClusterLog(await fetchClusterLog(max, signal)),
    refetchInterval: paused ? false : 5_000,
    placeholderData: keepPreviousData,
    enabled,
  })
}

export type LogLevelFilter = 'all' | 'warning' | 'error'

export const LOG_LEVEL_FILTERS: readonly { value: LogLevelFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'warning', label: '警告' },
  { value: 'error', label: '错误' },
]

/** syslog priorities as the official UI names them (log_severity_hash). */
export const LOG_PRIORITY_LABEL: Record<number, string> = {
  0: '紧急',
  1: '警报',
  2: '严重',
  3: '错误',
  4: '警告',
  5: '通知',
  6: '信息',
  7: '调试',
}

export type LogTone = 'error' | 'warning' | 'notice' | 'info'

export function logTone(pri: number): LogTone {
  if (pri <= 3) return 'error'
  if (pri === 4) return 'warning'
  if (pri === 5) return 'notice'
  return 'info'
}

export function filterClusterLog(
  entries: readonly ClusterLogEntry[],
  { level = 'all', query = '', node }: { level?: LogLevelFilter; query?: string; node?: string | undefined },
): ClusterLogEntry[] {
  const q = query.trim().toLowerCase()
  const maxPri = level === 'error' ? 3 : level === 'warning' ? 4 : 7
  return entries.filter(
    (e) =>
      e.pri <= maxPri &&
      (!node || e.node === node) &&
      (!q || e.msg.toLowerCase().includes(q) || e.user.toLowerCase().includes(q) || e.tag.toLowerCase().includes(q)),
  )
}

export type LogSegment = { text: string } | { upid: string }

const UPID_IN_TEXT = /UPID:[^:\s]+:[0-9A-Fa-f]{8}:[0-9A-Fa-f]{8,9}:[0-9A-Fa-f]{8}:[^:\s]+:[^:\s]*:[^:\s]+:/g

/** Split a log message into text and UPIDs ("starting task UPID:…") so UPIDs can link to the task. */
export function splitUpids(msg: string): LogSegment[] {
  const out: LogSegment[] = []
  let last = 0
  for (const m of msg.matchAll(UPID_IN_TEXT)) {
    if (m.index > last) out.push({ text: msg.slice(last, m.index) })
    out.push({ upid: m[0] })
    last = m.index + m[0].length
  }
  if (last < msg.length) out.push({ text: msg.slice(last) })
  return out
}
