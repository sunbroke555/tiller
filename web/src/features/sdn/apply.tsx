// Pending SDN changes: the count, the bar shown above every sub-page, apply
// (PUT /cluster/sdn → task reloading the network on every node), dry-run
// diff per node, rollback of all pending changes and releasing a stale lock.

import { useMemo, useState } from 'react'
import { Ellipsis, FileDiff, Loader2, LockOpen, Play, Undo2 } from 'lucide-react'

import {
  applySdn,
  releaseSdnLock,
  rollbackSdn,
  sdnKeys,
  useDryRun,
  usePrefixLists,
  useRouteMapEntries,
  useSdnControllers,
  useSdnFabrics,
  useSdnSubnetsOf,
  useSdnVnets,
  useSdnZones,
} from '@/api/sdn'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NodeSelect } from '@/components/form'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { ErrorState } from '@/components/QueryState'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { effective } from './pending'
import { useSdnCanEdit } from './ui'

/** Pending objects per kind (subnets of every VNet included). */
export function usePendingSummary() {
  const zones = useSdnZones()
  const vnets = useSdnVnets()
  const controllers = useSdnControllers()
  const fabrics = useSdnFabrics()
  const routeMaps = useRouteMapEntries()
  const prefixLists = usePrefixLists()
  const vnetIds = useMemo(() => (vnets.data ?? []).map((v) => effective(v).vnet).filter(Boolean), [vnets.data])
  const subnets = useSdnSubnetsOf(vnetIds)

  const parts = useMemo(() => {
    const n = (list: readonly { state?: unknown }[] | undefined) => (list ?? []).filter((o) => o.state).length
    return [
      { label: 'Zone', count: n(zones.data) },
      { label: 'VNet', count: n(vnets.data) },
      { label: '子网', count: n(subnets.data) },
      { label: '控制器', count: n(controllers.data) },
      { label: 'Fabric', count: n(fabrics.data?.fabrics) + n(fabrics.data?.nodes) },
      { label: 'Route Map', count: n(routeMaps.data) },
      { label: '前缀列表', count: n(prefixLists.data) },
    ].filter((p) => p.count > 0)
  }, [zones.data, vnets.data, subnets.data, controllers.data, fabrics.data, routeMaps.data, prefixLists.data])

  return {
    total: parts.reduce((s, p) => s + p.count, 0),
    parts,
    loading: zones.isPending || vnets.isPending,
  }
}

type Dialog = 'apply' | 'diff' | 'rollback' | 'unlock' | null

/** Apply / dry-run / rollback buttons and their dialogs. */
export function ApplyActions({ pending, compact }: { pending: number; compact?: boolean }) {
  const canEdit = useSdnCanEdit()
  const [dialog, setDialog] = useState<Dialog>(null)
  const close = (o: boolean) => {
    if (!o) setDialog(null)
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size={compact ? 'sm' : 'default'} onClick={() => setDialog('diff')}>
          <FileDiff />
          差异预览
        </Button>
        <Button size={compact ? 'sm' : 'default'} disabled={!canEdit} title={canEdit ? undefined : '没有 SDN.Allocate 权限'} onClick={() => setDialog('apply')}>
          <Play />
          应用
        </Button>
        {canEdit && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="更多 SDN 操作" className="text-muted-foreground">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem disabled={pending === 0} onSelect={() => setDialog('rollback')}>
                <Undo2 />
                丢弃未应用的改动
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDialog('unlock')}>
                <LockOpen />
                强制释放全局锁
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <ConfirmDialog
        open={dialog === 'apply'}
        onOpenChange={close}
        title="应用 SDN 配置？"
        description={
          <>
            会把{pending > 0 ? ` ${pending} 项` : '所有'}未应用的 SDN 配置写到每个节点并重新加载网络（ifreload）。
            节点上尚未应用的本地网络改动也会一起生效。
          </>
        }
        confirmLabel="应用"
        onConfirm={() => runTask(applySdn(), { title: '应用 SDN 配置', invalidate: [sdnKeys.all(), ['pve', 'cluster', 'resources']] })}
      />
      <ConfirmDialog
        open={dialog === 'rollback'}
        onOpenChange={close}
        destructive
        title="丢弃所有未应用的 SDN 改动？"
        description="Zone、VNet、子网、控制器、Fabric、Route Map 和前缀列表都回到当前运行中的配置。这一步不能撤销。"
        confirmLabel="丢弃"
        onConfirm={() =>
          runTask(rollbackSdn(), { title: '丢弃 SDN 改动', syncSuccessMessage: '已丢弃未应用的 SDN 改动', invalidate: [sdnKeys.all()] })
        }
      />
      <ConfirmDialog
        open={dialog === 'unlock'}
        onOpenChange={close}
        destructive
        title="强制释放 SDN 全局锁？"
        description="只有在自动化工具持有锁后异常退出、导致 SDN 配置无法修改时才需要这样做。正在进行的自动化修改可能被打断。"
        confirmLabel="释放"
        onConfirm={() => runTask(releaseSdnLock(), { title: '释放 SDN 全局锁', syncSuccessMessage: '已释放 SDN 全局锁', invalidate: [] })}
      />
      <DryRunDialog open={dialog === 'diff'} onOpenChange={close} />
    </>
  )
}

