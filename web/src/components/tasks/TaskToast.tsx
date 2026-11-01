import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

import type { TaskState } from '@/api/tasks'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/format'

import { TaskStateIcon } from './TaskStateIcon'
import { clearFinishedTasks, dismissTask, openTaskLog, useTrackedTasks, type TrackedTask } from './tracker'

const MAX_VISIBLE = 3

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

const DONE_LABEL: Record<Exclude<TaskState, 'running'>, string> = {
  ok: '已完成',
  warning: '已完成，有警告',
  error: '失败',
}

/**
 * Screen reader messages for tasks that started or ended since `prev`
 * (upid → state), oldest first. Log lines and the timer are not announced.
 */
export function taskAnnouncements(prev: ReadonlyMap<string, TaskState>, tasks: readonly TrackedTask[]): string[] {
  const out: string[] = []
  for (const t of [...tasks].reverse()) {
    const before = prev.get(t.upid)
    if (before === t.state) continue
    if (t.state === 'running') {
      if (before === undefined) out.push(`${t.title}：开始`)
    } else {
      out.push(`${t.title}：${DONE_LABEL[t.state]}`)
    }
  }
  return out
}

/** Polite live region that only speaks when a task starts or ends. */
function TaskAnnouncer({ tasks }: { tasks: readonly TrackedTask[] }) {
  const seen = useRef<Map<string, TaskState> | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => {
    // Tasks already there on mount are not news.
    const next = taskAnnouncements(seen.current ?? new Map(tasks.map((t) => [t.upid, t.state])), tasks)
    seen.current = new Map(tasks.map((t) => [t.upid, t.state]))
    if (next.length) setMessage(next.join('；'))
  }, [tasks])
  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  )
}

/**
 * Stack of tasks started from this UI: spinner, title, last log line and a
 * progress bar while running; result and exit status when done. Tap opens
 * the live log. Rendered by AppShell inside the bottom dock (above the
 * mobile nav, bottom-right on desktop). The stack itself is not a live
 * region (its timer ticks every second); TaskAnnouncer speaks start and end.
 */
export function TaskToast({ className }: { className?: string }) {
  const all = useTrackedTasks()
  const tasks = all.filter((t) => !t.dismissed)
  const now = useNow(tasks.some((t) => t.state === 'running'))
  const visible = tasks.slice(0, MAX_VISIBLE)
  const hidden = tasks.length - visible.length
  const finished = tasks.filter((t) => t.state !== 'running').length

  return (
    <>
      <TaskAnnouncer tasks={all} />
      {tasks.length > 0 && (
        <section aria-label="任务进度" className={cn('grid gap-2', className)}>
          {visible.map((task) => (
            <TaskRow key={task.upid} task={task} now={now} />
          ))}
          {(hidden > 0 || finished > 1) && (
            <div className="flex items-center justify-end gap-2 text-xs">
              {hidden > 0 && <span className="text-muted-foreground">还有 {hidden} 个任务</span>}
              {finished > 1 && (
                <button
                  type="button"
                  onClick={clearFinishedTasks}
                  className="surface-strong h-8 rounded-full px-3 text-muted-foreground transition-colors hover:text-foreground pointer-coarse:h-9"
                >
                  清除已完成
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </>
  )
}

function TaskRow({ task, now }: { task: TrackedTask; now: number }) {
  const running = task.state === 'running'
  const elapsed = Math.round(((task.finishedAt ?? now) - task.startedAt) / 1000)
  const detail = running ? task.lastLine : task.state === 'ok' ? '已完成' : task.exitstatus
  return (
    <div
      data-state={task.state}
      className={cn(
        'surface-strong group relative flex w-full animate-in items-center gap-3 overflow-hidden rounded-2xl py-2.5 pr-1.5 pl-3.5 duration-300 fade-in-0 slide-in-from-bottom-2',
        task.state === 'error' && 'border-destructive/40',
      )}
    >
      <button
        type="button"
        onClick={() => openTaskLog({ node: task.node, upid: task.upid, title: task.title })}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:underline"
        aria-label={`${task.title}，查看日志`}
      >
        <TaskStateIcon state={task.state} className="size-[18px]" />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium text-foreground">{task.title}</span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular">{formatDuration(elapsed)}</span>
          </span>
          <span
            className={cn(
              'truncate text-xs',
              task.state === 'error' ? 'text-destructive' : task.state === 'warning' ? 'text-warning-strong' : 'text-muted-foreground',
            )}
          >
            {detail || '正在执行…'}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => dismissTask(task.upid)}
        aria-label={running ? '隐藏' : '关闭'}
        title={running ? '隐藏（任务继续运行）' : '关闭'}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground pointer-coarse:size-11"
      >
        <X className="size-4" />
      </button>
      {running && <TaskProgressLine progress={task.progress} />}
    </div>
  )
}

/** Hairline progress at the bottom edge: determinate when known, else a sweep. */
export function TaskProgressLine({ progress, className }: { progress?: number | undefined; className?: string }) {
  const known = progress !== undefined
  return (
    <div
      role="progressbar"
      aria-label="进度"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? Math.round(progress * 100) : undefined}
      className={cn('absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-brand/10', className)}
    >
      {known ? (
        <div className="h-full bg-brand transition-[width] duration-500" style={{ width: `${Math.max(2, progress * 100)}%` }} />
      ) : (
        <div className="task-indeterminate h-full w-1/3 bg-brand" />
      )}
    </div>
  )
}
