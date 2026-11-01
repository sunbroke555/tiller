import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDown, ChevronsUp, Download, Filter, Loader2, Pause, Play, RefreshCw, RotateCcw, WrapText } from 'lucide-react'
import { toast } from 'sonner'

import {
  PRIORITY_LABEL,
  formatJournalTime,
  journalLineText,
  type JournalFilters,
  type JournalLine,
} from '@/api/node-summary'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { downloadText, fileStamp } from './clipboard'
import { JOURNAL_MAX_LINES, JOURNAL_PAGE, dayString, useJournal, type JournalMode, type JournalRange } from './useJournal'

const ALL = '__all__'

export function priorityClass(p: number | undefined): string | undefined {
  if (p === undefined) return undefined
  if (p <= 2) return 'text-destructive font-medium'
  if (p === 3) return 'text-destructive'
  if (p === 4) return 'text-warning'
  if (p === 5) return 'text-info'
  if (p === 7) return 'text-muted-foreground'
  return undefined
}

function LineView({ line, host }: { line: JournalLine; host?: string }) {
  if (line.reboot) {
    return (
      <div className="my-1 flex items-center gap-2 text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <span>
          {line.time ? `${formatJournalTime(line.time)} ` : ''}
          {line.text ?? '重新启动'}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
    )
  }
  if (line.text !== undefined) return <div className="min-h-[1lh]">{line.text}</div>
  return (
    <div className={cn('min-h-[1lh]', priorityClass(line.priority))} data-priority={line.priority}>
      <span className="text-muted-foreground">{formatJournalTime(line.time)} </span>
      {host && <span className="hidden text-muted-foreground lg:inline">{host} </span>}
      <span className={cn(priorityClass(line.priority) ? undefined : 'text-brand paper:text-brand-2')}>
        {line.identifier}
        {line.pid !== undefined ? `[${line.pid}]` : ''}
      </span>
      : {line.message}
    </div>
  )
}

export interface JournalViewProps {
  node: string
  /** Fixed systemd unit (per-service log); hides the unit filter. */
  unit?: string
  /** Height of the log area (CSS). */
  className?: string
  logClassName?: string
}

