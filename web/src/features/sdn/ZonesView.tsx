// Zone list: type, MTU, IPAM, DNS, nodes and the pending state; add by type,
// edit, delete. Opening a zone shows its VNets and per-node runtime state.

import { useMemo } from 'react'
import { Layers, Pencil, Trash2 } from 'lucide-react'

import { deleteSdnObject, useSdnVnets, useSdnZones, type SdnZone, type ZoneType } from '@/api/sdn'

import { ZONE_TYPES, splitList, zoneTypeLabel } from './model'
import { sdnHref } from './nav'
import { byState, effective } from './pending'
import { AddButton, Chip, DeleteDialog, ListBody, ObjectRow, SdnCard, useDialog, useSdnCanEdit } from './ui'
import { ZoneDialog } from './ZoneDialog'

type Dialog = { kind: 'add'; type: ZoneType } | { kind: 'edit' | 'delete'; zone: SdnZone }

export function zoneDetail(z: SdnZone, vnetCount: number) {
  const nodes = splitList(z.nodes)
  return (
    <>
      <span>{vnetCount} 个 VNet</span>
      {z.bridge && <span>· 网桥 {z.bridge}</span>}
      {z.tag !== undefined && <span>· 服务 VLAN {z.tag}</span>}
      {z.mtu && <span>· MTU {z.mtu}</span>}
      {z.ipam && <span>· IPAM {z.ipam}</span>}
      {z.dnszone && <span>· {z.dnszone}</span>}
      {z.controller && <span>· 控制器 {z.controller}</span>}
      {z.dhcp && <span>· 自动 DHCP</span>}
      <span>· {nodes.length ? nodes.join('、') : '所有节点'}</span>
    </>
  )
}

export function ZonesView() {
  const zones = useSdnZones()
  const vnets = useSdnVnets()
  const canEdit = useSdnCanEdit()
  const dialog = useDialog<Dialog>()

  const list = useMemo(() => (zones.data ?? []).map((z) => ({ raw: z, eff: effective(z) })).sort((a, b) => byState<SdnZone>((z) => z.zone)(a.eff, b.eff)), [zones.data])
  const vnetCount = (zone: string) => (vnets.data ?? []).map(effective).filter((v) => v.zone === zone && v.state !== 'deleted').length
  const add = (type?: ZoneType) => type && dialog.open({ kind: 'add', type })
  const types = ZONE_TYPES.map((t) => ({ value: t.type, label: t.label, hint: t.hint }))

  return (
    <SdnCard
      title="Zone"
      testId="sdn-zones"
      summary={zones.isPending ? '正在读取…' : `${list.length} 个 Zone · Zone 决定 VNet 用哪种技术隔离、在哪些节点上可用`}
      onRefresh={() => void zones.refetch()}
      refreshing={zones.isFetching}
      actions={<AddButton types={types} onAdd={add} disabled={!canEdit && '没有 SDN.Allocate 权限'} />}
    >
      <ListBody
        query={zones}
        items={list}
        label="Zone"
        empty={{
          icon: Layers,
          title: '还没有 Zone',
          description: 'Simple Zone 适合单节点的隔离网络；VLAN / QinQ 基于现有网桥；VXLAN 和 EVPN 跨节点组网。',
        }}
      >
        {({ raw, eff }) => (
          <ObjectRow
            key={eff.zone}
            testId="sdn-zone-row"
            rowKey={eff.zone}
            icon={Layers}
            title={eff.zone}
            badge={<Chip>{zoneTypeLabel(eff.type)}</Chip>}
            detail={zoneDetail(eff, vnetCount(eff.zone))}
            obj={raw}
            to={sdnHref('zones', eff.zone)}
            actions={
              canEdit && raw.state !== 'deleted'
                ? [
                    { label: '编辑', icon: Pencil, onSelect: () => dialog.open({ kind: 'edit', zone: eff }) },
                    {
                      label: '删除',
                      icon: Trash2,
                      destructive: true,
                      disabled: vnetCount(eff.zone) > 0 && '先删除 Zone 里的 VNet',
                      onSelect: () => dialog.open({ kind: 'delete', zone: eff }),
                    },
                  ]
                : undefined
            }
          />
        )}
      </ListBody>

      {dialog.shown?.kind === 'add' && <ZoneDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} type={dialog.shown.type} />}
      {dialog.shown?.kind === 'edit' && (
        <ZoneDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} type={dialog.shown.zone.type} zone={dialog.shown.zone} />
      )}
      {dialog.shown?.kind === 'delete' && (
        <DeleteDialog
          open={dialog.isOpen}
          onOpenChange={dialog.onOpenChange}
          what=" Zone"
          name={dialog.shown.zone.zone}
          isNew={dialog.shown.zone.state === 'new'}
          run={() => deleteSdnObject('zones', (dialog.shown as { zone: SdnZone }).zone.zone)}
        />
      )}
    </SdnCard>
  )
}
