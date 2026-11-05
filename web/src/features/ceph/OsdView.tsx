// OSD tree by host with in/out, start/stop/restart, scrub, details and
// destroy; create OSD and global flags (official PVE.node.CephOsdTree); rolling
// restart of all OSDs of a node (pve-manager ≥ 9.2.5).

import { useMemo, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Ellipsis, Flag, Info, ListRestart, Play, Plus, RotateCw, ScanSearch, Server, Square, Trash2 } from 'lucide-react'

import { cephKeys, cephServiceCommand, osdInOut, osdScrub, useCephOsdTree } from '@/api/ceph'
import { usePveFeature } from '@/api/pve-features'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { fireTask, runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatBytes, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { cephUsageTone, CEPH_USAGE_HINT, METRIC_FILL, METRIC_TEXT } from '@/lib/metric-status'

import { FLAG_LABEL, activeOsdFlags, osdDestroyBlocker, osdHosts, type OsdHost, type OsdRow } from './model'
import { CreateOsdDialog, DestroyOsdDialog, FlagsDialog, OsdDetailsDialog, StopOsdDialog } from './OsdDialogs'
import { RollingRestartDialog } from './RollingRestartDialog'
import { Chip, RefreshButton, Section, useCephAccess } from './ui'

type Dialog =
  | { kind: 'create' }
  | { kind: 'flags' }
  | { kind: 'rolling'; node: string }
  | { kind: 'details' | 'stop' | 'destroy' | 'scrub' | 'deep-scrub'; osd: OsdRow }
  | null

export interface OsdActions {
  open: (kind: Exclude<NonNullable<Dialog>['kind'], 'create' | 'flags' | 'rolling'>, osd: OsdRow) => void
  start: (osd: OsdRow) => void
  restart: (osd: OsdRow) => void
  inOut: (osd: OsdRow, dir: 'in' | 'out') => void
}

/** `host` limits the list to one node (node page tab). */
export function OsdView({ apiNode, host }: { apiNode: string; host?: string }) {
  const tree = useCephOsdTree(apiNode)
  const access = useCephAccess()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [shown, setShown] = useState<Dialog>(null)
  if (dialog && dialog !== shown) setShown(dialog)
  const close = (o: boolean) => !o && setDialog(null)

  const hosts = useMemo(() => osdHosts(tree.data).filter((h) => !host || h.name === host), [tree.data, host])
  const flags = activeOsdFlags(tree.data)
  const total = hosts.reduce((n, h) => n + h.osds.length, 0)

  const actions: OsdActions = {
    open: (kind, osd) => setDialog({ kind, osd }),
    start: (osd) =>
      void fireTask(cephServiceCommand(osd.host, 'start', `osd.${osd.id}`), { title: `启动 osd.${osd.id}`, invalidate: [cephKeys.all()] }),
    restart: (osd) =>
      void fireTask(cephServiceCommand(osd.host, 'restart', `osd.${osd.id}`), { title: `重启 osd.${osd.id}`, invalidate: [cephKeys.all()] }),
    // in/out are not node specific and must work while the OSD's node is down.
    inOut: (osd, dir) =>
      void fireTask(osdInOut(apiNode, osd.id, dir), {
        title: `将 osd.${osd.id} 标记为 ${dir}`,
        syncSuccessMessage: `osd.${osd.id} 已标记为 ${dir}`,
        invalidate: [cephKeys.all()],
      }),
  }

  const active = shown && 'osd' in shown ? shown.osd : null

  return (
    <div className="grid min-w-0 gap-(--section-gap)">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 text-sm font-medium">
          OSD <span className="text-muted-foreground tabular">{tree.data ? total : ''}</span>
        </h2>
        <RefreshButton onClick={() => void tree.refetch()} busy={tree.isFetching} />
        {access.canModify && !host && (
          <Button variant="outline" onClick={() => setDialog({ kind: 'flags' })} className="pointer-coarse:h-11">
            <Flag /> 全局标志
          </Button>
        )}
        {access.canModify && (
          <Button onClick={() => setDialog({ kind: 'create' })} className="pointer-coarse:h-11">
            <Plus /> 创建 OSD
          </Button>
        )}
      </div>
      {flags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm" data-testid="osd-flags">
          <span className="text-muted-foreground">已设置标志：</span>
          {flags.map((f) => (
            <Chip key={f} tone="warn" title={FLAG_LABEL[f]}>
              {f}
            </Chip>
          ))}
        </div>
      )}

      {tree.isPending ? (
        <LoadingRows rows={4} />
      ) : tree.error ? (
        <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />
      ) : total === 0 ? (
        <EmptyState
          icon={Server}
          title="还没有 OSD"
          description={host ? '这个节点上没有 OSD。' : '在每个节点上用一块空闲磁盘创建 OSD（至少 3 个，分布在不同节点）。'}
          action={
            access.canModify ? (
              <Button onClick={() => setDialog({ kind: 'create' })}>
                <Plus /> 创建 OSD
              </Button>
            ) : undefined
          }
        />
      ) : (
        hosts.map((h) => (
          <HostCard
            key={h.name || '-'}
            host={h}
            actions={actions}
            canModify={access.canModify}
            onRollingRestart={() => setDialog({ kind: 'rolling', node: h.name })}
          />
        ))
      )}

      <CreateOsdDialog apiNode={apiNode} defaultNode={host} open={dialog?.kind === 'create'} onOpenChange={close} />
      <FlagsDialog open={dialog?.kind === 'flags'} onOpenChange={close} />
      <RollingRestartDialog
        target={shown?.kind === 'rolling' ? { kind: 'node', node: shown.node } : null}
        open={dialog?.kind === 'rolling'}
        onOpenChange={close}
      />
      <OsdDetailsDialog osd={shown?.kind === 'details' ? active : null} actions={actions} canModify={access.canModify} open={dialog?.kind === 'details'} onOpenChange={close} />
      <StopOsdDialog osd={shown?.kind === 'stop' ? active : null} open={dialog?.kind === 'stop'} onOpenChange={close} />
      <DestroyOsdDialog osd={shown?.kind === 'destroy' ? active : null} open={dialog?.kind === 'destroy'} onOpenChange={close} />
      <ConfirmDialog
        open={dialog?.kind === 'scrub' || dialog?.kind === 'deep-scrub'}
        onOpenChange={close}
        title={shown?.kind === 'deep-scrub' ? `深度清洗 osd.${active?.id}？` : `清洗 osd.${active?.id}？`}
        description={shown?.kind === 'deep-scrub' ? '深度清洗会读取并校验全部数据，运行期间可能降低性能。' : '检查对象元数据的一致性。'}
        confirmLabel={shown?.kind === 'deep-scrub' ? '深度清洗' : '清洗'}
        onConfirm={() =>
          active
            ? runTask(osdScrub(active.host, active.id, shown?.kind === 'deep-scrub'), {
                title: `${shown?.kind === 'deep-scrub' ? '深度清洗' : '清洗'} osd.${active.id}`,
                syncSuccessMessage: `已要求 osd.${active.id} ${shown?.kind === 'deep-scrub' ? '深度清洗' : '清洗'}`,
                invalidate: [],
              })
            : undefined
        }
      />
    </div>
  )
}

