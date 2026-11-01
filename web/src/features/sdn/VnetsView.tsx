// VNet list grouped by zone: alias, tag, VLAN aware, pending state; add,
// edit, delete. Opening a VNet shows its subnets and firewall.

import { useMemo } from 'react'
import { Network, Pencil, Trash2 } from 'lucide-react'

import { deleteSdnObject, useSdnSubnetsOf, useSdnVnets, useSdnZones, type SdnVnet } from '@/api/sdn'

import { vnetTagLabel, zoneTypeLabel } from './model'
import { sdnHref } from './nav'
import { byState, effective } from './pending'
import { AddButton, DeleteDialog, ListBody, ObjectRow, SdnCard, useDialog, useSdnCanEdit } from './ui'
import { VnetDialog } from './VnetDialog'

type Dialog = { kind: 'add' } | { kind: 'edit' | 'delete'; vnet: SdnVnet }

export function VnetsView() {
  const vnets = useSdnVnets()
  const zones = useSdnZones()
  const canEdit = useSdnCanEdit()
  const dialog = useDialog<Dialog>()
  const list = useMemo(() => (vnets.data ?? []).map((v) => ({ raw: v, eff: effective(v) })).sort((a, b) => byState<SdnVnet>((v) => v.vnet)(a.eff, b.eff)), [vnets.data])
  const subnets = useSdnSubnetsOf(useMemo(() => list.map((v) => v.eff.vnet), [list]))
  const zoneType = (z: string | undefined) => (zones.data ?? []).map(effective).find((x) => x.zone === z)?.type
  const subnetCount = (vnet: string) => subnets.data.filter((s) => s.vnet === vnet && s.state !== 'deleted').length

  return (
    <SdnCard
      title="VNet"
      testId="sdn-vnets"
      summary={vnets.isPending ? '正在读取…' : `${list.length} 个 VNet · 客户机网卡选它作为网桥`}
      onRefresh={() => void vnets.refetch()}
      refreshing={vnets.isFetching}
      actions={
        <AddButton
          onAdd={() => dialog.open({ kind: 'add' })}
          disabled={!canEdit ? '没有 SDN.Allocate 权限' : !zones.data?.length && !zones.isPending ? '先添加 Zone' : false}
        />
      }
    >
      <ListBody
        query={vnets}
        items={list}
        label="VNet"
        empty={{ icon: Network, title: '还没有 VNet', description: '在 Zone 里添加 VNet，然后给它配置子网和 DHCP。' }}
      >
        {({ raw, eff }) => {
          const type = zoneType(eff.zone)
          const n = subnetCount(eff.vnet)
          return (
            <ObjectRow
              key={eff.vnet}
              testId="sdn-vnet-row"
              rowKey={eff.vnet}
              icon={Network}
              title={eff.vnet}
              obj={raw}
              to={sdnHref('vnets', eff.vnet)}
              detail={
                <>
                  {eff.alias && <span className="text-foreground/80">{eff.alias}</span>}
                  <span>
                    {eff.alias && '· '}Zone {eff.zone}
                    {type ? `（${zoneTypeLabel(type)}）` : ''}
                  </span>
                  {eff.tag !== undefined && (
                    <span>
                      · {vnetTagLabel(type)} {eff.tag}
                    </span>
                  )}
                  {eff.vlanaware ? <span>· VLAN aware</span> : null}
                  {eff['isolate-ports'] ? <span>· 端口隔离</span> : null}
                  <span>· {n} 个子网</span>
                </>
              }
              actions={
                canEdit && raw.state !== 'deleted'
                  ? [
                      { label: '编辑', icon: Pencil, onSelect: () => dialog.open({ kind: 'edit', vnet: eff }) },
                      {
                        label: '删除',
                        icon: Trash2,
                        destructive: true,
                        disabled: n > 0 && '先删除 VNet 的子网',
                        onSelect: () => dialog.open({ kind: 'delete', vnet: eff }),
                      },
                    ]
                  : undefined
              }
            />
          )
        }}
      </ListBody>

      {dialog.shown?.kind === 'add' && <VnetDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} />}
      {dialog.shown?.kind === 'edit' && <VnetDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} vnet={dialog.shown.vnet} />}
      {dialog.shown?.kind === 'delete' && (
        <DeleteDialog
          open={dialog.isOpen}
          onOpenChange={dialog.onOpenChange}
          what=" VNet"
          name={dialog.shown.vnet.vnet}
          isNew={dialog.shown.vnet.state === 'new'}
          run={() => deleteSdnObject('vnets', (dialog.shown as { vnet: SdnVnet }).vnet.vnet)}
        />
      )}
    </SdnCard>
  )
}
