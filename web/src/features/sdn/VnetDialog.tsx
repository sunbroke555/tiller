// Create / edit a VNet (official PVE.sdn.VnetInputPanel): name, alias, zone,
// tag (VLAN tag or VXLAN VNI depending on the zone), VLAN aware, port isolation.

import { useMemo, useState } from 'react'

import { createSdnObject, updateSdnObject, useSdnZones, type SdnVnet } from '@/api/sdn'
import { FieldInput, FormDialog, FormField, FormRow, FormSection, SelectField, SwitchField } from '@/components/form'

import { str, validateVnet, vnetCreateParams, vnetForm, vnetTagLabel, vnetTagMode, vnetUpdateParams, zoneTypeLabel, type FormValues } from './model'
import { effective } from './pending'
import { sdnWrite } from './ui'

export function VnetDialog({
  open,
  onOpenChange,
  vnet,
  zone: presetZone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Effective config of the VNet to edit; undefined = create. */
  vnet?: SdnVnet
  zone?: string
}) {
  const create = !vnet
  const [form, setForm] = useState<FormValues>(() => ({ ...vnetForm(vnet), ...(presetZone && !vnet ? { zone: presetZone } : {}) }))
  const [touched, setTouched] = useState(false)
  const zones = useSdnZones()
  const zoneList = useMemo(() => (zones.data ?? []).map(effective).filter((z) => z.state !== 'deleted'), [zones.data])
  const zoneType = zoneList.find((z) => z.zone === form.zone)?.type
  const tagMode = vnetTagMode(zoneType)
  const errors = validateVnet(form, zoneType, create)
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))
  const err = (k: string) => (touched ? errors[k] : undefined)

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={create ? '添加 VNet' : `编辑 VNet ${vnet.vnet}`}
      description={create ? 'VNet 是客户机网卡可以接入的虚拟网络（节点上的网桥）。应用后生效。' : undefined}
      submitLabel={create ? '添加' : '保存'}
      onSubmit={async () => {
        setTouched(true)
        if (Object.keys(errors).length) throw new Error('请检查标红的字段')
        if (create) {
          await sdnWrite(createSdnObject('vnets', vnetCreateParams(form, zoneType)), `添加 VNet ${str(form.vnet)}`)
        } else {
          const params = vnetUpdateParams(vnet, form, zoneType)
          if (params) await sdnWrite(updateSdnObject('vnets', vnet.vnet, params), `修改 VNet ${vnet.vnet}`)
        }
      }}
    >
      <FormRow>
        <FormField label="名称" name="vnet" required={create} error={err('vnet')} hint={create ? '字母开头，最多 8 个字母或数字' : undefined}>
          <FieldInput value={str(form.vnet)} onChange={(e) => set('vnet', e.target.value)} disabled={!create} autoComplete="off" placeholder="例如 vnet1" />
        </FormField>
        <FormField label="别名" name="alias" error={err('alias')}>
          <FieldInput value={str(form.alias)} onChange={(e) => set('alias', e.target.value)} autoComplete="off" placeholder="可选" />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="Zone" name="zone" required error={err('zone')}>
          <SelectField
            value={str(form.zone) || undefined}
            onValueChange={(v) => set('zone', v ?? '')}
            loading={zones.isPending}
            placeholder={zoneList.length ? '选择 Zone' : '先添加 Zone'}
            options={zoneList.map((z) => ({ value: z.zone, label: z.zone, description: zoneTypeLabel(z.type) }))}
          />
        </FormField>
        <FormField
          label={vnetTagLabel(zoneType)}
          name="tag"
          required={tagMode === 'required'}
          error={err('tag')}
          hint={tagMode === 'none' ? (zoneType ? 'Simple Zone 不用标签' : '先选 Zone') : undefined}
        >
          <FieldInput
            value={tagMode === 'none' ? '' : str(form.tag)}
            onChange={(e) => set('tag', e.target.value)}
            disabled={tagMode === 'none'}
            inputMode="numeric"
            placeholder={tagMode === 'optional' ? '可选' : undefined}
          />
        </FormField>
      </FormRow>
      <FormSection title="高级" collapsible defaultOpen={!!(form.vlanaware || form['isolate-ports'])}>
        <SwitchField
          label="VLAN aware"
          description={zoneType === 'evpn' ? 'EVPN Zone 不支持' : '允许客户机网卡在这个 VNet 上再打 VLAN 标签'}
          checked={zoneType !== 'evpn' && !!form.vlanaware}
          disabled={!zoneType || zoneType === 'evpn'}
          onCheckedChange={(v) => set('vlanaware', v)}
        />
        <SwitchField
          label="端口隔离"
          description="同一 VNet 上的客户机之间不能直接通信，只能和上行端口通信"
          checked={!!form['isolate-ports']}
          onCheckedChange={(v) => set('isolate-ports', v)}
        />
      </FormSection>
    </FormDialog>
  )
}
