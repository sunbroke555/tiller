// One VNet: configuration and pending changes, subnets (gateway, SNAT, DHCP
// ranges, DNS prefix), the VNet firewall (forward rules, nftables) and, for
// EVPN zones, the MAC-VRF per node.

import { useMemo, useState } from 'react'
import { Network, Pencil, Plus, Shield, Trash2, Waypoints } from 'lucide-react'

import { p } from '@/api/client'
import { deleteSdnObject, deleteSubnet, useNodeSdn, useSdnSubnets, useSdnVnets, useSdnZones, type MacVrfEntry, type SdnSubnet } from '@/api/sdn'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { VnetFirewall } from '@/features/firewall/VnetFirewall'

import { parseDhcpRanges, vnetTagLabel, zoneTypeLabel } from './model'
import { sdnHref } from './nav'
import { byState, effective } from './pending'
import { SubnetDialog } from './SubnetDialog'
import { Chip, DeleteDialog, Fact, FactGrid, ListBody, Mono, ObjectRow, PendingChanges, PendingChip, SdnCard, useDialog, useSdnCanEdit } from './ui'
import { VnetDialog } from './VnetDialog'
import { BackLink, NodePicker, useOnlineNodes } from './ZoneDetail'

type Dialog = { kind: 'edit' | 'delete' } | { kind: 'add-subnet' } | { kind: 'edit-subnet' | 'delete-subnet'; subnet: SdnSubnet }

export function VnetDetail({ vnet: id }: { vnet: string }) {
  const vnets = useSdnVnets()
  const zones = useSdnZones()
  const subnets = useSdnSubnets(id)
  const canEdit = useSdnCanEdit()
  const dialog = useDialog<Dialog>()
  const raw = vnets.data?.find((v) => effective(v).vnet === id)
  const vnet = raw && effective(raw)
  const zone = (zones.data ?? []).map(effective).find((z) => z.zone === vnet?.zone)
  const subnetList = useMemo(
    () => (subnets.data ?? []).map((s) => ({ raw: s, eff: effective(s) })).sort((a, b) => byState<SdnSubnet>((s) => s.subnet)(a.eff, b.eff)),
    [subnets.data],
  )

  if (vnets.isPending) return <LoadingRows rows={4} />
  if (vnets.error) return <ErrorState error={vnets.error} onRetry={() => void vnets.refetch()} />
  if (!raw || !vnet) {
    return (
      <div className="grid gap-3">
        <BackLink to={sdnHref('vnets')} label="VNet" />
        <EmptyState icon={Network} title={`没有 VNet ${id}`} description="它可能已被删除。" />
      </div>
    )
  }
  const alive = raw.state !== 'deleted'
  const activeSubnets = subnetList.filter((s) => s.raw.state !== 'deleted').length

  return (
    <div className="grid gap-(--section-gap)" data-testid="sdn-vnet-detail">
      <BackLink to={sdnHref('vnets')} label="VNet" />
      <SdnCard
        title={
          <span className="flex flex-wrap items-center gap-2">
            {vnet.vnet}
            {vnet.alias && <span className="text-sm font-normal text-muted-foreground">{vnet.alias}</span>}
            <PendingChip obj={raw} />
          </span>
        }
        summary="VNet 配置"
        actions={
          canEdit &&
          alive && (
            <>
              <Button variant="outline" onClick={() => dialog.open({ kind: 'edit' })}>
                <Pencil />
                编辑
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="删除 VNet"
                title={activeSubnets ? '先删除子网' : '删除'}
                disabled={activeSubnets > 0}
                onClick={() => dialog.open({ kind: 'delete' })}
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
          <Fact label="Zone">
            {vnet.zone}
            {zone && <span className="text-muted-foreground">（{zoneTypeLabel(zone.type)}）</span>}
          </Fact>
          <Fact label={vnetTagLabel(zone?.type)}>{vnet.tag ?? '—'}</Fact>
          <Fact label="VLAN aware">{vnet.vlanaware ? '是' : '否'}</Fact>
          <Fact label="端口隔离">{vnet['isolate-ports'] ? '是' : '否'}</Fact>
        </FactGrid>
      </SdnCard>

      <SdnCard
        title="子网"
        testId="sdn-subnets"
        summary={subnets.isPending ? '正在读取…' : `${subnetList.length} 个子网`}
        onRefresh={() => void subnets.refetch()}
        refreshing={subnets.isFetching}
        actions={
          canEdit &&
          alive && (
            <Button variant="outline" onClick={() => dialog.open({ kind: 'add-subnet' })}>
              <Plus />
              添加子网
            </Button>
          )
        }
      >
        <ListBody
          query={subnets}
          items={subnetList}
          label="子网"
          empty={{ icon: Waypoints, title: '还没有子网', description: '子网给 VNet 配置网关、SNAT 和 DHCP 范围，并登记到 IPAM。' }}
        >
          {({ raw: s, eff }) => {
            const ranges = parseDhcpRanges(eff['dhcp-range'])
            return (
              <ObjectRow
                key={eff.subnet}
                testId="sdn-subnet-row"
                rowKey={eff.cidr}
                title={<Mono>{eff.cidr ?? eff.subnet}</Mono>}
                obj={s}
                onOpen={canEdit && s.state !== 'deleted' ? () => dialog.open({ kind: 'edit-subnet', subnet: eff }) : undefined}
                badge={eff.snat ? <Chip>SNAT</Chip> : undefined}
                detail={
                  <>
                    <span>网关 {eff.gateway ?? '—'}</span>
                    {ranges.length > 0 && <span>· DHCP {ranges.map((r) => `${r['start-address']}–${r['end-address']}`).join('，')}</span>}
                    {eff.dnszoneprefix && <span>· DNS 前缀 {eff.dnszoneprefix}</span>}
                    {eff['dhcp-dns-server'] && <span>· DNS {eff['dhcp-dns-server']}</span>}
                  </>
                }
                actions={
                  canEdit && s.state !== 'deleted'
                    ? [
                        { label: '编辑', icon: Pencil, onSelect: () => dialog.open({ kind: 'edit-subnet', subnet: eff }) },
                        { label: '删除', icon: Trash2, destructive: true, onSelect: () => dialog.open({ kind: 'delete-subnet', subnet: eff }) },
                      ]
                    : undefined
                }
              />
            )
          }}
        </ListBody>
      </SdnCard>

      <section className="grid gap-3" aria-labelledby="sdn-vnet-fw">
        <h2 id="sdn-vnet-fw" className="heading flex items-center gap-2 text-base font-medium">
          <Shield className="size-4 text-muted-foreground" aria-hidden />
          防火墙
          <span className="text-xs font-normal text-muted-foreground">经过这个 VNet 转发的流量（仅 nftables 后端）</span>
        </h2>
        {raw.state === 'new' ? (
          <p className="text-sm text-muted-foreground">应用 SDN 配置后才能给新的 VNet 配置防火墙。</p>
        ) : (
          <VnetFirewall vnet={vnet.vnet} />
        )}
      </section>

      {zone?.type === 'evpn' && raw.state !== 'new' && <MacVrf vnet={vnet.vnet} />}

      {dialog.shown?.kind === 'edit' && <VnetDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} vnet={vnet} />}
      {dialog.shown?.kind === 'delete' && (
        <DeleteDialog
          open={dialog.isOpen}
          onOpenChange={dialog.onOpenChange}
          what=" VNet"
          name={vnet.vnet}
          isNew={raw.state === 'new'}
          run={() => deleteSdnObject('vnets', vnet.vnet)}
        />
      )}
      {dialog.shown?.kind === 'add-subnet' && <SubnetDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} vnet={vnet.vnet} zoneType={zone?.type} />}
      {dialog.shown?.kind === 'edit-subnet' && (
        <SubnetDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} vnet={vnet.vnet} subnet={dialog.shown.subnet} zoneType={zone?.type} />
      )}
      {dialog.shown?.kind === 'delete-subnet' && (
        <DeleteDialog
          open={dialog.isOpen}
          onOpenChange={dialog.onOpenChange}
          what="子网"
          name={dialog.shown.subnet.cidr ?? dialog.shown.subnet.subnet}
          isNew={dialog.shown.subnet.state === 'new'}
          run={() => deleteSubnet(vnet.vnet, (dialog.shown as { subnet: SdnSubnet }).subnet.subnet)}
        />
      )}
    </div>
  )
}

