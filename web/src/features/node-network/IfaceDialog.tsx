import { useMemo, useState, type ReactNode } from 'react'

import { createIface, updateIface, type NetworkIface } from '@/api/node-network'
import {
  FieldInput,
  FormDialog,
  FormField,
  FormRow,
  FormSection,
  NumberInput,
  SelectField,
  SwitchField,
  type SelectOption,
} from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { cn } from '@/lib/utils'

import {
  BOND_MODE_LABEL,
  BOND_MODES,
  HASH_POLICIES,
  OVS_BOND_MODES,
  bondUsesHashPolicy,
  bondUsesPrimary,
  formFromIface,
  formToParams,
  hasAddresses,
  hasAutostart,
  portOwners,
  splitList,
  toggleInList,
  typeLabel,
  validateForm,
  vlanFieldState,
  type EditableType,
  type FormErrors,
  type IfaceForm,
} from './model'
import { networkInvalidate } from './shared'

export interface IfaceDialogTarget {
  type: EditableType
  /** Edit this interface; undefined = create. */
  iface?: NetworkIface
  /** Pre-filled name of a new interface. */
  name?: string
}

/** Errors that only exist for typed values: shown while typing, before the first submit. */
const FORMAT_KEYS = new Set<keyof IfaceForm>(['iface', 'cidr', 'gateway', 'cidr6', 'gateway6', 'bridge_vids', 'mtu', 'vlan_id', 'ovs_tag'])

