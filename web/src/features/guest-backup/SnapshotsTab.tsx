import { useMemo, useState } from 'react'
import { Camera, ChevronRight, Ellipsis, History, Loader2, MemoryStick, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'

import { useSnapshotFeature, useSnapshots, type Snapshot } from '@/api/guest-backup'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import type { GuestTabProps } from '@/features/guest/types'
import { errorMessage } from '@/lib/errors'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { guestName } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { buildSnapshotRows, countSnapshots, firstLine, type SnapshotRow } from './logic'
import {
  DeleteSnapshotDialog,
  RollbackSnapshotDialog,
  SnapshotDetailDialog,
  TakeSnapshotDialog,
  type SnapshotGuest,
} from './SnapshotDialogs'
import { Chip, Notice, useVmCap } from './ui'

type Dialog = { kind: 'take' } | { kind: 'detail' | 'rollback' | 'delete'; snap: Snapshot } | null

/** Guest "快照" tab: the snapshot timeline ending at the current state. */
export default function SnapshotsTab({ node, type, vmid, guest }: GuestTabProps) {
  const snapshots = useSnapshots(node, type, vmid)
  const canSnapshot = useVmCap('VM.Snapshot', vmid, guest.pool)
  const canRollback = useVmCap('VM.Snapshot.Rollback', vmid, guest.pool)
  const feature = useSnapshotFeature(node, type, vmid, canSnapshot)
  const [dialog, setDialog] = useState<Dialog>(null)
  // Keep the last dialog mounted while it animates out.
  const [last, setLast] = useState<Dialog>(null)
  if (dialog && dialog !== last) setLast(dialog)

  const info: SnapshotGuest = {
    node,
    type,
    vmid,
    name: guestName(guest),
    running: guest.status === 'running',
    lock: guest.lock,
    pool: guest.pool,
  }
  const rows = useMemo(() => buildSnapshotRows(snapshots.data ?? []), [snapshots.data])
  const count = countSnapshots(snapshots.data)
  const unsupported = feature.data === false
  const takeDisabled = !canSnapshot ? '没有创建快照的权限' : unsupported ? '当前配置不支持快照' : guest.lock ? `已锁定（${guest.lock}）` : null

  const open = (d: Dialog) => setDialog(d)
  const close = (o: boolean) => {
    if (!o) setDialog(null)
  }
  const lastSnap = last && last.kind !== 'take' ? last.snap : null
  // Show the live entry (description edits, snapstate) in the open dialog.
  const liveSnap = lastSnap ? ((snapshots.data ?? []).find((s) => s.name === lastSnap.name) ?? lastSnap) : null

  return (
    <div className="grid gap-(--section-gap)">
      <GlassCard flush className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-(--card-p) py-3">
          <div className="min-w-0 flex-1">
            <h2 className="heading text-base font-medium text-foreground">快照</h2>
            <p className="text-xs text-muted-foreground">
              {snapshots.isPending ? '正在读取…' : count === 0 ? '还没有快照' : `${count} 个快照`}
              {unsupported && ' · 当前配置不支持快照'}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="刷新"
            title="刷新"
            onClick={() => void snapshots.refetch()}
            disabled={snapshots.isFetching}
            className="text-muted-foreground"
          >
            <RefreshCw className={cn(snapshots.isFetching && 'animate-spin')} />
          </Button>
          <Button onClick={() => open({ kind: 'take' })} disabled={!!takeDisabled} title={takeDisabled ?? undefined}>
            <Plus />
            创建快照
          </Button>
        </div>

        {unsupported && (
          <Notice tone="warning" className="mx-(--card-p) mt-3">
            有磁盘所在的存储不支持快照（例如目录存储上的 raw 磁盘），或挂载了不能快照的设备，暂时不能创建新快照。已有快照仍可回滚和删除。
          </Notice>
        )}

        {snapshots.isPending ? (
          <TimelineSkeleton />
        ) : snapshots.error ? (
          <div className="p-(--card-p)">
            <Notice tone="error">无法读取快照：{errorMessage(snapshots.error)}</Notice>
          </div>
        ) : count === 0 ? (
          <EmptyState
            icon={Camera}
            title="还没有快照"
            description="快照保存客户机此刻的磁盘和配置（虚拟机还可以包含内存），出问题时可以一键回滚。适合升级或改动配置之前使用。"
            action={
              !takeDisabled && (
                <Button variant="outline" onClick={() => open({ kind: 'take' })}>
                  <Plus />
                  创建第一个快照
                </Button>
              )
            }
          />
        ) : (
          <ol aria-label="快照时间线" className="py-2">
            {rows.map((row) => (
              <TimelineRow
                key={row.snap.name}
                row={row}
                guestRunning={guest.status === 'running'}
                canEdit={canSnapshot}
                canRollback={canRollback}
                onOpen={(s) => open({ kind: 'detail', snap: s })}
                onRollback={(s) => open({ kind: 'rollback', snap: s })}
                onDelete={(s) => open({ kind: 'delete', snap: s })}
              />
            ))}
          </ol>
        )}
      </GlassCard>

      {last?.kind === 'take' && <TakeSnapshotDialog guest={info} open={dialog === last} onOpenChange={close} />}
      {last?.kind === 'detail' && (
        <SnapshotDetailDialog
          guest={info}
          snapshot={liveSnap}
          open={dialog === last}
          onOpenChange={close}
          onRollback={(s) => open({ kind: 'rollback', snap: s })}
          onDelete={(s) => open({ kind: 'delete', snap: s })}
        />
      )}
      {last?.kind === 'rollback' && <RollbackSnapshotDialog guest={info} snapshot={liveSnap} open={dialog === last} onOpenChange={close} />}
      {last?.kind === 'delete' && <DeleteSnapshotDialog guest={info} snapshot={liveSnap} open={dialog === last} onOpenChange={close} />}
    </div>
  )
}

// --------------------------------------------------------------- timeline

const COL = 'w-7' // one timeline column (28px)

function TimelineRow({
  row,
  guestRunning,
  canEdit,
  canRollback,
  onOpen,
  onRollback,
  onDelete,
}: {
  row: SnapshotRow
  guestRunning: boolean
  canEdit: boolean
  canRollback: boolean
  onOpen: (s: Snapshot) => void
  onRollback: (s: Snapshot) => void
  onDelete: (s: Snapshot) => void
}) {
  const { snap, isCurrent, depth, rails, first, hasNext } = row
  const pending = snap.snapstate
  return (
    <li
      className={cn(
        'group/row relative flex items-stretch gap-3 pr-2 pl-(--card-p) transition-colors lg:pr-(--card-p)',
        !isCurrent && 'hover:bg-foreground/[0.03] paper:hover:bg-secondary/50',
      )}
      data-testid={isCurrent ? 'snapshot-current' : 'snapshot-row'}
      data-snapshot={snap.name}
    >
      {/* Gutter: one column per depth with rails, the node and elbows. */}
      <div aria-hidden className="relative flex shrink-0">
        {Array.from({ length: depth + 1 }, (_, col) => (
          <div key={col} className={cn('relative', COL)}>
            {rails.includes(col) && <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />}
            {col === depth && (
              <>
                {!first && (
                  <span
                    className={cn(
                      'absolute top-0 left-1/2 h-1/2 -translate-x-1/2',
                      isCurrent ? 'w-0 border-l border-dashed border-brand/60 paper:border-foreground/40' : 'w-px bg-border',
                    )}
                  />
                )}
                {hasNext && <span className="absolute bottom-0 left-1/2 h-1/2 w-px -translate-x-1/2 bg-border" />}
                <span className="absolute top-1/2 left-1/2 -translate-1/2">
                  <Node current={isCurrent} running={guestRunning} pending={!!pending} ram={snap.vmstate === 1} />
                </span>
              </>
            )}
            {/* Elbow into a side branch: from the parent column to this node. */}
            {first && depth > 0 && col === depth - 1 && (
              <span className="absolute top-1/2 left-1/2 h-px w-full bg-border" />
            )}
          </div>
        ))}
      </div>

      {isCurrent ? (
        <div className="flex min-h-16 min-w-0 flex-1 items-center gap-2 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-brand paper:text-foreground">当前状态</span>
              <Chip tone={guestRunning ? 'success' : 'neutral'}>{guestRunning ? '运行中' : '已停止'}</Chip>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              你在这里{snap.parent ? <> · 基于 <span className="font-mono">{snap.parent}</span></> : ''}
            </p>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onOpen(snap)}
            className="flex min-h-16 min-w-0 flex-1 items-center gap-2 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-lg"
          >
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-[15px] font-medium text-foreground">{snap.name}</span>
                {snap.vmstate === 1 && (
                  <Chip tone="brand" icon={<MemoryStick />} className="hidden sm:inline-flex">
                    含内存
                  </Chip>
                )}
                {pending && (
                  <Chip tone="warning" icon={<Loader2 className="animate-spin" />}>
                    {pending === 'delete' ? '删除中' : '创建中'}
                  </Chip>
                )}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span className="shrink-0 tabular" title={snap.snaptime ? formatDateTime(snap.snaptime) : undefined}>
                  {snap.snaptime ? formatDateTime(snap.snaptime) : '—'}
                </span>
                <span className="hidden shrink-0 text-faint sm:inline">· {formatRelativeTime(snap.snaptime)}</span>
                {snap.vmstate === 1 && <MemoryStick className="size-3 shrink-0 text-brand sm:hidden" aria-label="含内存" />}
              </div>
              {firstLine(snap.description) && <p className="mt-1 line-clamp-1 text-sm text-foreground/75">{firstLine(snap.description)}</p>}
            </div>
            <ChevronRight className="size-4 shrink-0 text-faint lg:hidden" aria-hidden />
          </button>
          <div className="hidden shrink-0 items-center gap-1 self-center lg:flex">
            <Button
              variant="ghost"
              size="sm"
              disabled={!canRollback || !!pending}
              onClick={() => onRollback(snap)}
              className="opacity-70 group-hover/row:opacity-100 focus-visible:opacity-100"
            >
              <History />
              回滚
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`${snap.name} 的更多操作`} className="text-muted-foreground">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuItem onSelect={() => onOpen(snap)}>
                  <Pencil />
                  {canEdit ? '查看与编辑' : '查看'}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canRollback || !!pending} onSelect={() => onRollback(snap)}>
                  <History />
                  回滚
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={!canEdit || !!pending} onSelect={() => onDelete(snap)}>
                  <Trash2 />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      )}
    </li>
  )
}

function Node({ current, running, pending, ram }: { current: boolean; running: boolean; pending: boolean; ram: boolean }) {
  if (current) {
    return (
      <span className="relative flex size-4 items-center justify-center">
        {running && <span className="absolute inset-0 animate-ping rounded-full bg-brand/40 paper:bg-foreground/20" />}
        <span className="relative size-3.5 rounded-full bg-brand ring-4 ring-brand/20 paper:bg-foreground paper:ring-foreground/10" />
      </span>
    )
  }
  return (
    <span
      className={cn(
        'flex size-7 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-xs',
        'border-border paper:bg-background',
        ram && 'border-brand/40 text-brand paper:border-foreground/30 paper:text-foreground/80',
        pending && 'border-warning/50 text-warning',
      )}
    >
      <Camera className="size-3.5" />
    </span>
  )
}

function TimelineSkeleton() {
  return (
    <div className="grid gap-4 px-(--card-p) py-4" aria-busy="true" aria-label="加载中">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-7 rounded-full" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      ))}
    </div>
  )
}
