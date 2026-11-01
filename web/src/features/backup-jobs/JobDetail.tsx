import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ChevronLeft, CircleCheck, CircleX, HardDrive, Pause, Pencil, Play, Search, Trash2 } from 'lucide-react'

import { useBackupJob, useBackupJobs, useIncludedVolumes, type IncludedGuest } from '@/api/backup-jobs'
import { useClusterResources } from '@/api/queries'
import { isGuest, type GuestType } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorCard, ErrorState, LoadingRows } from '@/components/QueryState'
import { ResourceIcon } from '@/components/ResourceIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Chip, InfoList } from '@/features/guest-backup/ui'
import { guestPath } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { matchGuest } from './GuestPicker'
import {
  MODE_LABEL,
  SELECTION_LABEL,
  compressLabel,
  describeJobRetention,
  describeNotification,
  describeSchedule,
  describeSelection,
  flag,
  includeReasonLabel,
  isJobEnabled,
  nextRunLabel,
  parseVmidList,
  selectionMode,
  volumeKey,
} from './logic'
import { jobPath } from './paths'
import { ScheduleRuns } from './ScheduleField'
import { jobTitle, useJobActions } from './useJobActions'

/** /datacenter/backup/:id — job details and the guests/disks it backs up. */
export function JobDetail() {
  const { id = '' } = useParams()
  const job = useBackupJob(id)
  const list = useBackupJobs()
  const actions = useJobActions({ afterDelete: jobPath() })
  const nextRun = list.data?.find((j) => j.id === id)?.['next-run']

  const back = (
    <Link
      to={jobPath()}
      className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="size-4" />
      全部备份计划
    </Link>
  )

  if (job.isError && !job.data) {
    return (
      <div className="grid gap-3">
        {back}
        <ErrorCard error={job.error} onRetry={() => void job.refetch()} title="无法读取备份计划" />
      </div>
    )
  }

  const j = job.data
  const enabled = j ? isJobEnabled(j) : true
  const mode = j ? selectionMode(j) : 'include'
  const preset = describeSchedule(j?.schedule)
  const notes = j?.['notes-template']?.replace(/\\n/g, ' ⏎ ').replace(/\\\\/g, '\\')
  const advanced = j
    ? [
        j.bwlimit !== undefined && `带宽 ${j.bwlimit === 0 ? '不限' : `${Math.round((j.bwlimit / 1024) * 100) / 100} MiB/s`}`,
        j.zstd !== undefined && `Zstd 线程 ${j.zstd}`,
        j.ionice !== undefined && `IO 优先级 ${j.ionice}`,
        j.performance && Object.keys(j.performance).length > 0 && `性能 ${typeof j.performance === 'string' ? j.performance : Object.entries(j.performance).map(([k, v]) => `${k}=${v}`).join(',')}`,
        j.fleecing && flagOf(j.fleecing) && `Fleecing ${typeof j.fleecing === 'object' && j.fleecing.storage ? `→ ${j.fleecing.storage}` : '开'}`,
        flag(j['repeat-missed']) && '补跑错过的备份',
        flag(j.protected) && '受保护',
        j['pbs-change-detection-mode'] && `PBS 变更检测 ${j['pbs-change-detection-mode']}`,
      ].filter(Boolean)
    : []

  return (
    <div className="grid gap-(--section-gap)">
      <div className="grid gap-2">
        {back}
        <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
          <div className="min-w-0 flex-1">
            {j ? (
              <>
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-lg font-semibold text-foreground">{jobTitle(j)}</h2>
                  <Chip tone={enabled ? 'success' : 'neutral'}>{enabled ? '已启用' : '已停用'}</Chip>
                </div>
                {j.comment?.trim() && <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{j.id}</p>}
              </>
            ) : (
              <Skeleton className="h-7 w-48" />
            )}
          </div>
          {j && actions.canModify && (
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto" role="toolbar" aria-label="计划操作">
              <Button variant="outline" onClick={() => actions.edit(j)}>
                <Pencil />
                编辑
              </Button>
              <Button variant="outline" onClick={() => actions.runNow(j)}>
                <Play />
                立即运行
              </Button>
              <Button variant="outline" onClick={() => void actions.toggle(j)}>
                {enabled ? <Pause /> : <Play />}
                {enabled ? '停用' : '启用'}
              </Button>
              <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => actions.remove(j)}>
                <Trash2 />
                删除
              </Button>
            </div>
          )}
        </div>
      </div>

      <GlassCard>
        {j ? (
          <div className="grid gap-x-10 gap-y-2.5 md:grid-cols-2">
            <InfoList
              items={[
                { label: '节点', value: j.node || '全部节点' },
                { label: '存储', value: j.storage ?? '—' },
                {
                  label: '计划',
                  value: (
                    <span>
                      <span className="font-mono">{j.schedule}</span>
                      {preset && <span className="text-muted-foreground">（{preset}）</span>}
                    </span>
                  ),
                },
                { label: '下次运行', value: enabled ? nextRunLabel(nextRun) : '已停用，不运行' },
                { label: '选择方式', value: SELECTION_LABEL[mode] },
                mode === 'pool'
                  ? { label: '资源池', value: j.pool }
                  : { label: mode === 'exclude' ? '排除' : '客户机', value: mode === 'exclude' ? parseVmidList(j.exclude).join('、') : describeSelection(j) },
              ]}
            />
            <InfoList
              items={[
                { label: '模式', value: MODE_LABEL[j.mode ?? 'snapshot'] },
                { label: '压缩', value: compressLabel(j.compress) },
                { label: '保留', value: describeJobRetention(j) },
                { label: '通知', value: describeNotification(j) },
                { label: '备注模板', value: notes ? <span className="font-mono text-xs">{notes}</span> : '—' },
                ...(advanced.length ? [{ label: '高级', value: advanced.join('；') }] : []),
              ]}
            />
            {enabled && j.schedule && <ScheduleRuns schedule={j.schedule} count={5} className="md:col-span-2 pt-2" />}
          </div>
        ) : (
          <div className="grid gap-3" aria-busy="true" aria-label="加载中">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        )}
      </GlassCard>

      <IncludedGuests id={id} />
      {actions.host}
    </div>
  )
}

