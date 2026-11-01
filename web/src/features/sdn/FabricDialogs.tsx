// Fabric and fabric-node editors (official PVE.sdn.Fabric.*): per protocol
// prefixes, intervals, area, route filter, redistribution; nodes with router
// IPs and interfaces (OpenFabric hello multiplier, WireGuard ports, peers,
// external WireGuard peers).

import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import {
  createFabric,
  createFabricNode,
  updateFabric,
  updateFabricNode,
  useNodeInterfaces,
  usePrefixLists,
  type FabricProtocol,
  type SdnFabric,
  type SdnFabricNode,
} from '@/api/sdn'
import { FieldInput, FormDialog, FormField, FormRow, FormSection, NodeSelect, SelectField } from '@/components/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ChipSelect } from '@/features/storage-config/fields'
import { tryParsePropertyString } from '@/lib/propstring'

import {
  FABRIC_FIELDS,
  REDISTRIBUTE_SOURCES,
  fabricCreateParams,
  fabricForm,
  fabricHasIpv6,
  fabricNodeCreateParams,
  fabricNodeForm,
  fabricNodeUpdateParams,
  fabricUpdateParams,
  nodeInterfaces,
  protocolLabel,
  str,
  validateFabric,
  validateFabricNode,
  type FabricForm,
  type FabricInterfaceForm,
  type FabricNodeForm,
} from './model'
import { effective } from './pending'
import { RouteMapSelect } from './PluginDialogs'
import { sdnWrite } from './ui'

function PrefixListSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const lists = usePrefixLists()
  const ids = (lists.data ?? []).map(effective).filter((l) => l.state !== 'deleted').map((l) => l.id)
  return (
    <SelectField
      value={value || undefined}
      onValueChange={(v) => onChange(v ?? '')}
      emptyOption="不过滤"
      options={[...new Set([...ids, ...(value ? [value] : [])])].sort().map((id) => ({ value: id, label: id }))}
    />
  )
}

// ------------------------------------------------------------------ fabric

