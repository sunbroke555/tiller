// /datacenter/cluster — cluster administration (PVE.ClusterAdministration):
// standalone node → create / join; cluster → name, config version, quorum,
// nodes (id, votes, link addresses, online), join information, corosync
// links and totem settings, QDevice, and the CLI procedure to remove a node.

import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  Ellipsis,
  KeyRound,
  LogIn,
  Network,
  PlusCircle,
  RefreshCw,
  Server,
  ServerCog,
  Trash2,
  Users,
} from 'lucide-react'

import { useCorosyncNodes, useClusterJoinInfo, useQdevice, type QdeviceStatus } from '@/api/cluster'
import { usePermissions } from '@/api/permissions'
import { useClusterResources, useClusterStatus } from '@/api/queries'
import { isGuest } from '@/api/types'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState } from '@/components/QueryState'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { StatusDot } from '@/components/StatusDot'
import type { TaskOutcome } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { nodePath } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { CreateClusterDialog } from './CreateClusterDialog'
import { JoinClusterDialog } from './JoinClusterDialog'
import { JoinInfoDialog } from './JoinInfoDialog'
import { clusterNodeRows, linkPriority, totemFacts, usedLinkNumbers, voteSummary, type ClusterNodeRow } from './logic'
import { RemoveNodeDialog } from './RemoveNodeDialog'
import { Chip, Fact, Notice } from './ui'

type Dialog = { kind: 'create' | 'join' | 'info' } | { kind: 'remove'; node: string } | null

export default function ClusterPage() {
  const status = useClusterStatus()
  const perms = usePermissions()
  const canAudit = perms.can({ privs: 'Sys.Audit' })
  const canModify = perms.can({ privs: 'Sys.Modify' })

  const cluster = status.data?.find((e) => e.type === 'cluster')
  const localNode = status.data?.find((e) => e.type === 'node' && e.local)?.name
  const inCluster = !!cluster

  const corosync = useCorosyncNodes(inCluster && canAudit)
  const join = useClusterJoinInfo(undefined, inCluster && canAudit)
  const qdevice = useQdevice(inCluster && canAudit)
  const { data: guestCounts } = useClusterResources({
    select: (all) => {
      const m = new Map<string, number>()
      for (const r of all) if (isGuest(r)) m.set(r.node, (m.get(r.node) ?? 0) + 1)
      return m
    },
  })

  const rows = useMemo(() => clusterNodeRows(corosync.data ?? [], status.data, join.data?.nodelist), [corosync.data, status.data, join.data])

  const [dialog, setDialog] = useState<Dialog>(null)
  // Keep the last dialog mounted while it animates out.
  const [last, setLast] = useState<Dialog>(null)
  if (dialog && dialog !== last) setLast(dialog)
  const close = (o: boolean) => {
    if (!o) setDialog(null)
  }
  const [joined, setJoined] = useState(false)
  const onJoinFinished = (o: TaskOutcome) => {
    if (o.state !== 'error') setJoined(true)
  }

  const guestsOn = (node: string | undefined) => (node ? (guestCounts?.get(node) ?? 0) : 0)

  if (status.isPending) {
    return (
      <div className="grid gap-(--section-gap)">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    )
  }
  if (status.isError) {
    return (
      <GlassCard>
        <ErrorState error={status.error} onRetry={() => void status.refetch()} compact />
      </GlassCard>
    )
  }

  const qdeviceConfigured = !!qdevice.data && Object.keys(qdevice.data).length > 0

  return (
    <div className="grid gap-(--section-gap)">
      {cluster ? (
        <>
          <OverviewCard
            name={cluster.name}
            quorate={!!cluster.quorate}
            version={join.data?.totem.config_version ?? cluster.version}
            rows={rows}
            qdevice={qdevice.isPending && canAudit ? undefined : qdeviceConfigured}
            canAudit={canAudit}
            onInfo={() => setDialog({ kind: 'info' })}
            refreshing={corosync.isFetching || status.isFetching}
            onRefresh={() => {
              void status.refetch()
              void corosync.refetch()
              void join.refetch()
            }}
          />
          {!canAudit ? (
            <Notice>查看集群节点、链路和加入信息需要 Sys.Audit 权限。</Notice>
          ) : (
            <>
              <NodesCard
                rows={rows}
                pending={corosync.isPending}
                error={corosync.error}
                onRetry={() => void corosync.refetch()}
                onRemove={(node) => setDialog({ kind: 'remove', node })}
              />
              <CorosyncCard rows={rows} totem={join.data?.totem} pending={join.isPending} />
              {qdeviceConfigured && <QdeviceCard status={qdevice.data!} />}
            </>
          )}
        </>
      ) : (
        <StandaloneCard
          node={localNode}
          canModify={canModify}
          guestCount={guestsOn(localNode)}
          onCreate={() => setDialog({ kind: 'create' })}
          onJoin={() => setDialog({ kind: 'join' })}
        />
      )}

      {last?.kind === 'create' && localNode && <CreateClusterDialog open={dialog === last} onOpenChange={close} node={localNode} />}
      {last?.kind === 'join' && localNode && (
        <JoinClusterDialog open={dialog === last} onOpenChange={close} node={localNode} guestCount={guestsOn(localNode)} onFinished={onJoinFinished} />
      )}
      {last?.kind === 'info' && (
        <JoinInfoDialog
          open={dialog === last}
          onOpenChange={close}
          nodes={rows.map((r) => ({ name: r.name, online: r.online }))}
          defaultNode={join.data?.preferred_node ?? localNode}
        />
      )}
      {last?.kind === 'remove' && (
        <RemoveNodeDialog
          open={dialog === last}
          onOpenChange={close}
          node={last.node}
          guestCount={guestsOn(last.node)}
          runOn={rows.find((r) => r.name !== last.node && r.online)?.name}
          qdevice={qdeviceConfigured}
        />
      )}
      <JoinedDialog open={joined} />
    </div>
  )
}

