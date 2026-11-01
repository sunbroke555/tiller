// Create / edit a subnet of a VNet (official PVE.sdn.SubnetEdit): CIDR,
// gateway, SNAT, DNS zone prefix, DHCP DNS server and DHCP ranges.

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { createSubnet, updateSubnet, type SdnSubnet } from '@/api/sdn'
import { FieldInput, FormDialog, FormField, FormRow, FormSection, SwitchField } from '@/components/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { subnetCreateParams, subnetForm, subnetUpdateParams, validateSubnet, type SubnetForm } from './model'
import { sdnWrite } from './ui'

export function SubnetDialog({
  open,
  onOpenChange,
  vnet,
  subnet,
  zoneType,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  vnet: string
  /** Effective config of the subnet to edit; undefined = create. */
  subnet?: SdnSubnet
  zoneType?: string | undefined
}) {
  const create = !subnet
  const [form, setForm] = useState<SubnetForm>(() => subnetForm(subnet))
  const [touched, setTouched] = useState(false)
  const errors = validateSubnet(form, create)
  const err = (k: string) => (touched ? errors[k] : undefined)
  const set = <K extends keyof SubnetForm>(k: K, v: SubnetForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const setRange = (i: number, key: 'start-address' | 'end-address', v: string) =>
    setForm((f) => ({ ...f, ranges: f.ranges.map((r, j) => (j === i ? { ...r, [key]: v } : r)) }))

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={create ? `给 ${vnet} 添加子网` : `编辑子网 ${subnet.cidr ?? subnet.subnet}`}
      submitLabel={create ? '添加' : '保存'}
      onSubmit={async () => {
        setTouched(true)
        if (Object.keys(errors).length) throw new Error('请检查标红的字段')
        if (create) {
          await sdnWrite(createSubnet(vnet, subnetCreateParams(form)), `添加子网 ${form.cidr.trim()}`)
        } else {
          const params = subnetUpdateParams(subnet, form)
          if (params) await sdnWrite(updateSubnet(vnet, subnet.subnet, params), `修改子网 ${subnet.cidr ?? subnet.subnet}`)
        }
      }}
    >
      <FormRow>
        <FormField label="子网" name="subnet" required={create} error={err('subnet')}>
          <FieldInput value={form.cidr} onChange={(e) => set('cidr', e.target.value)} disabled={!create} placeholder="10.0.0.0/24" autoComplete="off" />
        </FormField>
        <FormField label="网关" name="gateway" error={err('gateway')} hint={zoneType === 'simple' || zoneType === 'evpn' ? '会配置在 VNet 网桥上' : undefined}>
          <FieldInput value={form.gateway} onChange={(e) => set('gateway', e.target.value)} placeholder="10.0.0.1" autoComplete="off" />
        </FormField>
      </FormRow>
      <SwitchField
        label="SNAT"
        description="出网流量伪装成节点地址（Simple / EVPN Zone，需要网关）"
        checked={form.snat}
        onCheckedChange={(v) => set('snat', v)}
      />
      <FormRow>
        <FormField label="DNS 域前缀" name="dnszoneprefix" hint="例如 adm → <主机名>.adm.<DNS 域>">
          <FieldInput value={form.dnszoneprefix} onChange={(e) => set('dnszoneprefix', e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label="DHCP DNS 服务器" name="dhcp-dns-server" error={err('dhcp-dns-server')}>
          <FieldInput value={form['dhcp-dns-server']} onChange={(e) => set('dhcp-dns-server', e.target.value)} placeholder="可选" autoComplete="off" />
        </FormField>
      </FormRow>

      <FormSection title="DHCP 范围" description="Zone 开启自动 DHCP 后，dnsmasq 从这些范围里分配地址。">
        <div className="grid gap-2" data-testid="sdn-dhcp-ranges">
          {form.ranges.map((r, i) => (
            <div key={i} className="grid gap-1">
              <div className="flex items-center gap-2">
                <Input
                  aria-label={`范围 ${i + 1} 起始地址`}
                  value={r['start-address']}
                  onChange={(e) => setRange(i, 'start-address', e.target.value)}
                  placeholder="起始 IP"
                  className="min-w-0 flex-1"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  aria-label={`范围 ${i + 1} 结束地址`}
                  value={r['end-address']}
                  onChange={(e) => setRange(i, 'end-address', e.target.value)}
                  placeholder="结束 IP"
                  className="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`删除范围 ${i + 1}`}
                  onClick={() => set('ranges', form.ranges.filter((_, j) => j !== i))}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              </div>
              {err(`range-${i}`) && <p className="text-xs text-destructive">{err(`range-${i}`)}</p>}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => set('ranges', [...form.ranges, { 'start-address': '', 'end-address': '' }])}
          >
            <Plus />
            添加范围
          </Button>
        </div>
      </FormSection>
    </FormDialog>
  )
}
