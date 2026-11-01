// The Ceph cluster log of one node (/var/log/ceph/ceph.log, written where a
// monitor runs), newest at the bottom, following every 5 s.

import { useEffect, useRef, useState } from 'react'

import { useCephLog } from '@/api/ceph'
import { NodeSelect, SwitchField } from '@/components/form'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { cn } from '@/lib/utils'

import { logLevel, type CephLogLevel } from './model'
import { RefreshButton, Section } from './ui'

const LEVEL_CLASS: Record<NonNullable<CephLogLevel>, string> = {
  DBG: 'text-muted-foreground',
  INF: '',
  WRN: 'text-warning-strong',
  ERR: 'text-destructive',
  SEC: 'text-destructive',
}

export function LogView({ defaultNode, fixedNode }: { defaultNode: string; fixedNode?: boolean }) {
  const [node, setNode] = useState<string | undefined>(defaultNode)
  const [follow, setFollow] = useState(true)
  const log = useCephLog(node, 500, follow)
  const ref = useRef<HTMLDivElement>(null)
  const lines = log.data?.lines ?? []
  const last = lines.at(-1)?.n

  // Stick to the bottom while following.
  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [last, follow])

  return (
    <Section title="Ceph 日志" flush actions={<RefreshButton onClick={() => void log.refetch()} busy={log.isFetching} />} data-testid="ceph-log">
      <div className="grid gap-2 border-b border-border/60 p-3 sm:grid-cols-[minmax(0,16rem)_auto] sm:items-center sm:justify-between">
        {!fixedNode && <NodeSelect value={node} onValueChange={setNode} />}
        <SwitchField label="自动跟随" checked={follow} onCheckedChange={setFollow} className="sm:col-start-2" />
      </div>
      {log.isPending ? (
        <LoadingRows rows={8} className="p-4" />
      ) : log.error ? (
        <ErrorState error={log.error} onRetry={() => void log.refetch()} compact className="p-4" />
      ) : lines.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">日志为空（这个节点上可能没有监视器）。</p>
      ) : (
        <div ref={ref} className="max-h-[65vh] overflow-auto px-3 py-2" tabIndex={0} aria-label="日志内容">
          <pre className="font-mono text-[11px] leading-relaxed">
            {lines.map((l) => {
              const level = logLevel(l.t)
              return (
                <div key={l.n} className={cn('break-all whitespace-pre-wrap', level && LEVEL_CLASS[level])}>
                  {l.t}
                </div>
              )
            })}
          </pre>
        </div>
      )}
    </Section>
  )
}
