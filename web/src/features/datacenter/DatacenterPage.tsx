import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  BadgeCheck,
  Box,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  Cpu,
  Database,
  HardDrive,
  KeyRound,
  Monitor,
  Network,
  Repeat,
  Shield,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'

import { usePermissions } from '@/api/permissions'
import { useClusterResources, useClusterStatus, useNodes, useVersion } from '@/api/queries'
import { clusterOptionsKey, saveDatacenterNotes, useCephStatus, useClusterOptions } from '@/api/shell'
import type { ClusterStatusNode, GuestType, NodeListEntry } from '@/api/types'
import { GlassCard } from '@/components/GlassCard'
import { NotesCard } from '@/components/NotesCard'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { ErrorCard, ErrorState, LoadingRows } from '@/components/QueryState'
import { StatusDot } from '@/components/StatusDot'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { UsageBar } from '@/components/UsageBar'
import { formatBytes, formatPercent, formatUptime, formatUsage, ratio } from '@/lib/format'
import { nodePath } from '@/lib/resources'
import { cn } from '@/lib/utils'

import {
  SUBSCRIPTION_LABEL,
  clusterUsage,
  guestCounts,
  healthReport,
  subscriptionLevel,
  subscriptionSummary,
  type GuestCounts,
  type Health,
} from './summary'

/** /datacenter — the datacenter summary (health, guests, usage, nodes, subscriptions, notes). */
export function DatacenterPage() {
  const resources = useClusterResources()
  const status = useClusterStatus()
  const nodes = useNodes()
  const { data: version } = useVersion()
  const ceph = useCephStatus()
  const options = useClusterOptions()
  const perms = usePermissions()
  const queryClient = useQueryClient()

  const report = useMemo(
    () => healthReport(status.data ?? [], ceph.data?.health?.status ?? null),
    [status.data, ceph.data],
  )
  const counts = useMemo(() => guestCounts(resources.data ?? []), [resources.data])
  const usage = useMemo(() => clusterUsage(resources.data ?? []), [resources.data])
  const subs = useMemo(() => subscriptionSummary(status.data ?? []), [status.data])
  const statusByNode = useMemo(() => {
    const m = new Map<string, ClusterStatusNode>()
    for (const e of status.data ?? []) if (e.type === 'node') m.set(e.name, e)
    return m
  }, [status.data])

  const canEditNotes = perms.can({ privs: 'Sys.Modify', path: '/' })
  const subtitle = [report.cluster ? `集群 ${report.cluster}` : status.data ? '单节点' : null, version && `PVE ${version.version}`]
    .filter(Boolean)
    .join(' · ')

  if (status.isError && resources.isError && !status.data && !resources.data) {
    return (
      <>
        <PageHeader title="数据中心" backTo="/" />
        <ErrorCard error={status.error} onRetry={() => void Promise.all([status.refetch(), resources.refetch()])} />
      </>
    )
  }

  const loading = status.isPending || resources.isPending

  return (
    <>
      <PageHeader title="数据中心" description={subtitle || ' '} backTo="/" />

      <div className="grid grid-cols-1 gap-(--section-gap)">
        <div className="grid grid-cols-1 gap-(--row-gap) lg:grid-cols-3">
          <HealthCard report={report} loading={status.isPending} />
          <GuestsCard counts={counts} loading={resources.isPending} />
          <GlassCard aria-labelledby="dc-usage">
            <CardTitle id="dc-usage" icon={Cpu}>
              资源用量
            </CardTitle>
            {loading ? (
              <div className="grid gap-4 pt-1">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-7" />
                ))}
              </div>
            ) : (
              <div className="grid gap-3.5">
                <UsageBar
                  label="CPU"
                  value={ratio(usage.cpu.used, usage.cpu.total)}
                  detail={`${usage.cpu.used.toFixed(1)} / ${usage.cpu.total} 核`}
                />
                <UsageBar label="内存" value={ratio(usage.mem.used, usage.mem.total)} detail={formatUsage(usage.mem.used, usage.mem.total)} />
                <UsageBar
                  label={`存储 · ${usage.storage.count} 个`}
                  value={ratio(usage.storage.used, usage.storage.total)}
                  detail={formatUsage(usage.storage.used, usage.storage.total)}
                />
              </div>
            )}
          </GlassCard>
        </div>

        <section aria-labelledby="dc-nodes">
          <SectionHeader title={<span id="dc-nodes">节点</span>}>
            {!loading && (
              <span className="text-xs text-muted-foreground tabular">
                {report.nodesOnline} / {report.nodesTotal} 在线
              </span>
            )}
          </SectionHeader>
          <GlassCard flush className="overflow-hidden">
            {nodes.isPending ? (
              <LoadingRows rows={2} />
            ) : nodes.isError && !nodes.data ? (
              <ErrorState compact error={nodes.error} onRetry={() => void nodes.refetch()} />
            ) : (
              <NodeTable nodes={nodes.data ?? []} statusByNode={statusByNode} />
            )}
          </GlassCard>
        </section>

        <div className="grid grid-cols-1 gap-(--row-gap) lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <GlassCard aria-labelledby="dc-subs">
            <CardTitle id="dc-subs" icon={BadgeCheck}>
              订阅
            </CardTitle>
            {status.isPending ? (
              <Skeleton className="h-12" />
            ) : (
              <SubscriptionSummary subs={subs} />
            )}
          </GlassCard>
          <NotesCard
            title="数据中心备注"
            text={options.data?.description}
            loading={options.isPending}
            emptyHint={options.isError ? '没有读取备注的权限。' : '还没有备注，可以记录维护窗口、联系人等信息。'}
            onSave={
              canEditNotes &&
              !options.isError &&
              (async (text) => {
                await saveDatacenterNotes(text)
                await queryClient.invalidateQueries({ queryKey: clusterOptionsKey() })
              })
            }
          />
        </div>

        <ManageLinks />
      </div>
    </>
  )
}

