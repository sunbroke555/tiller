// Firewall log of a node or guest (GET …/firewall/log). Shows the newest
// lines; since/until narrow it to a time range (rotated logs included);
// "加载更早" grows the window; optional auto refresh while no end time is set.

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronsUp, Loader2, RefreshCw, ScrollText, X } from 'lucide-react'

import { fetchFirewallLog, fwKeys, type FirewallScope, type LogPage } from '@/api/firewall'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import { localToEpoch, parseLogLine } from './model'

const PAGE = 500

interface Range {
  since?: number
  until?: number
}

/** The newest `window` lines: one small request for the total, then the tail. */
async function fetchTail(scope: FirewallScope, range: Range, window: number, signal: AbortSignal): Promise<LogPage & { start: number }> {
  const head = await fetchFirewallLog(scope, { start: 0, limit: window, ...range }, signal)
  if (head.total <= window) return { ...head, start: 0 }
  const start = head.total - window
  const tail = await fetchFirewallLog(scope, { start, limit: window, ...range }, signal)
  return { ...tail, start }
}

export function LogView({ scope }: { scope: FirewallScope }) {
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [range, setRange] = useState<Range>({})
  const [pages, setPages] = useState(1)
  const [follow, setFollow] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const live = follow && range.until === undefined
  const query = useQuery({
    queryKey: [...fwKeys.log(scope), range, pages],
    queryFn: ({ signal }) => fetchTail(scope, range, PAGE * pages, signal),
    placeholderData: keepPreviousData,
    refetchInterval: live ? 5_000 : false,
  })

  const lines = (query.data?.lines ?? []).filter((l) => !(l.n === 1 && l.t === 'no content'))
  const total = query.data?.total ?? 0
  const hasOlder = (query.data?.start ?? 0) > 0

  // Keep the view pinned to the newest line unless the user scrolled up.
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [query.data])

  function apply(e: FormEvent) {
    e.preventDefault()
    setPages(1)
    stick.current = true
    setRange({ since: localToEpoch(since), until: localToEpoch(until) })
  }

  function clear() {
    setSince('')
    setUntil('')
    setPages(1)
    stick.current = true
    setRange({})
  }

  const filtered = range.since !== undefined || range.until !== undefined

  return (
    <GlassCard flush className="flex min-w-0 flex-col overflow-hidden">
      <form onSubmit={apply} className="flex flex-wrap items-end gap-x-3 gap-y-2 border-b border-border/70 px-(--card-p) py-3">
        <div className="grid min-w-0 flex-1 basis-40 gap-1">
          <Label htmlFor="fw-log-since" className="text-xs text-muted-foreground">
            开始时间
          </Label>
          <Input id="fw-log-since" type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} className="h-9 pointer-coarse:h-10" />
        </div>
        <div className="grid min-w-0 flex-1 basis-40 gap-1">
          <Label htmlFor="fw-log-until" className="text-xs text-muted-foreground">
            结束时间
          </Label>
          <Input id="fw-log-until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} className="h-9 pointer-coarse:h-10" />
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" variant="outline" className="pointer-coarse:h-10">
            筛选
          </Button>
          {filtered && (
            <Button type="button" size="sm" variant="ghost" onClick={clear} className="pointer-coarse:h-10">
              <X /> 清除
            </Button>
          )}
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-(--card-p) py-2 text-xs text-muted-foreground">
        <span className="tabular" aria-live="polite">
          {query.data ? (lines.length < total ? `显示最后 ${lines.length} 行，共 ${total} 行` : `共 ${lines.length} 行`) : '加载中…'}
          {filtered && '（已筛选）'}
        </span>
        <label className={cn('ml-auto flex items-center gap-2', range.until !== undefined && 'opacity-50')}>
          <Switch checked={live} disabled={range.until !== undefined} onCheckedChange={setFollow} aria-label="自动刷新" />
          自动刷新
        </label>
        <Button type="button" size="sm" variant="ghost" onClick={() => void query.refetch()} disabled={query.isFetching} className="pointer-coarse:h-10">
          {query.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />} 刷新
        </Button>
      </div>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="h-[calc(100dvh-30rem)] min-h-[16rem] overflow-auto border-t border-border/60 bg-foreground/[0.02] px-(--card-p) py-2 font-mono text-xs leading-relaxed lg:h-[calc(100dvh-30rem)] lg:min-h-[18rem]"
        role="log"
        aria-label="防火墙日志"
      >
        {hasOlder && (
          <div className="mb-2 flex justify-center">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                stick.current = false
                setPages((p) => p + 1)
              }}
            >
              <ChevronsUp /> 加载更早的 {PAGE} 行
            </Button>
          </div>
        )}
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        ) : query.data && lines.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="没有日志"
            description={filtered ? '这个时间段内没有防火墙日志。' : '规则或策略设置了日志级别后，匹配的包会记在这里。'}
            className="font-sans"
          />
        ) : (
          lines.map((l) => <LogLineView key={l.n} text={l.t} />)
        )}
      </div>
    </GlassCard>
  )
}

const VERDICT_CLASS = {
  ACCEPT: 'text-success-strong',
  DROP: 'text-destructive',
  REJECT: 'text-warning-strong',
} as const

function LogLineView({ text }: { text: string }) {
  const p = parseLogLine(text)
  if (!p) return <div className="break-all whitespace-pre-wrap">{text}</div>
  const verdictAt = p.verdict ? p.message.indexOf(p.verdict) : -1
  return (
    <div className="break-all whitespace-pre-wrap">
      <span className="text-muted-foreground">{p.time} </span>
      <span className="text-brand-strong">{p.chain}</span>{' '}
      {verdictAt >= 0 ? (
        <>
          {p.message.slice(0, verdictAt)}
          <span className={cn('font-semibold', VERDICT_CLASS[p.verdict!])}>{p.verdict}</span>
          {p.message.slice(verdictAt + p.verdict!.length)}
        </>
      ) : (
        p.message
      )}
    </div>
  )
}
