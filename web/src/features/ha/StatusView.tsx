// /datacenter/ha: HA status (quorum, master, fencing, LRM per node with
// maintenance mode) and the HA resources with their live state.

import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  ArrowRightLeft,
  ChevronRight,
  Cog,
  Ellipsis,
  Link2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  Square,
  Trash2,
  Unlink,
  Wrench,
  EyeOff,
  Ban,
} from 'lucide-react'

import { useClusterResources } from '@/api/queries'
import { armHa, disarmHa, haKeys, updateHaResource, useCrsOptions, useHaManagerStatus, useHaResources, useHaStatus } from '@/api/ha'
import { isGuest, type GuestResource } from '@/api/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ResourceIcon } from '@/components/ResourceIcon'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/errors'
import { formatRelativeTime } from '@/lib/format'
import { guestName, guestPath, nodePath } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { CrsDialog } from './CrsDialog'
import { ARMED_LABEL, REQUEST_STATES, describeCrs, parseHaStatus, requestStateLabel, serviceRows, type LrmState, type ServiceRow } from './logic'
import { MoveDialog, RemoveResourceDialog, ResourceDialog } from './ResourceDialogs'
import { CardHeader, Chip, Fact, Notice, TONE_TEXT, useHaAccess } from './ui'

type RequestState = (typeof REQUEST_STATES)[number]['value']

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit' | 'remove' | 'detail'; sid: string }
  | { kind: 'move'; sid: string; mode: 'migrate' | 'relocate' }
  | { kind: 'state'; sid: string; state: RequestState }
  | { kind: 'crs' }
  | { kind: 'arm' }
  | { kind: 'disarm'; mode: 'freeze' | 'ignore' }
  | null

const STATE_ICON: Record<RequestState, typeof Play> = { started: Play, stopped: Square, disabled: Ban, ignored: EyeOff }

