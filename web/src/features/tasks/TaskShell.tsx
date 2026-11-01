// Running-task indicators in the app frame: a count badge on the 任务 nav
// item (phones and the sidebar) and the desktop footer bar with an
// expandable recent-tasks / cluster-log panel, like the official UI's
// bottom status panel.

import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ChevronDown, ChevronUp, CircleX, ListChecks, Loader2, ScrollText } from 'lucide-react'

import { useTasks } from '@/api/queries'
import { taskState } from '@/api/tasks'
import { useClusterLog } from '@/api/tasks-logs'
import { TaskStateIcon } from '@/components/tasks/TaskStateIcon'
import { openTaskLog, useTrackedTasks } from '@/components/tasks/tracker'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { ClusterLogList, ClusterLogSkeleton } from './ClusterLogList'
import { taskDuration, taskTitle } from './format'
import { useGuestNames, useNow, useRunningTasks } from './hooks'
import { TaskList, TaskListSkeleton } from './TaskList'

/** Count of running tasks for a nav item; nothing when idle. */
export function RunningTasksBadge({ className }: { className?: string }) {
  const { running } = useRunningTasks()
  if (running.length === 0) return null
  return (
    <span
      role="status"
      aria-label={`${running.length} 个任务运行中`}
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground tabular shadow-sm',
        className,
      )}
    >
      {running.length > 99 ? '99+' : running.length}
    </span>
  )
}

// ------------------------------------------------------------ footer bar

type PanelTab = 'tasks' | 'log'
const STORE_KEY = 'pve-web.task-footer'

function loadPanel(): { open: boolean; tab: PanelTab } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as { open?: unknown; tab?: unknown }
    return { open: raw.open === true, tab: raw.tab === 'log' ? 'log' : 'tasks' }
  } catch {
    return { open: false, tab: 'tasks' }
  }
}

function savePanel(v: { open: boolean; tab: PanelTab }) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v))
  } catch {
    // storage unavailable: the panel just forgets its state
  }
}

/** Desktop (≥1024px) footer: running tasks, recent failures, expandable panel. */
export function TaskFooterBar() {
  const desktop = useIsDesktop()
  if (!desktop) return null
  return <FooterBar />
}

