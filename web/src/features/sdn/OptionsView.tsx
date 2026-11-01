// SDN options: controllers (pending-aware), IPAM plugins and DNS plugins.

import { useMemo } from 'react'
import { Database, Globe, Pencil, Radar, Trash2 } from 'lucide-react'

import {
  deleteSdnObject,
  useSdnControllers,
  useSdnDns,
  useSdnIpams,
  useSdnZones,
  type ControllerType,
  type IpamType,
  type SdnController,
  type SdnDns,
  type SdnIpam,
} from '@/api/sdn'

import { CONTROLLER_TYPES, IPAM_TYPES } from './model'
import { byState, effective } from './pending'
import { ControllerDialog, DnsDialog, IpamDialog } from './PluginDialogs'
import { AddButton, Chip, DeleteDialog, ListBody, ObjectRow, SdnCard, useDialog, useSdnCanEdit } from './ui'

type Dialog =
  | { kind: 'add-controller'; type: ControllerType }
  | { kind: 'edit-controller' | 'delete-controller'; controller: SdnController }
  | { kind: 'add-ipam'; type: IpamType }
  | { kind: 'edit-ipam' | 'delete-ipam'; ipam: SdnIpam }
  | { kind: 'add-dns' }
  | { kind: 'edit-dns' | 'delete-dns'; dns: SdnDns }