export function FabricDialog({
  open,
  onOpenChange,
  protocol,
  fabric,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  protocol: FabricProtocol
  fabric?: SdnFabric
}) {
  const create = !fabric
  const [form, setForm] = useState<FabricForm>(() => fabricForm(fabric, protocol))
  const [touched, setTouched] = useState(false)
  const errors = validateFabric(protocol, form, create)
  const err = (k: string) => (touched ? errors[k] : undefined)
  const fields = FABRIC_FIELDS[protocol]
  const has = (k: string) => fields.includes(k)
  const val = (k: string) => str(form.values[k])
  const set = (k: string, v: string) => setForm((f) => ({ ...f, values: { ...f.values, [k]: v } }))
  const sources = REDISTRIBUTE_SOURCES[protocol]

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={create ? `添加 ${protocolLabel(protocol)} Fabric` : `编辑 Fabric ${fabric.id}`}
      description={create ? '保存后为待应用状态；添加节点并应用后建立路由。' : undefined}
      submitLabel={create ? '添加' : '保存'}
      onSubmit={async () => {
        setTouched(true)
        if (Object.keys(errors).length) throw new Error('请检查标红的字段')
        if (create) await sdnWrite(createFabric(fabricCreateParams(protocol, form)), `添加 Fabric ${form.id.trim()}`)
        else {
          const params = fabricUpdateParams(fabric, form)
          if (params) await sdnWrite(updateFabric(fabric.id, params), `修改 Fabric ${fabric.id}`)
        }
      }}
    >
      <FormField label="名称" name="id" required={create} error={err('id')} hint={create ? '2–8 个字符：字母、数字和 -' : undefined}>
        <FieldInput value={form.id} onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))} disabled={!create} autoComplete="off" placeholder="例如 fab1" />
      </FormField>
      <FormRow>
        <FormField label="IPv4 前缀" name="ip_prefix" error={err('ip_prefix')} hint="节点路由器 IP 所在网段">
          <FieldInput value={val('ip_prefix')} onChange={(e) => set('ip_prefix', e.target.value)} placeholder="10.10.0.0/24" autoComplete="off" />
        </FormField>
        {has('ip6_prefix') && (
          <FormField label="IPv6 前缀" name="ip6_prefix" error={err('ip6_prefix')}>
            <FieldInput value={val('ip6_prefix')} onChange={(e) => set('ip6_prefix', e.target.value)} placeholder="fd00:10::/64" autoComplete="off" />
          </FormField>
        )}
      </FormRow>
      {val('ip6_prefix') && <p className="-mt-2 text-xs text-muted-foreground">IPv6 Fabric 需要在所有节点上开启全局 IPv6 转发。</p>}
      {protocol === 'openfabric' && (
        <FormRow>
          <FormField label="Hello 间隔（秒）" name="hello_interval" error={err('hello_interval')}>
            <FieldInput value={val('hello_interval')} onChange={(e) => set('hello_interval', e.target.value)} inputMode="numeric" placeholder="3" />
          </FormField>
          <FormField label="CSNP 间隔（秒）" name="csnp_interval" error={err('csnp_interval')}>
            <FieldInput value={val('csnp_interval')} onChange={(e) => set('csnp_interval', e.target.value)} inputMode="numeric" placeholder="10" />
          </FormField>
        </FormRow>
      )}
      {protocol === 'ospf' && (
        <FormField label="区域（Area）" name="area" required error={err('area')}>
          <FieldInput value={val('area')} onChange={(e) => set('area', e.target.value)} placeholder="0" autoComplete="off" />
        </FormField>
      )}
      {protocol === 'wireguard' && (
        <FormField label="持久 Keepalive（秒）" name="persistent_keepalive" error={err('persistent_keepalive')} hint="NAT 后的节点建议 25；留空 = 关闭">
          <FieldInput value={val('persistent_keepalive')} onChange={(e) => set('persistent_keepalive', e.target.value)} inputMode="numeric" placeholder="关闭" />
        </FormField>
      )}
      {has('route_filter') && (
        <FormField label="路由过滤" name="route_filter" hint="只把匹配前缀列表的路由写进内核路由表">
          <PrefixListSelect value={val('route_filter')} onChange={(v) => set('route_filter', v)} />
        </FormField>
      )}
      {sources.length > 0 && (
        <FormSection title="路由重分发" description="把其他来源的路由发布到这个 Fabric，可用 Route Map 过滤。">
          <div className="grid gap-2" data-testid="sdn-redistribute">
            {form.redistribute.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <SelectField
                    aria-label={`来源 ${i + 1}`}
                    value={r.source || undefined}
                    onValueChange={(v) => setForm((f) => ({ ...f, redistribute: f.redistribute.map((x, j) => (j === i ? { ...x, source: v ?? '' } : x)) }))}
                    placeholder="来源"
                    options={sources.map((s) => ({ value: s, label: s }))}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <RouteMapSelect
                    value={r['route-map'] ?? ''}
                    onChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        redistribute: f.redistribute.map((x, j) => (j === i ? (v ? { ...x, 'route-map': v } : { source: x.source }) : x)),
                      }))
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`删除第 ${i + 1} 行`}
                  onClick={() => setForm((f) => ({ ...f, redistribute: f.redistribute.filter((_, j) => j !== i) }))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            {err('redistribute') && <p className="text-xs text-destructive">{err('redistribute')}</p>}
            <Button type="button" variant="outline" className="w-fit" onClick={() => setForm((f) => ({ ...f, redistribute: [...f.redistribute, { source: '' }] }))}>
              <Plus />
              添加来源
            </Button>
          </div>
        </FormSection>
      )}
    </FormDialog>
  )
}

// -------------------------------------------------------------------- node

const EMPTY_IFACE: FabricInterfaceForm = { name: '', ip: '', ip6: '', hello_multiplier: '', listen_port: '', extra: {} }

