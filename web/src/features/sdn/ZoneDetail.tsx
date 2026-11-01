// One zone: configuration, pending changes, its VNets and the runtime view
// per node (/nodes/{node}/sdn/zones/{zone}: VNet status, bridges and ports,
// EVPN IP-VRF) — the official "zone on node" panels.

import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Layers, Network, Pencil, Trash2 } from 'lucide-react'

import { p } from '@/api/client'
import { useClusterResources } from '@/api/queries'
import {
  deleteSdnObject,
  useNodeSdn,
  useSdnVnets,
  useSdnZones,
  type IpVrfEntry,
  type SdnResource,
  type ZoneBridge,
  type ZoneContentEntry,
} from '@/api/sdn'
import { isNode } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { StatusDot } from '@/components/StatusDot'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

import { splitList, vnetTagLabel, zoneTypeLabel } from './model'
import { sdnHref } from './nav'
import { effective } from './pending'
import { Chip, DeleteDialog, Fact, FactGrid, Mono, ObjectRow, PendingChanges, PendingChip, SdnCard, useDialog, useSdnCanEdit } from './ui'
import { ZoneDialog } from './ZoneDialog'

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="inline-flex h-9 w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden />
      {label}
    </Link>
  )
}

/** Toggle between the nodes a runtime view can be read from. */
export function NodePicker({ nodes, value, onChange }: { nodes: readonly string[]; value: string | undefined; onChange: (n: string) => void }) {
  return (
    <div className="overflow-x-auto scrollbar-none">
      <ToggleGroup type="single" variant="outline" size="sm" value={value ?? ''} onValueChange={(v) => v && onChange(v)} aria-label="节点" className="w-max">
        {nodes.map((n) => (
          <ToggleGroupItem key={n} value={n} className="px-3 text-xs pointer-coarse:h-9">
            {n}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

/** Online nodes, the first one preselected. */
export function useOnlineNodes() {
  const { data } = useClusterResources({
    select: (all) => all.filter(isNode).filter((n) => n.status === 'online').map((n) => n.node).sort(),
  })
  return data ?? []
}

type Tab = 'content' | 'bridges' | 'ip-vrf'

export function ZoneDetail({ zone: id }: { zone: string }) {
  const zones = useSdnZones()
  const vnets = useSdnVnets()
  const canEdit = useSdnCanEdit()
  const dialog = useDialog<'edit' | 'delete'>()
  const raw = zones.data?.find((z) => effective(z).zone === id)
  const zone = raw && effective(raw)
  const zoneVnets = useMemo(() => (vnets.data ?? []).filter((v) => effective(v).zone === id), [vnets.data, id])

  if (zones.isPending) return <LoadingRows rows={4} />
  if (zones.error) return <ErrorState error={zones.error} onRetry={() => void zones.refetch()} />
  if (!raw || !zone) {
    return (
      <div className="grid gap-3">
        <BackLink to={sdnHref('zones')} label="Zone" />
        <EmptyState icon={Layers} title={`没有 Zone ${id}`} description="它可能已被删除。" />
      </div>
    )
  }

  const nodes = splitList(zone.nodes)
  return (
    <div className="grid gap-(--section-gap)" data-testid="sdn-zone-detail">
      <BackLink to={sdnHref('zones')} label="Zone" />
      <SdnCard
        title={
          <span className="flex flex-wrap items-center gap-2">
            {zone.zone}
            <Chip>{zoneTypeLabel(zone.type)}</Chip>
            <PendingChip obj={raw} />
          </span>
        }
        summary="Zone 配置"
        actions={
          canEdit &&
          raw.state !== 'deleted' && (
            <>
              <Button variant="outline" onClick={() => dialog.open('edit')}>
                <Pencil />
                编辑
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="删除 Zone"
                title={zoneVnets.length ? '先删除 Zone 里的 VNet' : '删除'}
                disabled={zoneVnets.some((v) => v.state !== 'deleted')}
                onClick={() => dialog.open('delete')}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 />
              </Button>
            </>
          )
        }
      >
        {raw.state && (
          <div className="px-(--card-p) pt-3">
            <PendingChanges obj={raw} />
          </div>
        )}
        <FactGrid>
          <Fact label="类型">{zoneTypeLabel(zone.type)}</Fact>
          <Fact label="MTU">{zone.mtu ?? '自动'}</Fact>
          <Fact label="节点">{nodes.length ? nodes.join('、') : '所有节点'}</Fact>
          <Fact label="IPAM">{zone.ipam}</Fact>
          {zone.bridge && <Fact label="网桥">{zone.bridge}</Fact>}
          {zone.tag !== undefined && <Fact label="服务 VLAN">{zone.tag}</Fact>}
          {zone['vlan-protocol'] && <Fact label="VLAN 协议">{zone['vlan-protocol']}</Fact>}
          {zone.peers && <Fact label="对端">{zone.peers}</Fact>}
          {zone.fabric && <Fact label="Fabric">{zone.fabric}</Fact>}
          {zone['vxlan-port'] && <Fact label="VXLAN 端口">{zone['vxlan-port']}</Fact>}
          {zone.controller && <Fact label="控制器">{zone.controller}</Fact>}
          {zone['vrf-vxlan'] && <Fact label="VRF VXLAN">{zone['vrf-vxlan']}</Fact>}
          {zone.mac && <Fact label="VNet MAC">{zone.mac}</Fact>}
          {zone.exitnodes && <Fact label="出口节点">{zone.exitnodes}</Fact>}
          {zone['exitnodes-primary'] && <Fact label="首选出口">{zone['exitnodes-primary']}</Fact>}
          {zone['rt-import'] && <Fact label="导入 RT">{zone['rt-import']}</Fact>}
          {zone.type === 'simple' && <Fact label="自动 DHCP">{zone.dhcp ? 'dnsmasq' : '关闭'}</Fact>}
          {zone.dns && <Fact label="DNS">{zone.dns}</Fact>}
          {zone.reversedns && <Fact label="反向 DNS">{zone.reversedns}</Fact>}
          {zone.dnszone && <Fact label="DNS 域">{zone.dnszone}</Fact>}
        </FactGrid>
      </SdnCard>

      <SdnCard title="VNet" summary={`${zoneVnets.length} 个`}>
        {zoneVnets.length === 0 ? (
          <EmptyState icon={Network} title="这个 Zone 里还没有 VNet" action={<Link className="text-sm text-brand-strong hover:underline" to={sdnHref('vnets')}>去添加 VNet</Link>} />
        ) : (
          <ul className="divide-y divide-border/60" aria-label="VNet">
            {zoneVnets.map((v) => {
              const e = effective(v)
              return (
                <ObjectRow
                  key={e.vnet}
                  icon={Network}
                  title={e.vnet}
                  obj={v}
                  to={sdnHref('vnets', e.vnet)}
                  detail={
                    <>
                      {e.alias && <span>{e.alias}</span>}
                      {e.tag !== undefined && <span>· {vnetTagLabel(zone.type)} {e.tag}</span>}
                    </>
                  }
                />
              )
            })}
          </ul>
        )}
      </SdnCard>

      {raw.state !== 'new' && <ZoneRuntime zone={zone.zone} type={zone.type} />}

      {dialog.shown === 'edit' && <ZoneDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} type={zone.type} zone={zone} />}
      {dialog.shown === 'delete' && (
        <DeleteDialog
          open={dialog.isOpen}
          onOpenChange={dialog.onOpenChange}
          what=" Zone"
          name={zone.zone}
          isNew={raw.state === 'new'}
          run={() => deleteSdnObject('zones', zone.zone)}
        />
      )}
    </div>
  )
}

function ZoneRuntime({ zone, type }: { zone: string; type: string }) {
  const online = useOnlineNodes()
  const { data: statusRes } = useClusterResources({
    select: (all) => (all as unknown as SdnResource[]).filter((r) => r.type === 'network' && r['network-type'] === 'zone' && r.network === zone),
  })
  const nodes = useMemo(() => {
    const withZone = (statusRes ?? []).map((r) => r.node)
    return withZone.length ? online.filter((n) => withZone.includes(n)) : online
  }, [statusRes, online])
  const [picked, setPicked] = useState<string>()
  const node = picked && nodes.includes(picked) ? picked : nodes[0]
  const [tab, setTab] = useState<Tab>('content')
  const tabs: { id: Tab; label: string }[] = [
    { id: 'content', label: 'VNet 状态' },
    { id: 'bridges', label: '网桥与端口' },
    ...(type === 'evpn' ? [{ id: 'ip-vrf' as const, label: 'IP-VRF' }] : []),
  ]
  const status = statusRes?.find((r) => r.node === node)?.status

  return (
    <SdnCard
      title="节点上的运行状态"
      summary={node ? `${node}${status ? ` · ${status === 'ok' || status === 'available' ? '正常' : status}` : ''}` : '没有在线节点'}
      testId="sdn-zone-runtime"
    >
      <div className="grid gap-3 px-(--card-p) py-3">
        <NodePicker nodes={nodes} value={node} onChange={setPicked} />
        <ToggleGroup type="single" variant="outline" size="sm" value={tab} onValueChange={(v) => v && setTab(v as Tab)} aria-label="视图" className="w-max">
          {tabs.map((t) => (
            <ToggleGroupItem key={t.id} value={t.id} className="px-3 text-xs pointer-coarse:h-9">
              {t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {node && tab === 'content' && <ZoneContent node={node} zone={zone} />}
      {node && tab === 'bridges' && <ZoneBridges node={node} zone={zone} />}
      {node && tab === 'ip-vrf' && <ZoneIpVrf node={node} zone={zone} />}
    </SdnCard>
  )
}

function RuntimeState<T>({ q, empty, children }: { q: { isPending: boolean; error: unknown; data?: T[] | undefined; refetch: () => unknown }; empty: string; children: (rows: T[]) => ReactNode }) {
  if (q.isPending) return <LoadingRows rows={2} className="px-(--card-p) pb-3" />
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
  if (!q.data?.length) return <p className="px-(--card-p) pb-4 text-sm text-muted-foreground">{empty}</p>
  return <>{children(q.data)}</>
}

function ZoneContent({ node, zone }: { node: string; zone: string }) {
  const q = useNodeSdn<ZoneContentEntry[]>(node, p`/nodes/${node}/sdn/zones/${zone}/content`, ['zones', zone, 'content'])
  return (
    <RuntimeState q={q} empty="这个节点上没有 VNet。">
      {(rows) => (
        <ul className="divide-y divide-border/60 border-t border-border/60" aria-label="VNet 状态">
          {rows.map((r) => (
            <li key={r.vnet} className="flex items-center gap-3 px-(--card-p) py-2.5 text-sm">
              <StatusDot status={r.status === 'available' ? 'ok' : r.status} size="sm" decorative />
              <span className="font-medium">{r.vnet}</span>
              <span className="text-xs text-muted-foreground">{r.status === 'available' ? '可用' : r.status}</span>
              {r.statusmsg && <span className="min-w-0 truncate text-xs text-destructive">{r.statusmsg}</span>}
            </li>
          ))}
        </ul>
      )}
    </RuntimeState>
  )
}

function ZoneBridges({ node, zone }: { node: string; zone: string }) {
  const q = useNodeSdn<ZoneBridge[]>(node, p`/nodes/${node}/sdn/zones/${zone}/bridges`, ['zones', zone, 'bridges'])
  return (
    <RuntimeState q={q} empty="没有网桥。">
      {(rows) => (
        <ul className="divide-y divide-border/60 border-t border-border/60" aria-label="网桥">
          {rows.map((b) => (
            <li key={b.name} className="grid gap-1.5 px-(--card-p) py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{b.name}</span>
                {b.vlan_filtering === '1' && <Chip>VLAN aware</Chip>}
                <span className="text-xs text-muted-foreground">{b.ports?.length ?? 0} 个端口</span>
              </div>
              {b.ports && b.ports.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {b.ports.map((port) => (
                    <span key={port.name} className={cn('inline-flex items-center gap-1 rounded-lg bg-foreground/[0.04] px-2 py-1 text-xs ring-1 ring-border/60 ring-inset')}>
                      <Mono>{port.name}</Mono>
                      {port.vmid !== undefined && <span className="text-muted-foreground">· {port.vmid}{port.index !== undefined ? ` net${port.index}` : ''}</span>}
                      {port.primary_vlan !== undefined && <span className="text-muted-foreground">· PVID {port.primary_vlan}</span>}
                      {port.vlans?.length ? <span className="text-muted-foreground">· {port.vlans.join(',')}</span> : null}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </RuntimeState>
  )
}

function ZoneIpVrf({ node, zone }: { node: string; zone: string }) {
  const q = useNodeSdn<IpVrfEntry[]>(node, p`/nodes/${node}/sdn/zones/${zone}/ip-vrf`, ['zones', zone, 'ip-vrf'])
  return (
    <RuntimeState q={q} empty="VRF 路由表为空。">
      {(rows) => (
        <ul className="divide-y divide-border/60 border-t border-border/60" aria-label="IP-VRF">
          {rows.map((r, i) => (
            <li key={`${r.ip}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-(--card-p) py-2 text-sm">
              <Mono>{r.ip}</Mono>
              <span className="text-xs text-muted-foreground">
                {r.protocol ?? ''} {r.metric !== undefined ? `metric ${r.metric}` : ''} → {(r.nexthops ?? []).join(', ') || '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </RuntimeState>
  )
}
