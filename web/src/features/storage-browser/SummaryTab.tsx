import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronRight, CircleCheck, CircleSlash, Share2 } from 'lucide-react'

import {
  useStorageConfig,
  useStorageContent,
  useStorageRrd,
  useStorageStatus,
  type StorageRrdTimeframe,
} from '@/api/storage-browser'
import { GlassCard } from '@/components/GlassCard'
import { SectionHeader } from '@/components/PageHeader'
import { UsageBar } from '@/components/UsageBar'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { STORAGE_CONTENT_LABEL, storageContents, type StorageTabProps } from '@/features/storage/types'
import { DASH, formatBytes, formatPercent, ratio } from '@/lib/format'
import { storagePath } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { CONTENT_ICON, CONTENT_ORDER, storageTypeLabel } from './labels'
import { UsageChart } from './UsageChart'
import { parsePruneBackups, PRUNE_KEYS, PRUNE_LABEL } from './volumes'

const TIMEFRAMES: { value: StorageRrdTimeframe; label: string }[] = [
  { value: 'hour', label: '时' },
  { value: 'day', label: '天' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
]

/** Storage summary: usage, status, configuration, content breakdown and usage history. */
export default function SummaryTab({ node, storage, resource }: StorageTabProps) {
  const status = useStorageStatus(node, storage)
  const config = useStorageConfig(storage)
  const [timeframe, setTimeframe] = useState<StorageRrdTimeframe>('day')
  const rrd = useStorageRrd(node, storage, timeframe)
  const content = useStorageContent(node, storage, undefined, { refetchInterval: 60_000 })

  const s = status.data
  const used = s?.used ?? resource.disk
  const total = s?.total ?? resource.maxdisk
  const avail = s?.avail ?? (total !== undefined && used !== undefined ? total - used : undefined)
  const usage = ratio(used, total)
  const contents = storageContents(s?.content ?? resource.content)
  const active = s ? s.active === 1 : resource.status === 'available'
  const enabled = s ? s.enabled !== 0 : config.data ? config.data.disable !== 1 : true
  const shared = (s?.shared ?? resource.shared) === 1

  const breakdown = useMemo(() => {
    const out = new Map<string, { count: number; bytes: number }>()
    for (const v of content.data ?? []) {
      const e = out.get(v.content) ?? { count: 0, bytes: 0 }
      e.count++
      e.bytes += v.size ?? v['approximate-size'] ?? 0
      out.set(v.content, e)
    }
    return out
  }, [content.data])

  const location = config.data ? configLocation(config.data) : null
  const retention = config.data?.['prune-backups'] ? parsePruneBackups(config.data['prune-backups']) : null

  return (
    <div className="grid gap-(--section-gap)">
      <div className="grid gap-(--row-gap) lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <GlassCard className="grid content-start gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">已用空间</div>
              {status.isPending && !resource.maxdisk ? (
                <Skeleton className="mt-2 h-9 w-28" />
              ) : (
                <div className="mt-1 text-4xl font-semibold tracking-tight text-foreground tabular paper:font-serif">
                  {formatPercent(usage)}
                </div>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              <StatusPill ok={active} label={active ? '已激活' : '未激活'} />
              {!enabled && <StatusPill ok={false} label="已禁用" />}
              {shared && (
                <span className="inline-flex h-6 items-center gap-1 rounded-full bg-info/12 px-2.5 text-xs text-info paper:bg-secondary paper:text-foreground/75">
                  <Share2 className="size-3" aria-hidden />
                  共享
                </span>
              )}
            </div>
          </div>
          <UsageBar value={usage} showPercent={false} />
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <Figure label="已用" value={formatBytes(used)} />
            <Figure label="可用" value={formatBytes(avail)} />
            <Figure label="总量" value={formatBytes(total)} />
          </dl>
        </GlassCard>

        <GlassCard className="grid content-start gap-0 py-2">
          <InfoRow label="类型">{storageTypeLabel(s?.type ?? resource.plugintype)}</InfoRow>
          {location && <InfoRow label={location.label}>{location.value}</InfoRow>}
          <InfoRow label="节点">{config.data?.nodes ? config.data.nodes.split(',').join('、') : '所有节点'}</InfoRow>
          {contents.includes('backup') && (
            <InfoRow label="备份保留">
              {retention && Object.keys(retention).length > 0
                ? PRUNE_KEYS.filter((k) => retention[k])
                    .map((k) => `${PRUNE_LABEL[k]} ${retention[k]}`)
                    .join(' · ')
                : '全部保留'}
            </InfoRow>
          )}
          <InfoRow label="内容" last>
            <span className="flex flex-wrap justify-end gap-1.5">
              {contents.length
                ? contents.map((c) => (
                    <span key={c} className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                      {STORAGE_CONTENT_LABEL[c]}
                    </span>
                  ))
                : DASH}
            </span>
          </InfoRow>
        </GlassCard>
      </div>

      {contents.length > 0 && (
        <section aria-labelledby="storage-contents">
          <SectionHeader title={<span id="storage-contents">内容</span>} />
          <div className="grid grid-cols-2 gap-(--row-gap) sm:grid-cols-3 xl:grid-cols-4">
            {CONTENT_ORDER.filter((c) => contents.includes(c)).map((c) => {
              const Icon = CONTENT_ICON[c]
              const b = breakdown.get(c)
              return (
                <GlassCard key={c} asChild interactive className="px-3.5 py-3 sm:px-(--card-p)">
                  <Link to={storagePath(node, storage, c)} className="grid gap-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Icon className="size-4 text-brand paper:text-foreground/70" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{STORAGE_CONTENT_LABEL[c]}</span>
                      <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden />
                    </div>
                    {content.isPending ? (
                      <Skeleton className="h-6 w-16" />
                    ) : (
                      <div className="flex items-baseline gap-2">
                        <span className="text-xl font-semibold text-foreground tabular">{b?.count ?? 0}</span>
                        <span className="truncate text-xs text-muted-foreground tabular">
                          {b?.bytes ? formatBytes(b.bytes) : content.isError ? '无法读取' : '空'}
                        </span>
                      </div>
                    )}
                  </Link>
                </GlassCard>
              )
            })}
          </div>
        </section>
      )}

      <section aria-labelledby="storage-usage-history">
        <SectionHeader title={<span id="storage-usage-history">用量趋势</span>}>
          <ToggleGroup
            type="single"
            value={timeframe}
            onValueChange={(v) => v && setTimeframe(v as StorageRrdTimeframe)}
            variant="outline"
            size="sm"
            aria-label="时间范围"
          >
            {TIMEFRAMES.map((t) => (
              <ToggleGroupItem key={t.value} value={t.value} className="min-w-10 px-3 text-xs pointer-coarse:h-9">
                {t.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </SectionHeader>
        <GlassCard>
          {rrd.isPending ? (
            <Skeleton className="h-52 rounded-xl" />
          ) : rrd.isError ? (
            <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">无法加载用量数据</div>
          ) : (
            <UsageChart data={rrd.data} timeframe={timeframe} />
          )}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-(--chart-1)" aria-hidden /> 已用
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0 w-3 border-t border-dashed border-muted-foreground" aria-hidden /> 总量
            </span>
          </div>
        </GlassCard>
      </section>
    </div>
  )
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  const Icon = ok ? CircleCheck : CircleSlash
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs',
        ok ? 'bg-success/12 text-success' : 'bg-destructive/12 text-destructive',
        'paper:bg-secondary',
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-foreground/[0.035] px-3 py-2 paper:bg-secondary/60">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium text-foreground tabular">{value}</dd>
    </div>
  )
}

function InfoRow({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <div
      className={cn(
        'flex min-h-11 items-center justify-between gap-4 py-2 text-sm',
        !last && 'border-b border-border/60',
      )}
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right break-all text-foreground">{children}</span>
    </div>
  )
}

/** Where the storage lives, by plugin type. */
function configLocation(c: Record<string, unknown>): { label: string; value: string } | null {
  const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : undefined)
  if (str('server') && str('export')) return { label: '位置', value: `${str('server')}:${str('export')}` }
  if (str('server') && str('share')) return { label: '位置', value: `//${str('server')}/${str('share')}` }
  if (str('server') && str('datastore')) return { label: '数据存储', value: `${str('server')} / ${str('datastore')}` }
  if (str('path')) return { label: '路径', value: str('path')! }
  if (str('vgname')) return { label: '卷组', value: str('thinpool') ? `${str('vgname')} / ${str('thinpool')}` : str('vgname')! }
  if (str('pool')) return { label: '存储池', value: str('pool')! }
  return null
}
