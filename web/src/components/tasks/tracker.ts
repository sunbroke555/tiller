// Global tracker for tasks started from this UI.
//
//   await runTask(post(p`/nodes/${node}/qemu/${vmid}/status/start`), { title: `启动 ${name}` })
//
// runTask waits for the API call, then (when it returned a UPID) shows the
// task in the bottom task toast, polls its status and last log line, opens the
// live log on tap, and when the task ends refreshes queries and keeps a
// failed task visible with its exit status until dismissed.
//
// It is a tiny external store (useSyncExternalStore), no context provider
// needed: call runTask from anywhere. <TaskToast/> and <TaskLogHost/> (mounted
// in AppShell) render it; setTaskQueryClient (called in App) enables the
// query invalidation.

import { useSyncExternalStore } from 'react'
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'

import { isClientError } from '@/api/client'
import { queryKeys } from '@/api/queries'
import {
  TASK_POLL_MS,
  exitStatusState,
  fetchTaskLog,
  fetchTaskStatus,
  isUpid,
  parseTaskProgress,
  parseUpid,
  type TaskState,
} from '@/api/tasks'
import { errorMessage } from '@/lib/errors'
import { describeUpid } from '@/lib/taskTypes'

export interface TrackedTask {
  upid: string
  node: string
  /** What the user did, e.g. "启动 web-01". */
  title: string
  /** Client time (ms) the task was started. */
  startedAt: number
  finishedAt?: number
  state: TaskState
  /** PVE exit status once stopped ("OK", "WARNINGS: 1", error text). */
  exitstatus?: string
  /** Latest non-empty log line, shown under the title. */
  lastLine?: string
  /** 0..1 when the log prints percentages. */
  progress?: number
  /** Hidden from the toast (still tracked until it ends). */
  dismissed: boolean
}

export interface TaskOutcome {
  /** null when the call returned no UPID (a synchronous API call). */
  upid: string | null
  state: Exclude<TaskState, 'running'>
  exitstatus?: string
}

export interface TaskHandle {
  /** null when the call was synchronous (nothing to track). */
  upid: string | null
  /** Resolves when the task ends (never rejects; check outcome.state). */
  done: Promise<TaskOutcome>
}

export interface RunTaskOptions {
  /** Shown in the toast and the log sheet: "启动 web-01". */
  title: string
  /** Defaults to the node in the UPID. */
  node?: string
  /**
   * Queries refreshed when the task ends. Default: everything under
   * queryKeys.all (only queries on screen refetch). Pass [] for none.
   */
  invalidate?: readonly QueryKey[]
  /** Toast shown when a synchronous call (no UPID) succeeds; default "<title>：已完成". false = none. */
  syncSuccessMessage?: string | false
  /** Called once the task ended OK (or with warnings). */
  onSuccess?: (outcome: TaskOutcome) => void
  /** Called when the task failed (exit status is an error). */
  onError?: (outcome: TaskOutcome) => void
}

// ------------------------------------------------------------------ store

interface LogTarget {
  node: string
  upid: string
  title?: string
  /** End time (Unix seconds) when known from a task list, to show the duration. */
  endtime?: number
}

interface Snapshot {
  tasks: TrackedTask[]
  log: LogTarget | null
}

let snapshot: Snapshot = { tasks: [], log: null }
const listeners = new Set<() => void>()
let queryClient: QueryClient | null = null