export function OptionsView() {
  const controllers = useSdnControllers()
  const ipams = useSdnIpams()
  const dns = useSdnDns()
  const zones = useSdnZones()
  const canEdit = useSdnCanEdit()
  const dialog = useDialog<Dialog>()
  const noPerm = !canEdit && '没有 SDN.Allocate 权限'

  const zoneList = useMemo(() => (zones.data ?? []).map(effective), [zones.data])
  const usedBy = (key: 'controller' | 'ipam' | 'dns', id: string) =>
    zoneList.filter((z) => z[key] === id || (key === 'dns' && z.reversedns === id)).map((z) => z.zone)
  const ctrlList = useMemo(
    () => (controllers.data ?? []).map((c) => ({ raw: c, eff: effective(c) })).sort((a, b) => byState<SdnController>((c) => c.controller)(a.eff, b.eff)),
    [controllers.data],
  )
  const ipamList = useMemo(() => [...(ipams.data ?? [])].sort((a, b) => a.ipam.localeCompare(b.ipam)), [ipams.data])
  const dnsList = useMemo(() => [...(dns.data ?? [])].sort((a, b) => a.dns.localeCompare(b.dns)), [dns.data])
  const shown = dialog.shown

  return (
    <div className="grid gap-(--section-gap)">
      <SdnCard
        title="控制器"
        testId="sdn-controllers"
        summary="EVPN Zone 的 BGP 控制面、节点的 BGP / IS-IS 路由"
        onRefresh={() => void controllers.refetch()}
        refreshing={controllers.isFetching}
        actions={
          <AddButton
            types={CONTROLLER_TYPES.map((t) => ({ value: t.type, label: t.label, hint: t.hint }))}
            onAdd={(type) => type && dialog.open({ kind: 'add-controller', type })}
            disabled={noPerm}
          />
        }
      >
        <ListBody query={controllers} items={ctrlList} label="控制器" empty={{ icon: Radar, title: '没有控制器', description: 'EVPN Zone 需要一个 EVPN 控制器。' }}>
          {({ raw, eff }) => {
            const users = usedBy('controller', eff.controller)
            return (
              <ObjectRow
                key={eff.controller}
                testId="sdn-controller-row"
                rowKey={eff.controller}
                icon={Radar}
                title={eff.controller}
                badge={<Chip>{CONTROLLER_TYPES.find((t) => t.type === eff.type)?.label ?? eff.type}</Chip>}
                obj={raw}
                detail={
                  <>
                    {eff.node && <span>节点 {eff.node}</span>}
                    {eff.asn !== undefined && <span>ASN {eff.asn}</span>}
                    {eff.peers && <span>· 对等体 {eff.peers.split(',').join(', ')}</span>}
                    {eff.fabric && <span>· Fabric {eff.fabric}</span>}
                    {eff['isis-domain'] && <span>· 域 {eff['isis-domain']}</span>}
                    {users.length > 0 && <span>· 用于 {users.join('、')}</span>}
                  </>
                }
                actions={
                  canEdit && raw.state !== 'deleted'
                    ? [
                        { label: '编辑', icon: Pencil, onSelect: () => dialog.open({ kind: 'edit-controller', controller: eff }) },
                        {
                          label: '删除',
                          icon: Trash2,
                          destructive: true,
                          disabled: users.length > 0 && `仍被 Zone ${users.join('、')} 使用`,
                          onSelect: () => dialog.open({ kind: 'delete-controller', controller: eff }),
                        },
                      ]
                    : undefined
                }
              />
            )
          }}
        </ListBody>
      </SdnCard>

      <SdnCard
        title="IPAM"
        testId="sdn-ipams"
        summary="子网和客户机 IP 登记到哪里；改动立即生效"
        onRefresh={() => void ipams.refetch()}
        refreshing={ipams.isFetching}
        actions={
          <AddButton
            types={IPAM_TYPES.filter((t) => t.type !== 'pve').map((t) => ({ value: t.type, label: t.label }))}
            onAdd={(type) => type && dialog.open({ kind: 'add-ipam', type })}
            disabled={noPerm}
          />
        }
      >
        <ListBody query={ipams} items={ipamList} label="IPAM" empty={{ icon: Database, title: '没有 IPAM' }}>
          {(i) => {
            const users = usedBy('ipam', i.ipam)
            return (
              <ObjectRow
                key={i.ipam}
                testId="sdn-ipam-row"
                rowKey={i.ipam}
                icon={Database}
                title={i.ipam}
                badge={<Chip>{IPAM_TYPES.find((t) => t.type === i.type)?.label ?? i.type}</Chip>}
                detail={
                  <>
                    {i.type === 'pve' ? <span>内置</span> : <span className="truncate">{i.url}</span>}
                    {i.section !== undefined && <span>· Section {i.section}</span>}
                    {users.length > 0 && <span>· 用于 {users.join('、')}</span>}
                  </>
                }
                actions={
                  canEdit && i.type !== 'pve'
                    ? [
                        { label: '编辑', icon: Pencil, onSelect: () => dialog.open({ kind: 'edit-ipam', ipam: i }) },
                        {
                          label: '删除',
                          icon: Trash2,
                          destructive: true,
                          disabled: users.length > 0 && `仍被 Zone ${users.join('、')} 使用`,
                          onSelect: () => dialog.open({ kind: 'delete-ipam', ipam: i }),
                        },
                      ]
                    : undefined
                }
              />
            )
          }}
        </ListBody>
      </SdnCard>

      <SdnCard
        title="DNS"
        testId="sdn-dns"
        summary="自动登记客户机主机名（PowerDNS）"
        onRefresh={() => void dns.refetch()}
        refreshing={dns.isFetching}
        actions={<AddButton types={[{ value: 'powerdns', label: 'PowerDNS' }]} onAdd={() => dialog.open({ kind: 'add-dns' })} disabled={noPerm} />}
      >
        <ListBody query={dns} items={dnsList} label="DNS" empty={{ icon: Globe, title: '没有 DNS 插件' }}>
          {(d) => {
            const users = usedBy('dns', d.dns)
            return (
              <ObjectRow
                key={d.dns}
                testId="sdn-dns-row"
                rowKey={d.dns}
                icon={Globe}
                title={d.dns}
                badge={<Chip>PowerDNS</Chip>}
                detail={
                  <>
                    <span className="truncate">{d.url}</span>
                    {d.ttl !== undefined && <span>· TTL {d.ttl}</span>}
                    {users.length > 0 && <span>· 用于 {users.join('、')}</span>}
                  </>
                }
                actions={
                  canEdit
                    ? [
                        { label: '编辑', icon: Pencil, onSelect: () => dialog.open({ kind: 'edit-dns', dns: d }) },
                        {
                          label: '删除',
                          icon: Trash2,
                          destructive: true,
                          disabled: users.length > 0 && `仍被 Zone ${users.join('、')} 使用`,
                          onSelect: () => dialog.open({ kind: 'delete-dns', dns: d }),
                        },
                      ]
                    : undefined
                }
              />
            )
          }}
        </ListBody>
      </SdnCard>

      {shown?.kind === 'add-controller' && <ControllerDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} type={shown.type} />}
      {shown?.kind === 'edit-controller' && (
        <ControllerDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} type={shown.controller.type} controller={shown.controller} />
      )}
      {shown?.kind === 'delete-controller' && (
        <DeleteDialog
          open={dialog.isOpen}
          onOpenChange={dialog.onOpenChange}
          what="控制器"
          name={shown.controller.controller}
          isNew={shown.controller.state === 'new'}
          run={() => deleteSdnObject('controllers', shown.controller.controller)}
        />
      )}
      {shown?.kind === 'add-ipam' && <IpamDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} type={shown.type} />}
      {shown?.kind === 'edit-ipam' && <IpamDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} type={shown.ipam.type} ipam={shown.ipam} />}
      {shown?.kind === 'delete-ipam' && (
        <DeleteDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} what=" IPAM" name={shown.ipam.ipam} isNew run={() => deleteSdnObject('ipams', shown.ipam.ipam)} />
      )}
      {shown?.kind === 'add-dns' && <DnsDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} />}
      {shown?.kind === 'edit-dns' && <DnsDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} dns={shown.dns} />}
      {shown?.kind === 'delete-dns' && (
        <DeleteDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} what=" DNS" name={shown.dns.dns} isNew run={() => deleteSdnObject('dns', shown.dns.dns)} />
      )}
    </div>
  )
}
