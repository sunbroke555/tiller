// Fabric list (OpenFabric, OSPF, BGP, WireGuard): protocol, prefixes and
// member nodes; add by protocol, edit, delete. A fabric opens its nodes and
// the per-node routes / neighbors / interfaces.

import { useMemo } from 'react'
import { Pencil, Trash2, Waypoints } from 'lucide-react'

import { deleteFabric, useSdnFabrics, type FabricProtocol, type SdnFabric } from '@/api/sdn'

import { FabricDialog } from './FabricDialogs'
import { FABRIC_PROTOCOLS, protocolLabel } from './model'
import { sdnHref } from './nav'
import { byState, effective } from './pending'
import { AddButton, Chip, DeleteDialog, ListBody, ObjectRow, SdnCard, useDialog, useSdnCanEdit } from './ui'

type Dialog = { kind: 'add'; protocol: FabricProtocol } | { kind: 'edit' | 'delete'; fabric: SdnFabric }

export function FabricsView() {
  const fabrics = useSdnFabrics()
  const canEdit = useSdnCanEdit()
  const dialog = useDialog<Dialog>()
  const list = useMemo(
    () => (fabrics.data?.fabrics ?? []).map((f) => ({ raw: f, eff: effective(f) })).sort((a, b) => byState<SdnFabric>((f) => f.id)(a.eff, b.eff)),
    [fabrics.data],
  )
  const nodesOf = (id: string) =>
    (fabrics.data?.nodes ?? [])
      .map(effective)
      .filter((n) => n.fabric_id === id && n.state !== 'deleted')
      .map((n) => n.node_id)
      .sort()

  return (
    <SdnCard
      title="Fabrics"
      testId="sdn-fabrics"
      summary={fabrics.isPending ? '正在读取…' : `${list.length} 个 Fabric · 节点之间的路由底层网络，可作为 VXLAN / EVPN 的承载`}
      onRefresh={() => void fabrics.refetch()}
      refreshing={fabrics.isFetching}
      actions={
        <AddButton
          types={FABRIC_PROTOCOLS.map((p) => ({ value: p.protocol, label: p.label, hint: p.hint }))}
          onAdd={(protocol) => protocol && dialog.open({ kind: 'add', protocol })}
          disabled={!canEdit && '没有 SDN.Allocate 权限'}
        />
      }
    >
      <ListBody
        query={fabrics}
        items={list}
        label="Fabric"
        empty={{ icon: Waypoints, title: '还没有 Fabric', description: 'OpenFabric 适合节点之间全互联（含直连网线）的场景；OSPF 接入已有的路由网络。' }}
      >
        {({ raw, eff }) => {
          const nodes = nodesOf(eff.id)
          return (
            <ObjectRow
              key={eff.id}
              testId="sdn-fabric-row"
              rowKey={eff.id}
              icon={Waypoints}
              title={eff.id}
              badge={<Chip>{protocolLabel(eff.protocol)}</Chip>}
              obj={raw}
              to={sdnHref('fabrics', eff.id)}
              detail={
                <>
                  {eff.ip_prefix && <span>{eff.ip_prefix}</span>}
                  {eff.ip6_prefix && <span>· {eff.ip6_prefix}</span>}
                  {eff.area !== undefined && <span>· 区域 {eff.area}</span>}
                  <span>· {nodes.length ? nodes.join('、') : '没有节点'}</span>
                </>
              }
              actions={
                canEdit && raw.state !== 'deleted'
                  ? [
                      { label: '编辑', icon: Pencil, onSelect: () => dialog.open({ kind: 'edit', fabric: eff }) },
                      {
                        label: '删除',
                        icon: Trash2,
                        destructive: true,
                        disabled: nodes.length > 0 && '先移除 Fabric 里的节点',
                        onSelect: () => dialog.open({ kind: 'delete', fabric: eff }),
                      },
                    ]
                  : undefined
              }
            />
          )
        }}
      </ListBody>

      {dialog.shown?.kind === 'add' && <FabricDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} protocol={dialog.shown.protocol} />}
      {dialog.shown?.kind === 'edit' && (
        <FabricDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} protocol={dialog.shown.fabric.protocol} fabric={dialog.shown.fabric} />
      )}
      {dialog.shown?.kind === 'delete' && (
        <DeleteDialog
          open={dialog.isOpen}
          onOpenChange={dialog.onOpenChange}
          what=" Fabric"
          name={dialog.shown.fabric.id}
          isNew={false}
          run={() => deleteFabric((dialog.shown as { fabric: SdnFabric }).fabric.id)}
        />
      )}
    </SdnCard>
  )
}
