import { useMemo, useState } from 'react'
import { ChevronRight, HardDrive, Search } from 'lucide-react'

import { useDiskList, type DiskEntry } from '@/api/node-disks'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'

import { DiskDetailDialog } from './DiskDetailDialog'
import {
  buildDiskTree,
  diskInUse,
  diskTypeLabel,
  diskUsageLabel,
  isPartition,
  smartHealthLabel,
  smartHealthTone,
  truthy,
  wearoutLeft,
} from './model'
import { HealthBadge, Num, ViewHeader } from './shared'

// Desktop columns: device | type | usage | size | GPT | model / serial | SMART | life
const COLS = 'lg:grid-cols-[minmax(8rem,1fr)_4.5rem_minmax(7rem,1fr)_5.5rem_3rem_minmax(9rem,1.4fr)_5rem_4.5rem_1rem]'

/** Physical disks with partitions; tap one for details, SMART and actions. */
export function DiskListView({ node }: { node: string }) {
  const list = useDiskList(node)
  const disks = useMemo(() => buildDiskTree(list.data ?? []), [list.data])
  const [open, setOpen] = useState<string | null>(null)
  const [last, setLast] = useState<string | null>(null)
  if (open && open !== last) setLast(open)
  const all = list.data ?? []
  const selected = all.find((d) => d.devpath === last) ?? null
  const partitionsOf = (devpath: string) => disks.find((d) => d.devpath === devpath)?.partitions ?? []

  return (
    <div className="grid gap-2">
      <ViewHeader title="磁盘" count={list.data ? disks.length : undefined} onRefresh={() => void list.refetch()} refreshing={list.isFetching} />
      <GlassCard flush className="overflow-hidden">
        {list.isPending ? (
          <LoadingRows rows={3} className="p-3" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} compact />
        ) : disks.length === 0 ? (
          <EmptyState icon={Search} title="没有找到磁盘" />
        ) : (
          <>
            <div
              aria-hidden
              className={cn('hidden gap-3 border-b border-border/60 px-(--card-p) py-2 text-xs text-muted-foreground lg:grid', COLS)}
            >
              <span>设备</span>
              <span>类型</span>
              <span>用途</span>
              <span className="text-right">大小</span>
              <span>GPT</span>
              <span>型号 / 序列号</span>
              <span>S.M.A.R.T.</span>
              <span className="text-right">剩余寿命</span>
              <span />
            </div>
            <ul className="divide-y divide-border/60" aria-label="磁盘">
              {disks.map((d) => (
                <li key={d.devpath}>
                  <DiskRow disk={d} onOpen={setOpen} />
                  {d.partitions.length > 0 && (
                    <ul aria-label={`${d.devpath} 的分区`} className="pb-1">
                      {d.partitions.map((part) => (
                        <li key={part.devpath}>
                          <DiskRow disk={part} onOpen={setOpen} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </GlassCard>
      <DiskDetailDialog
        node={node}
        disk={selected}
        partitions={selected ? partitionsOf(selected.devpath) : []}
        open={!!open && !!selected}
        onOpenChange={(o) => !o && setOpen(null)}
        onOpenPartition={setOpen}
      />
    </div>
  )
}

function DiskRow({ disk: d, onOpen }: { disk: DiskEntry; onOpen: (devpath: string) => void }) {
  const part = isPartition(d)
  const usage = diskUsageLabel(d)
  const used = diskInUse(d)
  const life = wearoutLeft(d.wearout)
  const tone = smartHealthTone(d.health)
  const modelText = [d.model, d.serial].filter(Boolean).join(' · ')
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(d.devpath)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(d.devpath)
        }
      }}
      aria-label={`${d.devpath}，${usage}`}
      className={cn(
        'group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-(--card-p) outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.04] paper:hover:bg-secondary/50 lg:gap-3',
        COLS,
        part ? 'min-h-11 py-1.5' : 'min-h-14 py-(--row-py)',
      )}
    >
      {/* Device (phones: everything stacks under it) */}
      <div className={cn('flex min-w-0 items-center gap-3', part && 'pl-5 lg:pl-4')}>
        {part ? (
          <span aria-hidden className="h-4 w-2.5 shrink-0 -translate-y-1 rounded-bl border-b border-l border-border" />
        ) : (
          <span
            aria-hidden
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand-strong ring-1 ring-brand/15 ring-inset paper:bg-secondary paper:text-foreground/70 paper:ring-border"
          >
            <HardDrive className="size-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={cn('truncate font-mono text-[13px]', !part && 'font-medium')}>{d.devpath}</span>
            {!part && <span className="shrink-0 text-xs text-muted-foreground lg:hidden">{diskTypeLabel(d.type)}</span>}
          </div>
          {/* Phone summary lines */}
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground lg:hidden">
            <span className={cn(used ? 'text-foreground/85' : 'text-success-strong')}>{usage}</span>
            {!part && modelText && <span className="truncate">{modelText}</span>}
          </div>
          {!part && (
            <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground lg:hidden">
              <span>GPT {truthy(d.gpt) ? '是' : '否'}</span>
              <span className="inline-flex items-center gap-1">
                SMART <HealthBadge tone={tone}>{smartHealthLabel(d.health)}</HealthBadge>
              </span>
              {life !== null && <span>寿命 {life}%</span>}
            </div>
          )}
        </div>
      </div>
      {/* Desktop columns */}
      <span className="hidden text-xs text-muted-foreground lg:block">{part ? '分区' : diskTypeLabel(d.type)}</span>
      <span className={cn('hidden truncate text-xs lg:block', used ? 'text-foreground/85' : 'text-success-strong')}>{usage}</span>
      <Num className="justify-self-end text-xs text-muted-foreground lg:text-[13px] lg:text-foreground">{formatBytes(d.size)}</Num>
      <span className="hidden text-xs text-muted-foreground lg:block">{part ? '' : truthy(d.gpt) ? '是' : '否'}</span>
      <span className="hidden min-w-0 lg:block">
        {!part && (
          <>
            <span className="block truncate text-xs">{d.model || '—'}</span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">{d.serial || ''}</span>
          </>
        )}
      </span>
      <span className="hidden text-xs lg:block">{!part && <HealthBadge tone={tone}>{smartHealthLabel(d.health)}</HealthBadge>}</span>
      <span className="hidden text-right text-xs text-muted-foreground lg:block">{part ? '' : life !== null ? `${life}%` : '—'}</span>
      <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
    </div>
  )
}
