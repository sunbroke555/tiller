import { useMemo, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Ellipsis,
  FileCode2,
  FolderSearch,
  KeyRound,
  Lock,
  LockOpen,
  NotebookPen,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'

import { useGuestBackups, isProtected, type BackupVolume } from '@/api/guest-backup'
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
import { formatBytes, formatDateTime, formatRelativeTime } from '@/lib/format'
import { guestName } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { useBackupDialogs, VerifyIcon, type BackupItemActions } from './BackupDialogs'
import { BackupNowDialog } from './BackupNowDialog'
import { firstLine, formatBackupFormat } from './logic'
import { Chip, Notice, useVmCap } from './ui'

const ALL = '__all__'

/** Guest "备份" tab: backups of this guest on every backup storage, backup now, restore. */
export default function BackupTab({ node, type, vmid, guest }: GuestTabProps) {
  const name = guestName(guest)
  const data = useGuestBackups(node, type, vmid)
  const canBackup = useVmCap('VM.Backup', vmid, guest.pool)
  const [filter, setFilter] = useState<string>(ALL)
  const [backupOpen, setBackupOpen] = useState(false)

  const pluginOf = useMemo(() => new Map(data.storages.map((s) => [s.storage, s.type])), [data.storages])
  const dialogs = useBackupDialogs({
    node,
    isPBS: (s) => pluginOf.get(s) === 'pbs',
    target: { vmid, name, status: guest.status },
  })

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of data.backups) m.set(b.storage, (m.get(b.storage) ?? 0) + 1)
    return m
  }, [data.backups])
  const shown = filter === ALL ? data.backups : data.backups.filter((b) => b.storage === filter)
  const total = shown.reduce((sum, b) => sum + (b.size ?? 0), 0)
  const latest = data.backups[0]
  const noStorage = !data.isPending && !data.storageError && data.storages.length === 0
  const waiting = filter === ALL ? data.pendingStorages : data.pendingStorages.filter((s) => s === filter)
  const incomplete = !!data.storageError || data.errors.some((e) => filter === ALL || e.storage === filter)
  const loading = shown.length === 0 && (data.isPending || waiting.length > 0)

  return (
    <div className="grid gap-(--section-gap)">
      <GlassCard flush className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-(--card-p) py-3">
          <div className="min-w-0 flex-1">
            <h2 className="heading text-base font-medium text-foreground">备份</h2>
            <p className="truncate text-xs text-muted-foreground">
              {loading
                ? '正在读取…'
                : incomplete && data.backups.length === 0
                  ? '备份列表读取失败'
                : data.backups.length === 0
                  ? '还没有备份'
                  : (
                    <>
                      {data.pendingStorages.length > 0 && '已读取 '}{shown.length} 个备份 · 共 {formatBytes(total)}
                      {latest && <span className="hidden sm:inline"> · 最近 {formatRelativeTime(latest.ctime)}</span>}
                    </>
                  )}
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
          <Button
            onClick={() => setBackupOpen(true)}
            disabled={!canBackup || noStorage}
            title={!canBackup ? '没有备份权限' : noStorage ? '没有可存放备份的存储' : undefined}
          >
            <Plus />
            立即备份
          </Button>
        </div>

        {data.storages.length > 1 && (
          <div role="group" aria-label="按存储筛选" className="scrollbar-none flex gap-2 overflow-x-auto border-b border-border/60 px-(--card-p) py-2.5">
            <FilterChip active={filter === ALL} onClick={() => setFilter(ALL)} label="全部" count={data.backups.length} />
            {data.storages.map((s) => (
              <FilterChip key={s.storage} active={filter === s.storage} onClick={() => setFilter(s.storage)} label={s.storage} count={counts.get(s.storage) ?? 0} />
            ))}
          </div>
        )}

        {data.pendingStorages.length > 0 && (
          <p role="status" className="px-(--card-p) pt-3 text-xs break-words text-muted-foreground">
            正在读取 {data.pendingStorages.join('、')} 上的备份{data.backups.length > 0 ? '，已返回的备份可先查看。' : '…'}
          </p>
        )}

        {(data.storageError || data.errors.length > 0) && (
          <div className="grid gap-2 px-(--card-p) pt-3">
            {data.storageError && <Notice tone="error">无法读取备份存储列表：{errorMessage(data.storageError)}</Notice>}
            {data.errors.map((e) => (
              <Notice key={e.storage} tone="error">
                无法读取存储 {e.storage} 上的备份：{errorMessage(e.error)}
              </Notice>
            ))}
          </div>
        )}

        {loading ? (
          <ListSkeleton />
        ) : noStorage ? (
          <EmptyState icon={Archive} title="没有备份存储" description="这个节点上没有允许存放备份（内容类型含“备份”）的存储。先在存储设置里添加一个。" />
        ) : shown.length === 0 && incomplete ? (
          <EmptyState icon={Archive} title="暂时无法确认备份列表" description="部分存储读取失败，请查看上方错误并重试。" />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={Archive}
            title={filter === ALL ? '还没有备份' : `${filter} 上没有备份`}
            description="备份是客户机磁盘和配置的完整副本，可以恢复到这台客户机，也可以恢复成一台新的客户机。"
            action={
              canBackup && (
                <Button variant="outline" onClick={() => setBackupOpen(true)}>
                  <Plus />
                  立即备份
                </Button>
              )
            }
          />
        ) : (
          <ul aria-label="备份列表" className="divide-y divide-border/60">
            {shown.map((b) => (
              <BackupRow
                key={`${b.storage}:${b.volid}`}
                backup={b}
                isPBS={pluginOf.get(b.storage) === 'pbs'}
                showStorage={data.storages.length > 1}
                actions={dialogs.actionsFor(b)}
                onOpen={() => dialogs.open('detail', b)}
              />
            ))}
          </ul>
        )}
      </GlassCard>

      <BackupNowDialog
        node={node}
        type={type}
        vmid={vmid}
        name={name}
        storage={filter === ALL ? undefined : filter}
        open={backupOpen}
        onOpenChange={setBackupOpen}
      />
      {dialogs.host}
    </div>
  )
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors pointer-coarse:h-10',
        active
          ? 'border-brand/50 bg-brand/12 text-brand-strong paper:border-foreground/40 paper:bg-secondary paper:text-foreground'
          : 'border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {label}
      <span className={cn('tabular', active ? 'opacity-80' : 'text-faint')}>{count}</span>
    </button>
  )
}