/** Create / edit dialog for every interface type the official UI edits. */
export function IfaceDialog({
  node,
  target,
  ifaces,
  open,
  onOpenChange,
}: {
  node: string
  target: IfaceDialogTarget | undefined
  ifaces: readonly NetworkIface[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [form, setForm] = useState<IfaceForm | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open && target) {
      setForm(formFromIface(target.type, target.iface, target.name))
      setAttempted(false)
    }
  }

  const create = !target?.iface
  const existing = useMemo(() => new Set(ifaces.map((i) => i.iface)), [ifaces])
  const errors: FormErrors = form ? validateForm(form, { create, existing }) : {}
  const shown = (k: keyof IfaceForm): string | undefined => {
    const e = errors[k]
    if (!e || !form) return undefined
    if (attempted) return e
    const v = form[k]
    return FORMAT_KEYS.has(k) && v !== '' && v !== undefined ? e : undefined
  }

  if (!target || !form) return null
  const f = form
  const update = (patch: Partial<IfaceForm>) => setForm((s) => (s ? { ...s, ...patch } : s))
  const type = target.type
  const title = create ? `创建 ${typeLabel(type)}` : `编辑 ${typeLabel(type)} ${target.iface!.iface}`

  async function submit() {
    if (Object.keys(errors).length > 0) {
      setAttempted(true)
      throw new Error('请先修正标出的字段')
    }
    const params = formToParams(f, target!.iface)
    const name = create ? f.iface.trim() : target!.iface!.iface
    await runTask(create ? createIface(node, params) : updateIface(node, name, params), {
      title: `${create ? '创建' : '修改'}${typeLabel(type)} ${name}`,
      invalidate: networkInvalidate(node),
      syncSuccessMessage: '已保存，应用配置后生效',
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="更改先写入待应用配置，点击“应用配置”后生效。"
      size="lg"
      submitLabel={create ? '创建' : '保存'}
      onSubmit={submit}
    >
      <FormSection>
        <FormRow>
          {create ? (
            <FormField label="名称" name="iface" required error={shown('iface')} hint={nameHint(type)}>
              <FieldInput
                value={f.iface}
                onChange={(e) => update({ iface: e.target.value })}
                maxLength={type === 'bridge' || type === 'OVSBridge' ? 10 : 15}
                spellCheck={false}
                autoCapitalize="none"
                className="font-mono"
                autoFocus
              />
            </FormField>
          ) : (
            <FormField label="名称">
              <ReadOnlyValue>{target.iface!.iface}</ReadOnlyValue>
            </FormField>
          )}
          {!create && target.iface!.altnames && target.iface!.altnames.length > 0 ? (
            <FormField label="备用名称">
              <div className="flex flex-wrap gap-1.5 py-1" aria-label="备用名称">
                {target.iface!.altnames.map((n) => (
                  <span key={n} className="rounded-md bg-secondary px-2 py-1 font-mono text-xs text-muted-foreground">
                    {n}
                  </span>
                ))}
              </div>
            </FormField>
          ) : null}
        </FormRow>
      </FormSection>

      <TypeFields node={node} form={f} update={update} create={create} ifaces={ifaces} shown={shown} self={target.iface?.iface ?? f.iface} />

      {hasAddresses(type) && (
        <FormSection title="地址">
          <FormRow>
            <FormField label="IPv4/CIDR" name="cidr" error={shown('cidr')}>
              <FieldInput
                value={f.cidr}
                onChange={(e) => update({ cidr: e.target.value })}
                placeholder="192.168.1.10/24"
                inputMode="decimal"
                spellCheck={false}
                className="font-mono"
              />
            </FormField>
            <FormField label="IPv4 网关" name="gateway" error={shown('gateway')}>
              <FieldInput
                value={f.gateway}
                onChange={(e) => update({ gateway: e.target.value })}
                placeholder="192.168.1.1"
                inputMode="decimal"
                spellCheck={false}
                className="font-mono"
              />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="IPv6/CIDR" name="cidr6" error={shown('cidr6')}>
              <FieldInput
                value={f.cidr6}
                onChange={(e) => update({ cidr6: e.target.value })}
                placeholder="2001:db8::10/64"
                spellCheck={false}
                autoCapitalize="none"
                className="font-mono"
              />
            </FormField>
            <FormField label="IPv6 网关" name="gateway6" error={shown('gateway6')}>
              <FieldInput
                value={f.gateway6}
                onChange={(e) => update({ gateway6: e.target.value })}
                placeholder="2001:db8::1"
                spellCheck={false}
                autoCapitalize="none"
                className="font-mono"
              />
            </FormField>
          </FormRow>
        </FormSection>
      )}

      <FormSection>
        {hasAutostart(type) && (
          <SwitchField
            label="开机自动启动"
            description="写入 auto 行，系统启动时启用这个接口"
            checked={f.autostart}
            onCheckedChange={(autostart) => update({ autostart })}
          />
        )}
        <FormField label="注释" name="comments">
          <FieldInput value={f.comments} onChange={(e) => update({ comments: e.target.value })} placeholder="可选" />
        </FormField>
      </FormSection>

      <FormSection collapsible title="高级选项" defaultOpen={f.mtu !== undefined || (type === 'bridge' && !!f.bridge_vids)}>
        <FormRow>
          <FormField label="MTU" name="mtu" error={shown('mtu')} hint="1280–65520，留空为 1500">
            <NumberInput value={f.mtu} onChange={(mtu) => update({ mtu })} placeholder="1500" />
          </FormField>
          {type === 'bridge' && (
            <FormField
              label="VLAN ID 范围"
              name="bridge_vids"
              error={shown('bridge_vids')}
              disabled={!f.bridge_vlan_aware}
              hint={f.bridge_vlan_aware ? '如 2 4 100-200，留空为 2-4094' : '开启“VLAN 感知”后可设置'}
            >
              <FieldInput
                value={f.bridge_vids}
                onChange={(e) => update({ bridge_vids: e.target.value })}
                placeholder="2-4094"
                spellCheck={false}
                className="font-mono"
              />
            </FormField>
          )}
        </FormRow>
      </FormSection>
    </FormDialog>
  )
}

function nameHint(type: EditableType): string | undefined {
  switch (type) {
    case 'bridge':
    case 'OVSBridge':
      return '如 vmbr1，最多 10 个字符'
    case 'bond':
    case 'OVSBond':
      return '格式 bondN，如 bond0'
    case 'vlan':
      return '写成 <父接口>.<VLAN ID>（如 ens19.100）会自动解析；也可以用 vlanN 或自定义名称'
    case 'OVSIntPort':
      return '小写字母开头，如 mgmt0'
    default:
      return undefined
  }
}

function ReadOnlyValue({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-h-9 items-center rounded-md border border-border/60 bg-foreground/[0.03] px-3 font-mono text-sm text-muted-foreground pointer-coarse:min-h-11 paper:bg-secondary/50',
        className,
      )}
    >
      {children}
    </div>
  )
}