function flagOf(v: unknown): boolean {
  if (typeof v === 'string') return /(^|,)enabled=1/.test(v)
  if (v && typeof v === 'object') return String((v as Record<string, unknown>).enabled) === '1'
  return false
}

/** Guests and disks the job backs up (PVE.dc.BackupDiskTree). */
function IncludedGuests({ id }: { id: string }) {
  const included = useIncludedVolumes(id)
  const { data: resources } = useClusterResources({ select: (all) => all.filter(isGuest) })
  const nodeOf = new Map((resources ?? []).map((g) => [g.vmid, g.node]))
  const [query, setQuery] = useState('')
  const guests = [...(included.data ?? [])].sort((a, b) => a.id - b.id)
  const shown = guests.filter((g) => matchGuest({ vmid: g.id, name: g.name, type: g.type as GuestType, node: nodeOf.get(g.id) ?? '' }, query))
  const disks = guests.reduce((n, g) => n + (g.children?.length ?? 0), 0)
  const excluded = guests.reduce((n, g) => n + (g.children?.filter((d) => !flag(d.included)).length ?? 0), 0)

  return (
    <GlassCard flush className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-(--card-p) py-3">
        <div className="min-w-0 flex-1">
          <h2 className="heading text-base font-medium text-foreground">包含的客户机</h2>
          <p className="text-xs text-muted-foreground">
            {included.isPending
              ? '正在读取…'
              : `${guests.length} 台客户机 · ${disks} 个磁盘${excluded ? `，其中 ${excluded} 个不备份` : ''}`}
          </p>
        </div>
        {guests.length > 5 && (
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名称、VMID、类型" aria-label="搜索客户机" className="h-9 pl-8" />
          </div>
        )}
      </div>
      {included.isError && !included.data ? (
        <ErrorState error={included.error} onRetry={() => void included.refetch()} compact />
      ) : included.isPending ? (
        <LoadingRows rows={2} />
      ) : guests.length === 0 ? (
        <EmptyState icon={HardDrive} title="没有客户机" description="按当前的选择方式，这个计划不会备份任何客户机。" className="py-8" />
      ) : (
        <ul aria-label="包含的客户机" className="divide-y divide-border/60">
          {shown.map((g) => (
            <IncludedGuestRow key={g.id} guest={g} node={nodeOf.get(g.id)} />
          ))}
          {shown.length === 0 && <li className="px-(--card-p) py-6 text-center text-sm text-muted-foreground">没有匹配的客户机</li>}
        </ul>
      )}
    </GlassCard>
  )
}

function IncludedGuestRow({ guest: g, node }: { guest: IncludedGuest; node: string | undefined }) {
  const type = (g.type === 'lxc' ? 'lxc' : 'qemu') as GuestType
  const vols = g.children ?? []
  const head = (
    <>
      <ResourceIcon type={type} variant="tile" />
      <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground tabular">{g.id}</span>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{g.name ?? '—'}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{vols.length ? `${vols.filter((v) => flag(v.included)).length}/${vols.length} 个磁盘` : '没有磁盘'}</span>
    </>
  )
  return (
    <li className="px-(--card-p) py-3" data-testid="included-guest" data-vmid={g.id}>
      {node ? (
        <Link to={guestPath({ node, type, vmid: g.id })} className="-mx-2 flex min-h-11 items-center gap-3 rounded-lg px-2 transition-colors hover:bg-accent/50">
          {head}
        </Link>
      ) : (
        <div className="flex min-h-11 items-center gap-3">{head}</div>
      )}
      {vols.length > 0 && (
        <ul className="mt-1 grid gap-1 pl-11">
          {vols.map((v) => {
            const yes = flag(v.included)
            return (
              <li key={v.id} className="flex min-w-0 items-start gap-2 text-sm" data-volume={volumeKey(v.id)}>
                {yes ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-strong" aria-label="备份" />
                ) : (
                  <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="不备份" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs text-foreground">{volumeKey(v.id)}</span>
                    <span className="min-w-0 truncate text-xs text-muted-foreground">{v.name}</span>
                  </div>
                  <div className={cn('text-xs', yes ? 'text-muted-foreground' : 'text-destructive')}>
                    {yes ? '备份' : '不备份'}
                    {v.reason && ` · ${includeReasonLabel(v.reason)}`}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}
