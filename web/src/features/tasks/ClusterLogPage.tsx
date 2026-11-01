import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AlertTriangle, Pause, Play, RefreshCw, ScrollText, Search, SearchX } from 'lucide-react'

import { useClusterResources } from '@/api/queries'
import {
  LOG_LEVEL_FILTERS,
  LOG_MAX_OPTIONS,
  filterClusterLog,
  useClusterLog,
  type LogLevelFilter,
} from '@/api/tasks-logs'
import { isNode, type ClusterResource } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { ClusterLogList, ClusterLogSkeleton } from './ClusterLogList'
import { useNow } from './hooks'
import { TasksNav } from './TasksNav'

const selectNodeNames = (all: ClusterResource[]) =>
  all
    .filter(isNode)
    .map((n) => n.node)
    .sort((a, b) => a.localeCompare(b))

const ALL_NODES = '__all__'

/** /cluster/log — the pmxcfs cluster log, live, with level / text / node filters. */
export default function ClusterLogPage() {
  const [params, setParams] = useSearchParams()
  const level = (LOG_LEVEL_FILTERS.some((l) => l.value === params.get('level')) ? params.get('level') : 'all') as LogLevelFilter
  const maxParam = Number(params.get('max'))
  const max = (LOG_MAX_OPTIONS as readonly number[]).includes(maxParam) ? maxParam : 200
  const nodeParam = params.get('node') ?? undefined
  const [query, setQuery] = useState('')
  const [paused, setPaused] = useState(false)

  const nodes = useClusterResources({ select: selectNodeNames }).data ?? []
  const log = useClusterLog(max, { paused })
  const now = useNow(true, 30_000)
  const entries = useMemo(
    () => filterClusterLog(log.data ?? [], { level, query, node: nodeParam }),
    [log.data, level, query, nodeParam],
  )

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params)
    if (value === undefined) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const filtered = level !== 'all' || !!query.trim() || !!nodeParam

  return (
    <>
      <PageHeader
        title="集群日志"
        description="集群文件系统（pmxcfs）记录的认证、任务与服务事件"
        actions={
          <Button
            variant={paused ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPaused(!paused)}
            className="pointer-coarse:h-10"
            aria-pressed={paused}
          >
            {paused ? <Play /> : <Pause />}
            {paused ? '继续' : '暂停'}
          </Button>
        }
      />
      <TasksNav className="mb-(--section-gap)" />

      <div className="grid grid-cols-1 gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value={level}
            onValueChange={(v) => v && setParam('level', v === 'all' ? undefined : v)}
            variant="outline"
            size="sm"
            aria-label="级别"
          >
            {LOG_LEVEL_FILTERS.map((l) => (
              <ToggleGroupItem key={l.value} value={l.value} className="px-3 text-xs">
                {l.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="relative order-last w-full sm:order-none sm:w-auto sm:min-w-56 sm:flex-1 lg:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索消息、服务或用户"
              aria-label="搜索日志"
              className="h-8 pl-9 pointer-coarse:h-10"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            {nodes.length > 1 && (
              <Select value={nodeParam ?? ALL_NODES} onValueChange={(v) => setParam('node', v === ALL_NODES ? undefined : v)}>
                <SelectTrigger size="sm" aria-label="节点" className="h-8 pointer-coarse:h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="end">
                  <SelectItem value={ALL_NODES}>全部节点</SelectItem>
                  {nodes.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={String(max)} onValueChange={(v) => setParam('max', v === '200' ? undefined : v)}>
              <SelectTrigger size="sm" aria-label="条数" className="h-8 pointer-coarse:h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                {LOG_MAX_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    最近 {m} 条
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <GlassCard flush className="relative overflow-hidden">
          {log.isFetching && !log.isPending && (
            <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-brand/10" aria-hidden>
              <div className="task-indeterminate h-full w-1/3 bg-brand/70" />
            </div>
          )}
          {log.isPending ? (
            <ClusterLogSkeleton />
          ) : log.isError && !log.data ? (
            <EmptyState
              icon={AlertTriangle}
              title="无法加载集群日志"
              description={errorMessage(log.error)}
              action={
                <Button variant="outline" onClick={() => void log.refetch()}>
                  <RefreshCw /> 重试
                </Button>
              }
            />
          ) : entries.length === 0 ? (
            <EmptyState
              icon={filtered ? SearchX : ScrollText}
              title={filtered ? '没有符合条件的日志' : '集群日志是空的'}
              description={filtered ? '换个级别或搜索词试试。' : undefined}
            />
          ) : (
            <ClusterLogList entries={entries} now={now} showNode={nodes.length > 1} />
          )}
        </GlassCard>

        {!log.isPending && (log.data?.length ?? 0) > 0 && (
          <div className="flex items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
            <span className="tabular">
              {filtered ? `${entries.length} / ${log.data?.length ?? 0} 条` : `${entries.length} 条`}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn('size-1.5 rounded-full', paused ? 'bg-muted-foreground' : 'animate-pulse bg-success')}
                aria-hidden
              />
              {paused ? '已暂停更新' : '每 5 秒自动更新'}
            </span>
          </div>
        )}
      </div>
    </>
  )
}
