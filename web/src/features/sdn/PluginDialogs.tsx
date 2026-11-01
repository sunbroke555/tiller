// Editors of the SDN options: controllers (EVPN, BGP, IS-IS), IPAM plugins
// (PVE, NetBox, phpIPAM) and DNS plugins (PowerDNS), like the official
// PVE.sdn.controllers / ipams / dns input panels.

import { useMemo, useState } from 'react'

import {
  createSdnObject,
  updateSdnObject,
  useRouteMapEntries,
  useSdnFabrics,
  type ControllerType,
  type IpamType,
  type SdnController,
  type SdnDns,
  type SdnIpam,
} from '@/api/sdn'
import { FieldInput, FormDialog, FormField, FormRow, FormSection, NodeSelect, SelectField, SwitchField } from '@/components/form'
import { NodeChips } from '@/features/storage-config/fields'

import {
  CONTROLLER_TYPES,
  IPAM_TYPES,
  controllerCreateParams,
  controllerForm,
  controllerId,
  controllerUpdateParams,
  dnsCreateParams,
  dnsForm,
  dnsUpdateParams,
  ipamCreateParams,
  ipamForm,
  ipamUpdateParams,
  splitList,
  str,
  validateController,
  validateDns,
  validateIpam,
  type FormValues,
} from './model'
import { effective } from './pending'
import { sdnWrite } from './ui'

function useForm(initial: () => FormValues) {
  const [form, setForm] = useState<FormValues>(initial)
  const [touched, setTouched] = useState(false)
  return {
    form,
    touched,
    setTouched,
    set: (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v })),
    text: (k: string) => str(form[k]),
  }
}

/** Route map ids for the selectors. */
export function useRouteMapIds(): string[] {
  const entries = useRouteMapEntries()
  return useMemo(
    () => [...new Set((entries.data ?? []).map(effective).filter((e) => e.state !== 'deleted').map((e) => e['route-map-id']))].sort(),
    [entries.data],
  )
}

export function RouteMapSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ids = useRouteMapIds()
  return <SelectField value={value || undefined} onValueChange={(v) => onChange(v ?? '')} emptyOption="不使用" options={[...new Set([...ids, ...(value ? [value] : [])])].map((id) => ({ value: id, label: id }))} />
}

// ----------------------------------------------------------- controllers

