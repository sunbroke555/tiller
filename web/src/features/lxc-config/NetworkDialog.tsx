// Add / edit a container NIC (net[n]); mirrors PVE.lxc.NetworkInputPanel plus
// the "manual" address modes and trunks the API offers.

import {
  BridgeSelect,
  FieldInput,
  FormDialog,
  FormField,
  FormRow,
  FormSection,
  NumberInput,
  SwitchField,
} from '@/components/form'

import { useFormState, ValidationError } from './hooks'
import {
  formToNet,
  netNames,
  netToForm,
  newNetForm,
  nextFreeIndex,
  validateNetForm,
  type Ip4Mode,
  type Ip6Mode,
  type NetForm,
} from './model'
import { Segmented, type LxcConfigApi } from './shared'

const IP4_MODES: { value: Ip4Mode; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'static', label: '静态' },
  { value: 'dhcp', label: 'DHCP' },
  { value: 'manual', label: '手动' },
]

const IP6_MODES: { value: Ip6Mode; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'static', label: '静态' },
  { value: 'dhcp', label: 'DHCP' },
  { value: 'auto', label: 'SLAAC' },
  { value: 'manual', label: '手动' },
]

const MODE_HINT: Record<string, string> = {
  none: '不配置地址。',
  dhcp: '启动时通过 DHCP 获取地址。',
  auto: '通过路由器通告（SLAAC）自动配置。',
  manual: 'PVE 不写入地址，由容器内自行配置。',
}

/** Next free netN and a free ethN name for a new NIC. */
export function newNicKey(cfg: Record<string, string>): { key: string | null; name: string } {
  const i = nextFreeIndex(cfg, 'net')
  const names = netNames(cfg)
  let n = 0
  while (names.includes(`eth${n}`)) n++
  return { key: i === null ? null : `net${i}`, name: `eth${n}` }
}