export function StatusView() {
  const status = useHaStatus()
  const manager = useHaManagerStatus()
  const configs = useHaResources()
  const crs = useCrsOptions()
  const resources = useClusterResources()
  const access = useHaAccess()
  const [dialog, setDialog] = useState<Dialog>(null)
  // Keep the last dialog mounted while it animates out.
  const [shown, setShown] = useState<Dialog>(null)
  if (dialog && dialog !== shown) setShown(dialog)
  const isOpen = dialog !== null && dialog === shown
  const close = (o: boolean) => {
    if (!o) setDialog(null)
  }

  const guests = useMemo(() => new Map((resources.data ?? []).filter(isGuest).map((g) => [g.vmid, g])), [resources.data])
  const overview = useMemo(() => parseHaStatus(status.data ?? [], manager.data), [status.data, manager.data])
  const rows = useMemo(() => serviceRows(overview.services, configs.data), [overview.services, configs.data])
  const rowOf = (sid: string) => rows.find((r) => r.sid === sid)
  const active = shown && 'sid' in shown ? rowOf(shown.sid) : undefined

  const setState = (row: ServiceRow, state: RequestState) => {
    if (state === 'stopped' || state === 'disabled') return setDialog({ kind: 'state', sid: row.sid, state })
    void runTask(updateHaResource(row.sid, { state }), {
      title: `${row.sid} 请求状态改为${requestStateLabel(state)}`,
      syncSuccessMessage: `已请求${requestStateLabel(state)} ${row.sid}`,
      invalidate: [haKeys.all(), ['pve', 'cluster', 'resources']],
    }).catch(() => undefined)
  }

  const actions: RowActions = {
    open: (r) => setDialog({ kind: 'detail', sid: r.sid }),
    edit: (r) => setDialog({ kind: 'edit', sid: r.sid }),
    remove: (r) => setDialog({ kind: 'remove', sid: r.sid }),
    move: (r, mode) => setDialog({ kind: 'move', sid: r.sid, mode }),
    setState,
    canEdit: access.canEdit,
  }

  const disarmed = overview.armed === 'disarmed' || overview.armed === 'disarming'
  const maintenance = overview.lrms.filter((l) => l.maintenance)

  return (
    <div className="grid gap-(--section-gap)">
      {status.error ? (
        <Notice tone="error">无法读取 HA 状态：{errorMessage(status.error)}</Notice>
      ) : (
        <>
          {overview.quorate === false && (
            <Notice tone="error" title="集群没有法定人数">
              HA 资源不会被启动或恢复，直到法定人数恢复。{overview.quorumText}
            </Notice>
          )}
          {disarmed && (
            <Notice tone="warning" title={overview.armed === 'disarming' ? 'HA 正在解除' : 'HA 已解除'}>
              解除期间 HA 不保护任何资源，节点故障不会自动恢复。维护结束后点「启用 HA」。
            </Notice>
          )}
          {maintenance.length > 0 && (
            <Notice title={`节点 ${maintenance.map((m) => m.node).join('、')} 处于维护模式`}>
              维护模式的节点不运行 HA 资源，其上的资源已迁到其他节点；用 <code className="font-mono text-xs">ha-manager crm-command node-maintenance disable</code> 结束维护。
            </Notice>
          )}
        </>
      )}

      <GlassCard flush className="overflow-hidden">
        <CardHeader title="HA 状态">
          <Button
            variant="ghost"
            size="icon"
            aria-label="刷新"
            title="刷新"
            onClick={() => {
              void status.refetch()
              void manager.refetch()
              void configs.refetch()
            }}
            disabled={status.isFetching}
            className="text-muted-foreground"
          >
            <RefreshCw className={cn(status.isFetching && 'animate-spin')} />
          </Button>
          <Button variant="outline" onClick={() => setDialog({ kind: 'crs' })} disabled={!access.canCrs} title={access.canCrs ? 'CRS 设置' : '没有 Sys.Modify 权限'}>
            <Cog />
            <span className="max-sm:sr-only">CRS 设置</span>
          </Button>
          {disarmed ? (
            <Button onClick={() => setDialog({ kind: 'arm' })} disabled={!access.canEdit || overview.armed === 'disarming'}>
              <Link2 />
              启用 HA
            </Button>
          ) : (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={!access.canEdit || status.isPending}>
                  <Unlink />
                  解除 HA
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-w-72">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">解除时资源的处理方式</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setDialog({ kind: 'disarm', mode: 'freeze' })}>
                  <Snowflake />
                  <div>
                    <div>冻结</div>
                    <div className="text-xs text-muted-foreground">资源保持当前状态，不执行新的状态变更</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog({ kind: 'disarm', mode: 'ignore' })}>
                  <EyeOff />
                  <div>
                    <div>忽略</div>
                    <div className="text-xs text-muted-foreground">HA 完全不管资源，可以像普通客户机一样操作</div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </CardHeader>

        {status.isPending ? (
          <div className="grid gap-2 p-(--card-p) sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 p-(--card-p)">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="ha-overview">
              <Fact label="法定人数">
                {overview.quorate === undefined ? (
                  '—'
                ) : (
                  <Chip tone={overview.quorate ? 'ok' : 'error'}>{overview.quorate ? '正常' : '无法定人数'}</Chip>
                )}
              </Fact>
              <Fact label="主 CRM">
                {overview.master ? (
                  <span>
                    <Link to={nodePath(overview.master)} className="font-medium underline-offset-2 hover:underline">
                      {overview.master}
                    </Link>
                    {overview.masterTimestamp ? (
                      <span className="block text-[11px] text-muted-foreground">{formatRelativeTime(overview.masterTimestamp)}</span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{overview.masterText ? '无响应' : '无（没有 HA 资源）'}</span>
                )}
              </Fact>
              <Fact label="Fencing">
                <Chip tone={ARMED_LABEL[overview.armed].tone} testId="ha-armed">
                  {ARMED_LABEL[overview.armed].label}
                </Chip>
                <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">看门狗隔离 · {ARMED_LABEL[overview.armed].hint}</span>
              </Fact>
              <Fact label="资源调度（CRS）">
                {crs.isPending ? '—' : describeCrs(crs.data?.crs)}
              </Fact>
            </div>

            {overview.lrms.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">各节点 LRM</h3>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="各节点 LRM">
                  {overview.lrms.map((l) => (
                    <LrmItem key={l.node} lrm={l} master={overview.master === l.node} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </GlassCard>

      <GlassCard flush className="overflow-hidden">
        <CardHeader
          title="HA 资源"
          summary={configs.isPending ? '正在读取…' : rows.length === 0 ? '还没有 HA 资源' : `${rows.length} 个资源${countSummary(rows)}`}
        >
          <Button onClick={() => setDialog({ kind: 'add' })} disabled={!access.canEdit} title={access.canEdit ? undefined : '没有 Sys.Console 权限'}>
            <Plus />
            添加
          </Button>
        </CardHeader>
        {configs.isPending || status.isPending ? (
          <div className="grid gap-4 px-(--card-p) py-4" aria-busy="true" aria-label="加载中">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : configs.error ? (
          <div className="p-(--card-p)">
            <Notice tone="error">无法读取 HA 资源：{errorMessage(configs.error)}</Notice>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="还没有 HA 资源"
            description="把虚拟机或容器加入 HA 后，节点故障时会自动在其他节点上重启；也可以按亲和规则控制它们运行在哪些节点。"
            action={
              access.canEdit && (
                <Button variant="outline" onClick={() => setDialog({ kind: 'add' })}>
                  <Plus />
                  添加 HA 资源
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className="hidden items-center gap-3 border-b border-border/60 px-(--card-p) py-2 text-xs text-muted-foreground lg:flex" aria-hidden>
              <span className="w-4" />
              <span className="min-w-0 flex-1">资源</span>
              <span className={COLS.state}>状态</span>
              <span className={COLS.node}>节点</span>
              <span className={COLS.request}>请求状态</span>
              <span className={COLS.limits}>重启 / 迁移</span>
              <span className={COLS.actions} />
            </div>
            <ul className="divide-y divide-border/60" aria-label="HA 资源">
              {rows.map((r) => (
                <ResourceRow key={r.sid} row={r} guest={r.vmid !== undefined ? guests.get(r.vmid) : undefined} actions={actions} />
              ))}
            </ul>
          </>
        )}
      </GlassCard>

      <ResourceDialog open={shown?.kind === 'add' && isOpen} onOpenChange={close} />
      {shown?.kind === 'edit' && <ResourceDialog open={isOpen} onOpenChange={close} sid={shown.sid} guest={active?.vmid !== undefined ? guests.get(active.vmid) : undefined} />}
      {shown?.kind === 'remove' && <RemoveResourceDialog open={isOpen} onOpenChange={close} sid={shown.sid} />}
      {shown?.kind === 'move' && <MoveDialog open={isOpen} onOpenChange={close} sid={shown.sid} mode={shown.mode} node={active?.node} />}
      {shown?.kind === 'detail' && (
        <DetailDialog
          open={isOpen}
          onOpenChange={close}
          row={active ?? null}
          guest={active?.vmid !== undefined ? guests.get(active.vmid) : undefined}
          actions={actions}
          onAction={(d) => setDialog(d)}
        />
      )}
      {shown?.kind === 'state' && (
        <ConfirmDialog
          open={isOpen}
          onOpenChange={close}
          destructive
          title={`${shown.state === 'disabled' ? '禁用' : '停止'} ${shown.sid}？`}
          description={
            shown.state === 'disabled'
              ? 'HA 会停止这台客户机，并且不再在故障时恢复它。'
              : 'HA 会关闭这台客户机并保持停止，它仍由 HA 管理。'
          }
          confirmLabel={shown.state === 'disabled' ? '禁用' : '停止'}
          onConfirm={() =>
            runTask(updateHaResource(shown.sid, { state: shown.state }), {
              title: `${shown.sid} 请求状态改为${requestStateLabel(shown.state)}`,
              syncSuccessMessage: `已请求${requestStateLabel(shown.state)} ${shown.sid}`,
              invalidate: [haKeys.all(), ['pve', 'cluster', 'resources']],
            })
          }
        />
      )}
      {shown?.kind === 'crs' && <CrsDialog open={isOpen} onOpenChange={close} />}
      {shown?.kind === 'arm' && (
        <ConfirmDialog
          open={isOpen}
          onOpenChange={close}
          title="启用 HA？"
          description="重新激活 HA 栈和各节点的看门狗，资源恢复由 HA 管理。"
          confirmLabel="启用"
          onConfirm={() => runTask(armHa(), { title: '启用 HA', syncSuccessMessage: '已请求启用 HA', invalidate: [haKeys.all()] })}
        />
      )}
      {shown?.kind === 'disarm' && (
        <ConfirmDialog
          open={isOpen}
          onOpenChange={close}
          destructive
          title={`解除 HA（${shown.mode === 'freeze' ? '冻结' : '忽略'}）？`}
          description={
            <>
              {shown.mode === 'freeze'
                ? '所有 HA 资源保持当前状态，不再执行新的状态变更。'
                : 'HA 完全不管理资源，资源可以像普通客户机一样手动启停和迁移。'}
              <br />
              解除期间 HA 不保护任何资源，节点故障不会自动恢复。
            </>
          }
          confirmLabel="解除 HA"
          onConfirm={() =>
            runTask(disarmHa(shown.mode), { title: '解除 HA', syncSuccessMessage: '已请求解除 HA', invalidate: [haKeys.all()] })
          }
        />
      )}
    </div>
  )
}

function countSummary(rows: ServiceRow[]): string {
  const bad = rows.filter((r) => r.state.tone === 'error').length
  const busy = rows.filter((r) => r.state.tone === 'running').length
  return `${busy ? ` · ${busy} 个变更中` : ''}${bad ? ` · ${bad} 个异常` : ''}`
}

// ------------------------------------------------------------------- LRM

function LrmItem({ lrm, master }: { lrm: LrmState; master: boolean }) {
  return (
    <li
      className="flex min-w-0 items-center gap-3 rounded-xl bg-foreground/[0.03] px-3 py-2.5 ring-1 ring-border/60 ring-inset paper:bg-secondary/50"
      data-testid="ha-lrm"
      data-node={lrm.node}
    >
      {lrm.maintenance ? (
        <Wrench className="size-4 shrink-0 text-warning-strong" aria-hidden />
      ) : (
        <span className={cn('size-2 shrink-0 rounded-full', lrm.tone === 'ok' ? 'bg-success' : lrm.tone === 'error' ? 'bg-destructive' : 'bg-muted-foreground/50')} aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link to={nodePath(lrm.node)} className="truncate font-medium underline-offset-2 hover:underline">
            {lrm.node}
          </Link>
          {master && <span className="shrink-0 rounded bg-brand/12 px-1.5 text-[10px] leading-4 text-brand-strong paper:bg-secondary paper:text-foreground/80">主 CRM</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {lrm.watchdog === undefined ? '' : lrm.watchdog ? '看门狗已激活' : '看门狗待命'}
          {lrm.timestamp ? ` · ${formatRelativeTime(lrm.timestamp)}` : ''}
        </div>
      </div>
      <Chip tone={lrm.tone} testId="ha-lrm-state">
        {lrm.label}
      </Chip>
    </li>
  )
}

// -------------------------------------------------------------- resources

interface RowActions {
  open: (r: ServiceRow) => void
  edit: (r: ServiceRow) => void
  remove: (r: ServiceRow) => void
  move: (r: ServiceRow, mode: 'migrate' | 'relocate') => void
  setState: (r: ServiceRow, state: RequestState) => void
  canEdit: boolean
}

const COLS = {
  state: 'w-24',
  node: 'w-28',
  request: 'w-20',
  limits: 'w-24',
  actions: 'w-10',
}

function rowTitle(row: ServiceRow, guest: GuestResource | undefined): string {
  return guest ? guestName(guest) : row.vmid !== undefined ? `${row.kind === 'ct' ? '容器' : '虚拟机'} ${row.vmid}` : row.sid
}

function ResourceRow({ row, guest, actions }: { row: ServiceRow; guest: GuestResource | undefined; actions: RowActions }) {
  const title = rowTitle(row, guest)
  return (
    <li data-testid="ha-resource" data-sid={row.sid}>
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
        aria-label={`HA 资源 ${row.sid}，${row.state.label}`}
        className="group flex min-h-16 cursor-pointer items-center gap-3 px-(--card-p) py-(--row-py) transition-colors outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.04] paper:hover:bg-secondary/50"
      >
        <ResourceIcon type={row.kind === 'ct' ? 'lxc' : 'qemu'} className="max-lg:mt-0.5 max-lg:self-start" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 font-mono text-[13px] text-muted-foreground tabular">{row.sid}</span>
            <span className="truncate font-medium">{title}</span>
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span className={cn('lg:hidden', TONE_TEXT[row.state.tone])}>{row.state.label}</span>
            {row.node && <span className="lg:hidden">· {row.node}</span>}
            <span className="lg:hidden">· 请求{requestStateLabel(row.requestState)}</span>
            {row.comment && <span className="max-w-full truncate text-foreground/70 max-lg:before:content-['·_']">{row.comment}</span>}
          </div>
        </div>
        <div className={cn('hidden shrink-0 lg:block', COLS.state)}>
          <Chip tone={row.state.tone} testId="ha-state">
            {row.state.label}
          </Chip>
        </div>
        <div className={cn('hidden shrink-0 truncate text-sm lg:block', COLS.node)}>{row.node ?? '—'}</div>
        <div className={cn('hidden shrink-0 text-sm lg:block', COLS.request)} data-testid="ha-request-state">
          {requestStateLabel(row.requestState)}
        </div>
        <div className={cn('hidden shrink-0 text-sm tabular lg:block', COLS.limits)}>
          {row.maxRestart} / {row.maxRelocate}
        </div>
        <div className={cn('hidden shrink-0 justify-end lg:flex', COLS.actions)} onClick={(e) => e.stopPropagation()}>
          <RowMenu row={row} actions={actions} />
        </div>
        <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 lg:hidden" aria-hidden />
      </div>
    </li>
  )
}

function RowMenu({ row, actions }: { row: ServiceRow; actions: RowActions }) {
  const can = actions.canEdit
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`${row.sid} 的操作`} className="text-muted-foreground">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem disabled={!can} onSelect={() => actions.edit(row)}>
          <Pencil />
          编辑
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">请求状态</DropdownMenuLabel>
        {REQUEST_STATES.map((s) => {
          const Icon = STATE_ICON[s.value]
          return (
            <DropdownMenuItem key={s.value} disabled={!can || row.requestState === s.value} onSelect={() => actions.setState(row, s.value)}>
              <Icon />
              {s.label}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!can || !row.node} onSelect={() => actions.move(row, 'migrate')}>
          <ArrowRightLeft />
          迁移
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!can || !row.node} onSelect={() => actions.move(row, 'relocate')}>
          <RefreshCw />
          重定位
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={!can} onSelect={() => actions.remove(row)}>
          <Trash2 />
          移出 HA
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DetailDialog({
  row,
  guest,
  actions,
  open,
  onOpenChange,
  onAction,
}: {
  row: ServiceRow | null
  guest: GuestResource | undefined
  actions: RowActions
  open: boolean
  onOpenChange: (open: boolean) => void
  onAction: (d: Dialog) => void
}) {
  if (!row) {
    return (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="HA 资源">
        <p className="py-6 text-center text-sm text-muted-foreground">这个资源已经不在 HA 中。</p>
      </ResponsiveDialog>
    )
  }
  const can = actions.canEdit
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={`HA 资源 ${row.sid}`}
      headerExtra={<Chip tone={row.state.tone}>{row.state.label}</Chip>}
      description={rowTitle(row, guest)}
      bodyClassName="grid gap-4"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Fact label="客户机">
          {guest ? (
            <Link to={guestPath(guest)} className="underline-offset-2 hover:underline" onClick={() => onOpenChange(false)}>
              {guest.vmid} · {guestName(guest)}
            </Link>
          ) : (
            (row.vmid ?? row.sid)
          )}
        </Fact>
        <Fact label="节点">{row.node ?? '—'}</Fact>
        <Fact label="请求状态">{requestStateLabel(row.requestState)}</Fact>
        <Fact label="CRM 状态">{row.crmState ?? '—'}</Fact>
        <Fact label="最多重启 / 迁移">
          <span className="tabular">
            {row.maxRestart} / {row.maxRelocate}
          </span>
        </Fact>
        <Fact label="自动回迁 · 自动均衡">
          {row.failback ? '是' : '否'} · {row.autoRebalance ? '是' : '否'}
        </Fact>
        {row.comment && (
          <Fact label="备注" className="col-span-2 sm:col-span-3">
            {row.comment}
          </Fact>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">请求状态</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {REQUEST_STATES.map((s) => {
            const Icon = STATE_ICON[s.value]
            const current = row.requestState === s.value
            return (
              <Button
                key={s.value}
                variant={current ? 'secondary' : 'outline'}
                disabled={!can || current}
                aria-pressed={current}
                onClick={() => {
                  actions.setState(row, s.value)
                  if (s.value === 'started' || s.value === 'ignored') onOpenChange(false)
                }}
              >
                <Icon />
                {s.label}
              </Button>
            )
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button variant="outline" disabled={!can || !row.node} onClick={() => onAction({ kind: 'move', sid: row.sid, mode: 'migrate' })}>
          <ArrowRightLeft />
          迁移
        </Button>
        <Button variant="outline" disabled={!can || !row.node} onClick={() => onAction({ kind: 'move', sid: row.sid, mode: 'relocate' })}>
          <RefreshCw />
          重定位
        </Button>
        <Button variant="outline" disabled={!can} onClick={() => onAction({ kind: 'edit', sid: row.sid })}>
          <Pencil />
          编辑
        </Button>
        <Button
          variant="outline"
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:ml-auto"
          disabled={!can}
          onClick={() => onAction({ kind: 'remove', sid: row.sid })}
        >
          <Trash2 />
          移出 HA
        </Button>
      </div>
    </ResponsiveDialog>
  )
}