export function ControllerDialog({
  open,
  onOpenChange,
  type,
  controller,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  type: ControllerType
  controller?: SdnController
}) {
  const create = !controller
  const f = useForm(() => controllerForm(controller, type))
  const errors = validateController(type, f.form, create)
  const err = (k: string) => (f.touched ? errors[k] : undefined)
  const fabrics = useSdnFabrics()
  const label = CONTROLLER_TYPES.find((t) => t.type === type)?.label ?? type

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={create ? `添加 ${label} 控制器` : `编辑控制器 ${controller.controller}`}
      submitLabel={create ? '添加' : '保存'}
      onSubmit={async () => {
        f.setTouched(true)
        if (Object.keys(errors).length) throw new Error('请检查标红的字段')
        if (create) {
          await sdnWrite(createSdnObject('controllers', controllerCreateParams(type, f.form)), `添加控制器 ${controllerId(type, f.form)}`)
        } else {
          const params = controllerUpdateParams(controller, f.form)
          if (params) await sdnWrite(updateSdnObject('controllers', controller.controller, params), `修改控制器 ${controller.controller}`)
        }
      }}
    >
      {type === 'evpn' ? (
        <FormField label="ID" name="controller" required={create} error={err('controller')}>
          <FieldInput value={f.text('controller')} onChange={(e) => f.set('controller', e.target.value)} disabled={!create} autoComplete="off" placeholder="例如 evpn1" />
        </FormField>
      ) : (
        <FormField label="节点" name="node" required={create} error={err('node')} hint={create ? `ID 自动生成：${type}<节点名>` : undefined}>
          {create ? <NodeSelect value={f.text('node') || undefined} onValueChange={(v) => f.set('node', v ?? '')} autoSelect={false} /> : <FieldInput value={f.text('node')} disabled />}
        </FormField>
      )}

      {type !== 'isis' && (
        <FormRow>
          <FormField label="ASN" name="asn" required error={err('asn')}>
            <FieldInput value={f.text('asn')} onChange={(e) => f.set('asn', e.target.value)} inputMode="numeric" />
          </FormField>
          <FormField label="对等体" name="peers" required={type === 'bgp'} error={err('peers')} hint={type === 'evpn' ? '使用 Fabric 时可留空' : undefined}>
            <FieldInput value={f.text('peers')} onChange={(e) => f.set('peers', e.target.value)} placeholder="10.0.0.1, 10.0.0.2" autoComplete="off" />
          </FormField>
        </FormRow>
      )}

      {type === 'evpn' && (
        <>
          <FormField label="SDN Fabric" name="fabric" hint="用作底层网络">
            <SelectField
              value={f.text('fabric') || undefined}
              onValueChange={(v) => f.set('fabric', v ?? '')}
              emptyOption="不使用"
              options={(fabrics.data?.fabrics ?? []).map(effective).map((x) => ({ value: x.id, label: x.id, description: x.protocol }))}
            />
          </FormField>
          <FormRow>
            <FormField label="入方向 Route Map" name="route-map-in">
              <RouteMapSelect value={f.text('route-map-in')} onChange={(v) => f.set('route-map-in', v)} />
            </FormField>
            <FormField label="出方向 Route Map" name="route-map-out">
              <RouteMapSelect value={f.text('route-map-out')} onChange={(v) => f.set('route-map-out', v)} />
            </FormField>
          </FormRow>
          <FormSection title="高级" collapsible defaultOpen={!!(f.form['peer-group-name'] || f.form.nodes || f.form['bgp-mode'] || f.form['ebgp-multihop'])}>
            <FormRow>
              <FormField label="对等组名称" name="peer-group-name">
                <FieldInput value={f.text('peer-group-name')} onChange={(e) => f.set('peer-group-name', e.target.value)} placeholder="VTEP" autoComplete="off" />
              </FormField>
              <FormField label="BGP 模式" name="bgp-mode">
                <SelectField
                  value={f.text('bgp-mode') || undefined}
                  onValueChange={(v) => f.set('bgp-mode', v ?? '')}
                  emptyOption="自动"
                  options={[
                    { value: 'auto', label: '自动' },
                    { value: 'external', label: 'eBGP' },
                    { value: 'internal', label: 'iBGP' },
                  ]}
                />
              </FormField>
            </FormRow>
            <FormField label="eBGP 多跳" name="ebgp-multihop" error={err('ebgp-multihop')}>
              <FieldInput value={f.text('ebgp-multihop')} onChange={(e) => f.set('ebgp-multihop', e.target.value)} inputMode="numeric" placeholder="1–100" />
            </FormField>
            <FormField label="节点" name="nodes" hint="不选 = 所有节点">
              <NodeChips value={splitList(f.form.nodes)} onChange={(v) => f.set('nodes', v.join(','))} />
            </FormField>
          </FormSection>
        </>
      )}

      {type === 'bgp' && (
        <>
          <SwitchField label="eBGP" description="对等体在另一个 AS（remote-as external）" checked={!!f.form.ebgp} onCheckedChange={(v) => f.set('ebgp', v)} />
          <FormRow>
            <FormField label="Loopback 接口" name="loopback">
              <FieldInput value={f.text('loopback')} onChange={(e) => f.set('loopback', e.target.value)} placeholder="dummy1" autoComplete="off" />
            </FormField>
            <FormField label="eBGP 多跳" name="ebgp-multihop" error={err('ebgp-multihop')}>
              <FieldInput value={f.text('ebgp-multihop')} onChange={(e) => f.set('ebgp-multihop', e.target.value)} inputMode="numeric" placeholder="1–100" />
            </FormField>
          </FormRow>
          <SwitchField
            label="多路径放宽 AS-Path"
            description="bgp-multipath-as-path-relax"
            checked={!!f.form['bgp-multipath-as-path-relax']}
            onCheckedChange={(v) => f.set('bgp-multipath-as-path-relax', v)}
          />
          <FormRow>
            <FormField label="入方向 Route Map" name="route-map-in">
              <RouteMapSelect value={f.text('route-map-in')} onChange={(v) => f.set('route-map-in', v)} />
            </FormField>
            <FormField label="出方向 Route Map" name="route-map-out">
              <RouteMapSelect value={f.text('route-map-out')} onChange={(v) => f.set('route-map-out', v)} />
            </FormField>
          </FormRow>
        </>
      )}

      {type === 'isis' && (
        <>
          <FormRow>
            <FormField label="域" name="isis-domain" required error={err('isis-domain')}>
              <FieldInput value={f.text('isis-domain')} onChange={(e) => f.set('isis-domain', e.target.value)} autoComplete="off" />
            </FormField>
            <FormField label="网络实体名（NET）" name="isis-net" required error={err('isis-net')}>
              <FieldInput value={f.text('isis-net')} onChange={(e) => f.set('isis-net', e.target.value)} placeholder="49.0001.1921.6800.1001.00" autoComplete="off" />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="接口" name="isis-ifaces" required error={err('isis-ifaces')} hint="逗号分隔">
              <FieldInput value={f.text('isis-ifaces')} onChange={(e) => f.set('isis-ifaces', e.target.value)} placeholder="ens19, ens20" autoComplete="off" />
            </FormField>
            <FormField label="Loopback 接口" name="loopback">
              <FieldInput value={f.text('loopback')} onChange={(e) => f.set('loopback', e.target.value)} placeholder="dummy1" autoComplete="off" />
            </FormField>
          </FormRow>
        </>
      )}
    </FormDialog>
  )
}