function CardTitle({ id, icon: Icon, children, extra }: { id: string; icon: LucideIcon; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      <h2 id={id} className="text-sm font-medium">
        {children}
      </h2>
      {extra && <div className="ml-auto">{extra}</div>}
    </div>
  )
}

const HEALTH_META: Record<Health, { icon: LucideIcon; label: string; tone: string; ring: string }> = {
  ok: { icon: CircleCheck, label: '运行正常', tone: 'text-success', ring: 'bg-success/12 ring-success/25' },
  warning: { icon: CircleAlert, label: '需要关注', tone: 'text-warning', ring: 'bg-warning/12 ring-warning/25' },
  critical: { icon: CircleX, label: '存在故障', tone: 'text-destructive', ring: 'bg-destructive/12 ring-destructive/25' },
}

function HealthCard({ report, loading }: { report: ReturnType<typeof healthReport>; loading: boolean }) {
  const meta = HEALTH_META[report.health]
  return (
    <GlassCard aria-labelledby="dc-health">
      <CardTitle id="dc-health" icon={ShieldCheck}>
        健康状态
      </CardTitle>
      {loading ? (
        <Skeleton className="h-24" />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span className={cn('inline-flex size-12 items-center justify-center rounded-2xl ring-1 ring-inset', meta.ring, meta.tone)}>
              <meta.icon className="size-6" aria-hidden />
            </span>
            <div>
              <div className={cn('text-lg font-semibold', meta.tone)}>{meta.label}</div>
              <div className="text-xs text-muted-foreground">{report.cluster ? `集群 ${report.cluster}` : '单节点，未组建集群'}</div>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {report.quorate !== null && (
              <>
                <dt className="text-muted-foreground">法定人数</dt>
                <dd className={report.quorate ? '' : 'text-destructive'}>{report.quorate ? '正常（Quorate）' : '已失去法定人数'}</dd>
              </>
            )}
            <dt className="text-muted-foreground">节点</dt>
            <dd className="tabular">
              <span className={report.nodesOnline < report.nodesTotal ? 'text-warning' : ''}>{report.nodesOnline}</span> / {report.nodesTotal} 在线
            </dd>
            {report.ceph && (
              <>
                <dt className="text-muted-foreground">Ceph</dt>
                <dd
                  className={cn(
                    report.ceph === 'HEALTH_OK' ? 'text-success' : report.ceph === 'HEALTH_WARN' ? 'text-warning' : 'text-destructive',
                  )}
                >
                  {report.ceph}
                </dd>
              </>
            )}
          </dl>
        </>
      )}
    </GlassCard>
  )
}