// ------------------------------------------------------------ per type

interface TypeFieldsProps {
  node: string
  form: IfaceForm
  update: (patch: Partial<IfaceForm>) => void
  create: boolean
  ifaces: readonly NetworkIface[]
  shown: (k: keyof IfaceForm) => string | undefined
  /** Name of the interface being edited (or the typed name). */
  self: string
}

function TypeFields(props: TypeFieldsProps) {
  const { form: f, update, ifaces, shown, self } = props
  const owners = useMemo(() => portOwners(ifaces), [ifaces])

  /** Interfaces of `types` that could be a member of `self`. */
  const candidates = (types: readonly string[]): PortCandidate[] =>
    ifaces
      .filter((i) => types.includes(i.type) && i.iface !== self)
      .map((i) => {
        const owner = owners.get(i.iface)
        return { name: i.iface, usedBy: owner && owner !== self ? owner : undefined }
      })

  switch (f.type) {
    case 'bridge':
      return (
        <FormSection title="网桥">
          <FormField label="网桥端口" name="bridge_ports" hint="空格分隔，可以留空（无上联的内部网桥）">
            <PortPicker
              value={f.bridge_ports}
              onChange={(bridge_ports) => update({ bridge_ports })}
              candidates={candidates(['eth', 'bond', 'vlan'])}
              label="网桥端口"
            />
          </FormField>
          <SwitchField
            label="VLAN 感知"
            description="客户机网卡可以按 VLAN 标签接入这个网桥"
            checked={f.bridge_vlan_aware}
            onCheckedChange={(bridge_vlan_aware) => update({ bridge_vlan_aware })}
          />
        </FormSection>
      )

    case 'bond': {
      const modes: SelectOption[] = BOND_MODES.map((m) => ({ value: m, label: BOND_MODE_LABEL[m] ?? m }))
      const slaves = splitList(f.slaves)
      return (
        <FormSection title="Bond">
          <FormField label="成员网卡" name="slaves" hint="空格分隔">
            <PortPicker value={f.slaves} onChange={(s) => update({ slaves: s })} candidates={candidates(['eth'])} label="成员网卡" />
          </FormField>
          <FormRow>
            <FormField label="模式" name="bond_mode" required error={shown('bond_mode')}>
              <SelectField
                value={f.bond_mode}
                onValueChange={(m) => update({ bond_mode: m ?? '' })}
                options={modes}
                aria-label="模式"
              />
            </FormField>
            {bondUsesHashPolicy(f.bond_mode) && (
              <FormField label="哈希策略" name="bond_xmit_hash_policy">
                <SelectField
                  value={f.bond_xmit_hash_policy || undefined}
                  onValueChange={(v) => update({ bond_xmit_hash_policy: v ?? '' })}
                  options={HASH_POLICIES.map((h) => ({ value: h, label: h }))}
                  emptyOption="默认（layer2）"
                  aria-label="哈希策略"
                />
              </FormField>
            )}
            {bondUsesPrimary(f.bond_mode) && (
              <FormField label="主网卡（bond-primary）" name="bond-primary" hint="可选，链路正常时优先使用">
                <SelectField
                  value={f.bond_primary || undefined}
                  onValueChange={(v) => update({ bond_primary: v ?? '' })}
                  options={[...new Set([...slaves, ...(f.bond_primary ? [f.bond_primary] : [])])].map((s) => ({ value: s, label: s }))}
                  emptyOption="不指定"
                  aria-label="主网卡"
                />
              </FormField>
            )}
          </FormRow>
        </FormSection>
      )
    }

    case 'vlan': {
      const st = vlanFieldState(f.iface.trim())
      const naming = st.naming
      const rawFromName = naming.kind === 'dotted' ? naming.rawDevice : undefined
      const idFromName = naming.kind === 'dotted' || naming.kind === 'vlanN' ? naming.id : undefined
      return (
        <FormSection title="VLAN">
          <FormRow>
            <FormField
              label="父接口"
              name="vlan-raw-device"
              required={st.rawDevice === 'input'}
              error={shown('vlan_raw_device')}
              hint={st.rawDevice === 'name' ? '由名称决定' : undefined}
            >
              {st.rawDevice === 'name' ? (
                <ReadOnlyValue>{rawFromName}</ReadOnlyValue>
              ) : (
                <div className="grid gap-2">
                  <FieldInput
                    value={f.vlan_raw_device}
                    onChange={(e) => update({ vlan_raw_device: e.target.value })}
                    placeholder="如 ens19 或 bond0"
                    spellCheck={false}
                    autoCapitalize="none"
                    className="font-mono"
                  />
                  <QuickPick
                    label="选择父接口"
                    items={candidates(['eth', 'bond', 'bridge']).map((c) => c.name)}
                    selected={f.vlan_raw_device}
                    onPick={(vlan_raw_device) => update({ vlan_raw_device })}
                  />
                </div>
              )}
            </FormField>
            <FormField
              label="VLAN ID"
              name="vlan-id"
              required={st.id === 'input'}
              error={shown('vlan_id')}
              hint={st.id === 'name' ? '由名称决定' : '1–4094'}
            >
              {st.id === 'name' ? (
                <ReadOnlyValue>{idFromName}</ReadOnlyValue>
              ) : (
                <NumberInput value={f.vlan_id} onChange={(vlan_id) => update({ vlan_id })} min={1} max={4094} />
              )}
            </FormField>
          </FormRow>
        </FormSection>
      )
    }

    case 'OVSBridge':
      return (
        <FormSection title="OVS 网桥">
          <FormField label="网桥端口" name="ovs_ports" hint="空格分隔；OVS 内部端口和 OVS Bond 创建时会自动加入">
            <PortPicker
              value={f.ovs_ports}
              onChange={(ovs_ports) => update({ ovs_ports })}
              candidates={candidates(['eth', 'bond', 'OVSIntPort', 'OVSBond', 'OVSPort'])}
              label="网桥端口"
            />
          </FormField>
          <OvsOptions {...props} />
        </FormSection>
      )

    case 'OVSBond':
    case 'OVSPort':
    case 'OVSIntPort': {
      const isBond = f.type === 'OVSBond'
      return (
        <FormSection title={typeLabel(f.type)}>
          <FormRow>
            <OvsBridgeField {...props} />
            <FormField label="VLAN 标签" name="ovs_tag" error={shown('ovs_tag')} hint="1–4094，留空不打标签">
              <NumberInput value={f.ovs_tag} onChange={(ovs_tag) => update({ ovs_tag })} min={1} max={4094} />
            </FormField>
          </FormRow>
          {isBond && (
            <FormRow>
              <FormField label="模式" name="bond_mode" required error={shown('bond_mode')}>
                <SelectField
                  value={f.bond_mode}
                  onValueChange={(m) => update({ bond_mode: m ?? '' })}
                  options={OVS_BOND_MODES.map((m) => ({ value: m, label: BOND_MODE_LABEL[m] ?? m }))}
                  aria-label="模式"
                />
              </FormField>
              <FormField label="成员网卡" name="ovs_bonds" hint="空格分隔">
                <PortPicker value={f.ovs_bonds} onChange={(ovs_bonds) => update({ ovs_bonds })} candidates={candidates(['eth'])} label="成员网卡" />
              </FormField>
            </FormRow>
          )}
          <OvsOptions {...props} />
        </FormSection>
      )
    }

    case 'eth':
      return null
  }
}

