import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { AlertTriangle, ListChecks, Loader2, RefreshCw, SearchX } from 'lucide-react'

import { filtersFromSearch, filtersToSearch, useTaskHistory, type TaskFilters } from '@/api/tasks-logs'
import { taskState } from '@/api/tasks'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { useTrackedTasks } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { useGuestNames, useNow, useRunningTasks } from './hooks'
import { TaskFilterBar } from './TaskFilters'
import { TaskList, TaskListSkeleton } from './TaskList'

export interface TaskHistoryViewProps {
  /** Filters set by the page and not editable (the node / guest of a tab). */
  fixed?: Pick<TaskFilters, 'node' | 'vmid'>
  /** Nodes offered as scope (/tasks). With one node its history is the default. */
  nodes?: readonly string[]
  /** Show the node of each task. */
  showNode?: boolean
  /** Inside a guest tab: row titles without the guest. */
  omitSubject?: boolean
  className?: string
}

/**
 * Filterable task history with live running tasks. Filters live in the URL
 * (?status=error&type=qmstart&range=7d…) so they survive reloads and links.
 */
export function TaskHistoryView({ fixed, nodes = [], showNode = false, omitSubject = false, className }: TaskHistoryViewProps) {
  const [params, setParams] = useSearchParams()
  const fromUrl = useMemo(() => filtersFromSearch(params), [params])
  const defaultNode = nodes.length === 1 ? nodes[0] : undefined
  const filters: TaskFilters = { ...fromUrl, ...fixed }
  if (!filters.node && defaultNode) filters.node = defaultNode

  const history = useTaskHistory(filters)
  const names = useGuestNames()
  const tracked = useTrackedTasks()
  const { running } = useRunningTasks()
  const live = useMemo(() => new Map(tracked.map((t) => [t.upid, t])), [tracked])
  const anyRunning = history.tasks.some((t) => taskState(t) === 'running')
  const now = useNow(true, anyRunning ? 1000 : 30_000)

  const setFilters = (next: TaskFilters) => {
    const clean: TaskFilters = { ...next }
    if (fixed?.node || clean.node === defaultNode) delete clean.node
    if (fixed?.vmid) delete clean.vmid
    setParams(filtersToSearch(clean, params), { replace: true })
  }

  const fixedKeys = (Object.keys(fixed ?? {}) as (keyof TaskFilters)[]).concat(defaultNode ? ['node' as const] : [])
  const runningCount = fixed
    ? running.filter((t) => (!fixed.node || t.node === fixed.node) && (!fixed.vmid || t.id === String(fixed.vmid))).length
    : running.length
  const filtered = Object.keys(fromUrl).some((k) => k !== 'node' || nodes.length > 1)

  return (
    <div className={cn('grid grid-cols-1 gap-3', className)}>
      <TaskFilterBar
        filters={filters}
        fixedKeys={fixedKeys}
        onChange={setFilters}
        nodes={fixed?.node ? [] : nodes}
        showVmid={!fixed?.vmid}
        runningCount={runningCount}
      />

      <GlassCard flush className="relative overflow-hidden">
        {history.isFetching && !history.isPending && !history.isFetchingMore && (
          <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-brand/10" aria-hidden>
            <div className="task-indeterminate h-full w-1/3 bg-brand/70" />
          </div>
        )}
        {history.isPending ? (
          <TaskListSkeleton />
        ) : history.isError && history.tasks.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title="无法加载任务"
            description={errorMessage(history.error)}
            action={
              <Button variant="outline" onClick={history.refetch}>
                <RefreshCw /> 重试
              </Button>
            }
          />
        ) : history.tasks.length === 0 ? (
          <EmptyState
            icon={filtered ? SearchX : ListChecks}
            title={filtered ? '没有符合条件的任务' : '还没有任务'}
            description={
              filtered
                ? history.source === 'cluster'
                  ? '这里只包含各节点最近的任务，可以在“筛选”里选择节点查看完整历史。'
                  : '换个筛选条件试试。'
                : '启动、备份、迁移等操作会在这里留下记录。'
            }
            action={
              filtered ? (
                <Button variant="outline" onClick={() => setFilters({})}>
                  清除筛选
                </Button>
              ) : undefined
            }
          />
        ) : (
          <TaskList
            tasks={history.tasks}
            now={now}
            names={names}
            showNode={showNode || history.source === 'cluster'}
            omitSubject={omitSubject}
            live={live}
          />
        )}
      </GlassCard>

      {!history.isPending && history.tasks.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 text-xs text-muted-foreground">
          <span className="tabular">
            {history.source === 'node'
              ? history.total !== undefined
                ? `已显示 ${history.tasks.length} / 共 ${history.total} 个任务`
                : `已显示 ${history.tasks.length} 个任务`
              : `各节点最近的 ${history.tasks.length} 个任务`}
          </span>
          {history.hasMore && (
            <Button variant="outline" size="sm" onClick={history.loadMore} disabled={history.isFetchingMore} className="pointer-coarse:h-10">
              {history.isFetchingMore && <Loader2 className="animate-spin" />}
              加载更多
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