function HostCard({
  host,
  actions,
  canModify,
  onRollingRestart,
}: {
  host: OsdHost
  actions: OsdActions
  canModify: boolean
  onRollingRestart: () => void
}) {
  // Per node: the endpoint runs on (and needs the version of) the OSDs' node.
  const rollingRestart = usePveFeature('cephRestartBulk', host.name || undefined) === 'supported' && canModify && !!host.name && host.osds.length > 0
  return (
    <Section
      flush
      title={
        <span className="inline-flex items-center gap-2">
          <Server className="size-4 text-muted-foreground" aria-hidden />
          {host.name || '其他'}
          {host.version && <span className="text-xs font-normal text-muted-foreground">Ceph {host.version}</span>}
        </span>
      }
      count={host.osds.length}
      data-testid={`osd-host-${host.name}`}
      actions={
        rollingRestart ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onRollingRestart}
            className="pointer-coarse:h-10"
            aria-label={`重启 ${host.name} 上的所有 OSD`}
            title="逐个重启该节点的 OSD，等待集群恢复健康后再重启下一个"
            data-testid={`osd-host-${host.name}-rolling-restart`}
          >
            <ListRestart />
            <span className="hidden sm:inline">重启该节点所有 OSD</span>
          </Button>
        ) : undefined
      }
    >
      <ul className="divide-y divide-border/60">
        {host.osds.map((o) => (
          <OsdItem key={o.id} osd={o} actions={actions} canModify={canModify} />
        ))}
      </ul>
    </Section>
  )
}

