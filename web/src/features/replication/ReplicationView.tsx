// The replication job list shared by the datacenter page, the node tab and
// the guest tab. The datacenter lists /cluster/replication and merges the
// state from the node each guest lives on; node and guest read
// /nodes/{node}/replication (jobs whose guest lives there) directly.

import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  ArrowRight,
  ChevronRight,
  Ellipsis,
  FileText,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Trash2,
} from 'lucide-react'

import { useClusterResources } from '@/api/queries'
import {
  replicationKeys,
  scheduleReplicationNow,
  updateReplicationJob,
  useNodeReplication,
  useReplicationJobs,
  useReplicationStates,
  type ReplicationJob,
  type ReplicationStatus,
} from '@/api/replication'
import { isGuest, isNode, type GuestResource } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { fireTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/errors'
import { formatRelativeTime } from '@/lib/format'
import { guestName, guestPath, nodePath } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { DeleteJobDialog, JobDialog } from './JobDialogs'
import { LogDialog } from './LogDialog'
import {
  compareJobs,
  describeSchedule,
  formatLastSync,
  formatNextSync,
  formatRateLimit,
  formatSyncDuration,
  jobState,
  DEFAULT_SCHEDULE,
  type JobState,
} from './logic'
import { Fact, Notice, StateChip, StateIcon, TONE_TEXT, useCanReplicate, useCanReplicateAnywhere } from './ui'

export type ReplicationScope =
  | { kind: 'dc' }
  | { kind: 'node'; node: string }
  | { kind: 'guest'; node: string; vmid: number; pool?: string | undefined; template?: boolean }

export interface JobRow {
  job: ReplicationJob
  status: ReplicationStatus | undefined
  /** Node the guest lives on: where "schedule now" and the log are. */
  node: string | undefined
  guest: GuestResource | undefined
  state: JobState
}

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit' | 'delete' | 'log' | 'detail'; id: string }
  | null

// ------------------------------------------------------------------- data

function useRows(scope: ReplicationScope) {
  const resources = useClusterResources()
  const guests = useMemo(() => new Map((resources.data ?? []).filter(isGuest).map((g) => [g.vmid, g])), [resources.data])
  const onlineNodes = useMemo(
    () => new Set((resources.data ?? []).filter(isNode).filter((n) => n.status === 'online').map((n) => n.node)),
    [resources.data],
  )
  const nodeCount = (resources.data ?? []).filter(isNode).length

  // Datacenter: configuration of every job + state from the guests' nodes.
  const dc = scope.kind === 'dc'
  const jobs = useReplicationJobs(dc)
  const stateNodes = useMemo(() => {
    if (!dc) return []
    const set = new Set<string>()
    for (const j of jobs.data ?? []) {
      const n = guests.get(j.guest)?.node ?? j.source
      if (n && onlineNodes.has(n)) set.add(n)
    }
    return [...set].sort()
  }, [dc, jobs.data, guests, onlineNodes])
  const states = useReplicationStates(stateNodes)

  // Node / guest: the node's own view.
  const local = useNodeReplication(dc ? null : scope.node, scope.kind === 'guest' ? scope.vmid : undefined)

  const rows: JobRow[] = useMemo(() => {
    if (dc) {
      return (jobs.data ?? [])
        .map((job) => {
          const status = states.byId.get(job.id)
          const guest = guests.get(job.guest)
          const node = status?.node ?? guest?.node ?? job.source
          return { job, status, node, guest, state: jobState(job, status ?? (node && !onlineNodes.has(node) ? null : undefined)) }
        })
        .sort((a, b) => compareJobs(a.job, b.job))
    }
    return (local.data ?? [])
      .map((s) => ({ job: s, status: s, node: scope.node, guest: guests.get(s.guest), state: jobState(s, s) }))
      .sort((a, b) => compareJobs(a.job, b.job))
  }, [dc, jobs.data, states.byId, local.data, guests, onlineNodes, scope])

  const query = dc ? jobs : local
  return {
    rows,
    nodeCount,
    isPending: query.isPending || (dc && states.pending && rows.length === 0),
    error: query.error,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
    failedNodes: dc ? states.failedNodes : [],
  }
}

// ------------------------------------------------------------------- view

export function ReplicationView({ scope }: { scope: ReplicationScope }) {
  const data = useRows(scope)
  const canReplicate = useCanReplicate()
  const canAny = useCanReplicateAnywhere()
  const [dialog, setDialog] = useState<Dialog>(null)
  // Keep the last dialog mounted while it animates out.
  const [shown, setShown] = useState<Dialog>(null)
  if (dialog && dialog !== shown) setShown(dialog)
  const isOpen = dialog !== null && dialog === shown
  const close = (o: boolean) => {
    if (!o) setDialog(null)
  }
  const rowOf = (id: string | undefined) => data.rows.find((r) => r.job.id === id)
  const active = shown && shown.kind !== 'create' ? rowOf(shown.id) : undefined

  const standalone = data.nodeCount === 1
  const canCreate =
    scope.kind === 'guest' ? canReplicate(scope.vmid, scope.pool) : canAny
  const createDisabled = standalone ? '存储复制需要至少两个节点' : !canCreate ? '没有 VM.Replicate 权限' : null

  const counts = useMemo(() => {
    let failed = 0
    let syncing = 0
    for (const r of data.rows) {
      if (r.state.kind === 'error') failed++
      if (r.state.kind === 'syncing') syncing++
    }
    return { failed, syncing }
  }, [data.rows])

  const actions: RowActions = {
    open: (r) => setDialog({ kind: 'detail', id: r.job.id }),
    edit: (r) => setDialog({ kind: 'edit', id: r.job.id }),
    remove: (r) => setDialog({ kind: 'delete', id: r.job.id }),
    log: (r) => setDialog({ kind: 'log', id: r.job.id }),
    scheduleNow: (r) => {
      if (!r.node) return
      fireTask(scheduleReplicationNow(r.node, r.job.id), {
        title: `立即同步 ${r.job.id}`,
        syncSuccessMessage: `${r.job.id} 已排队，一分钟内开始同步`,
        invalidate: [replicationKeys.nodeScope(r.node), replicationKeys.jobs()],
      })
    },
    toggle: (r) => {
      const enable = !!r.job.disable
      fireTask(updateReplicationJob(r.job.id, enable ? { delete: 'disable' } : { disable: 1 }), {
        title: `${enable ? '启用' : '停用'}复制任务 ${r.job.id}`,
        syncSuccessMessage: `已${enable ? '启用' : '停用'}复制任务 ${r.job.id}`,
      })
    },
    can: (r) => canReplicate(r.job.guest, r.guest?.pool),
  }

  const title = scope.kind === 'guest' ? '复制' : '复制任务'
  const summary = data.isPending ? (
    '正在读取…'
  ) : data.rows.length === 0 ? (
    '还没有复制任务'
  ) : (
    <>
      {data.rows.length} 个任务
      {counts.syncing > 0 && ` · ${counts.syncing} 个同步中`}
      {counts.failed > 0 && <span className="text-destructive"> · {counts.failed} 个失败</span>}
    </>
  )

  return (
    <div className="grid gap-(--section-gap)">
      {standalone && <Notice tone="warning">存储复制需要至少两个节点的集群。这台主机是独立节点。</Notice>}
      {data.failedNodes.length > 0 && (
        <Notice tone="warning">无法读取节点 {data.failedNodes.join('、')} 上的同步状态。</Notice>
      )}
      <GlassCard flush className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-(--card-p) py-3">
          <div className="min-w-0 flex-1">
            <h2 className="heading text-base font-medium text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground" data-testid="replication-summary">
              {summary}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="刷新"
            title="刷新"
            onClick={data.refetch}
            disabled={data.isFetching}
            className="text-muted-foreground"
          >
            <RefreshCw className={cn(data.isFetching && 'animate-spin')} />
          </Button>
          <Button onClick={() => setDialog({ kind: 'create' })} disabled={!!createDisabled} title={createDisabled ?? undefined}>
            <Plus />
            添加
          </Button>
        </div>

        {data.isPending ? (
          <ListSkeleton />
        ) : data.error ? (
          <div className="p-(--card-p)">
            <Notice tone="error">无法读取复制任务：{errorMessage(data.error)}</Notice>
          </div>
        ) : data.rows.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title="还没有复制任务"
            description={
              scope.kind === 'node'
                ? '这里列出客户机在本节点上的复制任务。复制按计划把本地 ZFS 存储上的磁盘增量同步到其他节点，节点故障时可以在目标节点上快速恢复。'
                : '复制按计划把客户机在本地 ZFS 存储上的磁盘增量同步到另一个节点，节点故障时可以在目标节点上快速恢复（最多丢失一个同步周期的数据）。'
            }
            action={
              !createDisabled && (
                <Button variant="outline" onClick={() => setDialog({ kind: 'create' })}>
                  <Plus />
                  添加复制任务
                </Button>
              )
            }
          />
        ) : (
          <>
            <ListHeader scope={scope} />
            <ul className="divide-y divide-border/60" aria-label="复制任务">
              {data.rows.map((r) => (
                <JobRowItem key={r.job.id} row={r} scope={scope} actions={actions} />
              ))}
            </ul>
          </>
        )}
      </GlassCard>

      <JobDialog
        open={shown?.kind === 'create' && isOpen}
        onOpenChange={close}
        guest={scope.kind === 'guest' ? scope.vmid : undefined}
        node={scope.kind === 'node' ? scope.node : undefined}
      />
      {shown?.kind === 'edit' && active && <JobDialog open={isOpen} onOpenChange={close} job={active.job} />}
      {shown?.kind === 'delete' && <DeleteJobDialog open={isOpen} onOpenChange={close} job={active?.job ?? null} />}
      {shown?.kind === 'log' && (
        <LogDialog
          open={isOpen}
          onOpenChange={close}
          node={active?.node}
          job={active?.job ?? null}
          state={active?.state ?? null}
          onScheduleNow={active && actions.can(active) && active.node ? () => actions.scheduleNow(active) : undefined}
        />
      )}
      {shown?.kind === 'detail' && (
        <JobDetailDialog
          open={isOpen}
          onOpenChange={close}
          row={active ?? null}
          scope={scope}
          actions={actions}
          onAction={(kind) => active && setDialog({ kind, id: active.job.id })}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------------- rows

interface RowActions {
  open: (r: JobRow) => void
  edit: (r: JobRow) => void
  remove: (r: JobRow) => void
  log: (r: JobRow) => void
  scheduleNow: (r: JobRow) => void
  toggle: (r: JobRow) => void
  can: (r: JobRow) => boolean
}

const COLS = {
  state: 'w-28',
  last: 'w-32',
  duration: 'w-16',
  next: 'w-32',
  actions: 'w-[7.5rem]',
}

function ListHeader({ scope }: { scope: ReplicationScope }) {
  return (
    <div className="hidden items-center gap-3 border-b border-border/60 px-(--card-p) py-2 text-xs text-muted-foreground lg:flex" aria-hidden>
      <span className="w-4" />
      <span className="min-w-0 flex-1">{scope.kind === 'guest' ? '目标 · 计划' : '客户机 → 目标 · 计划'}</span>
      <span className={COLS.state}>状态</span>
      <span className={COLS.last}>上次同步</span>
      <span className={cn(COLS.duration, 'text-right')}>耗时</span>
      <span className={COLS.next}>下次同步</span>
      <span className={COLS.actions} />
    </div>
  )
}

function scheduleText(job: ReplicationJob): string {
  const raw = job.schedule || DEFAULT_SCHEDULE
  return describeSchedule(raw) ?? raw
}

function canRun(r: JobRow): boolean {
  return !!r.status && !!r.node && r.state.kind !== 'syncing' && r.state.kind !== 'removing'
}

function JobRowItem({ row, scope, actions }: { row: JobRow; scope: ReplicationScope; actions: RowActions }) {
  const { job, status, state } = row
  const allowed = actions.can(row)
  const guestLabel = row.guest ? guestName(row.guest) : `客户机 ${job.guest}`
  return (
    <li data-testid="replication-row" data-job={job.id}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => actions.open(row)}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            actions.open(row)
          }
        }}
        aria-label={`复制任务 ${job.id}，${state.label}`}
        className="group flex min-h-16 cursor-pointer items-center gap-3 px-(--card-p) py-(--row-py) transition-colors outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.04] paper:hover:bg-secondary/50"
      >
        <StateIcon state={state} className="max-lg:mt-0.5 max-lg:self-start" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {scope.kind !== 'guest' && (
              <>
                <span className="shrink-0 font-mono text-[13px] text-muted-foreground tabular">{job.guest}</span>
                <span className="truncate font-medium">{guestLabel}</span>
              </>
            )}
            <ArrowRight className={cn('size-3.5 shrink-0 text-faint', scope.kind === 'guest' && 'hidden')} aria-hidden />
            <span className={cn('truncate', scope.kind === 'guest' ? 'font-medium' : 'text-foreground/85')}>
              {scope.kind === 'guest' && <span className="text-muted-foreground">复制到 </span>}
              {job.target}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-faint">#{job.jobnum}</span>
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span className={cn('lg:hidden', TONE_TEXT[state.tone])}>{state.label}</span>
            <span className="lg:hidden">·</span>
            <span className="truncate">{scheduleText(job)}</span>
            {job.rate ? <span className="truncate">· {formatRateLimit(job.rate)}</span> : null}
            {status?.last_sync && !status.pid ? <span className="lg:hidden">· 上次 {formatRelativeTime(status.last_sync)}</span> : null}
            {job.comment && <span className="max-w-full truncate text-foreground/70">· {job.comment}</span>}
          </div>
          {status?.error && <p className="mt-1 line-clamp-2 text-xs break-all text-destructive">{status.error}</p>}
        </div>
        <div className={cn('hidden shrink-0 lg:block', COLS.state)}>
          <StateChip state={state} />
        </div>
        <div className={cn('hidden shrink-0 text-xs tabular lg:block', COLS.last)}>{formatLastSync(status)}</div>
        <div className={cn('hidden shrink-0 text-right text-xs tabular lg:block', COLS.duration)}>
          {status?.last_sync ? formatSyncDuration(status.duration) : '—'}
        </div>
        <div className={cn('hidden shrink-0 text-xs tabular lg:block', COLS.next)}>{formatNextSync(status ? { ...status, disable: job.disable } : undefined)}</div>
        <div className={cn('hidden shrink-0 items-center justify-end gap-0.5 lg:flex', COLS.actions)} onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            aria-label={`立即同步 ${job.id}`}
            title="立即同步"
            disabled={!allowed || !canRun(row)}
            onClick={() => actions.scheduleNow(row)}
          >
            <Play />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            aria-label={`${job.id} 的日志`}
            title="日志"
            disabled={!row.node || !status}
            onClick={() => actions.log(row)}
          >
            <FileText />
          </Button>
          <RowMenu row={row} actions={actions} allowed={allowed} />
        </div>
        <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 lg:hidden" aria-hidden />
      </div>
    </li>
  )
}

