// Create / edit a zone. Common fields (ID, MTU, nodes, IPAM, DNS) plus the
// fields of its type, like the official PVE.sdn.zones.*InputPanel.

import { useMemo, useState } from 'react'

import { createSdnObject, updateSdnObject, useSdnControllers, useSdnDns, useSdnFabrics, useSdnIpams, type SdnZone, type ZoneType } from '@/api/sdn'
import { FieldInput, FormDialog, FormField, FormRow, FormSection, SelectField, SwitchField } from '@/components/form'
import { NodeChips } from '@/features/storage-config/fields'

import { splitList, str, validateZone, zoneCreateParams, zoneForm, zoneTypeLabel, zoneUpdateParams, type FormValues } from './model'
import { effective } from './pending'
import { sdnWrite } from './ui'

export function ZoneDialog({
  open,
  onOpenChange,
  type,
  zone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  type: ZoneType
  /** Effective config of the zone to edit; undefined = create. */
  zone?: SdnZone
}) {
  const create = !zone
  const [form, setForm] = useState<FormValues>(() => zoneForm(zone, type))
  const [touched, setTouched] = useState(false)
  const errors = validateZone(type, form, create)
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))
  const text = (k: string) => str(form[k])
  const err = (k: string) => (touched ? errors[k] : undefined)

  const ipams = useSdnIpams()
  const dns = useSdnDns()
  const controllers = useSdnControllers()
  const fabrics = useSdnFabrics()
  const evpnControllers = useMemo(
    () => (controllers.data ?? []).map(effective).filter((c) => c.type === 'evpn' && c.state !== 'deleted'),
    [controllers.data],
  )
  const dnsOptions = (dns.data ?? []).map((d) => ({ value: d.dns, label: d.dns }))

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={create ? `添加 ${zoneTypeLabel(type)} Zone` : `编辑 Zone ${zone.zone}`}
      description={create ? '保存后为待应用状态；应用 SDN 配置后在节点上生效。' : undefined}
      submitLabel={create ? '添加' : '保存'}
      onSubmit={async () => {
        setTouched(true)
        if (Object.keys(errors).length) throw new Error('请检查标红的字段')
        if (create) {
          await sdnWrite(createSdnObject('zones', zoneCreateParams(type, form)), `添加 Zone ${text('zone')}`)
        } else {
          const params = zoneUpdateParams(zone, form)
          if (params) await sdnWrite(updateSdnObject('zones', zone.zone, params), `修改 Zone ${zone.zone}`)
        }
      }}
    >
      <FormRow>
        <FormField label="ID" name="zone" required={create} error={err('zone')} hint={create ? '字母开头，最多 8 个字母或数字' : undefined}>
          <FieldInput value={text('zone')} onChange={(e) => set('zone', e.target.value)} disabled={!create} autoComplete="off" placeholder="例如 zone1" />
        </FormField>
        <FormField label="MTU" name="mtu" error={err('mtu')}>
          <FieldInput value={text('mtu')} onChange={(e) => set('mtu', e.target.value)} inputMode="numeric" placeholder="自动" />
        </FormField>
      </FormRow>

      {(type === 'vlan' || type === 'qinq') && (
        <FormField label="网桥" name="bridge" required error={err('bridge')} hint="每个节点上都要有这个网桥，例如 vmbr0">
          <FieldInput value={text('bridge')} onChange={(e) => set('bridge', e.target.value)} placeholder="vmbr0" autoComplete="off" />
        </FormField>
      )}
      {type === 'qinq' && (
        <FormRow>
          <FormField label="服务 VLAN" name="tag" required error={err('tag')}>
            <FieldInput value={text('tag')} onChange={(e) => set('tag', e.target.value)} inputMode="numeric" placeholder="0–4096" />
          </FormField>
          <FormField label="服务 VLAN 协议" name="vlan-protocol">
            <SelectField
              value={text('vlan-protocol') || undefined}
              onValueChange={(v) => set('vlan-protocol', v ?? '')}
              emptyOption="默认（802.1q）"
              options={[
                { value: '802.1q', label: '802.1q' },
                { value: '802.1ad', label: '802.1ad' },
              ]}
            />
          </FormField>
        </FormRow>
      )}
      {type === 'vxlan' && (
        <>
          <FormField label="对端地址" name="peers" error={err('peers')} hint="参与 VXLAN 的节点 IP，逗号分隔；使用 Fabric 时可留空">
            <FieldInput value={text('peers')} onChange={(e) => set('peers', e.target.value)} placeholder="10.0.0.1, 10.0.0.2" autoComplete="off" />
          </FormField>
          <FormRow>
            <FormField label="SDN Fabric" name="fabric" hint="用作底层网络">
              <SelectField
                value={text('fabric') || undefined}
                onValueChange={(v) => set('fabric', v ?? '')}
                emptyOption="不使用"
                options={(fabrics.data?.fabrics ?? []).map(effective).map((f) => ({ value: f.id, label: f.id, description: f.protocol }))}
              />
            </FormField>
            <FormField label="VXLAN 端口" name="vxlan-port" error={err('vxlan-port')}>
              <FieldInput value={text('vxlan-port')} onChange={(e) => set('vxlan-port', e.target.value)} inputMode="numeric" placeholder="4789" />
            </FormField>
          </FormRow>
        </>
      )}
      {type === 'evpn' && (
        <>
          <FormRow>
            <FormField label="控制器" name="controller" required error={err('controller')}>
              <SelectField
                value={text('controller') || undefined}
                onValueChange={(v) => set('controller', v ?? '')}
                placeholder={evpnControllers.length ? '选择 EVPN 控制器' : '先在“选项”里添加 EVPN 控制器'}
                options={evpnControllers.map((c) => ({ value: c.controller, label: c.controller, description: c.asn ? `ASN ${c.asn}` : undefined }))}
              />
            </FormField>
            <FormField label="VRF VXLAN 标签" name="vrf-vxlan" required error={err('vrf-vxlan')}>
              <FieldInput value={text('vrf-vxlan')} onChange={(e) => set('vrf-vxlan', e.target.value)} inputMode="numeric" placeholder="例如 10000" />
            </FormField>
          </FormRow>
          <FormField label="VNet MAC 地址" name="mac" error={err('mac')}>
            <FieldInput value={text('mac')} onChange={(e) => set('mac', e.target.value)} placeholder="自动" autoComplete="off" />
          </FormField>
          <FormField label="出口节点" name="exitnodes" hint="不选 = 没有出口节点">
            <NodeChips value={splitList(form.exitnodes)} onChange={(v) => set('exitnodes', v.join(','))} />
          </FormField>
          <FormField label="首选出口节点" name="exitnodes-primary">
            <SelectField
              value={text('exitnodes-primary') || undefined}
              onValueChange={(v) => set('exitnodes-primary', v ?? '')}
              emptyOption="不指定"
              options={splitList(form.exitnodes).map((n) => ({ value: n, label: n }))}
            />
          </FormField>
          <div className="grid gap-1">
            <SwitchField label="出口节点本地路由" checked={!!form['exitnodes-local-routing']} onCheckedChange={(v) => set('exitnodes-local-routing', v)} />
            <SwitchField label="通告子网" description="用 Type-5 路由通告前缀，而不是 MAC/IP 对" checked={!!form['advertise-subnets']} onCheckedChange={(v) => set('advertise-subnets', v)} />
            <SwitchField label="关闭 ARP/ND 抑制" checked={!!form['disable-arp-nd-suppression']} onCheckedChange={(v) => set('disable-arp-nd-suppression', v)} />
          </div>
          <FormField label="导入 Route Target" name="rt-import" hint="逗号分隔，例如 65000:100">
            <FieldInput value={text('rt-import')} onChange={(e) => set('rt-import', e.target.value)} autoComplete="off" />
          </FormField>
        </>
      )}
      {type === 'simple' && (
        <SwitchField
          label="自动 DHCP"
          description="用 dnsmasq 给子网里配置了 DHCP 范围的客户机分配地址"
          checked={!!form.dhcp}
          onCheckedChange={(v) => set('dhcp', v)}
        />
      )}

      <FormField label="节点" name="nodes" hint="不选 = 所有节点">
        <NodeChips value={splitList(form.nodes)} onChange={(v) => set('nodes', v.join(','))} />
      </FormField>
      <FormField label="IPAM" name="ipam" required error={err('ipam')}>
        <SelectField
          value={text('ipam') || undefined}
          onValueChange={(v) => set('ipam', v ?? '')}
          loading={ipams.isPending}
          options={(ipams.data ?? []).map((i) => ({ value: i.ipam, label: i.ipam, description: i.type }))}
        />
      </FormField>

      <FormSection title="DNS" collapsible defaultOpen={!!(form.dns || form.reversedns || form.dnszone)}>
        <FormRow>
          <FormField label="DNS 服务器" name="dns">
            <SelectField value={text('dns') || undefined} onValueChange={(v) => set('dns', v ?? '')} emptyOption="不使用" options={dnsOptions} />
          </FormField>
          <FormField label="反向 DNS 服务器" name="reversedns">
            <SelectField value={text('reversedns') || undefined} onValueChange={(v) => set('reversedns', v ?? '')} emptyOption="不使用" options={dnsOptions} />
          </FormField>
        </FormRow>
        <FormField label="DNS 域" name="dnszone" hint="例如 lab.example.com">
          <FieldInput value={text('dnszone')} onChange={(e) => set('dnszone', e.target.value)} autoComplete="off" />
        </FormField>
      </FormSection>

      {type === 'evpn' && (
        <FormSection title="高级" collapsible defaultOpen={!!form['secondary-controllers']}>
          <FormField label="附加控制器" name="secondary-controllers" hint="逗号分隔的控制器 ID">
            <FieldInput value={text('secondary-controllers')} onChange={(e) => set('secondary-controllers', e.target.value)} autoComplete="off" />
          </FormField>
        </FormSection>
      )}
    </FormDialog>
  )
}