function OvsOptions({ form: f, update }: TypeFieldsProps) {
  return (
    <FormField label="OVS 选项" name="ovs_options" hint="写入 ovs_options，如 tag=10 vlan_mode=native-untagged">
      <FieldInput
        value={f.ovs_options}
        onChange={(e) => update({ ovs_options: e.target.value })}
        spellCheck={false}
        autoCapitalize="none"
        className="font-mono"
      />
    </FormField>
  )
}

function OvsBridgeField({ form: f, update, create, ifaces, shown }: TypeFieldsProps) {
  const bridges = ifaces.filter((i) => i.type === 'OVSBridge')
  if (!create) {
    return (
      <FormField label="OVS 网桥">
        <ReadOnlyValue>{f.ovs_bridge || '—'}</ReadOnlyValue>
      </FormField>
    )
  }
  return (
    <FormField
      label="OVS 网桥"
      name="ovs_bridge"
      required
      error={shown('ovs_bridge')}
      hint={bridges.length === 0 ? '这台节点还没有 OVS 网桥，先创建一个' : undefined}
    >
      <SelectField
        value={f.ovs_bridge || undefined}
        onValueChange={(v) => update({ ovs_bridge: v ?? '' })}
        options={bridges.map((b) => ({ value: b.iface, label: b.iface, description: b.comments?.trim() }))}
        placeholder={bridges.length ? '选择网桥' : '没有 OVS 网桥'}
        disabled={bridges.length === 0}
        aria-label="OVS 网桥"
      />
    </FormField>
  )
}

