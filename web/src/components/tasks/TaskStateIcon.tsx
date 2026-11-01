import { CircleCheck, CircleX, Loader2, TriangleAlert } from 'lucide-react'

import { TASK_STATE_LABEL, type TaskState } from '@/api/tasks'
import { cn } from '@/lib/utils'

const ICON = {
  running: Loader2,
  ok: CircleCheck,
  warning: TriangleAlert,
  error: CircleX,
} as const

export const TASK_STATE_TEXT_CLASS: Record<TaskState, string> = {
  running: 'text-brand-strong',
  ok: 'text-success-strong',
  warning: 'text-warning-strong',
  error: 'text-destructive',
}

/** Spinner / check / warning / cross for a task state. */
export function TaskStateIcon({ state, className }: { state: TaskState; className?: string }) {
  const Icon = ICON[state]
  return (
    <Icon
      role="img"
      aria-label={TASK_STATE_LABEL[state]}
      className={cn('size-4 shrink-0', TASK_STATE_TEXT_CLASS[state], state === 'running' && 'animate-spin', className)}
    />
  )
}

/** Small pill with icon and label ("运行中", "失败" …). */
export function TaskStateBadge({ state, className }: { state: TaskState; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium',
        state === 'running' && 'bg-brand/12 text-brand-strong',
        state === 'ok' && 'bg-success/12 text-success-strong',
        state === 'warning' && 'bg-warning/14 text-warning-strong',
        state === 'error' && 'bg-destructive/12 text-destructive',
        className,
      )}
    >
      <TaskStateIcon state={state} className="size-3.5 text-current" />
      {TASK_STATE_LABEL[state]}
    </span>
  )
}
