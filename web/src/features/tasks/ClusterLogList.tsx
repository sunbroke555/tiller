import { useEffect, useRef } from 'react'
import { ExternalLink } from 'lucide-react'

import { logTone, splitUpids, LOG_PRIORITY_LABEL, type ClusterLogEntry, type LogTone } from '@/api/tasks-logs'
import { parseUpid } from '@/api/tasks'
import { Skeleton } from '@/components/ui/skeleton'
import { openTaskLog } from '@/components/tasks/tracker'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { describeTask } from '@/lib/taskTypes'
import { cn } from '@/lib/utils'

import { formatTaskTime } from './format'

const TONE_DOT: Record<LogTone, string> = {
  error: 'bg-destructive',
  warning: 'bg-warning',
  notice: 'bg-info',
  info: 'bg-foreground/25',
}

const TONE_BADGE: Record<LogTone, string> = {
  error: 'bg-destructive/12 text-destructive',
  warning: 'bg-warning/14 text-warning',
  notice: 'bg-info/12 text-info',
  info: 'text-muted-foreground',
}

/** Message with UPIDs turned into buttons that open the task log. */
export function LogMessage({ msg }: { msg: string }) {
  return (
    <>
      {splitUpids(msg).map((seg, i) => {
        if ('text' in seg) return <span key={i}>{seg.text}</span>
        const parsed = parseUpid(seg.upid)
        if (!parsed) return <span key={i}>{seg.upid}</span>
        return (
          <button
            key={i}
            type="button"
            title={seg.upid}
            onClick={(e) => {
              e.stopPropagation()
              openTaskLog({ node: parsed.node, upid: seg.upid })
            }}
            className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-brand/10 px-1.5 align-baseline text-[0.95em] font-medium text-brand underline-offset-2 transition-colors hover:bg-brand/15 hover:underline paper:bg-secondary paper:text-foreground"
          >
            {describeTask(parsed)}
            <ExternalLink className="size-3 opacity-70" aria-hidden />
          </button>
        )
      })}
    </>
  )
}

/**
 * Cluster log rows, newest first. Entries that arrived since the previous
 * render slide in; errors and warnings are tinted.
 */
export function ClusterLogList({
  entries,
  now,
  showNode = false,
  compact = false,
}: {
  entries: readonly ClusterLogEntry[]
  now: number
  showNode?: boolean
  compact?: boolean
}) {
  const desktop = useIsDesktop()
  // Highlight entries that were not in the previous list (none on the first one).
  const seen = useRef<Set<string> | null>(null)
  const previous = seen.current
  useEffect(() => {
    seen.current = new Set(entries.map((e) => e.id))
  }, [entries])

  const cols = showNode
    ? 'grid-cols-[8.5rem_7rem_8.5rem_7rem_3.5rem_minmax(0,1fr)]'
    : 'grid-cols-[8.5rem_8.5rem_7rem_3.5rem_minmax(0,1fr)]'

  return (
    <div>
      {desktop && !compact && (
        <div className={cn('grid gap-4 border-b border-border/70 px-(--card-p) py-2.5 text-xs font-medium text-muted-foreground', cols)} aria-hidden>
          <span className="pl-4">时间</span>
          {showNode && <span>节点</span>}
          <span>服务</span>
          <span>用户</span>
          <span>级别</span>
          <span>消息</span>
        </div>
      )}
      <ul className="divide-y divide-border/70" aria-label="集群日志">
        {entries.map((e) => {
          const tone = logTone(e.pri)
          const fresh = previous !== null && !previous.has(e.id)
          const rowTint = tone === 'error' ? 'bg-destructive/[0.04]' : tone === 'warning' ? 'bg-warning/[0.05]' : ''
          return (
            <li
              key={e.id}
              data-pri={e.pri}
              className={cn(rowTint, fresh && 'animate-in duration-500 fade-in-0 slide-in-from-top-1')}
            >
              {desktop && !compact ? (
                <div className={cn('grid items-start gap-4 px-(--card-p) py-2 text-sm', cols)}>
                  <span className="flex items-center gap-2.5 text-muted-foreground tabular">
                    <span className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden />
                    {formatTaskTime(e.time, now)}
                  </span>
                  {showNode && <span className="truncate text-muted-foreground">{e.node}</span>}
                  <span className="truncate text-muted-foreground">
                    {e.tag}
                    <span className="text-faint">[{e.pid}]</span>
                  </span>
                  <span className="truncate text-muted-foreground" title={e.user}>
                    {e.user}
                  </span>
                  <span>
                    <span className={cn('rounded-full px-1.5 py-0.5 text-[11px]', TONE_BADGE[tone])}>{LOG_PRIORITY_LABEL[e.pri] ?? e.pri}</span>
                  </span>
                  <span className={cn('min-w-0 break-words', tone === 'error' ? 'text-destructive' : 'text-foreground')}>
                    <LogMessage msg={e.msg} />
                  </span>
                </div>
              ) : (
                <div className={cn('flex gap-3 px-(--card-p)', compact ? 'py-2' : 'py-(--row-py)')}>
                  <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                      <span className="tabular">{formatTaskTime(e.time, now)}</span>
                      <span className="truncate">
                        {[showNode && e.node, e.tag, e.user].filter(Boolean).join(' · ')}
                      </span>
                      {tone !== 'info' && (
                        <span className={cn('ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none', TONE_BADGE[tone])}>
                          {LOG_PRIORITY_LABEL[e.pri] ?? e.pri}
                        </span>
                      )}
                    </div>
                    <div className={cn('mt-0.5 text-sm break-words', tone === 'error' ? 'text-destructive' : 'text-foreground')}>
                      <LogMessage msg={e.msg} />
                    </div>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function ClusterLogSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border/70" aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3 px-(--card-p) py-3.5">
          <Skeleton className="mt-1 size-1.5 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  )
}