export function NetworkDialog({
  open,
  onOpenChange,
  api,
  netKey,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  api: LxcConfigApi
  /** undefined = add a NIC. */
  netKey: string | undefined
}) {
  const isCreate = !netKey
  const fresh = newNicKey(api.cfg)
  const key = netKey ?? fresh.key ?? ''
  const previous = netKey ? api.cfg[netKey] : undefined
  const [form, setForm] = useFormState<NetForm>(open, () => (previous ? netToForm(previous) : newNetForm(fresh.name)))
  const [attempted, setAttempted] = useFormState(open, () => false)
  const errors = validateNetForm(form, netNames(api.cfg, netKey))
  const err = (k: keyof NetForm) => (attempted ? errors[k] : undefined)
  const set = <K extends keyof NetForm>(k: K, v: NetForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={isCreate ? '添加网卡' : `网卡 ${form.name || netKey}`}
      description={
        isCreate
          ? `将写入配置 ${key}（veth）。`
          : api.running
            ? '修改会尽量热应用到运行中的容器；无法热应用的会在重启后生效。'
            : undefined
      }
      submitLabel={isCreate ? '添加' : '保存'}
      onSubmit={async () => {
        setAttempted(true)
        if (Object.keys(errors).length || !key) throw new ValidationError()
        await api.save({ [key]: formToNet(form, previous) }, `${isCreate ? '添加' : '修改'}网卡 ${form.name.trim()}`)
      }}
    >
      <FormRow>
        <FormField label="名称" name="name" error={err('name')} hint="容器内看到的接口名。" required>
          <FieldInput
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="eth0"
            autoCapitalize="off"
            spellCheck={false}
          />
        </FormField>
        <FormField label="网桥" name="bridge" error={err('bridge')} required>
          <BridgeSelect node={api.node} value={form.bridge} onValueChange={(v) => set('bridge', v ?? '')} />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="VLAN 标签" name="tag" error={err('tag')}>
          <NumberInput value={form.tag} onChange={(v) => set('tag', v)} min={1} max={4094} placeholder="无" />
        </FormField>
        <SwitchField
          label="防火墙"
          description="在这块网卡上启用 PVE 防火墙。"
          checked={form.firewall}
          onCheckedChange={(v) => set('firewall', v)}
          className="self-end"
        />
      </FormRow>

      <FormSection title="IPv4">
        <Segmented aria-label="IPv4 配置方式" value={form.ip4mode} onChange={(v) => set('ip4mode', v)} options={IP4_MODES} />
        {form.ip4mode === 'static' ? (
          <FormRow>
            <FormField label="地址/前缀" name="ip" error={err('ip')} required>
              <FieldInput
                value={form.ip}
                onChange={(e) => set('ip', e.target.value)}
                placeholder="192.168.1.10/24"
                inputMode="decimal"
                autoCapitalize="off"
                spellCheck={false}
                className="tabular"
              />
            </FormField>
            <FormField label="网关" name="gw" error={err('gw')}>
              <FieldInput
                value={form.gw}
                onChange={(e) => set('gw', e.target.value)}
                placeholder="192.168.1.1"
                inputMode="decimal"
                autoCapitalize="off"
                spellCheck={false}
                className="tabular"
              />
            </FormField>
          </FormRow>
        ) : (
          <p className="-mt-1 text-xs text-muted-foreground">{MODE_HINT[form.ip4mode]}</p>
        )}
      </FormSection>

      <FormSection title="IPv6">
        <Segmented aria-label="IPv6 配置方式" value={form.ip6mode} onChange={(v) => set('ip6mode', v)} options={IP6_MODES} />
        {form.ip6mode === 'static' ? (
          <FormRow>
            <FormField label="地址/前缀" name="ip6" error={err('ip6')} required>
              <FieldInput
                value={form.ip6}
                onChange={(e) => set('ip6', e.target.value)}
                placeholder="fd00::10/64"
                autoCapitalize="off"
                spellCheck={false}
                className="tabular"
              />
            </FormField>
            <FormField label="网关" name="gw6" error={err('gw6')}>
              <FieldInput
                value={form.gw6}
                onChange={(e) => set('gw6', e.target.value)}
                placeholder="fd00::1"
                autoCapitalize="off"
                spellCheck={false}
                className="tabular"
              />
            </FormField>
          </FormRow>
        ) : (
          <p className="-mt-1 text-xs text-muted-foreground">{MODE_HINT[form.ip6mode]}</p>
        )}
      </FormSection>

      <FormSection collapsible title="高级选项">
        <FormRow>
          <FormField label="MAC 地址" name="hwaddr" error={err('hwaddr')}>
            <FieldInput
              value={form.hwaddr}
              onChange={(e) => set('hwaddr', e.target.value)}
              placeholder="自动生成"
              autoCapitalize="characters"
              spellCheck={false}
              className="tabular"
            />
          </FormField>
          <FormField label="MTU" name="mtu" error={err('mtu')}>
            <NumberInput value={form.mtu} onChange={(v) => set('mtu', v)} min={576} max={65535} placeholder="与网桥相同" />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label="限速" name="rate" error={err('rate')}>
            <NumberInput value={form.rate} onChange={(v) => set('rate', v)} min={0} decimal unit="MB/s" placeholder="不限" />
          </FormField>
          <FormField label="Trunks" name="trunks" error={err('trunks')} hint="允许通过的 VLAN，用分号分隔。">
            <FieldInput
              value={form.trunks}
              onChange={(e) => set('trunks', e.target.value)}
              placeholder="10;20;30"
              inputMode="numeric"
              className="tabular"
            />
          </FormField>
        </FormRow>
        <SwitchField
          label="断开链路"
          description="保留网卡，但像拔掉网线一样断开连接。"
          checked={form.linkDown}
          onCheckedChange={(v) => set('linkDown', v)}
        />
        <SwitchField
          label="由主机管理"
          description="地址由主机（而不是容器内的网络配置）管理，常用于 OCI 应用容器。"
          checked={form.hostManaged}
          onCheckedChange={(v) => set('hostManaged', v)}
        />
      </FormSection>
    </FormDialog>
  )
}
