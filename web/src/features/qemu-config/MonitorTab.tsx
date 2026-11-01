import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CornerDownLeft, Eraser, Gauge, Loader2, PowerOff } from 'lucide-react'

import { qemuMonitor } from '@/api/qemu-config'
import { useSession } from '@/api/useSession'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { GuestTabProps } from '@/features/guest/types'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

/** Quick commands; non-root users may only run "info" commands. */
const QUICK = ['info status', 'info version', 'info cpus', 'info block', 'info network', 'info balloon', 'info pci', 'info usb', 'help']

interface Entry {
  id: number
  command: string
  output?: string
  error?: string
  pending?: boolean
}

const HISTORY_MAX = 20
/** Like the official monitor: trim old output beyond 10 commands and 5000 lines. */
const COMMAND_LIMIT = 10
const LINE_LIMIT = 5000

function trim(entries: Entry[]): Entry[] {
  const lines = (list: Entry[]) => list.reduce((n, e) => n + 1 + (e.output ?? e.error ?? '').split('\n').length, 0)
  const out = [...entries]
  while (out.length > COMMAND_LIMIT && lines(out) > LINE_LIMIT) out.shift()
  return out
}

/** /guest/:node/qemu/:vmid/monitor — QEMU human monitor (HMP) console. */
export default function MonitorTab({ node, vmid, guest }: GuestTabProps) {
  const session = useSession()
  const isRoot = session?.username === 'root@pam'
  const [entries, setEntries] = useState<Entry[]>([])
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histPos, setHistPos] = useState(-1)
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)
  const running = guest.status === 'running'
  const busy = entries.some((e) => e.pending)

  useEffect(() => {
    const el = outputRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  const run = async (raw: string) => {
    const cmd = raw.trim()
    if (!cmd || busy) return
    const id = nextId.current++
    setEntries((list) => trim([...list, { id, command: cmd, pending: true }]))
    setHistory((h) => [cmd, ...h.filter((c) => c !== cmd)].slice(0, HISTORY_MAX))
    setHistPos(-1)
    setCommand('')
    try {
      const output = await qemuMonitor(node, vmid, cmd)
      setEntries((list) => list.map((e) => (e.id === id ? { ...e, output: output ?? '', pending: false } : e)))
    } catch (e) {
      setEntries((list) => list.map((x) => (x.id === id ? { ...x, error: errorMessage(e), pending: false } : x)))
    }
    inputRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault()
      const pos = Math.min(histPos + 1, history.length - 1)
      setHistPos(pos)
      setCommand(history[pos]!)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const pos = histPos - 1
      setHistPos(Math.max(pos, -1))
      setCommand(pos < 0 ? '' : history[pos]!)
    }
  }

  if (!running) {
    return (
      <GlassCard>
        <EmptyState icon={PowerOff} title="虚拟机未运行" description="QEMU 监视器只能在虚拟机运行时使用。" />
      </GlassCard>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="-mx-4 flex gap-2 overflow-x-auto scrollbar-none px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="常用命令">
        {QUICK.map((q) => (
          <Button
            key={q}
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 font-mono text-xs pointer-coarse:h-10"
            disabled={busy || (!isRoot && !q.startsWith('info') && q !== 'help')}
            onClick={() => void run(q)}
          >
            {q}
          </Button>
        ))}
      </div>
      <GlassCard flush className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-(--card-p) py-2">
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            <Gauge className="size-4 text-brand-strong" aria-hidden />
            QEMU 监视器
          </span>
          <Button variant="ghost" size="sm" onClick={() => setEntries([])} disabled={entries.length === 0} className="text-muted-foreground">
            <Eraser />
            清屏
          </Button>
        </div>
        <div
          ref={outputRef}
          role="log"
          aria-live="polite"
          aria-label="监视器输出"
          className="h-[max(12rem,calc(100dvh-31rem))] overflow-y-auto lg:h-[max(16rem,calc(100dvh-21rem))] bg-black/[0.03] px-(--card-p) py-3 font-mono text-xs leading-relaxed dark:bg-black/30 paper:bg-secondary/40"
        >
          {entries.length === 0 ? (
            <p className="text-muted-foreground">
              输入 HMP 命令，例如 <span className="text-foreground">info status</span>；输入 <span className="text-foreground">help</span> 查看全部命令。
              {!isRoot && ' 非 root 用户只能执行 info 类命令。'}
            </p>
          ) : (
            entries.map((e) => (
              <div key={e.id} className="mb-3 last:mb-0">
                <div className="text-brand-strong">
                  <span className="select-none text-faint"># </span>
                  {e.command}
                </div>
                {e.pending ? (
                  <Loader2 className="mt-1 size-3.5 animate-spin text-muted-foreground" aria-label="执行中" />
                ) : e.error ? (
                  <pre className="whitespace-pre-wrap break-all text-destructive">{e.error}</pre>
                ) : (
                  <pre className={cn('whitespace-pre-wrap break-all text-foreground/90', !e.output && 'text-faint')}>{e.output || '（无输出）'}</pre>
                )}
              </div>
            ))
          )}
        </div>
        <form
          className="flex items-center gap-2 border-t border-border/70 p-2"
          onSubmit={(e) => {
            e.preventDefault()
            void run(command)
          }}
        >
          <span className="pl-2 font-mono text-sm text-faint select-none" aria-hidden>
            #
          </span>
          <Input
            ref={inputRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="输入命令，回车执行"
            aria-label="监视器命令"
            className="border-0 bg-transparent font-mono shadow-none focus-visible:ring-0"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button type="submit" size="icon" aria-label="执行" disabled={!command.trim() || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <CornerDownLeft />}
          </Button>
        </form>
      </GlassCard>
    </div>
  )
}