function FooterBar() {
  const [panel, setPanelState] = useState(loadPanel)
  const setPanel = (v: { open: boolean; tab: PanelTab }) => {
    setPanelState(v)
    savePanel(v)
  }
  const ref = useRef<HTMLDivElement>(null)
  const { running, failures, lastFinished } = useRunningTasks()
  const names = useGuestNames()
  const now = useNow(true, running.length ? 1000 : 30_000)

  // Publish the height so <main> and the task toasts keep clear of it.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const update = () => root.style.setProperty('--task-footer-h', `${el.offsetHeight}px`)
    update()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    ro?.observe(el)
    return () => {
      ro?.disconnect()
      root.style.removeProperty('--task-footer-h')
    }
  }, [])

  const first = running[0]
  const toggle = () => setPanel({ ...panel, open: !panel.open })

  return (
    <div ref={ref} className="fixed right-0 bottom-0 left-[17rem] z-30" data-testid="task-footer">
      {panel.open && (
        <FooterPanel
          tab={panel.tab}
          onTab={(tab) => setPanel({ open: true, tab })}
          onClose={() => setPanel({ ...panel, open: false })}
          now={now}
        />
      )}
      <div
        role="region"
        aria-label="任务状态栏"
        className="surface-strong flex h-11 items-center gap-1 rounded-none border-x-0 border-b-0 px-3 text-sm shadow-none"
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={panel.open}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 font-medium text-foreground transition-colors hover:bg-accent"
        >
          {panel.open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronUp className="size-4 text-muted-foreground" />}
          任务
        </button>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />

        <div className="flex min-w-0 flex-1 items-center">
          {first ? (
            <button
              type="button"
              onClick={() => openTaskLog({ node: first.node, upid: first.upid, title: first.title ?? taskTitle(first, names) })}
              className="inline-flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-accent"
            >
              <Loader2 className="size-4 shrink-0 animate-spin text-brand-strong" aria-hidden />
              <span className="shrink-0 font-medium text-brand-strong">{running.length} 个运行中</span>
              <span className="text-faint" aria-hidden>
                ·
              </span>
              <span className="truncate text-foreground">{first.title ?? taskTitle(first, names)}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular">{taskDuration(first, now)}</span>
              {first.lastLine && <span className="hidden truncate text-xs text-muted-foreground xl:inline">{first.lastLine}</span>}
            </button>
          ) : lastFinished ? (
            <button
              type="button"
              onClick={() =>
                openTaskLog({
                  node: lastFinished.node,
                  upid: lastFinished.upid,
                  title: taskTitle(lastFinished, names),
                  ...(lastFinished.endtime ? { endtime: lastFinished.endtime } : {}),
                })
              }
              className="inline-flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <TaskStateIcon state={taskState(lastFinished)} />
              <span className="shrink-0">没有运行中的任务</span>
              <span className="text-faint" aria-hidden>
                ·
              </span>
              <span className="truncate">
                最近：{taskTitle(lastFinished, names)}，{formatRelativeTime(lastFinished.endtime ?? lastFinished.starttime, now)}
              </span>
            </button>
          ) : (
            <span className="px-2 text-muted-foreground">没有运行中的任务</span>
          )}
        </div>

        {failures.length > 0 && (
          <Link
            to="/tasks?status=error&range=1d"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-destructive transition-colors hover:bg-destructive/10"
          >
            <CircleX className="size-4" aria-hidden />
            24 小时内 {failures.length} 个失败
          </Link>
        )}
        <Link
          to="/cluster/log"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ScrollText className="size-4" aria-hidden />
          集群日志
        </Link>
        <Link
          to="/tasks"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ListChecks className="size-4" aria-hidden />
          全部任务
        </Link>
      </div>
    </div>
  )
}

function FooterPanel({
  tab,
  onTab,
  onClose,
  now,
}: {
  tab: PanelTab
  onTab: (t: PanelTab) => void
  onClose: () => void
  now: number
}) {
  const tasks = useTasks()
  const log = useClusterLog(50, { enabled: tab === 'log' })
  const names = useGuestNames()
  const tracked = useTrackedTasks()
  const live = new Map(tracked.map((t) => [t.upid, t]))
  const multiNode = new Set((tasks.data ?? []).map((t) => t.node)).size > 1

  return (
    <div
      className="surface-strong flex h-72 animate-in flex-col rounded-none rounded-t-2xl border-b-0 shadow-none duration-200 fade-in-0 slide-in-from-bottom-2"
      role="region"
      aria-label="最近任务与集群日志"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border/70 px-3 py-1.5">
        {(
          [
            ['tasks', '最近任务', ListChecks],
            ['log', '集群日志', ScrollText],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => onTab(id)}
            aria-pressed={tab === id}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors',
              tab === id ? 'bg-foreground/[0.08] font-medium text-foreground paper:bg-secondary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className={cn('size-4', tab === id && 'text-brand-strong')} aria-hidden />
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          aria-label="收起"
          className="ml-auto inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {tab === 'tasks' ? (
          tasks.isPending ? (
            <TaskListSkeleton rows={4} />
          ) : (tasks.data?.length ?? 0) === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">还没有任务</p>
          ) : (
            <TaskList tasks={tasks.data ?? []} now={now} names={names} showNode={multiNode} live={live} compact />
          )
        ) : log.isPending ? (
          <ClusterLogSkeleton rows={4} />
        ) : (log.data?.length ?? 0) === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">集群日志是空的</p>
        ) : (
          <ClusterLogList entries={log.data ?? []} now={now} showNode={multiNode} compact />
        )}
      </div>
    </div>
  )
}
