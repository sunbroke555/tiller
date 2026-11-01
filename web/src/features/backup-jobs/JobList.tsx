import { useState } from 'react'
import { Link } from 'react-router'
import {
  Archive,
  CalendarClock,
  ChevronRight,
  Ellipsis,
  ListTree,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react'

import { useBackupJobs, useUncoveredGuests, type BackupJob } from '@/api/backup-jobs'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Chip } from '@/features/guest-backup/ui'
import { cn } from '@/lib/utils'

import { describeJobRetention, describeSchedule, describeSelection, formatRunTime, formatTimeUntil, isJobEnabled, nextRunLabel, nextRunState } from './logic'
import { jobPath } from './paths'
import { ScheduleSimulatorDialog } from './ScheduleSimulatorDialog'
import { UncoveredGuestsDialog } from './UncoveredGuestsDialog'
import { jobTitle, useJobActions, type JobActions } from './useJobActions'

/** /datacenter/backup — scheduled backup jobs. */
export function JobList() {
  const jobs = useBackupJobs()
  const uncovered = useUncoveredGuests()
  const actions = useJobActions()
  const [simulator, setSimulator] = useState(false)
  const [uncoveredOpen, setUncoveredOpen] = useState(false)

  const list = [...(jobs.data ?? [])].sort((a, b) => jobTitle(a).localeCompare(jobTitle(b)) || a.id.localeCompare(b.id))
  const uncoveredCount = uncovered.data?.length ?? 0

  return (
    <div className="grid gap-(--section-gap)">
      {uncoveredCount > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-warning/30 bg-warning/10 px-(--card-p) py-3 text-sm"
          data-testid="uncovered-notice"
        >
          <TriangleAlert className="size-4 shrink-0 text-warning-strong" aria-hidden />
          <span className="min-w-0 flex-1 text-foreground/90">
            有 <span className="font-medium tabular">{uncoveredCount}</span> 台客户机没有被任何备份计划覆盖
          </span>
          <Button variant="outline" size="sm" onClick={() => setUncoveredOpen(true)}>
            查看
          </Button>
        </div>
      )}

      <GlassCard flush className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-border/60 px-(--card-p) py-3">
          <div className="min-w-0 flex-1">
            <h2 className="heading text-base font-medium text-foreground">备份计划</h2>
            <p className="truncate text-xs text-muted-foreground">
              {jobs.isPending ? '正在读取…' : list.length === 0 ? '还没有计划' : `${list.length} 个计划 · ${list.filter(isJobEnabled).length} 个启用`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="刷新"
            title="刷新"
            onClick={() => {
              void jobs.refetch()
              void uncovered.refetch()
            }}
            disabled={jobs.isFetching}
            className="text-muted-foreground"
          >
            <RefreshCw className={cn(jobs.isFetching && 'animate-spin')} />
          </Button>
          <Button variant="outline" onClick={() => setSimulator(true)} aria-label="计划模拟器" title="计划模拟器">
            <CalendarClock />
            <span className="hidden sm:inline">计划模拟器</span>
          </Button>
          {actions.canModify && (
            <Button onClick={actions.create}>
              <Plus />
              新建
            </Button>
          )}
        </div>

        {jobs.isError && !jobs.data ? (
          <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} compact />
        ) : jobs.isPending ? (
          <ListSkeleton />
        ) : list.length === 0 ? (
          <EmptyState
            icon={Archive}
            title="还没有备份计划"
            description="备份计划按时间表自动备份客户机，并按保留策略清理旧备份。"
            action={
              actions.canModify && (
                <Button variant="outline" onClick={actions.create}>
                  <Plus />
                  新建备份计划
                </Button>
              )
            }
          />
        ) : (
          <ul aria-label="备份计划列表" className="divide-y divide-border/60">
            {list.map((job) => (
              <JobRow key={job.id} job={job} actions={actions} />
            ))}
          </ul>
        )}
      </GlassCard>

      <ScheduleSimulatorDialog open={simulator} onOpenChange={setSimulator} />
      <UncoveredGuestsDialog open={uncoveredOpen} onOpenChange={setUncoveredOpen} guests={uncovered.data ?? []} />
      {actions.host}
    </div>
  )
}

function JobRow({ job, actions }: { job: BackupJob; actions: JobActions }) {
  const enabled = isJobEnabled(job)
  const preset = describeSchedule(job.schedule)
  const next = nextRunState(enabled ? job['next-run'] : undefined)
  return (
    <li
      className="group/row flex items-center gap-3 pr-2 pl-(--card-p) transition-colors hover:bg-foreground/[0.03] lg:pr-(--card-p) paper:hover:bg-secondary/50"
      data-testid="backup-job-row"
      data-job={job.id}
    >
      <Link
        to={jobPath(job.id)}
        className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-lg py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span
          aria-hidden
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset',
            enabled
              ? 'bg-brand/10 text-brand-strong ring-brand/15 paper:bg-secondary paper:text-foreground/70 paper:ring-border'
              : 'bg-secondary text-muted-foreground ring-border',
          )}
        >
          {enabled ? <CalendarClock className="size-4" /> : <Pause className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn('truncate font-medium', enabled ? 'text-foreground' : 'text-muted-foreground')}>{jobTitle(job)}</span>
            {!enabled && <Chip>已停用</Chip>}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="shrink-0 font-mono">{job.schedule ?? '—'}</span>
            {preset && <span className="hidden truncate sm:inline">（{preset}）</span>}
            <span className="shrink-0">· {job.storage}</span>
            {job.node && <span className="shrink-0">· {job.node}</span>}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate text-foreground/75">{describeSelection(job)}</span>
            <span className="hidden shrink-0 sm:inline">· {describeJobRetention(job)}</span>
          </div>
          {next.kind !== 'none' && (
            <div className="mt-0.5 text-xs text-muted-foreground sm:hidden">
              下次 {next.kind === 'at' ? `${formatRunTime(next.time)} · ${formatTimeUntil(next.time)}` : '等待运行'}
            </div>
          )}
        </div>
        <div className="hidden shrink-0 text-right sm:block" data-testid="next-run">
          {next.kind === 'at' ? (
            <>
              <div className="text-sm text-foreground tabular">{nextRunLabel(next.time)}</div>
              <div className="text-xs text-muted-foreground">{formatTimeUntil(next.time)}</div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">{enabled ? nextRunLabel(job['next-run']) : '不运行'}</div>
          )}
        </div>
        <ChevronRight className="size-4 shrink-0 text-faint lg:hidden" aria-hidden />
      </Link>
      <div className="hidden shrink-0 items-center lg:flex">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="更多操作" className="text-muted-foreground">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem asChild>
              <Link to={jobPath(job.id)}>
                <ListTree />
                详情与包含的客户机
              </Link>
            </DropdownMenuItem>
            {actions.canModify && (
              <>
                <DropdownMenuItem onSelect={() => actions.edit(job)}>
                  <Pencil />
                  编辑…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.runNow(job)}>
                  <Play />
                  立即运行…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void actions.toggle(job)}>
                  {enabled ? <Pause /> : <Play />}
                  {enabled ? '停用' : '启用'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => actions.remove(job)}>
                  <Trash2 />
                  删除…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

function ListSkeleton() {
  return (
    <div className="grid gap-4 px-(--card-p) py-4" aria-busy="true" aria-label="加载中">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-xl" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ))}
    </div>
  )
}