function RowMenu({ row, actions, allowed }: { row: JobRow; actions: RowActions; allowed: boolean }) {
  const removing = !!row.job.remove_job
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`${row.job.id} 的更多操作`} className="text-muted-foreground">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem disabled={!allowed || removing} onSelect={() => actions.edit(row)}>
          <Pencil />
          编辑
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!allowed || removing} onSelect={() => actions.toggle(row)}>
          {row.job.disable ? <Play /> : <Pause />}
          {row.job.disable ? '启用' : '停用'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={!allowed} onSelect={() => actions.remove(row)}>
          <Trash2 />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------------------------------------------------------------- details

function JobDetailDialog({
  row,
  scope,
  actions,
  open,
  onOpenChange,
  onAction,
}: {
  row: JobRow | null
  scope: ReplicationScope
  actions: RowActions
  open: boolean
  onOpenChange: (open: boolean) => void
  onAction: (kind: 'edit' | 'delete' | 'log') => void
}) {
  if (!row) {
    return (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="复制任务">
        <p className="py-6 text-center text-sm text-muted-foreground">这个任务已经不存在。</p>
      </ResponsiveDialog>
    )
  }
  const { job, status, state } = row
  const allowed = actions.can(row)
  const removing = !!job.remove_job
  const raw = job.schedule || DEFAULT_SCHEDULE
  const described = describeSchedule(raw)
  const guestLabel = row.guest ? guestName(row.guest) : `客户机 ${job.guest}`
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={`复制任务 ${job.id}`}
      headerExtra={<StateChip state={state} />}
      description={
        <span>
          {guestLabel}（{job.guest}）· {row.node ?? job.source ?? '?'} → {job.target}
        </span>
      }
      bodyClassName="grid gap-4"
    >
      {status?.error && (
        <Notice tone="error">
          {status.fail_count ? `连续失败 ${status.fail_count} 次：` : ''}
          {status.error}
        </Notice>
      )}
      {removing && <Notice tone="warning">已标记删除（{job.remove_job === 'full' ? '清理副本' : '保留副本'}），等待后台清理。</Notice>}
      {!status && !removing && scope.kind === 'dc' && (
        <Notice>{row.node ? `节点 ${row.node} 离线或不可达，读不到同步状态。` : '找不到这台客户机所在的节点。'}</Notice>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Fact label="上次同步">
          <span className="tabular">{formatLastSync(status)}</span>
          {status?.last_sync && !status.pid ? (
            <span className="block text-[11px] text-muted-foreground">{formatRelativeTime(status.last_sync)}</span>
          ) : null}
        </Fact>
        <Fact label="耗时">
          <span className="tabular">{status?.last_sync ? formatSyncDuration(status.duration) : '—'}</span>
        </Fact>
        <Fact label="下次同步">
          <span className="tabular">{formatNextSync(status ? { ...status, disable: job.disable } : undefined)}</span>
        </Fact>
        <Fact label="失败次数">
          <span className={cn('tabular', status?.fail_count ? 'text-destructive' : undefined)}>{status ? (status.fail_count ?? 0) : '—'}</span>
        </Fact>
        <Fact label="计划">
          <span className="font-mono">{raw}</span>
          {described && <span className="block text-[11px] text-muted-foreground">{described}</span>}
        </Fact>
        <Fact label="限速">{formatRateLimit(job.rate)}</Fact>
        <Fact label="客户机">
          {row.guest ? (
            <Link to={guestPath(row.guest, 'replication')} className="underline-offset-2 hover:underline" onClick={() => onOpenChange(false)}>
              {job.guest} · {guestLabel}
            </Link>
          ) : (
            job.guest
          )}
        </Fact>
        <Fact label="源节点">
          {row.node ? (
            <Link to={nodePath(row.node, 'replication')} className="underline-offset-2 hover:underline" onClick={() => onOpenChange(false)}>
              {row.node}
            </Link>
          ) : (
            '—'
          )}
        </Fact>
        <Fact label="目标节点">{job.target}</Fact>
        {job.comment && (
          <Fact label="备注" className="col-span-2 sm:col-span-3">
            {job.comment}
          </Fact>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button variant="outline" disabled={!allowed || !canRun(row)} onClick={() => actions.scheduleNow(row)}>
          <Play />
          立即同步
        </Button>
        <Button variant="outline" disabled={!row.node || !status} onClick={() => onAction('log')}>
          <FileText />
          日志
        </Button>
        <Button variant="outline" disabled={!allowed || removing} onClick={() => onAction('edit')}>
          <Pencil />
          编辑
        </Button>
        <Button variant="outline" disabled={!allowed || removing} onClick={() => actions.toggle(row)}>
          {job.disable ? <Play /> : <Pause />}
          {job.disable ? '启用' : '停用'}
        </Button>
        <Button
          variant="outline"
          className="col-span-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:ml-auto"
          disabled={!allowed}
          onClick={() => onAction('delete')}
        >
          <Trash2 />
          删除
        </Button>
      </div>
    </ResponsiveDialog>
  )
}

function ListSkeleton() {
  return (
    <div className="grid gap-4 px-(--card-p) py-4" aria-busy="true" aria-label="加载中">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-4 rounded-full" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      ))}
    </div>
  )
}