// ------------------------------------------------------------ port picker

interface PortCandidate {
  name: string
  /** Already a port / slave of another interface. */
  usedBy?: string | undefined
}

/**
 * Space-separated list input plus tappable chips for the candidates (free
 * ones; ports used elsewhere are shown disabled with their owner).
 */
function PortPicker({
  value,
  onChange,
  candidates,
  label,
}: {
  value: string
  onChange: (v: string) => void
  candidates: PortCandidate[]
  label: string
}) {
  const selected = new Set(splitList(value))
  return (
    <div className="grid gap-2">
      <FieldInput value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} autoCapitalize="none" className="font-mono" />
      {candidates.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={`选择${label}`}>
          {candidates.map((c) => {
            const on = selected.has(c.name)
            const disabled = !!c.usedBy && !on
            return (
              <button
                key={c.name}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                title={disabled ? `已用于 ${c.usedBy}` : undefined}
                onClick={() => onChange(toggleInList(value, c.name))}
                className={cn(
                  'inline-flex min-h-8 items-center gap-1 rounded-full border px-3 font-mono text-xs transition-colors pointer-coarse:min-h-10',
                  on
                    ? 'border-brand/40 bg-brand/12 text-brand-strong paper:border-primary/40 paper:bg-primary/10 paper:text-primary'
                    : 'border-border bg-transparent text-muted-foreground hover:text-foreground',
                  disabled && 'cursor-not-allowed opacity-50 hover:text-muted-foreground',
                )}
              >
                {c.name}
                {disabled && <span className="font-sans text-[10px]">· {c.usedBy}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Single-choice chips under a text input (VLAN parent). */
function QuickPick({ label, items, selected, onPick }: { label: string; items: string[]; selected: string; onPick: (v: string) => void }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {items.map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={selected === name}
          onClick={() => onPick(name)}
          className={cn(
            'inline-flex min-h-8 items-center rounded-full border px-3 font-mono text-xs transition-colors pointer-coarse:min-h-10',
            selected === name
              ? 'border-brand/40 bg-brand/12 text-brand-strong paper:border-primary/40 paper:bg-primary/10 paper:text-primary'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          {name}
        </button>
      ))}
    </div>
  )
}