/** Shown above the sub-pages while there are unapplied changes. */
export function PendingBar() {
  const summary = usePendingSummary()
  if (summary.total === 0) return null
  return (
    <div
      role="status"
      data-testid="sdn-pending-bar"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-warning/30 bg-warning/10 px-(--card-p) py-2.5"
    >
      <div className="min-w-0 flex-[1_1_18rem] text-sm">
        <span className="font-medium">{summary.total} 项 SDN 改动未应用</span>
        <span className="text-muted-foreground"> · {summary.parts.map((p) => `${p.label} ${p.count}`).join('、')}</span>
      </div>
      <ApplyActions pending={summary.total} compact />
    </div>
  )
}

// ------------------------------------------------------------------ dry run

function DiffBlock({ title, text }: { title: string; text: string | undefined }) {
  const lines = (text ?? '').split('\n')
  return (
    <section className="grid min-w-0 gap-1.5">
      <h3 className="text-sm font-medium">{title}</h3>
      {text ? (
        <pre className="max-h-[40vh] overflow-auto rounded-xl bg-foreground/[0.04] p-3 font-mono text-[12px] leading-relaxed ring-1 ring-border/60 ring-inset">
          {lines.map((l, i) => (
            <div
              key={i}
              className={cn(
                'whitespace-pre',
                l.startsWith('+') && !l.startsWith('+++') && 'bg-success/10 text-success-strong',
                l.startsWith('-') && !l.startsWith('---') && 'bg-destructive/10 text-destructive',
                l.startsWith('@@') && 'text-info',
              )}
            >
              {l || ' '}
            </div>
          ))}
        </pre>
      ) : (
        <p className="rounded-xl bg-foreground/[0.03] px-3 py-2 text-sm text-muted-foreground ring-1 ring-border/60 ring-inset">没有改动</p>
      )}
    </section>
  )
}

export function DryRunDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [node, setNode] = useState<string | undefined>()
  const diff = useDryRun(open ? node : undefined)
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title="待应用的 SDN 改动"
      description="选择节点，查看应用后 FRR 配置和 /etc/network/interfaces.d/sdn 的变化。"
      footer={
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          关闭
        </Button>
      }
    >
      <div className="grid gap-4 pb-2">
        <div className="max-w-xs">
          <NodeSelect value={node} onValueChange={setNode} />
        </div>
        {!node ? null : diff.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在计算差异…
          </p>
        ) : diff.error ? (
          <ErrorState error={diff.error} onRetry={() => void diff.refetch()} compact />
        ) : (
          <>
            <DiffBlock title="FRR 配置" text={diff.data?.['frr-diff']} />
            <DiffBlock title="网络接口配置" text={diff.data?.['interfaces-diff']} />
          </>
        )}
      </div>
    </ResponsiveDialog>
  )
}