/** Live / time range journal viewer with server-side filters and "load older". */
export function JournalView({ node, unit, className, logClassName }: JournalViewProps) {
  const today = dayString(new Date())
  const threeDaysAgo = dayString(new Date(Date.now() - 3 * 86400_000))
  const [mode, setMode] = useState<JournalMode>('live')
  const [rangeDraft, setRangeDraft] = useState<JournalRange>({ since: threeDaysAgo, until: today })
  const [range, setRange] = useState<JournalRange>(rangeDraft)
  const [filters, setFilters] = useState<JournalFilters>(() => (unit ? { unit } : {}))
  const [showFilters, setShowFilters] = useState(false)
  const [paused, setPaused] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const [wrap, setWrap] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const ids = useId()

  const journal = useJournal({ node, mode, range, filters, follow: !paused, reloadKey })

  // --------------------------------------------------------------- scrolling
  const scroller = useRef<HTMLDivElement>(null)
  const prevHeight = useRef<{ height: number; top: number; first?: string } | null>(null)
  const firstKey = journal.lines[0]?.key

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const prev = prevHeight.current
    const prepended = !!prev?.first && prev.first !== firstKey && journal.lines.some((l) => l.key === prev.first)
    if (prev && prepended) {
      // Older lines were prepended: keep the same lines in view.
      el.scrollTop = prev.top + (el.scrollHeight - prev.height)
    } else if (mode === 'live' && atBottom) {
      el.scrollTop = el.scrollHeight
    } else if (mode === 'range' && !prev?.first) {
      el.scrollTop = 0
    }
    prevHeight.current = { height: el.scrollHeight, top: el.scrollTop, first: firstKey }
  }, [journal.lines, firstKey, mode, atBottom])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (bottom !== atBottom) setAtBottom(bottom)
    if (prevHeight.current) prevHeight.current.top = el.scrollTop
  }

  useEffect(() => {
    setAtBottom(true)
    prevHeight.current = null
  }, [mode, range, filters, reloadKey])

  const toBottom = () => {
    setAtBottom(true)
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // ----------------------------------------------------------------- filters
  const [serviceDraft, setServiceDraft] = useState('')
  const [unitDraft, setUnitDraft] = useState('')
  const applyText = (e?: FormEvent) => {
    e?.preventDefault()
    setFilters((f) => ({ ...f, service: serviceDraft.trim() || undefined, unit: unit ?? (unitDraft.trim() || undefined) }))
  }
  const activeFilters =
    (filters.priority ? 1 : 0) + (filters.kernel ? 1 : 0) + (filters.service ? 1 : 0) + (!unit && filters.unit ? 1 : 0)
  const resetFilters = () => {
    setServiceDraft('')
    setUnitDraft('')
    setFilters(unit ? { unit } : {})
  }
  const canFilter = journal.structured !== false

  const download = () => {
    const text = journal.lines.map((l) => journalLineText(l, journal.host)).join('\n')
    downloadText(`${text}\n`, `${node}-${unit ? `${unit}-` : ''}journal-${fileStamp()}.log`)
  }

  const loadOlder = () => {
    journal.loadOlder().catch((e: unknown) => toast.error('加载更早的日志失败', { description: errorMessage(e) }))
  }

  const lineCount = journal.lines.length
  const shownHost = journal.host

  return (
    <div className={cn('flex min-h-0 flex-col gap-2', className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={mode}
          onValueChange={(v) => (v === 'live' || v === 'range') && setMode(v)}
          aria-label="模式"
        >
          <ToggleGroupItem value="live" className="h-9 px-3 text-xs pointer-coarse:h-11">
            实时
          </ToggleGroupItem>
          <ToggleGroupItem value="range" className="h-9 px-3 text-xs pointer-coarse:h-11">
            时间范围
          </ToggleGroupItem>
        </ToggleGroup>
        {mode === 'live' && !journal.syslogFallback && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 pointer-coarse:h-11"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
          >
            {paused ? <Play /> : <Pause />}
            {paused ? '继续' : '暂停'}
          </Button>
        )}
        {canFilter && (
          <Button
            variant={showFilters ? 'secondary' : 'outline'}
            size="sm"
            className="h-9 pointer-coarse:h-11"
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
            aria-controls={`${ids}-filters`}
          >
            <Filter /> 筛选
            {activeFilters > 0 && (
              <Badge className="h-4.5 min-w-4.5 rounded-full px-1 text-[10px] tabular">{activeFilters}</Badge>
            )}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setWrap((w) => !w)}
            aria-pressed={wrap}
            aria-label={wrap ? '不换行' : '自动换行'}
            title={wrap ? '不换行' : '自动换行'}
            className={cn(!wrap && 'text-muted-foreground')}
          >
            <WrapText />
          </Button>
          <Button variant="ghost" size="icon" onClick={download} disabled={lineCount === 0} aria-label="下载日志" title="下载日志">
            <Download />
          </Button>
        </div>
      </div>

      {mode === 'range' && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setRange(rangeDraft)
            setReloadKey((k) => k + 1)
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor={`${ids}-since`} className="text-xs text-muted-foreground">
              从
            </Label>
            <Input
              id={`${ids}-since`}
              type="date"
              value={rangeDraft.since}
              max={rangeDraft.until}
              onChange={(e) => setRangeDraft((r) => ({ ...r, since: e.target.value }))}
              className="w-40"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${ids}-until`} className="text-xs text-muted-foreground">
              到
            </Label>
            <Input
              id={`${ids}-until`}
              type="date"
              value={rangeDraft.until}
              min={rangeDraft.since}
              max={today}
              onChange={(e) => setRangeDraft((r) => ({ ...r, until: e.target.value }))}
              className="w-40"
            />
          </div>
          <Button type="submit" variant="outline">
            <RefreshCw /> 查询
          </Button>
        </form>
      )}

      {canFilter && showFilters && (
        <form
          id={`${ids}-filters`}
          onSubmit={applyText}
          className="grid gap-3 rounded-xl border border-border/60 bg-foreground/[0.02] p-3 sm:grid-cols-2 lg:grid-cols-4 paper:bg-secondary/40"
        >
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground" id={`${ids}-prio`}>
              最低优先级
            </Label>
            <Select
              value={filters.priority ?? ALL}
              onValueChange={(v) => setFilters((f) => ({ ...f, priority: v === ALL ? undefined : v }))}
            >
              <SelectTrigger aria-labelledby={`${ids}-prio`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value={ALL}>全部</SelectItem>
                {['0', '1', '2', '3', '4', '5', '6'].map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                    {p !== '0' ? ' 及以上' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${ids}-svc`} className="text-xs text-muted-foreground">
              程序（标识符，可用 *）
            </Label>
            <Input
              id={`${ids}-svc`}
              list={`${ids}-svc-list`}
              value={serviceDraft}
              onChange={(e) => setServiceDraft(e.target.value)}
              onBlur={() => applyText()}
              placeholder="例如 pve*"
              disabled={filters.kernel}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="search"
            />
            <datalist id={`${ids}-svc-list`}>
              {journal.identifiers.map((i) => (
                <option key={i} value={i} />
              ))}
            </datalist>
          </div>
          {!unit && (
            <div className="grid gap-1">
              <Label htmlFor={`${ids}-unit`} className="text-xs text-muted-foreground">
                systemd 单元
              </Label>
              <Input
                id={`${ids}-unit`}
                list={`${ids}-unit-list`}
                value={unitDraft}
                onChange={(e) => setUnitDraft(e.target.value)}
                onBlur={() => applyText()}
                placeholder="例如 pveproxy"
                disabled={filters.kernel}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="search"
              />
              <datalist id={`${ids}-unit-list`}>
                {journal.units.map((u) => (
                  <option key={u} value={u.replace(/\.service$/, '')} />
                ))}
              </datalist>
            </div>
          )}
          <div className="flex items-end justify-between gap-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <Switch checked={!!filters.kernel} onCheckedChange={(c) => setFilters((f) => ({ ...f, kernel: c || undefined }))} />
              仅内核
            </label>
            <Button type="button" variant="ghost" size="sm" onClick={resetFilters} disabled={activeFilters === 0} className="pointer-coarse:h-11">
              <RotateCcw /> 重置
            </Button>
          </div>
          <button type="submit" className="sr-only">
            应用筛选
          </button>
        </form>
      )}

      {/* Log */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={onScroll}
          role="log"
          aria-live="off"
          aria-label={unit ? `${unit} 日志` : '系统日志'}
          aria-busy={journal.loading}
          className={cn(
            'min-h-32 flex-1 overflow-auto overscroll-contain rounded-xl border border-border/60 bg-foreground/[0.03] px-3 py-2.5 font-mono text-[11.5px] leading-[1.55] sm:px-4 sm:text-xs paper:bg-secondary/50',
            wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre',
            logClassName,
          )}
          data-testid="journal"
        >
          {mode === 'live' && !journal.loading && !journal.syslogFallback && lineCount > 0 && (
            <div className="mb-2 flex justify-center font-sans">
              {journal.atStart ? (
                <span className="text-xs text-muted-foreground">没有更早的日志</span>
              ) : (
                <Button variant="ghost" size="sm" onClick={loadOlder} disabled={journal.loadingOlder} className="text-xs pointer-coarse:h-11">
                  {journal.loadingOlder ? <Loader2 className="animate-spin" /> : <ChevronsUp />}
                  加载更早的 {JOURNAL_PAGE} 条
                </Button>
              )}
            </div>
          )}
          {journal.truncated && (
            <div className="mb-2 text-center font-sans text-xs text-muted-foreground">只保留最近 {JOURNAL_MAX_LINES} 行</div>
          )}
          {journal.loading ? (
            <div className="flex items-center gap-2 font-sans text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> 正在读取日志…
            </div>
          ) : journal.error && lineCount === 0 ? (
            <div className="grid justify-items-start gap-2 font-sans text-sm">
              <span className="text-destructive">{errorMessage(journal.error)}</span>
              <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
                <RefreshCw /> 重试
              </Button>
            </div>
          ) : lineCount === 0 ? (
            <div className="font-sans text-muted-foreground">
              {mode === 'range' ? '这段时间没有日志' : activeFilters > 0 ? '没有符合筛选条件的日志' : '暂无日志'}
            </div>
          ) : (
            journal.lines.map((l) => <LineView key={l.key} line={l} host={shownHost} />)
          )}
        </div>
        {mode === 'live' && !atBottom && lineCount > 0 && (
          <button
            type="button"
            onClick={toBottom}
            className="surface-strong absolute right-3 bottom-3 inline-flex h-9 items-center gap-1.5 rounded-full px-3 font-sans text-xs font-medium text-foreground pointer-coarse:h-11"
          >
            <ArrowDown className="size-3.5" /> 最新
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="tabular">
          {lineCount} 行
          {mode === 'live' && !journal.syslogFallback && (paused ? ' · 已暂停' : ' · 实时更新')}
        </span>
        {journal.structured === false && (
          <span>{journal.syslogFallback ? '此 PVE 版本不支持按单元读取 journal，显示的是 syslog。' : '此 PVE 版本的日志接口不支持筛选。'}</span>
        )}
      </div>
    </div>
  )
}