// ------------------------------------------------------------------ IPAM

export function IpamDialog({ open, onOpenChange, type, ipam }: { open: boolean; onOpenChange: (o: boolean) => void; type: IpamType; ipam?: SdnIpam }) {
  const create = !ipam
  const f = useForm(() => ipamForm(ipam, type))
  const errors = validateIpam(type, f.form, create)
  const err = (k: string) => (f.touched ? errors[k] : undefined)
  const label = IPAM_TYPES.find((t) => t.type === type)?.label ?? type
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={create ? `添加 ${label} IPAM` : `编辑 IPAM ${ipam.ipam}`}
      description="外部 IPAM 在创建子网和分配 IP 时由各节点直接调用。"
      submitLabel={create ? '添加' : '保存'}
      onSubmit={async () => {
        f.setTouched(true)
        if (Object.keys(errors).length) throw new Error('请检查标红的字段')
        if (create) await sdnWrite(createSdnObject('ipams', ipamCreateParams(type, f.form)), `添加 IPAM ${f.text('ipam')}`, `已添加 IPAM ${f.text('ipam')}`)
        else {
          const params = ipamUpdateParams(ipam, f.form)
          if (params) await sdnWrite(updateSdnObject('ipams', ipam.ipam, params), `修改 IPAM ${ipam.ipam}`, `已修改 IPAM ${ipam.ipam}`)
        }
      }}
    >
      <FormField label="ID" name="ipam" required={create} error={err('ipam')}>
        <FieldInput value={f.text('ipam')} onChange={(e) => f.set('ipam', e.target.value)} disabled={!create} autoComplete="off" />
      </FormField>
      {type !== 'pve' && (
        <>
          <FormField label="URL" name="url" required error={err('url')} hint={type === 'netbox' ? '例如 https://netbox.example/api' : '例如 https://phpipam.example/api/<应用 ID>'}>
            <FieldInput value={f.text('url')} onChange={(e) => f.set('url', e.target.value)} autoComplete="off" />
          </FormField>
          <FormField label="令牌" name="token" required error={err('token')}>
            <FieldInput type="password" value={f.text('token')} onChange={(e) => f.set('token', e.target.value)} autoComplete="off" />
          </FormField>
          {type === 'phpipam' && (
            <FormField label="Section" name="section" required error={err('section')}>
              <FieldInput value={f.text('section')} onChange={(e) => f.set('section', e.target.value)} inputMode="numeric" />
            </FormField>
          )}
          <FormField label="证书指纹" name="fingerprint" error={err('fingerprint')} hint="自签证书时填 SHA-256 指纹">
            <FieldInput value={f.text('fingerprint')} onChange={(e) => f.set('fingerprint', e.target.value)} autoComplete="off" className="font-mono text-xs" />
          </FormField>
        </>
      )}
    </FormDialog>
  )
}