function MacVrf({ vnet }: { vnet: string }) {
  const nodes = useOnlineNodes()
  const [picked, setPicked] = useState<string>()
  const node = picked && nodes.includes(picked) ? picked : nodes[0]
  const q = useNodeSdn<MacVrfEntry[]>(node, p`/nodes/${node ?? ''}/sdn/vnets/${vnet}/mac-vrf`, ['vnets', vnet, 'mac-vrf'])
  return (
    <SdnCard title="MAC-VRF" summary="节点自己产生或通过 BGP 学到的 MAC/IP 路由">
      <div className="px-(--card-p) py-3">
        <NodePicker nodes={nodes} value={node} onChange={setPicked} />
      </div>
      {q.isPending ? (
        <LoadingRows rows={2} className="px-(--card-p) pb-3" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
      ) : !q.data?.length ? (
        <p className="px-(--card-p) pb-4 text-sm text-muted-foreground">没有条目。</p>
      ) : (
        <ul className="divide-y divide-border/60 border-t border-border/60" aria-label="MAC-VRF">
          {q.data.map((e, i) => (
            <li key={`${e.mac}-${e.ip}-${i}`} className="flex flex-wrap gap-x-3 px-(--card-p) py-2 text-sm">
              <Mono>{e.mac ?? '—'}</Mono>
              <Mono>{e.ip ?? ''}</Mono>
              <span className="text-xs text-muted-foreground">下一跳 {e.nexthop ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </SdnCard>
  )
}