// --------------------------------------------------------------- overview

function OverviewCard({
  name,
  quorate,
  version,
  rows,
  qdevice,
  canAudit,
  onInfo,
  refreshing,
  onRefresh,
}: {
  name: string
  quorate: boolean
  version: string | number | undefined
  rows: ClusterNodeRow[]
  qdevice: boolean | undefined
  canAudit: boolean
  onInfo: () => void
  refreshing: boolean
  onRefresh: () => void
}) {
  const online = rows.filter((r) => r.online).length
  const votes = voteSummary(rows)
  const links = usedLinkNumbers(rows)
  return (
    <GlassCard data-testid="cluster-overview">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand/12 text-brand-strong paper:bg-secondary paper:text-foreground/70">
            <Server className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="heading truncate text-lg font-medium text-foreground" data-testid="cluster-name">
                {name}
              </h2>
              <Chip tone={quorate ? 'ok' : 'bad'}>{quorate ? '法定人数正常' : '失去法定人数'}</Chip>
            </div>
            <p className="text-xs text-muted-foreground">Proxmox VE 集群 · 配置版本 {version ?? '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 max-sm:w-full">
          <Button variant="ghost" size="icon" aria-label="刷新" title="刷新" onClick={onRefresh} disabled={refreshing} className="text-muted-foreground">
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
          </Button>
          <Button onClick={onInfo} disabled={!canAudit} className="max-sm:flex-1">
            <KeyRound />
            加入信息
          </Button>
        </div>
      </div>
      {!quorate && (
        <Notice tone="error" className="mt-4">
          集群失去法定人数：/etc/pve 变为只读，客户机不能启动或修改配置。请尽快恢复离线节点或网络。
        </Notice>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="cluster-facts">
        <Fact label="在线节点">
          <span className="tabular">
            {rows.length ? `${online} / ${rows.length}` : '—'}
          </span>
        </Fact>
        <Fact label="票数（在线 / 总数）">
          <span className="tabular">{rows.length ? `${votes.present} / ${votes.total}` : '—'}</span>
          {rows.length > 0 && <span className="ml-1 text-xs text-muted-foreground">需 {votes.quorum}</span>}
        </Fact>
        <Fact label="Corosync 链路">{links.length ? links.map((n) => `链路 ${n}`).join('、') : '—'}</Fact>
        <Fact label="QDevice">{qdevice === undefined ? '—' : qdevice ? '已配置' : '未配置'}</Fact>
      </div>
    </GlassCard>
  )
}

// ----------------------------------------------------------------- nodes

function NodesCard({
  rows,
  pending,
  error,
  onRetry,
  onRemove,
}: {
  rows: ClusterNodeRow[]
  pending: boolean
  error: Error | null
  onRetry: () => void
  onRemove: (node: string) => void
}) {
  const links = usedLinkNumbers(rows)
  return (
    <GlassCard flush className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border/60 px-(--card-p) py-3">
        <div className="min-w-0 flex-1">
          <h2 className="heading text-base font-medium text-foreground">集群节点</h2>
          <p className="text-xs text-muted-foreground">{pending ? '正在读取…' : `${rows.length} 个节点 · 按节点 ID 排序`}</p>
        </div>
        <Users className="size-4 text-faint" aria-hidden />
      </div>
      {pending ? (
        <div className="grid gap-2 p-(--card-p)">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} compact />
      ) : (
        <>
          <div className="hidden items-center gap-3 border-b border-border/60 px-(--card-p) py-2 text-xs text-muted-foreground lg:flex" aria-hidden>
            <span className="w-4" />
            <span className="min-w-0 flex-1">节点</span>
            <span className="w-14 text-right">ID</span>
            <span className="w-14 text-right">票数</span>
            {links.map((n) => (
              <span key={n} className="w-36 pl-4">
                链路 {n}
              </span>
            ))}
            <span className="w-36">API 地址</span>
            <span className="w-9" />
          </div>
          <ul className="divide-y divide-border/60" aria-label="集群节点">
            {rows.map((r) => (
              <NodeRowItem key={r.name} row={r} links={links} onRemove={() => onRemove(r.name)} />
            ))}
          </ul>
        </>
      )}
    </GlassCard>
  )
}

function NodeRowItem({ row, links, onRemove }: { row: ClusterNodeRow; links: number[]; onRemove: () => void }) {
  const state = row.online === undefined ? 'unknown' : row.online ? 'online' : 'offline'
  const addr = (n: number) => row.links.find((l) => l.number === n)?.address
  return (
    <li data-testid="cluster-node" data-node={row.name} className="flex min-h-14 items-center gap-3 px-(--card-p) py-(--row-py)">
      <StatusDot status={state} size="sm" className="max-lg:mt-1 max-lg:self-start" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link to={nodePath(row.name)} className="truncate font-medium hover:underline">
            {row.name}
          </Link>
          {row.local && <Chip tone="brand">本节点</Chip>}
          {row.online === false && <Chip tone="bad">离线</Chip>}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-2 text-xs text-muted-foreground lg:hidden">
          <span className="tabular">ID {row.nodeid ?? '—'}</span>
          <span className="tabular">{row.votes} 票</span>
          {row.links.map((l) => (
            <span key={l.number} className="font-mono">
              链路{l.number} {l.address}
            </span>
          ))}
        </div>
      </div>
      <span className="hidden w-14 text-right text-sm tabular lg:block">{row.nodeid ?? '—'}</span>
      <span className="hidden w-14 text-right text-sm tabular lg:block">{row.votes}</span>
      {links.map((n) => (
        <span key={n} className="hidden w-36 truncate pl-4 font-mono text-[13px] lg:block">
          {addr(n) ?? '—'}
        </span>
      ))}
      <span className="hidden w-36 truncate font-mono text-[13px] text-muted-foreground lg:block">{row.address ?? '—'}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label={`${row.name} 的操作`}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link to={nodePath(row.name)}>
              <ServerCog />
              打开节点
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onRemove}>
            <Trash2 />
            移除节点…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

// -------------------------------------------------------------- corosync

function CorosyncCard({ rows, totem, pending }: { rows: ClusterNodeRow[]; totem: Parameters<typeof totemFacts>[0]; pending: boolean }) {
  const links = usedLinkNumbers(rows)
  const facts = totemFacts(totem)
  return (
    <GlassCard data-testid="corosync-card">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="heading text-base font-medium text-foreground">Corosync</h2>
          <p className="text-xs text-muted-foreground">集群通信的链路和 totem 设置（/etc/pve/corosync.conf）</p>
        </div>
        <Network className="size-4 text-faint" aria-hidden />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {links.map((n) => {
          const prio = linkPriority(totem, n)
          return (
            <div key={n} data-testid="corosync-link" data-link={n} className="rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/60 ring-inset paper:bg-secondary/50">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">链路 {n}</span>
                <span className="text-xs text-muted-foreground">优先级 {prio ?? '0（默认）'}</span>
              </div>
              <ul className="mt-2 grid gap-1 text-[13px]">
                {rows.map((r) => (
                  <li key={r.name} className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.name}</span>
                    <span className="truncate font-mono">{r.links.find((l) => l.number === n)?.address ?? '—'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
      {pending ? (
        <Skeleton className="mt-3 h-16 rounded-xl" />
      ) : (
        facts.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="totem-facts">
            {facts.map((f) => (
              <Fact key={f.key} label={f.label}>
                <span className="tabular">{f.value}</span>
              </Fact>
            ))}
          </div>
        )
      )}
    </GlassCard>
  )
}

// --------------------------------------------------------------- qdevice

function QdeviceCard({ status }: { status: QdeviceStatus }) {
  const entries = Object.entries(status).filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
  return (
    <GlassCard data-testid="qdevice-card">
      <h2 className="heading text-base font-medium text-foreground">QDevice</h2>
      <p className="text-xs text-muted-foreground">外部仲裁设备的状态（corosync-qdevice-tool）</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {entries.map(([k, v]) => (
          <Fact key={k} label={k}>
            {String(v)}
          </Fact>
        ))}
      </div>
    </GlassCard>
  )
}

// ------------------------------------------------------------ standalone

function StandaloneCard({
  node,
  canModify,
  guestCount,
  onCreate,
  onJoin,
}: {
  node: string | undefined
  canModify: boolean
  guestCount: number
  onCreate: () => void
  onJoin: () => void
}) {
  const disabled = !canModify ? '需要 Sys.Modify 权限' : !node ? '无法确定本节点' : null
  return (
    <div className="grid gap-(--section-gap)" data-testid="cluster-standalone">
      <GlassCard>
        <div className="flex items-center gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-secondary text-muted-foreground">
            <Server className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="heading text-lg font-medium text-foreground">独立节点</h2>
            <p className="text-xs text-muted-foreground">{node ?? '本节点'} 还没有加入集群</p>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-foreground/80">
          集群让多个节点共用配置，并支持在线迁移、存储复制和高可用。可以在这台节点上创建新集群，或者把它加入已有的集群。
        </p>
        {disabled && <Notice className="mt-3">{disabled}，无法创建或加入集群。</Notice>}
      </GlassCard>
      <div className="grid gap-(--section-gap) md:grid-cols-2">
        <ChoiceCard
          icon={PlusCircle}
          title="创建集群"
          description="以这台节点为第一个成员创建集群，再从其他节点加入。"
          action="创建集群"
          disabled={!!disabled}
          onClick={onCreate}
        />
        <ChoiceCard
          icon={LogIn}
          title="加入集群"
          description={
            guestCount > 0
              ? `粘贴集群节点上的加入信息。注意：本节点上还有 ${guestCount} 台客户机，需先清空才能加入。`
              : '粘贴集群节点上的“加入信息”，输入那台节点的 root 密码即可加入。'
          }
          action="加入集群"
          disabled={!!disabled}
          onClick={onJoin}
        />
      </div>
    </div>
  )
}

function ChoiceCard({
  icon: Icon,
  title,
  description,
  action,
  disabled,
  onClick,
}: {
  icon: typeof Server
  title: string
  description: string
  action: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <GlassCard className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-brand-strong paper:text-foreground/70" aria-hidden />
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <p className="flex-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
      <Button variant="outline" onClick={onClick} disabled={disabled} className="self-start max-sm:self-stretch">
        {action}
      </Button>
    </GlassCard>
  )
}

// ---------------------------------------------------------------- joined

/** After a successful join the node has a new certificate and auth key: reload. */
function JoinedDialog({ open }: { open: boolean }) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={() => {}}
      dismissible={false}
      title="已加入集群"
      description="本节点的证书和登录密钥已经更换，当前会话已失效。"
      footer={<Button onClick={() => window.location.reload()}>重新加载</Button>}
    >
      <p className="pt-1 pb-2 text-sm leading-relaxed text-foreground/85">重新加载页面后用集群的账号登录。如果浏览器提示证书变化，请确认后继续。</p>
    </ResponsiveDialog>
  )
}
