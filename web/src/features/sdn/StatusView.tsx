// SDN overview: status of every zone and fabric on every node
// (/cluster/resources type network), pending changes with apply / dry-run /
// rollback, and shortcuts to the configuration pages.

import { useMemo } from 'react'
import { Link } from 'react-router'
import { Cable, Layers, Network, Route, Waypoints } from 'lucide-react'

import { useClusterResources } from '@/api/queries'
import { useSdnFabrics, useSdnVnets, useSdnZones, type SdnResource } from '@/api/sdn'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { StatusDot } from '@/components/StatusDot'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { ApplyActions, usePendingSummary } from './apply'
import { sdnHref } from './nav'
import { SdnCard } from './ui'

const STATUS_LABEL: Record<string, string> = {
  ok: '正常',
  available: '正常',
  pending: '待应用',
  error: '错误',
  unknown: '未知',
}

function statusTone(s: string | undefined): string {
  if (s === 'ok' || s === 'available') return 'running'
  if (s === 'pending') return 'paused'
  if (s === 'error') return 'error'
  return 'unknown'
}

interface StatusRow {
  name: string
  kind: 'zone' | 'fabric'
  nodes: { node: string; status: string }[]
}

export function groupStatus(resources: readonly SdnResource[]): StatusRow[] {
  const map = new Map<string, StatusRow>()
  for (const r of resources) {
    const name = r.network ?? r.sdn ?? r.zone
    if (!name) continue
    const kind = r['network-type'] === 'fabric' ? 'fabric' : 'zone'
    const key = `${kind}/${name}`
    const row = map.get(key) ?? { name, kind, nodes: [] }
    map.set(key, row)
    row.nodes.push({ node: r.node, status: r.status ?? 'unknown' })
  }
  return [...map.values()]
    .map((r) => ({ ...r, nodes: r.nodes.sort((a, b) => a.node.localeCompare(b.node)) }))
    .sort((a, b) => Number(a.kind === 'fabric') - Number(b.kind === 'fabric') || a.name.localeCompare(b.name))
}

export function StatusView() {
  const resources = useClusterResources({
    select: (all) => all.filter((r) => r.type === 'network' || r.type === 'sdn') as unknown as SdnResource[],
  })
  const rows = useMemo(() => groupStatus(resources.data ?? []), [resources.data])
  const summary = usePendingSummary()
  const zones = useSdnZones()
  const vnets = useSdnVnets()
  const fabrics = useSdnFabrics()
  const errors = rows.reduce((n, r) => n + r.nodes.filter((x) => x.status === 'error').length, 0)

  const tiles = [
    { to: sdnHref('zones'), icon: Layers, label: 'Zone', count: zones.data?.length },
    { to: sdnHref('vnets'), icon: Network, label: 'VNet', count: vnets.data?.length },
    { to: sdnHref('fabrics'), icon: Waypoints, label: 'Fabric', count: fabrics.data?.fabrics.length },
    { to: sdnHref('ipam'), icon: Cable, label: 'IPAM', count: undefined },
  ]

  return (
    <div className="grid gap-(--section-gap)">
      <SdnCard
        title="配置状态"
        testId="sdn-apply-card"
        summary={
          summary.loading
            ? '正在读取…'
            : summary.total === 0
              ? '没有未应用的改动'
              : `${summary.total} 项改动未应用：${summary.parts.map((p) => `${p.label} ${p.count}`).join('、')}`
        }
      >
        <div className="grid gap-2 px-(--card-p) py-3">
          <ApplyActions pending={summary.total} />
          <p className="text-xs text-muted-foreground">Zone、VNet、子网、控制器和 Fabric 的改动先保存为待应用；应用时每个节点重新生成网络和 FRR 配置并重新加载。</p>
        </div>
      </SdnCard>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <GlassCard key={t.label} asChild interactive className="flex items-center gap-3 py-3">
            <Link to={t.to}>
              <t.icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 text-sm font-medium">{t.label}</span>
              {t.count !== undefined && <span className="font-mono text-sm text-muted-foreground tabular">{t.count}</span>}
            </Link>
          </GlassCard>
        ))}
      </div>

      <SdnCard
        title="节点状态"
        testId="sdn-status"
        summary={resources.isPending ? '正在读取…' : `${rows.length} 个网络${errors ? ` · ${errors} 处错误` : ''}`}
        onRefresh={() => void resources.refetch()}
        refreshing={resources.isFetching}
      >
        {resources.isPending ? (
          <div className="grid gap-2 p-(--card-p)">
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Route} title="没有 SDN 状态" description="应用过 SDN 配置后，这里显示每个 Zone 和 Fabric 在各节点上的状态。" />
        ) : (
          <ul className="divide-y divide-border/60" aria-label="SDN 状态">
            {rows.map((r) => (
              <li key={`${r.kind}/${r.name}`} data-testid="sdn-status-row" data-name={r.name} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-(--card-p) py-(--row-py)">
                <div className="flex min-w-36 flex-1 items-center gap-2">
                  {r.kind === 'fabric' ? <Waypoints className="size-4 text-muted-foreground" aria-hidden /> : <Layers className="size-4 text-muted-foreground" aria-hidden />}
                  {r.name === 'localnetwork' ? (
                    <span className="font-medium">本地网络</span>
                  ) : (
                    <Link
                      to={sdnHref(r.kind === 'fabric' ? 'fabrics' : 'zones', r.name)}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {r.name}
                    </Link>
                  )}
                  <span className="text-xs text-muted-foreground">{r.kind === 'fabric' ? 'Fabric' : 'Zone'}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.nodes.map((n) => (
                    <span
                      key={n.node}
                      title={`${n.node}：${STATUS_LABEL[n.status] ?? n.status}`}
                      className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-full border border-border/70 px-2.5 text-xs',
                        n.status === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
                      )}
                    >
                      <StatusDot status={statusTone(n.status)} size="sm" decorative />
                      {n.node}
                      <span className="text-muted-foreground">{STATUS_LABEL[n.status] ?? n.status}</span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SdnCard>
    </div>
  )
}