export function FabricNodeDialog({
  open,
  onOpenChange,
  fabric,
  node,
  members,
  siblings,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  fabric: SdnFabric
  /** Effective node to edit; undefined = add. */
  node?: SdnFabricNode
  /** Node ids already in the fabric. */
  members: readonly string[]
  /** All (effective) nodes of the fabric, for WireGuard peers. */
  siblings: readonly SdnFabricNode[]
}) {
  const protocol = fabric.protocol
  const create = !node
  const [form, setForm] = useState<FabricNodeForm>(() => fabricNodeForm(node))
  const [touched, setTouched] = useState(false)
  const errors = validateFabricNode(protocol, form, create)
  const err = (k: string) => (touched ? errors[k] : undefined)
  const set = <K extends keyof FabricNodeForm>(k: K, v: FabricNodeForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const external = protocol === 'wireguard' && form.role === 'external'
  const ifaces = useNodeInterfaces(external ? undefined : form.node_id || undefined)
  const ipv6 = fabricHasIpv6(protocol)
  const setIface = (i: number, patch: Partial<FabricInterfaceForm>) =>
    setForm((f) => ({ ...f, interfaces: f.interfaces.map((x, j) => (j === i ? { ...x, ...patch } : x)) }))

  // WireGuard peer candidates: interfaces of the other internal nodes, external nodes.
  const peerOptions = useMemo(() => {
    if (protocol !== 'wireguard') return []
    const out: { value: string; label: string }[] = []
    for (const s of siblings) {
      if (s.node_id === form.node_id) continue
      if (s.role === 'external') out.push({ value: `node=${s.node_id},type=external`, label: `${s.node_id}（外部）` })
      else
        for (const raw of nodeInterfaces(s)) {
          const name = tryParsePropertyString(raw).name
          if (name) out.push({ value: `node=${s.node_id},node_iface=${name},type=internal`, label: `${s.node_id}:${name}` })
        }
    }
    return out
  }, [protocol, siblings, form.node_id])

  const peersOf = (iface: string) =>
    form.peers
      .filter((p) => tryParsePropertyString(p).iface === iface)
      .map((p) => {
        const m = tryParsePropertyString(p)
        return m.type === 'external' ? `node=${m.node},type=external` : `node=${m.node},node_iface=${m.node_iface},type=internal`
      })
  const setPeersOf = (iface: string, values: string[]) =>
    setForm((f) => ({ ...f, peers: [...f.peers.filter((p) => tryParsePropertyString(p).iface !== iface), ...values.map((v) => `iface=${iface},${v}`)] }))

  const ifaceOptions = (current: string) => {
    const names = (ifaces.data ?? []).map((i) => ({ value: i.iface, label: i.iface, description: [i.type, i.cidr].filter(Boolean).join(' · ') }))
    if (current && !names.some((n) => n.value === current)) names.unshift({ value: current, label: current, description: '' })
    return names
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={create ? `给 ${fabric.id} 添加节点` : `编辑 ${fabric.id} 上的 ${node.node_id}`}
      submitLabel={create ? '添加' : '保存'}
      onSubmit={async () => {
        setTouched(true)
        if (Object.keys(errors).length) throw new Error('请检查标红的字段')
        if (create) await sdnWrite(createFabricNode(fabric.id, fabricNodeCreateParams(protocol, form)), `给 ${fabric.id} 添加节点 ${form.node_id}`)
        else {
          const params = fabricNodeUpdateParams(node, form)
          if (params) await sdnWrite(updateFabricNode(fabric.id, node.node_id, params), `修改 ${fabric.id} 上的 ${node.node_id}`)
        }
      }}
    >
      {protocol === 'wireguard' && create && (
        <FormField label="角色">
          <ToggleGroup type="single" variant="outline" value={form.role} onValueChange={(v) => v && set('role', v as 'internal' | 'external')} className="w-max">
            <ToggleGroupItem value="internal" className="px-3">
              集群节点
            </ToggleGroupItem>
            <ToggleGroupItem value="external" className="px-3">
              外部对端
            </ToggleGroupItem>
          </ToggleGroup>
        </FormField>
      )}

      {external ? (
        <>
          <FormField label="名称" name="node_id" required={create} error={err('node_id')}>
            <FieldInput value={form.node_id} onChange={(e) => set('node_id', e.target.value)} disabled={!create} autoComplete="off" />
          </FormField>
          <FormField label="公钥" name="public_key" required error={err('public_key')}>
            <FieldInput value={form.public_key} onChange={(e) => set('public_key', e.target.value)} placeholder="base64 编码的 WireGuard 公钥" autoComplete="off" className="font-mono text-xs" />
          </FormField>
          <FormField label="Endpoint" name="endpoint" required error={err('endpoint')}>
            <FieldInput value={form.endpoint} onChange={(e) => set('endpoint', e.target.value)} placeholder="198.51.100.1:51820" autoComplete="off" />
          </FormField>
          <FormField label="允许的 IP" name="allowed_ips" error={err('allowed_ips')} hint="经这个对端路由的目标网段，逗号分隔">
            <FieldInput value={form.allowed_ips} onChange={(e) => set('allowed_ips', e.target.value)} placeholder="10.9.0.0/24" autoComplete="off" />
          </FormField>
        </>
      ) : (
        <>
          <FormField label="节点" name="node_id" required={create} error={err('node_id')}>
            {create ? (
              <NodeSelect value={form.node_id || undefined} onValueChange={(v) => set('node_id', v ?? '')} exclude={members} autoSelect={false} />
            ) : (
              <FieldInput value={form.node_id} disabled />
            )}
          </FormField>
          <FormRow>
            <FormField label={protocol === 'wireguard' ? 'IPv4 地址（可选）' : '路由器 IPv4'} name="ip" error={err('ip')} hint={fabric.ip_prefix ? `在 ${fabric.ip_prefix} 里` : undefined}>
              <FieldInput value={form.ip} onChange={(e) => set('ip', e.target.value)} placeholder="10.10.0.1" autoComplete="off" />
            </FormField>
            {ipv6 && (
              <FormField label="路由器 IPv6" name="ip6" error={err('ip6')} hint={fabric.ip6_prefix ? `在 ${fabric.ip6_prefix} 里` : undefined}>
                <FieldInput value={form.ip6} onChange={(e) => set('ip6', e.target.value)} placeholder="fd00:10::1" autoComplete="off" />
              </FormField>
            )}
          </FormRow>
          {protocol === 'wireguard' && (
            <FormField label="Endpoint" name="endpoint" hint="对端连接这个节点用的地址；留空 = 节点 IP">
              <FieldInput value={form.endpoint} onChange={(e) => set('endpoint', e.target.value)} autoComplete="off" />
            </FormField>
          )}

          <FormSection title="接口" description={protocol === 'wireguard' ? '这个节点上的 WireGuard 接口及其对端。' : '参与 Fabric 的网卡；IP 留空表示无编号（unnumbered）。'}>
            <div className="grid gap-3" data-testid="sdn-fabric-ifaces">
              {form.interfaces.map((iface, i) => (
                <div key={i} className="grid gap-2 rounded-xl p-3 ring-1 ring-border/60 ring-inset">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      {protocol === 'wireguard' ? (
                        <Input aria-label={`接口 ${i + 1} 名称`} value={iface.name} onChange={(e) => setIface(i, { name: e.target.value })} placeholder="wg0" />
                      ) : (
                        <SelectField
                          aria-label={`接口 ${i + 1}`}
                          value={iface.name || undefined}
                          onValueChange={(v) => setIface(i, { name: v ?? '' })}
                          placeholder={form.node_id ? '选择网卡' : '先选节点'}
                          loading={ifaces.isFetching}
                          options={ifaceOptions(iface.name)}
                        />
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`删除接口 ${i + 1}`}
                      onClick={() => set('interfaces', form.interfaces.filter((_, j) => j !== i))}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {protocol !== 'bgp' && (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Input aria-label={`接口 ${i + 1} IPv4`} value={iface.ip} onChange={(e) => setIface(i, { ip: e.target.value })} placeholder="IPv4/前缀（可选）" />
                      {(protocol === 'openfabric' || protocol === 'wireguard') && (
                        <Input aria-label={`接口 ${i + 1} IPv6`} value={iface.ip6} onChange={(e) => setIface(i, { ip6: e.target.value })} placeholder="IPv6/前缀（可选）" />
                      )}
                      {protocol === 'openfabric' && (
                        <Input
                          aria-label={`接口 ${i + 1} Hello 倍数`}
                          value={iface.hello_multiplier}
                          onChange={(e) => setIface(i, { hello_multiplier: e.target.value })}
                          inputMode="numeric"
                          placeholder="Hello 倍数（10）"
                        />
                      )}
                      {protocol === 'wireguard' && (
                        <Input
                          aria-label={`接口 ${i + 1} 监听端口`}
                          value={iface.listen_port}
                          onChange={(e) => setIface(i, { listen_port: e.target.value })}
                          inputMode="numeric"
                          placeholder="监听端口"
                        />
                      )}
                    </div>
                  )}
                  {protocol === 'wireguard' && iface.name.trim() && (
                    <div className="grid gap-1.5">
                      <span className="text-xs text-muted-foreground">对端</span>
                      {peerOptions.length ? (
                        <ChipSelect label={`${iface.name} 的对端`} options={peerOptions} value={peersOf(iface.name.trim())} onChange={(v) => setPeersOf(iface.name.trim(), v)} />
                      ) : (
                        <span className="text-xs text-muted-foreground">Fabric 里还没有其他节点。</span>
                      )}
                    </div>
                  )}
                  {err(`iface-${i}`) && <p className="text-xs text-destructive">{err(`iface-${i}`)}</p>}
                </div>
              ))}
              <Button type="button" variant="outline" className="w-fit" onClick={() => set('interfaces', [...form.interfaces, { ...EMPTY_IFACE, extra: {} }])}>
                <Plus />
                添加接口
              </Button>
            </div>
          </FormSection>
        </>
      )}
    </FormDialog>
  )
}
