// Ceph configuration (read-only, like the official panel): ceph.conf, the
// monitor configuration database and the CRUSH map.

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

import { useCephConfigDb, useCephConfigRaw, useCephCrush } from '@/api/ceph'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { CodeBlock, RefreshButton, Section } from './ui'

type Tab = 'conf' | 'db' | 'crush'

const TABS: { id: Tab; label: string }[] = [
  { id: 'conf', label: 'ceph.conf' },
  { id: 'db', label: '配置数据库' },
  { id: 'crush', label: 'CRUSH 映射' },
]

export function ConfigView({ apiNode }: { apiNode: string }) {
  const [tab, setTab] = useState<Tab>('conf')
  return (
    <div className="grid min-w-0 gap-(--section-gap)">
      <div role="tablist" aria-label="配置" className="flex w-max max-w-full gap-1 overflow-x-auto rounded-xl bg-secondary/60 p-1 paper:bg-secondary">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'inline-flex h-9 items-center rounded-lg px-3.5 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-10',
              tab === t.id && 'bg-background font-medium text-foreground shadow-sm paper:bg-card',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'conf' && <RawConfig apiNode={apiNode} />}
      {tab === 'db' && <ConfigDb apiNode={apiNode} />}
      {tab === 'crush' && <CrushMap apiNode={apiNode} />}
    </div>
  )
}

function RawConfig({ apiNode }: { apiNode: string }) {
  const q = useCephConfigRaw(apiNode)
  return (
    <Section title="/etc/pve/ceph.conf" actions={<RefreshButton onClick={() => void q.refetch()} busy={q.isFetching} />}>
      {q.isPending ? <LoadingRows rows={6} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} compact /> : <CodeBlock aria-label="ceph.conf 内容">{q.data}</CodeBlock>}
    </Section>
  )
}

function CrushMap({ apiNode }: { apiNode: string }) {
  const q = useCephCrush(apiNode)
  return (
    <Section title="CRUSH 映射" actions={<RefreshButton onClick={() => void q.refetch()} busy={q.isFetching} />}>
      {q.isPending ? <LoadingRows rows={8} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} compact /> : <CodeBlock aria-label="CRUSH 映射内容">{q.data}</CodeBlock>}
    </Section>
  )
}

function ConfigDb({ apiNode }: { apiNode: string }) {
  const q = useCephConfigDb(apiNode)
  const [filter, setFilter] = useState('')
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (q.data ?? [])
      .filter((r) => !f || `${r.section} ${r.name} ${r.value}`.toLowerCase().includes(f))
      .sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name))
  }, [q.data, filter])
  return (
    <Section title="配置数据库" count={q.data?.length} flush actions={<RefreshButton onClick={() => void q.refetch()} busy={q.isFetching} />}>
      <div className="border-b border-border/60 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="筛选" aria-label="筛选配置" className="pl-9" />
        </div>
      </div>
      {q.isPending ? (
        <LoadingRows rows={4} className="p-4" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact className="p-4" />
      ) : rows.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">没有配置项。</p>
      ) : (
        <ul className="divide-y divide-border/60" aria-label="配置项">
          {rows.map((r) => (
            <li key={`${r.section}/${r.mask ?? ''}/${r.name}`} className="grid gap-0.5 px-4 py-2.5 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-4" data-config={r.name}>
              <span className="font-mono text-xs text-muted-foreground">
                {r.section}
                {r.mask ? `/${r.mask}` : ''}
              </span>
              <span className="font-mono text-[13px] break-all">{r.name}</span>
              <span className="font-mono text-[13px] break-all text-foreground/85">
                {r.value}
                {r.can_update_at_runtime === 0 || r.can_update_at_runtime === false ? <span className="ml-2 text-[11px] text-muted-foreground">（需重启）</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