function emit(next: Snapshot) {
  snapshot = next
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function patchTask(upid: string, patch: Partial<TrackedTask>) {
  if (!snapshot.tasks.some((t) => t.upid === upid)) return
  emit({ ...snapshot, tasks: snapshot.tasks.map((t) => (t.upid === upid ? { ...t, ...patch } : t)) })
}

/** Called once by the app with its QueryClient so finished tasks refresh data. */
export function setTaskQueryClient(client: QueryClient | null): void {
  queryClient = client
}

/** All tracked tasks, newest first. */
export function useTrackedTasks(): TrackedTask[] {
  return useSyncExternalStore(subscribe, () => snapshot.tasks, () => snapshot.tasks)
}

/** The task whose log sheet is open, if any. */
export function useTaskLogTarget(): LogTarget | null {
  return useSyncExternalStore(subscribe, () => snapshot.log, () => snapshot.log)
}

/** Open the live log sheet for any task (also ones not started here). */
export function openTaskLog(target: LogTarget): void {
  const previous = snapshot.log?.upid
  emit({ ...snapshot, log: target })
  if (previous && previous !== target.upid) dismissDeferred(previous)
}

export function closeTaskLog(): void {
  const previous = snapshot.log?.upid
  if (snapshot.log) emit({ ...snapshot, log: null })
  if (previous) dismissDeferred(previous)
}

/** Hide a task from the toast; a running task keeps being tracked. */
export function dismissTask(upid: string): void {
  const task = snapshot.tasks.find((t) => t.upid === upid)
  if (!task) return
  if (task.state === 'running') patchTask(upid, { dismissed: true })
  else {
    cancelDismiss(upid)
    emit({ ...snapshot, tasks: snapshot.tasks.filter((t) => t.upid !== upid) })
  }
}

/** Remove finished tasks from the toast. */
export function clearFinishedTasks(): void {
  emit({ ...snapshot, tasks: snapshot.tasks.filter((t) => t.state === 'running') })
}

/** Clears everything (logout; tests). */
export function resetTaskTracker(): void {
  for (const stop of pollers.values()) stop()
  pollers.clear()
  for (const timer of dismissTimers.values()) clearTimeout(timer)
  dismissTimers.clear()
  dismissOnLogClose.clear()
  emit({ tasks: [], log: null })
}

// ---------------------------------------------------------------- polling

/** How long finished tasks stay in the toast. Errors stay until dismissed. */
export const AUTO_DISMISS_MS: Record<Exclude<TaskState, 'running'>, number | null> = {
  ok: 4_000,
  warning: 10_000,
  error: null,
}

const pollers = new Map<string, () => void>()
/** Pending auto-dismiss timers of finished tasks. */
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Finished tasks whose auto-dismiss came while their log was open: dismissed when it closes. */
const dismissOnLogClose = new Set<string>()

function scheduleDismiss(upid: string, ms: number) {
  cancelDismiss(upid)
  dismissTimers.set(
    upid,
    setTimeout(() => {
      dismissTimers.delete(upid)
      // Keep it while its log is open; closeTaskLog dismisses it then.
      if (snapshot.log?.upid === upid) dismissOnLogClose.add(upid)
      else dismissTask(upid)
    }, ms),
  )
}

function cancelDismiss(upid: string) {
  const timer = dismissTimers.get(upid)
  if (timer) clearTimeout(timer)
  dismissTimers.delete(upid)
  dismissOnLogClose.delete(upid)
}

function dismissDeferred(upid: string) {
  if (dismissOnLogClose.has(upid)) dismissTask(upid)
}

function invalidate(keys: readonly QueryKey[] | undefined) {
  if (!queryClient) return
  for (const queryKey of keys ?? [queryKeys.all]) void queryClient.invalidateQueries({ queryKey })
}

function pollTask(task: TrackedTask, opts: RunTaskOptions, resolve: (o: TaskOutcome) => void) {
  const { upid, node } = task
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let logOffset = 0
  let failures = 0
  pollers.set(upid, () => {
    stopped = true
    if (timer) clearTimeout(timer)
  })

  const readLog = async () => {
    // Only the tail matters here; skip ahead on the first read.
    const { lines, total } = await fetchTaskLog(node, upid, logOffset, 200)
    if (lines.length) logOffset = lines[lines.length - 1]!.n
    // Far behind (long backup log): jump to the tail for the next read.
    if (total - logOffset > 200) logOffset = total - 20
    const last = [...lines].reverse().find((l) => l.t.trim() && !/^TASK (OK|ERROR|WARNINGS)/.test(l.t))
    if (last) {
      const progress = parseTaskProgress(last.t)
      patchTask(upid, { lastLine: last.t.trim(), ...(progress !== null ? { progress } : {}) })
    }
  }

  const finish = (exitstatus: string) => {
    pollers.delete(upid)
    const state = exitStatusState(exitstatus)
    patchTask(upid, { state, exitstatus, finishedAt: Date.now(), ...(state === 'ok' ? { progress: 1 } : {}) })
    invalidate(opts.invalidate)
    const outcome: TaskOutcome = { upid, state, exitstatus }
    if (state === 'error') opts.onError?.(outcome)
    else opts.onSuccess?.(outcome)
    resolve(outcome)
    const ttl = AUTO_DISMISS_MS[state]
    if (ttl !== null) {
      scheduleDismiss(upid, ttl)
    } else {
      // Unhide failed tasks the user had hidden while running.
      patchTask(upid, { dismissed: false })
    }
  }

  const tick = async () => {
    if (stopped) return
    try {
      const status = await fetchTaskStatus(node, upid)
      failures = 0
      await readLog().catch(() => undefined)
      if (stopped) return
      if (status.status === 'stopped') {
        finish(status.exitstatus ?? 'unknown')
        return
      }
    } catch (e) {
      // Transient errors (network, node busy) are retried; give up after a
      // while. Client errors (no permission, task log pruned) end it right away.
      if (isClientError(e) || ++failures >= 20) {
        finish(`无法获取任务状态：${errorMessage(e)}`)
        return
      }
    }
    if (stopped) return
    const hidden = typeof document !== 'undefined' && document.hidden
    timer = setTimeout(tick, hidden ? TASK_POLL_MS * 4 : TASK_POLL_MS)
  }
  timer = setTimeout(tick, 400)
}

/**
 * Track an already started task (you have its UPID). Returns when the task
 * ends. runTask is the usual entry point.
 */
export function trackTask(upid: string, opts: RunTaskOptions): Promise<TaskOutcome> {
  const parsed = parseUpid(upid)
  const node = opts.node ?? parsed?.node
  if (!node) return Promise.resolve({ upid, state: 'error', exitstatus: '无效的任务 ID' })
  const existing = snapshot.tasks.find((t) => t.upid === upid)
  if (existing) patchTask(upid, { dismissed: false })
  return new Promise<TaskOutcome>((resolve) => {
    if (existing) {
      // Already tracked: resolve when its state settles.
      const unsubscribe = subscribe(() => {
        const t = snapshot.tasks.find((x) => x.upid === upid)
        if (!t || t.state !== 'running') {
          unsubscribe()
          resolve({ upid, state: t && t.state !== 'running' ? t.state : 'ok', exitstatus: t?.exitstatus })
        }
      })
      return
    }
    const task: TrackedTask = {
      upid,
      node,
      title: opts.title || describeUpid(upid),
      startedAt: Date.now(),
      state: 'running',
      dismissed: false,
    }
    emit({ ...snapshot, tasks: [task, ...snapshot.tasks] })
    pollTask(task, opts, resolve)
  })
}

/**
 * Run an API call that may return a UPID and track it.
 *
 * - The returned promise resolves as soon as the call succeeded (so a dialog
 *   can close right away) with a handle whose `done` resolves when the task ends.
 * - It rejects with the API error when the call itself fails, without a toast:
 *   ConfirmDialog / FormDialog show it. For a plain button use fireTask.
 * - A synchronous result (no UPID) shows a short success toast and refreshes queries.
 */
export async function runTask(start: Promise<unknown> | (() => Promise<unknown>), opts: RunTaskOptions): Promise<TaskHandle> {
  const result = await (typeof start === 'function' ? start() : start)
  if (isUpid(result)) {
    return { upid: result, done: trackTask(result, opts) }
  }
  invalidate(opts.invalidate)
  if (opts.syncSuccessMessage !== false) toast.success(opts.syncSuccessMessage ?? `${opts.title}：已完成`)
  const outcome: TaskOutcome = { upid: null, state: 'ok' }
  opts.onSuccess?.(outcome)
  return { upid: null, done: Promise.resolve(outcome) }
}

/** runTask for buttons without a dialog: a failing call is shown as an error toast. */
export function fireTask(start: Promise<unknown> | (() => Promise<unknown>), opts: RunTaskOptions): void {
  runTask(start, opts).catch((e: unknown) => {
    toast.error(`${opts.title}失败`, { description: errorMessage(e) })
  })
}