// ------------------------------------------------------------------- DNS

export function DnsDialog({ open, onOpenChange, dns }: { open: boolean; onOpenChange: (o: boolean) => void; dns?: SdnDns }) {
  const create = !dns
  const f = useForm(() => dnsForm(dns))
  const errors = validateDns(f.form, create)
  const err = (k: string) => (f.touched ? errors[k] : undefined)
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={create ? '添加 PowerDNS' : `编辑 DNS ${dns.dns}`}
      description="Zone 选择 DNS 服务器后，客户机的 IP 自动登记到 DNS。"
      submitLabel={create ? '添加' : '保存'}
      onSubmit={async () => {
        f.setTouched(true)
        if (Object.keys(errors).length) throw new Error('请检查标红的字段')
        if (create) await sdnWrite(createSdnObject('dns', dnsCreateParams(f.form)), `添加 DNS ${f.text('dns')}`, `已添加 DNS ${f.text('dns')}`)
        else {
          const params = dnsUpdateParams(dns, f.form)
          if (params) await sdnWrite(updateSdnObject('dns', dns.dns, params), `修改 DNS ${dns.dns}`, `已修改 DNS ${dns.dns}`)
        }
      }}
    >
      <FormField label="ID" name="dns" required={create} error={err('dns')}>
        <FieldInput value={f.text('dns')} onChange={(e) => f.set('dns', e.target.value)} disabled={!create} autoComplete="off" />
      </FormField>
      <FormField label="URL" name="url" required error={err('url')} hint="例如 http://pdns.example:8081/api/v1/servers/localhost">
        <FieldInput value={f.text('url')} onChange={(e) => f.set('url', e.target.value)} autoComplete="off" />
      </FormField>
      <FormField label="API 密钥" name="key" required error={err('key')}>
        <FieldInput type="password" value={f.text('key')} onChange={(e) => f.set('key', e.target.value)} autoComplete="off" />
      </FormField>
      <FormRow>
        <FormField label="TTL" name="ttl" error={err('ttl')}>
          <FieldInput value={f.text('ttl')} onChange={(e) => f.set('ttl', e.target.value)} inputMode="numeric" placeholder="默认" />
        </FormField>
        <FormField label="IPv6 反向掩码" name="reversemaskv6" error={err('reversemaskv6')}>
          <FieldInput value={f.text('reversemaskv6')} onChange={(e) => f.set('reversemaskv6', e.target.value)} inputMode="numeric" placeholder="默认" />
        </FormField>
      </FormRow>
      <FormField label="证书指纹" name="fingerprint" error={err('fingerprint')}>
        <FieldInput value={f.text('fingerprint')} onChange={(e) => f.set('fingerprint', e.target.value)} autoComplete="off" className="font-mono text-xs" />
      </FormField>
    </FormDialog>
  )
}