function OsdItem({ osd, actions, canModify }: { osd: OsdRow; actions: OsdActions; canModify: boolean }) {
  return (
    <li className="flex items-center gap-2 px-2 py-1.5 sm:px-3" data-osd={osd.id}>
      <button
        type="button"
        onClick={() => actions.open('details', osd)}
        className="grid min-h-12 min-w-0 flex-1 gap-1 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring lg:grid-cols-[minmax(9rem,1fr)_minmax(8rem,1.2fr)_repeat(3,minmax(4.5rem,auto))] lg:items-center lg:gap-4"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-medium">{osd.name}</span>
          <Chip tone={osd.up ? 'ok' : 'err'} data-testid="osd-up">
            {osd.up ? 'up' : 'down'}
          </Chip>
          <Chip tone={osd.in ? 'ok' : 'warn'} data-testid="osd-in">
            {osd.in ? 'in' : 'out'}
          </Chip>
          {osd.deviceClass && <Chip tone="unknown">{osd.deviceClass}</Chip>}
          {osd.outdated && <Chip tone="old">需重启</Chip>}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-secondary" aria-hidden>
            <span
              className={cn('block h-full rounded-full', METRIC_FILL[cephUsageTone(osd.usage)])}
              style={{ width: `${Math.min((osd.usage ?? 0) * 100, 100)}%` }}
            />
          </span>
          <span title={CEPH_USAGE_HINT} className={cn('tabular', METRIC_TEXT[cephUsageTone(osd.usage)])}>
            {formatPercent(osd.usage)} · {formatBytes(osd.total)}
          </span>
        </span>
        <span className="hidden text-xs text-muted-foreground tabular lg:block" title="Apply / Commit 延迟">
          {osd.applyLatency ?? '—'}/{osd.commitLatency ?? '—'} ms
        </span>
        <span className="hidden text-xs text-muted-foreground tabular lg:block">{osd.pgs ?? '—'} PG</span>
        <span className="hidden text-xs text-muted-foreground tabular lg:block">{osd.version ?? '—'}</span>
      </button>
      {canModify && <OsdMenu osd={osd} actions={actions} />}
    </li>
  )
}

export function OsdMenu({ osd, actions }: { osd: OsdRow; actions: OsdActions }) {
  const blocker = osdDestroyBlocker(osd)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`osd.${osd.id} 操作`} className="shrink-0 pointer-coarse:size-11">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => actions.open('details', osd)}>
          <Info /> 详情
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {osd.up ? (
          <DropdownMenuItem onSelect={() => actions.open('stop', osd)}>
            <Square /> 停止
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => actions.start(osd)}>
            <Play /> 启动
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => actions.restart(osd)}>
          <RotateCw /> 重启
        </DropdownMenuItem>
        {osd.in ? (
          <DropdownMenuItem onSelect={() => actions.inOut(osd, 'out')}>
            <ArrowUpFromLine /> 标记为 out
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => actions.inOut(osd, 'in')}>
            <ArrowDownToLine /> 标记为 in
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => actions.open('scrub', osd)} disabled={!osd.up}>
          <ScanSearch /> 清洗
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.open('deep-scrub', osd)} disabled={!osd.up}>
          <ScanSearch /> 深度清洗
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => actions.open('destroy', osd)} disabled={!!blocker} title={blocker ?? undefined}>
          <Trash2 /> 销毁{blocker ? `（${blocker}）` : ''}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