const GUEST_ROWS: { key: keyof Omit<GuestCounts, 'total'>; label: string; filter: string; dot: string }[] = [
  { key: 'running', label: '运行中', filter: 'filter=running', dot: 'running' },
  { key: 'stopped', label: '已停止', filter: 'filter=stopped', dot: 'stopped' },
  { key: 'templates', label: '模板', filter: '', dot: 'template' },
]

function GuestsCard({ counts, loading }: { counts: Record<GuestType, GuestCounts>; loading: boolean }) {
  return (
    <GlassCard aria-labelledby="dc-guests">
      <CardTitle id="dc-guests" icon={Monitor}>
        客户机
      </CardTitle>
      {loading ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {(['qemu', 'lxc'] as const).map((type) => {
            const c = counts[type]
            const Icon = type === 'qemu' ? Monitor : Box
            return (
              <div key={type} className="min-w-0">
                <Link
                  to={`/?type=${type}`}
                  className="mb-1.5 flex items-baseline gap-1.5 rounded-lg outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon className="size-3.5 self-center text-muted-foreground" aria-hidden />
                  <span className="text-sm font-medium">{type === 'qemu' ? '虚拟机' : '容器'}</span>
                  <span className="ml-auto text-xl font-medium tabular">{c.total}</span>
                </Link>
                <ul className="grid gap-0.5">
                  {GUEST_ROWS.map((row) => (
                    <li key={row.key}>
                      <Link
                        to={`/?${row.key === 'templates' ? 'type=template' : `type=${type}&${row.filter}`}`}
                        className="-mx-1.5 flex h-8 items-center gap-2 rounded-lg px-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground pointer-coarse:h-10"
                      >
                        <StatusDot status={row.dot} pulse={false} size="sm" decorative />
                        {row.label}
                        <span className="ml-auto text-foreground tabular">{c[row.key]}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </GlassCard>
  )
}

function NodeTable({ nodes, statusByNode }: { nodes: NodeListEntry[]; statusByNode: Map<string, ClusterStatusNode> }) {
  const sorted = [...nodes].sort((a, b) => a.node.localeCompare(b.node))
  return (
    <>
      {/* Desktop: table */}
      <table className="hidden w-full text-sm lg:table">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b border-border/70">
            <th className="px-(--card-p) py-2.5 font-medium">节点</th>
            <th className="px-3 py-2.5 font-medium">IP</th>
            <th className="w-40 px-3 py-2.5 font-medium">CPU</th>
            <th className="w-40 px-3 py-2.5 font-medium">内存</th>
            <th className="px-3 py-2.5 font-medium">运行时间</th>
            <th className="px-(--card-p) py-2.5 text-right font-medium">订阅</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {sorted.map((n) => {
            const st = statusByNode.get(n.node)
            const online = n.status === 'online'
            return (
              <tr key={n.node} className="transition-colors hover:bg-foreground/[0.03] paper:hover:bg-secondary/40">
                <td className="px-(--card-p) py-(--row-py)">
                  <Link to={nodePath(n.node)} className="inline-flex items-center gap-2 font-medium hover:text-brand">
                    <StatusDot status={n.status} decorative />
                    {n.node}
                  </Link>
                </td>
                <td className="px-3 text-muted-foreground tabular">{st?.ip ?? '—'}</td>
                <td className="px-3">{online ? <UsageBar value={n.cpu} showPercent size="sm" detail={n.maxcpu ? `${n.maxcpu} 核` : undefined} /> : '—'}</td>
                <td className="px-3">{online ? <UsageBar value={ratio(n.mem, n.maxmem)} size="sm" detail={formatBytes(n.maxmem)} /> : '—'}</td>
                <td className="px-3 text-muted-foreground tabular">{online ? formatUptime(n.uptime) : '离线'}</td>
                <td className="px-(--card-p) text-right">
                  <SubscriptionBadge level={st?.level ?? n.level} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {/* Phone: rows */}
      <ul className="divide-y divide-border/70 lg:hidden">
        {sorted.map((n) => {
          const st = statusByNode.get(n.node)
          const online = n.status === 'online'
          return (
            <li key={n.node}>
              <Link
                to={nodePath(n.node)}
                className="flex items-center gap-3 px-(--card-p) py-(--row-py) transition-colors active:bg-foreground/[0.05]"
              >
                <StatusDot status={n.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{n.node}</span>
                    <SubscriptionBadge level={st?.level ?? n.level} />
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground tabular">
                    {[st?.ip, online ? `运行 ${formatUptime(n.uptime)}` : '离线'].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {online && (
                  <div className="grid shrink-0 grid-cols-[auto_auto] gap-x-2 text-right text-xs leading-5">
                    <span className="text-muted-foreground">CPU</span>
                    <span className="min-w-10 tabular">{formatPercent(n.cpu)}</span>
                    <span className="text-muted-foreground">内存</span>
                    <span className="min-w-10 tabular">{formatPercent(ratio(n.mem, n.maxmem))}</span>
                  </div>
                )}
                <ChevronRight className="size-4 shrink-0 text-faint" />
              </Link>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function SubscriptionBadge({ level }: { level: string | undefined }) {
  const l = subscriptionLevel(level)
  return (
    <Badge variant={l === 'none' ? 'outline' : 'secondary'} className={cn('font-normal', l === 'none' && 'text-muted-foreground')}>
      {SUBSCRIPTION_LABEL[l]}
    </Badge>
  )
}

function SubscriptionSummary({ subs }: { subs: ReturnType<typeof subscriptionSummary> }) {
  if (subs.length === 0) return <p className="text-sm text-muted-foreground">没有节点信息。</p>
  const allNone = subs.length === 1 && subs[0]!.level === 'none'
  return (
    <div className="grid gap-3">
      {allNone ? (
        <p className="text-sm">
          所有节点都<span className="font-medium">没有有效订阅</span>。
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {subs.map((s) => (
            <li key={s.level} className="flex items-center gap-2 text-sm">
              <SubscriptionBadge level={s.level === 'none' ? '' : s.level} />
              <span className="min-w-0 truncate text-muted-foreground">{s.nodes.join('、')}</span>
              <span className="ml-auto tabular">{s.nodes.length}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        {allNone
          ? '可以继续使用 no-subscription 软件源；企业源和官方支持需要订阅。'
          : '订阅密钥的管理在后续版本提供（节点 → 订阅）。'}
      </p>
    </div>
  )
}

const MANAGE: { icon: LucideIcon; label: string; hint: string; phase: 2 | 3 }[] = [
  { icon: HardDrive, label: '存储配置', hint: '添加 NFS、CIFS、PBS 等存储', phase: 2 },
  { icon: Archive, label: '备份计划', hint: '定时备份任务', phase: 2 },
  { icon: Repeat, label: '存储复制', hint: 'ZFS 复制任务', phase: 2 },
  { icon: Shield, label: '防火墙', hint: '规则、安全组、IPSet', phase: 2 },
  { icon: Users, label: '用户与权限', hint: '用户、组、角色、ACL', phase: 3 },
  { icon: KeyRound, label: '认证域', hint: 'LDAP、AD、OpenID', phase: 3 },
  { icon: ShieldCheck, label: '高可用', hint: 'HA 资源与规则', phase: 3 },
  { icon: Network, label: 'SDN', hint: 'Zone、VNet、子网', phase: 3 },
  { icon: Database, label: 'Ceph', hint: '集群存储', phase: 3 },
]

function ManageLinks() {
  return (
    <section aria-labelledby="dc-manage">
      <SectionHeader title={<span id="dc-manage">管理</span>}>
        <span className="text-xs text-muted-foreground">后续版本提供</span>
      </SectionHeader>
      <div className="grid grid-cols-2 gap-(--row-gap) sm:grid-cols-3 lg:grid-cols-5">
        {MANAGE.map((m) => (
          <GlassCard key={m.label} className="flex min-h-20 flex-col gap-1 opacity-75" aria-disabled="true">
            <div className="flex items-center gap-2">
              <m.icon className="size-4 text-muted-foreground" aria-hidden />
              <span className="text-sm font-medium">{m.label}</span>
            </div>
            <span className="text-xs text-muted-foreground">{m.hint}</span>
            <span className="mt-auto pt-1 text-[11px] text-faint">第 {m.phase} 阶段</span>
          </GlassCard>
        ))}
      </div>
    </section>
  )
}
