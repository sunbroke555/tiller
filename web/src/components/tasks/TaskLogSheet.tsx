import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, Download, Loader2, Square } from 'lucide-react'
import { toast } from 'sonner'

import { parseUpid, stopTask, taskState, useTaskLog, useTaskStatus } from '@/api/tasks'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'
import { DASH, formatDateTime, formatDuration } from '@/lib/format'
import { describeTask } from '@/lib/taskTypes'
import { cn } from '@/lib/utils'

import { TaskStateBadge } from './TaskStateIcon'
import { closeTaskLog, useTaskLogTarget } from './tracker'

export interface TaskLogSheetProps {
  node: string | null | undefined
  upid: string | null | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Heading; defaults to the task type description ("启动 VM 100"). */
  title?: string
  /** End time (Unix seconds) from a task list; shows the duration of a finished task. */
  endtime?: number | undefined
}

/**
 * Task details with a live, auto-scrolling log, a stop button while running
 * and a download of the full log. Bottom sheet on phones, dialog on desktop.
 */
export function TaskLogSheet({ node, upid, open, onOpenChange, title, endtime }: TaskLogSheetProps) {
  const active = open && !!node && !!upid
  const status = useTaskStatus(active ? node : null, active ? upid : null)
  const parsed = upid ? parseUpid(upid) : null
  const state = status.data ? taskState(status.data) : 'running'
  const log = useTaskLog(node, upid, { follow: state === 'running', enabled: active && !!status.data })
  const [stopping, setStopping] = useState(false)

  const scroller = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)

  useEffect(() => {
    if (open) setFollow(true)
  }, [open, upid])

  // Stick to the bottom while following; layout effect avoids a visible jump.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && follow) el.scrollTop = el.scrollHeight
  }, [log.lines.length, follow])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (atBottom !== follow) setFollow(atBottom)
  }

  const stop = async () => {
    if (!node || !upid) return
    setStopping(true)
    try {
      await stopTask(node, upid)
      toast.success('已请求停止任务')
      void status.refetch()
    } catch (e) {
      toast.error('停止任务失败', { description: errorMessage(e) })
    } finally {
      setStopping(false)
    }
  }

  const download = () => {
    const text = log.lines.map((l) => l.t).join('\n')
    const blob = new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(parsed?.type ?? 'task')}-${parsed?.id || parsed?.node || 'log'}-${parsed?.starttime ?? ''}.log`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const info = status.data ?? parsed
  const heading = title || (info ? describeTask(info) : '任务日志')
  const started = info?.starttime
  const exit = status.data?.exitstatus

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={heading}
      headerExtra={<TaskStateBadge state={state} />}
      description={
        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          <span>节点 {info?.node ?? node ?? DASH}</span>
          <span>{info?.user ?? DASH}</span>
          <span className="tabular">{started ? formatDateTime(started) : DASH}</span>
          {state === 'running' && started ? (
            <span className="tabular">已运行 {formatDuration(Date.now() / 1000 - started)}</span>
          ) : started && endtime ? (
            <span className="tabular">耗时 {formatDuration(endtime - started)}</span>
          ) : null}
        </span>
      }
      bodyClassName="flex min-h-0 flex-col px-0 pb-0 sm:px-0"
      footer={
        <>
          <Button type="button" variant="outline" onClick={download} disabled={log.lines.length === 0}>
            <Download />
            下载日志
          </Button>
          {state === 'running' ? (
            <Button type="button" variant="destructive" onClick={() => void stop()} disabled={stopping}>
              {stopping ? <Loader2 className="animate-spin" /> : <Square className="fill-current" />}
              停止任务
            </Button>
          ) : (
            <Button type="button" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          )}
        </>
      }
    >
      {exit && exit !== 'OK' && (
        <div
          className={cn(
            'mx-5 mb-3 rounded-xl border px-3 py-2 text-sm break-words lg:mx-6',
            state === 'warning' ? 'border-warning/30 bg-warning/10 text-warning' : 'border-destructive/30 bg-destructive/10 text-destructive',
          )}
        >
          {exit}
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={onScroll}
          className="max-h-[min(60dvh,32rem)] min-h-32 overflow-auto border-y border-border/60 bg-foreground/[0.03] px-5 py-3 font-mono text-xs leading-relaxed lg:px-6 paper:bg-secondary/50"
          data-testid="task-log"
        >
          {log.isLoading && log.lines.length === 0 ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> 正在读取日志…
            </div>
          ) : log.lines.length === 0 ? (
            <div className="text-muted-foreground">{log.error ? errorMessage(log.error) : '（暂无日志）'}</div>
          ) : (
            <pre className="break-words whitespace-pre-wrap">
              {log.lines.map((l) => (
                <div key={l.n} className={cn(/^TASK ERROR/.test(l.t) && 'text-destructive', /^TASK WARNINGS/.test(l.t) && 'text-warning')}>
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

/** The app-wide log sheet driven by openTaskLog(); mounted once in AppShell. */
export function TaskLogHost() {
  const target = useTaskLogTarget()
  // Keep the last target while the close animation runs.
  const [last, setLast] = useState(target)
  if (target && target !== last) setLast(target)
  return (
    <TaskLogSheet
      node={last?.node}
      upid={last?.upid}
      title={last?.title}
      endtime={last?.endtime}
      open={!!target}
      onOpenChange={(o) => !o && closeTaskLog()}
    />
  )
}