function BackupRow({
  backup: b,
  isPBS,
  showStorage,
  actions,
  onOpen,
}: {
  backup: BackupVolume
  isPBS: boolean
  showStorage: boolean
  actions: BackupItemActions
  onOpen: () => void
}) {
  const prot = isProtected(b)
  const notes = firstLine(b.notes)
  return (
    <li className="group/row flex items-center gap-3 pr-2 pl-(--card-p) transition-colors hover:bg-foreground/[0.03] lg:pr-(--card-p) paper:hover:bg-secondary/50" data-testid="backup-row" data-volid={b.volid}>
      <button type="button" onClick={onOpen} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-lg py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <span
          aria-hidden
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand-strong ring-1 ring-brand/15 ring-inset paper:bg-secondary paper:text-foreground/70 paper:ring-border',
            prot && 'bg-warning/12 text-warning-strong ring-warning/20',
          )}
        >
          {prot ? <Lock className="size-4" /> : <Archive className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-medium text-foreground tabular">{formatDateTime(b.ctime)}</span>
            <span className="hidden text-xs text-faint sm:inline">{formatRelativeTime(b.ctime)}</span>
            {prot && (
              <Chip tone="warning" className="hidden sm:inline-flex">
                受保护
              </Chip>
            )}
            {b.encrypted && <KeyRound className="size-3.5 shrink-0 text-muted-foreground" aria-label="已加密" />}
            <VerifyIcon state={b.verification?.state} />
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="shrink-0 tabular">{formatBytes(b.size)}</span>
            {showStorage && <span className="shrink-0">· {b.storage}</span>}
            <span className="truncate">· {formatBackupFormat(b.format)}</span>
          </div>
          {notes && <p className="mt-1 line-clamp-1 text-sm text-foreground/75">{notes}</p>}
        </div>
        <ChevronRight className="size-4 shrink-0 text-faint lg:hidden" aria-hidden />
      </button>
      <div className="hidden shrink-0 items-center gap-1 lg:flex">
        <Button variant="ghost" size="sm" onClick={actions.restore} className="opacity-70 group-hover/row:opacity-100 focus-visible:opacity-100">
          <ArchiveRestore />
          恢复
        </Button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="更多操作" className="text-muted-foreground">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onSelect={actions.restore}>
              <ArchiveRestore />
              恢复…
            </DropdownMenuItem>
            {isPBS && actions.fileRestore && (
              <DropdownMenuItem onSelect={actions.fileRestore}>
                <FolderSearch />
                文件级恢复…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={actions.config}>
              <FileCode2 />
              显示配置
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={actions.notes}>
              <NotebookPen />
              编辑备注…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={actions.protect}>
              {prot ? <LockOpen /> : <Lock />}
              {prot ? '取消保护' : '设为受保护'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={prot} onSelect={actions.remove} title={prot ? '受保护的备份不能删除' : undefined}>
              <Trash2 />
              删除…
            </DropdownMenuItem>
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
