import { ChevronRight } from 'lucide-react'

import { taskState, type TaskState } from '@/api/tasks'
import type { ClusterTask } from '@/api/types'
import { Skeleton } from '@/components/ui/skeleton'
import { TaskStateIcon } from '@/components/tasks/TaskStateIcon'
import { TaskProgressLine } from '@/components/tasks/TaskToast'
import { openTaskLog, type TrackedTask } from '@/components/tasks/tracker'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { formatTaskTime, taskDuration, taskTitle, type GuestNames } from './format'

export interface TaskListProps {
  tasks: readonly ClusterTask[]
  now: number
  names?: GuestNames | undefined
  /** Show the node (multi-node clusters, cluster-wide lists). */
  showNode?: boolean
  /** Inside a guest's tab: titles without "VM 100". */
  omitSubject?: boolean
  /** Live details of tasks started in this UI (last log line, progress), by UPID. */
  live?: ReadonlyMap<string, Pick<TrackedTask, 'lastLine' | 'progress'>>
  /** Denser rows without the desktop table header (footer panel). */
  compact?: boolean
  className?: string
}

const STATUS_TEXT: Record<TaskState, string> = {
  running: 'text-brand',
  ok: 'text-muted-foreground',
  warning: 'text-warning',
  error: 'text-destructive',
}

function statusText(task: ClusterTask, state: TaskState): string {
  if (state === 'running') return '运行中'
  if (state === 'ok') return '成功'
  return task.status || (state === 'error' ? '失败' : '有警告')
}

/**
 * Task rows: stacked on phones (title, time, node · user · duration, error
 * line), a table on desktop. A row opens the live log sheet.
 */
export function TaskList({ tasks, now, names, showNode = false, omitSubject = false, live, compact = false, className }: TaskListProps) {
  const desktop = useIsDesktop()
  const cols = showNode
    ? 'grid-cols-[minmax(0,1fr)_7.5rem_9rem_8.5rem_5.5rem_minmax(0,10rem)_1rem]'
    : 'grid-cols-[minmax(0,1fr)_9rem_8.5rem_5.5rem_minmax(0,11rem)_1rem]'

  return (
    <div className={className}>
      {desktop && !compact && (
        <div
          className={cn(
            'grid items-center gap-4 border-b border-border/70 px-(--card-p) py-2.5 text-xs font-medium text-muted-foreground',
            cols,
          )}
          aria-hidden
        >
          <span className="pl-7">任务</span>
          {showNode && <span>节点</span>}
          <span>用户</span>
          <span>开始时间</span>
          <span>耗时</span>
          <span>状态</span>
          <span />
        </div>
      )}
      <ul className="divide-y divide-border/70" aria-label="任务列表">
        {tasks.map((task) => {
          const state = taskState(task)
          const title = taskTitle(task, names, { omitSubject })
          const info = live?.get(task.upid)
          const open = () =>
            openTaskLog({ node: task.node, upid: task.upid, title, ...(task.endtime ? { endtime: task.endtime } : {}) })
          const rowBase = cn(
            'group relative w-full text-left transition-colors outline-none',
            'hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] active:bg-foreground/[0.05] paper:hover:bg-secondary/50',
            state === 'error' && 'bg-destructive/[0.035]',
            state === 'warning' && 'bg-warning/[0.04]',
          )
          return (
            <li key={task.upid} data-upid={task.upid} data-state={state}>
              {desktop && !compact ? (
                <button
                  type="button"
                  onClick={open}
                  className={cn(rowBase, 'grid min-h-12 items-center gap-4 px-(--card-p) py-2.5 text-sm', cols)}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <TaskStateIcon state={state} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">{title}</span>
                      {state === 'running' && info?.lastLine && (
                        <span className="block truncate text-xs text-muted-foreground">{info.lastLine}</span>
                      )}
                    </span>
                  </span>
                  {showNode && <span className="truncate text-muted-foreground">{task.node}</span>}
                  <span className="truncate text-muted-foreground" title={task.user}>
                    {task.user}
                  </span>
                  <span className="text-muted-foreground tabular">{formatTaskTime(task.starttime, now)}</span>
                  <span className="text-muted-foreground tabular">{taskDuration(task, now)}</span>
                  <span className={cn('truncate', STATUS_TEXT[state])} title={task.status}>
                    {statusText(task, state)}
                  </span>
                  <ChevronRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
                  {state === 'running' && <TaskProgressLine progress={info?.progress} className="h-0.5" />}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={open}
                  className={cn(
                    rowBase,
                    'flex items-start gap-3 px-(--card-p)',
                    compact ? 'min-h-11 py-2' : 'min-h-14 py-(--row-py)',
                  )}
                >
                  <TaskStateIcon state={state} className="mt-0.5 size-[18px]" />
                  <span className="grid min-w-0 flex-1 grid-cols-1 gap-0.5">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular">
                        {now / 1000 - task.starttime < 86400 ? formatRelativeTime(task.starttime, now) : formatTaskTime(task.starttime, now)}
                      </span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {[showNode && task.node, task.user, state === 'running' ? `已运行 ${taskDuration(task, now)}` : `耗时 ${taskDuration(task, now)}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {state === 'running' && info?.lastLine && (
                      <span className="truncate text-xs text-muted-foreground">{info.lastLine}</span>
                    )}
                    {(state === 'error' || state === 'warning') && task.status && (
                      <span className={cn('line-clamp-2 text-xs break-words', STATUS_TEXT[state])}>{task.status}</span>
                    )}
                  </span>
                  {state === 'running' && <TaskProgressLine progress={info?.progress} className="h-0.5" />}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function TaskListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border/70" aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-(--card-p) py-4">
          <Skeleton className="size-[18px] rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-44 max-w-full" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="hidden h-3 w-20 sm:block" />
        </div>
      ))}
    </div>
  )
}
