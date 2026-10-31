// PVE tasks (UPIDs): parsing, status, incremental log and stop.
//
// Every long-running PVE call (start, stop, clone, backup, migrate…) returns a
// UPID string right away and runs as a task on its node:
//
//   UPID:pve-lab:00000A0F:00003849:6AE6339E:qmtemplate:9000:root@pam:
//        node    pid      pstart   starttime type       id   user
//
// Action buttons should not use these directly but `runTask` from
// '@/components/tasks/tracker', which tracks the task in the bottom toast,
// opens the live log on tap and refreshes queries when it ends.

import { useEffect, useRef, useState } from 'react'
import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

import { del, get, p, requestEnvelope } from './client'
import type { TaskStatus } from './types'

// ------------------------------------------------------------------ UPID

export interface ParsedUpid {
  upid: string
  node: string
  pid: number
  pstart: number
  /** Unix seconds. */
  starttime: number
  /** Task type, e.g. "qmstart", "vzdump", "download". */
  type: string
  /** Task subject, usually a VMID or storage; may be empty. */
  id: string
  /** "root@pam" or "user@realm!token". */
  user: string
}

const UPID_RE = /^UPID:([^:]+):([0-9A-Fa-f]{8}):([0-9A-Fa-f]{8,9}):([0-9A-Fa-f]{8}):([^:]+):(.*):([^:]+):$/

/** Parse a UPID; null if the string is not one. */
export function parseUpid(upid: string): ParsedUpid | null {
  const m = UPID_RE.exec(upid)
  if (!m) return null
  return {
    upid,
    node: m[1]!,
    pid: parseInt(m[2]!, 16),
    pstart: parseInt(m[3]!, 16),
    starttime: parseInt(m[4]!, 16),
    type: m[5]!,
    id: m[6]!,
    user: m[7]!,
  }
}

export function isUpid(value: unknown): value is string {
  return typeof value === 'string' && parseUpid(value) !== null
}

// ---------------------------------------------------------------- status

/** Simplified task outcome for icons and colours. */
export type TaskState = 'running' | 'ok' | 'warning' | 'error'

/**
 * Classify an exit status: "OK" → ok, "WARNINGS: 2" → warning, anything else
 * (an error message, "unexpected status", "interrupted by signal") → error.
 */
export function exitStatusState(exitstatus: string | null | undefined): Exclude<TaskState, 'running'> {
  if (!exitstatus) return 'error'
  if (exitstatus === 'OK') return 'ok'
  if (/^WARNINGS?:/i.test(exitstatus)) return 'warning'
  return 'error'
}

/**
 * State of a task from either shape PVE returns:
 * - /nodes/{node}/tasks/{upid}/status: { status: 'running' | 'stopped', exitstatus }
 * - /cluster/tasks and /nodes/{node}/tasks: { status?: exitstatus } (missing while running;
 *   the node list reports "running" explicitly with `source=all`)
 */
export function taskState(task: { status?: string | null; exitstatus?: string | null; endtime?: number | null }): TaskState {
  if (task.status === 'running') return 'running'
  if (task.status === 'stopped') return exitStatusState(task.exitstatus)
  if (!task.status) return task.endtime ? 'error' : 'running'
  return exitStatusState(task.status)
}

/** Short Chinese label for a state. */
export const TASK_STATE_LABEL: Record<TaskState, string> = {
  running: '运行中',
  ok: '完成',
  warning: '有警告',
  error: '失败',
}

// ------------------------------------------------------------- requests

export interface TaskLogLine {
  /** 1-based line number. */
  n: number
  t: string
}

export function fetchTaskStatus(node: string, upid: string, signal?: AbortSignal): Promise<TaskStatus> {
  return get<TaskStatus>(p`/nodes/${node}/tasks/${upid}/status`, undefined, { signal })
}

/**
 * One page of a task log. `start` is the number of lines already read
 * (0-based offset); `total` is the current line count of the log.
 */
export async function fetchTaskLog(
  node: string,
  upid: string,
  start = 0,
  limit = 1000,
  signal?: AbortSignal,
): Promise<{ lines: TaskLogLine[]; total: number }> {
  const env = await requestEnvelope<TaskLogLine[] | null>('GET', p`/nodes/${node}/tasks/${upid}/log`, { start, limit }, { signal })
  const data = env.data ?? []
  // PVE answers an empty (or not yet created) log with one fake line
  // {n: 1, t: "no content"} / "unable to open file - …" and total 1.
  // Treat it as empty, or the real first line would be skipped later.
  if (start === 0 && data.length === 1 && data[0]?.n === 1 && isPlaceholderLine(data[0].t)) {
    return { lines: [], total: 0 }
  }
  const lines = data.filter((l) => typeof l?.n === 'number' && l.n > start)
  return { lines, total: typeof env.total === 'number' ? env.total : start + lines.length }
}

function isPlaceholderLine(text: string | undefined): boolean {
  return text === 'no content' || (text ?? '').startsWith('unable to open file - ')
}

