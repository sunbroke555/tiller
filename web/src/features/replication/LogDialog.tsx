// Log of a job's last run (GET /nodes/{node}/replication/{id}/log), refreshed
// while open, like the official "Replication Log" window.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, Loader2, RefreshCw } from 'lucide-react'

import { useReplicationLog, type ReplicationJob } from '@/api/replication'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import type { JobState } from './logic'
import { StateChip } from './ui'

export function LogDialog({
  node,
  job,
  state,
  open,
  onOpenChange,
  onScheduleNow,
}: {
  node: string | undefined
  job: ReplicationJob | null
  state: JobState | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Shown as a footer button when the user may run the job. */
  onScheduleNow?: (() => void) | undefined
}) {
  const log = useReplicationLog(node, job?.id, { enabled: open, interval: state?.kind === 'syncing' ? 1_000 : 3_000 })
  const lines = log.data ?? []
  const scroller = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  useEffect(() => {
    if (open) setFollow(true)
  }, [open, job?.id])
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && follow) el.scrollTop = el.scrollHeight
  }, [lines.length, follow])
  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (atBottom !== follow) setFollow(atBottom)
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={`复制日志 ${job?.id ?? ''}`}
      headerExtra={state && <StateChip state={state} />}
      description={job ? `客户机 ${job.guest} · ${node ?? '?'} → ${job.target} · 只保留最近一次运行的日志` : undefined}
      bodyClassName="flex min-h-0 flex-col px-0 pb-0 sm:px-0"
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => void log.refetch()} disabled={log.isFetching} className="lg:mr-auto">
            <RefreshCw className={cn(log.isFetching && 'animate-spin')} />
            刷新
          </Button>
          {onScheduleNow && (
            <Button type="button" variant="outline" onClick={onScheduleNow} disabled={state?.kind === 'syncing' || state?.kind === 'removing'}>
              立即同步
            </Button>
          )}
          <Button type="button" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </>
      }
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={onScroll}
          className="max-h-[min(60dvh,32rem)] min-h-40 overflow-auto border-y border-border/60 bg-foreground/[0.03] px-5 py-3 font-mono text-xs leading-relaxed lg:px-6 paper:bg-secondary/50"
          data-testid="replication-log"
        >
          {log.isPending && open ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> 正在读取日志…
            </div>
          ) : log.error && lines.length === 0 ? (
            <div className="text-destructive">{errorMessage(log.error)}</div>
          ) : lines.length === 0 || (lines.length === 1 && /unable to open file/.test(lines[0]!.t)) ? (
            <div className="text-muted-foreground">（还没有日志：任务尚未运行过）</div>
          ) : (
            <pre className="break-words whitespace-pre-wrap">
              {lines.map((l) => (
                <div key={l.n} className={cn(/\berror\b|failed|unable/i.test(l.t) && 'text-destructive')}>
                  {l.t || ' '}
                </div>
              ))}
            </pre>
          )}
        </div>
        {!follow && (
          <button
            type="button"
            onClick={() => setFollow(true)}
            className="surface-strong absolute right-4 bottom-3 inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-foreground pointer-coarse:h-11"
          >
            <ArrowDown className="size-3.5" /> 最新
          </button>
        )}
      </div>
    </ResponsiveDialog>
  )
}