/** Stop a running task (DELETE /nodes/{node}/tasks/{upid}). */
export function stopTask(node: string, upid: string): Promise<null> {
  return del(p`/nodes/${node}/tasks/${upid}`)
}

/** Whole log as text (for download / copy). */
export async function fetchFullTaskLog(node: string, upid: string): Promise<string> {
  const out: string[] = []
  let start = 0
  for (;;) {
    const { lines } = await fetchTaskLog(node, upid, start, 5000)
    for (const l of lines) out.push(l.t)
    if (lines.length < 5000) break
    start = lines[lines.length - 1]!.n
  }
  return out.join('\n')
}

/**
 * Progress hint from a log line: the last "NN%" or "NN.N%" in it, as 0..1.
 * vzdump ("progress 45% …"), disk moves ("transferred … (45.12%)") and
 * downloads all print one.
 */
export function parseTaskProgress(line: string | null | undefined): number | null {
  if (!line) return null
  const matches = [...line.matchAll(/(\d{1,3}(?:\.\d+)?)\s?%/g)]
  const last = matches[matches.length - 1]
  if (!last) return null
  const v = Number(last[1])
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v / 100 : null
}

// ---------------------------------------------------------------- hooks

export const taskKeys = {
  /** Same prefix as node data so node-scoped invalidation includes tasks. */
  status: (node: string, upid: string) => ['pve', 'nodes', node, 'tasks', upid, 'status'] as const,
}

/** Poll interval while a task runs. */
export const TASK_POLL_MS = 1_500

type StatusQueryOpts = Omit<UseQueryOptions<TaskStatus, Error>, 'queryKey' | 'queryFn'>

/**
 * Status of one task, polled every 1.5 s while it runs and then left alone.
 * Pass node/upid as null to disable.
 */
export function useTaskStatus(node: string | null | undefined, upid: string | null | undefined, options?: StatusQueryOpts) {
  return useQuery({
    queryKey: taskKeys.status(node ?? '', upid ?? ''),
    queryFn: ({ signal }) => fetchTaskStatus(node!, upid!, signal),
    enabled: !!node && !!upid,
    refetchInterval: (q) => (q.state.data?.status === 'stopped' ? false : TASK_POLL_MS),
    refetchIntervalInBackground: true,
    staleTime: 0,
    ...options,
  })
}

const EMPTY_LOG: TaskLogState = { lines: [], isLoading: true, error: null, isComplete: false }

export interface TaskLogState {
  lines: TaskLogLine[]
  /** First page is still loading. */
  isLoading: boolean
  error: Error | null
  /** The log has been read completely after the task stopped. */
  isComplete: boolean
}

/**
 * The log of a task, read incrementally (start/limit) so a long backup log is
 * fetched once, not on every poll. While `follow` is true new lines are
 * fetched every `intervalMs`; when it turns false (the task stopped) the rest
 * is read once and polling ends. Pass `follow: taskState(status) === 'running'`.
 */
export function useTaskLog(
  node: string | null | undefined,
  upid: string | null | undefined,
  { follow = true, intervalMs = TASK_POLL_MS, enabled = true }: { follow?: boolean; intervalMs?: number; enabled?: boolean } = {},
): TaskLogState {
  const [state, setState] = useState<TaskLogState>(EMPTY_LOG)
  const key = `${node}\n${upid}`
  const [stateKey, setStateKey] = useState(key)
  // Lines read so far, for the task in offsetKey.
  const offset = useRef(0)
  const offsetKey = useRef(key)

  // Another task: start over (state reset during render, see React docs
  // "adjusting state when a prop changes").
  if (stateKey !== key) {
    setStateKey(key)
    setState(EMPTY_LOG)
  }

  useEffect(() => {
    if (!node || !upid || !enabled) return
    if (offsetKey.current !== key) {
      offsetKey.current = key
      offset.current = 0
    }
    const ac = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const PAGE = 1000

    const tick = async () => {
      try {
        let page: TaskLogLine[]
        do {
          const res = await fetchTaskLog(node, upid, offset.current, PAGE, ac.signal)
          page = res.lines
          if (ac.signal.aborted) return
          if (page.length) {
            offset.current = page[page.length - 1]!.n
            setState((s) => ({ ...s, lines: [...s.lines, ...page], isLoading: false, error: null }))
          } else {
            setState((s) => (s.isLoading || s.error ? { ...s, isLoading: false, error: null } : s))
          }
        } while (page.length === PAGE)
        if (follow) {
          timer = setTimeout(tick, document.hidden ? intervalMs * 3 : intervalMs)
        } else {
          setState((s) => ({ ...s, isComplete: true }))
        }
      } catch (e) {
        if (ac.signal.aborted) return
        setState((s) => ({ ...s, isLoading: false, error: e instanceof Error ? e : new Error(String(e)) }))
        timer = setTimeout(tick, intervalMs * 2)
      }
    }
    void tick()
    return () => {
      ac.abort()
      if (timer) clearTimeout(timer)
    }
  }, [key, node, upid, follow, intervalMs, enabled])

  return state
}
