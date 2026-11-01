// Editors of the datacenter options. Each dialog edits one option, compares
// with the options as they were when it opened and sends only what changed
// (cleared values are deleted, unchanged ones are not sent).

import { useMemo, useState } from 'react'
import { AlertTriangle, ExternalLink, Wand2 } from 'lucide-react'

import { clusterOptionsKey, setDcOptions, type DcOptions } from '@/api/dc-options'
import { useNodeNetworks } from '@/api/queries'
import { FieldInput, FieldTextarea, FormDialog, FormField, FormRow, NumberInput, SelectField, SwitchField, type SelectOption } from '@/components/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import {
  BWLIMIT_KEYS,
  BWLIMIT_LABEL,
  CONSENT_MAX,
  CRS_METHODS,
  CRS_MODES,
  NEXT_ID_MAX,
  NEXT_ID_MIN,
  bwlimitValue,
  crsCanAutoRebalance,
  crsValue,
  decodeBase64Utf8,
  encodeBase64Utf8,
  locationValue,
  networkSettingValue,
  nextIdValue,
  optionParams,
  parseBwlimit,
  parseCrs,
  parseLocationForm,
  parseNetworkSetting,
  parseNextId,
  parseU2f,
  parseWebauthn,
  scalarValue,
  u2fValue,
  validateCidr,
  validateLocationForm,
  validateNextId,
  validateWebauthn,
  webauthnValue,
  type CrsForm,
  type LocationForm,
  type NetworkForm,
  type OptionKey,
  type U2fForm,
  type WebauthnForm,
} from './model'
import { ValidationError, hasErrors, useFormState } from './ui'

export interface OptionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: DcOptions | undefined
}

/** PUT the changed options; nothing changed → nothing sent. */
export async function saveOptions(options: DcOptions | undefined, changes: Partial<Record<OptionKey, string | undefined>>, title: string) {
  const params = optionParams(options, changes)
  if (!params) return
  await runTask(setDcOptions(params), { title, invalidate: [clusterOptionsKey()], syncSuccessMessage: `${title}：已保存` })
}

/** The options as they were when the dialog opened (polling must not reset a form). */
function useSnapshot(open: boolean, options: DcOptions | undefined) {
  return useFormState(open, () => options)[0]
}

function Warning({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p role="note" className={cn('flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2.5 text-xs leading-relaxed text-warning-strong', className)}>
      <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

// ------------------------------------------------------------ select

export function SelectOptionDialog({
  open,
  onOpenChange,
  options,
  optionKey,
  title,
  description,
  choices,
  defaultLabel,
  read = (v) => (typeof v === 'string' && v ? v : undefined),
  write = (v) => v,
  warn,
}: OptionDialogProps & {
  optionKey: OptionKey
  title: string
  description?: string
  choices: SelectOption[]
  defaultLabel: string
  read?: (value: unknown) => string | undefined
  write?: (value: string | undefined) => string | undefined
  warn?: (value: string | undefined) => React.ReactNode
}) {
  const snap = useSnapshot(open, options)
  const [value, setValue] = useFormState<string | undefined>(open, () => read(snap?.[optionKey]))
  const warning = warn?.(value)
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={title} description={description} size="sm" onSubmit={() => saveOptions(snap, { [optionKey]: write(value) }, `修改${title}`)}>
      <FormField label={title} name={optionKey}>
        <SelectField value={value} onValueChange={setValue} emptyOption={defaultLabel} options={choices} />
      </FormField>
      {warning && <Warning>{warning}</Warning>}
    </FormDialog>
  )
}

// ------------------------------------------------------------ text

export function TextOptionDialog({
  open,
  onOpenChange,
  options,
  optionKey,
  title,
  description,
  hint,
  placeholder,
  validate,
  normalize = (v) => v.trim(),
  inputMode,
}: OptionDialogProps & {
  optionKey: OptionKey
  title: string
  description?: string
  hint?: string
  placeholder?: string
  validate?: (v: string) => string | undefined
  normalize?: (v: string) => string
  inputMode?: 'email' | 'url' | 'text'
}) {
  const snap = useSnapshot(open, options)
  const [value, setValue] = useFormState(open, () => {
    const v = snap?.[optionKey]
    return typeof v === 'string' ? v : ''
  })
  const [attempted, setAttempted] = useFormState(open, () => false)
  const error = validate?.(value)
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      onSubmit={async () => {
        setAttempted(true)
        if (error) throw new ValidationError()
        await saveOptions(snap, { [optionKey]: scalarValue(normalize(value)) }, `修改${title}`)
      }}
    >
      <FormField label={title} name={optionKey} hint={hint} error={attempted ? error : undefined}>
        <FieldInput value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} inputMode={inputMode} autoComplete="off" spellCheck={false} />
      </FormField>
    </FormDialog>
  )
}

// ------------------------------------------------------------ number

export function MaxWorkersDialog({ open, onOpenChange, options }: OptionDialogProps) {
  const snap = useSnapshot(open, options)
  const [value, setValue] = useFormState<number | undefined>(open, () => {
    const n = Number(snap?.max_workers)
    return snap?.max_workers !== undefined && Number.isFinite(n) ? n : undefined
  })
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="批量操作最大并发"
      description="每个节点在“全部停止”等批量操作和 HA 任务中同时启动的最大任务数。"
      size="sm"
      onSubmit={() => saveOptions(snap, { max_workers: value === undefined ? undefined : String(value) }, '修改最大并发')}
    >
      <FormField label="最大并发" name="max_workers" hint="留空使用默认值 4；范围 1–64。">
        <NumberInput value={value} onChange={setValue} min={1} max={64} stepper placeholder="4" />
      </FormField>
    </FormDialog>
  )
}

// ------------------------------------------------------------ migration / replication

export function NetworkSettingDialog({
  open,
  onOpenChange,
  options,
  optionKey,
  node,
}: OptionDialogProps & { optionKey: 'migration' | 'replication'; node: string | undefined }) {
  const snap = useSnapshot(open, options)
  const [form, setForm] = useFormState<NetworkForm>(open, () => parseNetworkSetting(snap?.[optionKey]))
  const [attempted, setAttempted] = useFormState(open, () => false)
  const networks = useNodeNetworks(open ? node : undefined, 'include_sdn')
  const cidrs = useMemo(() => {
    const out: { cidr: string; iface: string }[] = []
    for (const n of networks.data ?? []) {
      for (const c of [n.cidr, n.cidr6]) if (c && !out.some((o) => o.cidr === cidrNetwork(c))) out.push({ cidr: cidrNetwork(c), iface: n.iface })
    }
    return out
  }, [networks.data])
  const error = validateCidr(form.network)
  const title = optionKey === 'migration' ? '迁移设置' : '复制设置'

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={optionKey === 'migration' ? '在线迁移和离线迁移使用的网络与传输方式。' : '存储复制使用的网络与传输方式。'}
      onSubmit={async () => {
        setAttempted(true)
        if (error) throw new ValidationError()
        await saveOptions(snap, { [optionKey]: networkSettingValue(form) }, `修改${title}`)
      }}
    >
      <FormField label="类型" name="type">
        <SelectField<'secure' | 'insecure'>
          value={form.type}
          onValueChange={(type) => setForm((f) => ({ ...f, type }))}
          emptyOption="默认（secure）"
          options={[
            { value: 'secure', label: 'secure', description: '通过 SSH 隧道加密传输' },
            { value: 'insecure', label: 'insecure', description: '不加密，速度更快' },
          ]}
        />
      </FormField>
      {form.type === 'insecure' && <Warning>不加密时数据（包括客户机内存）以明文传输，只在可信的专用网络上使用。</Warning>}
      <FormField label="网络" name="network" hint="CIDR；留空使用集群默认网络（corosync 所在网络）。" error={attempted ? error : undefined}>
        <FieldInput value={form.network} onChange={(e) => setForm((f) => ({ ...f, network: e.target.value }))} placeholder="默认" autoComplete="off" spellCheck={false} />
      </FormField>
      {cidrs.length > 0 && (
        <div className="-mt-2 flex flex-wrap items-center gap-1.5" aria-label="本节点的网络">
          <span className="text-xs text-muted-foreground">本节点的网络：</span>
          {cidrs.map((c) => (
            <button
              key={c.cidr}
              type="button"
              onClick={() => setForm((f) => ({ ...f, network: c.cidr }))}
              className={cn(
                'inline-flex h-8 items-center gap-1 rounded-full border border-border bg-(--field) px-3 text-xs tabular hover:text-foreground pointer-coarse:h-10',
                form.network === c.cidr ? 'border-brand/50 text-foreground' : 'text-foreground/80',
              )}
            >
              {c.cidr}
              <span className="text-muted-foreground">{c.iface}</span>
            </button>
          ))}
        </div>
      )}
    </FormDialog>
  )
}

/** "192.168.0.245/24" → "192.168.0.0/24" (IPv4); IPv6 is kept as written. */
export function cidrNetwork(cidr: string): string {
  const [addr, len] = cidr.split('/')
  if (!addr || len === undefined || addr.includes(':')) return cidr
  const parts = addr.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) return cidr
  const bits = Number(len)
  const ip = ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  const net = (ip & mask) >>> 0
  return `${[net >>> 24, (net >>> 16) & 255, (net >>> 8) & 255, net & 255].join('.')}/${bits}`
}

// ------------------------------------------------------------ bandwidth

export function BwlimitDialog({ open, onOpenChange, options }: OptionDialogProps) {
  const snap = useSnapshot(open, options)
  const [form, setForm] = useFormState(open, () => parseBwlimit(snap?.bwlimit))
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="带宽限制"
      description="各类操作的默认 I/O 带宽上限（每秒）。留空不限制；具体操作中指定的限制优先。"
      onSubmit={() => saveOptions(snap, { bwlimit: bwlimitValue(form) }, '修改带宽限制')}
    >
      {BWLIMIT_KEYS.map((k) => (
        <FormField key={k} label={BWLIMIT_LABEL[k]} name={k} hint={k === 'default' ? '其他项留空时使用此值。' : undefined}>
          <BandwidthInput
            value={form[k]}
            onChange={(v) => setForm((f) => ({ ...f, [k]: v }))}
            placeholder={k === 'default' ? '不限制' : '默认'}
            label={BWLIMIT_LABEL[k]}
          />
        </FormField>
      ))}
    </FormDialog>
  )
}

const RATE_UNITS = { 'KiB/s': 1, 'MiB/s': 1024, 'GiB/s': 1024 * 1024 } as const
type RateUnit = keyof typeof RATE_UNITS

/** KiB/s value edited in KiB/s, MiB/s (default, as the official field) or GiB/s. */
function BandwidthInput({ value, onChange, placeholder, label }: { value: number | undefined; onChange: (kib: number | undefined) => void; placeholder: string; label: string }) {
  const [unit, setUnit] = useState<RateUnit>(() =>
    value && value % RATE_UNITS['GiB/s'] === 0 ? 'GiB/s' : !value || value % RATE_UNITS['MiB/s'] === 0 ? 'MiB/s' : 'KiB/s',
  )
  const display = value === undefined ? undefined : Math.round((value / RATE_UNITS[unit]) * 1000) / 1000
  return (
    <NumberInput
      value={display}
      decimal
      min={0}
      placeholder={placeholder}
      onChange={(v) => onChange(v === undefined ? undefined : Math.round(v * RATE_UNITS[unit]))}
      unitSlot={
        <Select value={unit} onValueChange={(u) => setUnit(u as RateUnit)}>
          <SelectTrigger size="sm" aria-label={`${label}单位`} className="h-7 gap-1 border-0 bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:bg-accent pointer-coarse:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {(Object.keys(RATE_UNITS) as RateUnit[]).map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  )
}

// ------------------------------------------------------------ next-id

export function NextIdDialog({ open, onOpenChange, options }: OptionDialogProps) {
  const snap = useSnapshot(open, options)
  const [form, setForm] = useFormState(open, () => parseNextId(snap?.['next-id']))
  const [attempted, setAttempted] = useFormState(open, () => false)
  const errors = validateNextId(form)
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="VMID 自动分配范围"
      description="新建客户机时自动建议的 VMID 从这个范围里取。手动填写的 VMID 不受限制。"
      size="sm"
      onSubmit={async () => {
        setAttempted(true)
        if (hasErrors(errors)) throw new ValidationError()
        await saveOptions(snap, { 'next-id': nextIdValue(form) }, '修改 VMID 范围')
      }}
    >
      <FormRow>
        <FormField label="下限" name="lower" hint="包含" error={attempted ? errors.lower : undefined}>
          <NumberInput value={form.lower} onChange={(lower) => setForm((f) => ({ ...f, lower }))} min={NEXT_ID_MIN} max={NEXT_ID_MAX} placeholder="100" />
        </FormField>
        <FormField label="上限" name="upper" hint="不包含" error={attempted ? errors.upper : undefined}>
          <NumberInput value={form.upper} onChange={(upper) => setForm((f) => ({ ...f, upper }))} min={NEXT_ID_MIN} max={NEXT_ID_MAX} placeholder="1000000" />
        </FormField>
      </FormRow>
    </FormDialog>
  )
}

// ------------------------------------------------------------ CRS

export function CrsDialog({ open, onOpenChange, options }: OptionDialogProps) {
  const snap = useSnapshot(open, options)
  const [form, setForm] = useFormState<CrsForm>(open, () => parseCrs(snap?.crs))
  const set = (patch: Partial<CrsForm>) => setForm((f) => ({ ...f, ...patch }))
  const canAuto = crsCanAutoRebalance(form.ha)
  const autoOff = !canAuto || !form.autoRebalance
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="集群资源调度"
      description="HA 资源选择节点的方式（CRS）。"
      onSubmit={() => saveOptions(snap, { crs: crsValue(form) }, '修改集群资源调度')}
    >
      <FormField label="调度模式" name="ha">
        <SelectField
          value={form.ha}
          onValueChange={(ha) => set({ ha })}
          emptyOption="默认（basic）"
          options={Object.entries(CRS_MODES).map(([value, label]) => ({ value, label }))}
        />
      </FormField>
      <SwitchField
        label="启动时重新平衡"
        description="启动 HA 资源时由 CRS 选择负载最低的节点。"
        checked={form.rebalanceOnStart}
        onCheckedChange={(rebalanceOnStart) => set({ rebalanceOnStart })}
      />
      <SwitchField
        label="自动重新平衡"
        description={canAuto ? '负载不均衡时自动迁移 HA 资源。' : '需要“静态负载”或“动态负载”调度模式。'}
        checked={canAuto && form.autoRebalance}
        disabled={!canAuto}
        onCheckedChange={(autoRebalance) => set({ autoRebalance })}
      />
      <FormRow>
        <FormField label="不均衡阈值" name="ha-auto-rebalance-threshold" disabled={autoOff}>
          <NumberInput value={form.threshold} onChange={(threshold) => set({ threshold })} min={0} max={100} unit="%" placeholder="30" />
        </FormField>
        <FormField label="方法" name="ha-auto-rebalance-method" disabled={autoOff}>
          <SelectField
            value={form.method}
            onValueChange={(method) => set({ method })}
            emptyOption="默认（Bruteforce）"
            options={Object.entries(CRS_METHODS).map(([value, label]) => ({ value, label }))}
          />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="保持时长" name="ha-auto-rebalance-hold-duration" hint="不均衡持续多少轮才开始迁移" disabled={autoOff}>
          <NumberInput value={form.holdDuration} onChange={(holdDuration) => set({ holdDuration })} min={0} placeholder="3" />
        </FormField>
        <FormField label="最小改善" name="ha-auto-rebalance-margin" hint="迁移后不均衡至少降低多少" disabled={autoOff}>
          <NumberInput value={form.margin} onChange={(margin) => set({ margin })} min={0} max={100} unit="%" placeholder="10" />
        </FormField>
      </FormRow>
    </FormDialog>
  )
}

// ------------------------------------------------------------ U2F / WebAuthn

export function U2fDialog({ open, onOpenChange, options }: OptionDialogProps) {
  const snap = useSnapshot(open, options)
  const [form, setForm] = useFormState<U2fForm>(open, () => parseU2f(snap?.u2f))
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="U2F 设置" size="sm" onSubmit={() => saveOptions(snap, { u2f: u2fValue(form) }, '修改 U2F 设置')}>
      <Warning>U2F 已弃用，请改用 WebAuthn。更改 AppID 会使已注册的 U2F 设备失效。</Warning>
      <FormField label="AppID URL" name="appid" hint="留空时与来源相同。">
        <FieldInput value={form.appid} onChange={(e) => setForm((f) => ({ ...f, appid: e.target.value }))} placeholder="默认" inputMode="url" autoComplete="off" spellCheck={false} />
      </FormField>
      <FormField label="来源（Origin）" name="origin" hint="留空时使用请求的主机地址。">
        <FieldInput value={form.origin} onChange={(e) => setForm((f) => ({ ...f, origin: e.target.value }))} placeholder="默认" inputMode="url" autoComplete="off" spellCheck={false} />
      </FormField>
    </FormDialog>
  )
}

export function WebauthnDialog({ open, onOpenChange, options }: OptionDialogProps) {
  const snap = useSnapshot(open, options)
  const initial = useMemo(() => parseWebauthn(snap?.webauthn), [snap])
  const [form, setForm] = useFormState<WebauthnForm>(open, () => initial)
  const [attempted, setAttempted] = useFormState(open, () => false)
  const errors = validateWebauthn(form)
  const set = (patch: Partial<WebauthnForm>) => setForm((f) => ({ ...f, ...patch }))
  const idChanged = !!initial.id && form.id.trim() !== initial.id
  const autofill = () => {
    const host = window.location.hostname
    setForm((f) => ({ ...f, rp: host, id: f.id.trim() ? f.id : host, origin: f.origin.trim() ? f.origin : window.location.origin }))
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="WebAuthn 设置"
      description="两步验证使用的 WebAuthn 依赖方信息。需要使用受信任的证书访问。"
      footerExtra={
        <Button type="button" variant="ghost" onClick={autofill}>
          <Wand2 /> 自动填写
        </Button>
      }
      onSubmit={async () => {
        setAttempted(true)
        if (hasErrors(errors)) throw new ValidationError()
        await saveOptions(snap, { webauthn: webauthnValue(form) }, '修改 WebAuthn 设置')
      }}
    >
      <FormField label="名称（依赖方）" name="rp" required error={attempted ? errors.rp : undefined}>
        <FieldInput value={form.rp} onChange={(e) => set({ rp: e.target.value })} placeholder={window.location.hostname} autoComplete="off" spellCheck={false} />
      </FormField>
      <FormField label="来源（Origin）" name="origin" hint={`锁定访问地址，例如 ${window.location.origin}；留空不限制。`} error={attempted ? errors.origin : undefined}>
        <FieldInput value={form.origin} onChange={(e) => set({ origin: e.target.value })} placeholder="不限制" inputMode="url" autoComplete="off" spellCheck={false} />
      </FormField>
      <FormField label="ID（域名）" name="id" required error={attempted ? errors.id : undefined}>
        <FieldInput value={form.id} onChange={(e) => set({ id: e.target.value })} placeholder={window.location.hostname} autoComplete="off" spellCheck={false} />
      </FormField>
      {idChanged && <Warning>更改 ID 会使已经注册的 WebAuthn 两步验证全部失效。</Warning>}
      <SwitchField label="允许子域名" description="也接受 ID 的子域名发起的请求。" checked={form.allowSubdomains} onCheckedChange={(allowSubdomains) => set({ allowSubdomains })} />
    </FormDialog>
  )
}

// ------------------------------------------------------------ text areas

export function ConsentTextDialog({ open, onOpenChange, options }: OptionDialogProps) {
  const snap = useSnapshot(open, options)
  const [text, setText] = useFormState(open, () => decodeBase64Utf8(typeof snap?.['consent-text'] === 'string' ? snap['consent-text'] : undefined))
  const encoded = text.trim() ? encodeBase64Utf8(text) : undefined
  const tooLong = (encoded?.length ?? 0) > CONSENT_MAX
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="登录同意书"
      description="登录前显示、需要用户确认的文本（支持 Markdown）。留空则不显示。"
      size="lg"
      onSubmit={async () => {
        if (tooLong) throw new ValidationError('文本太长')
        await saveOptions(snap, { 'consent-text': encoded }, '修改登录同意书')
      }}
    >
      <FormField label="同意书文本" name="consent-text" error={tooLong ? '超过 64 KiB（编码后）' : undefined}>
        <FieldTextarea value={text} onChange={(e) => setText(e.target.value)} rows={10} className="min-h-48 font-mono text-[13px]" placeholder="例如：仅限授权人员使用，所有操作均被记录。" />
      </FormField>
    </FormDialog>
  )
}

export function DescriptionDialog({ open, onOpenChange, options }: OptionDialogProps) {
  const snap = useSnapshot(open, options)
  const [text, setText] = useFormState(open, () => (typeof snap?.description === 'string' ? snap.description : ''))
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="数据中心备注"
      description="显示在数据中心概要的备注（Markdown）。"
      size="lg"
      onSubmit={() => saveOptions(snap, { description: text.trim() ? text : undefined }, '修改数据中心备注')}
    >
      <FormField label="备注" name="description">
        <FieldTextarea value={text} onChange={(e) => setText(e.target.value)} rows={10} className="min-h-48 font-mono text-[13px]" />
      </FormField>
    </FormDialog>
  )
}

// ------------------------------------------------------------ location

export function LocationDialog({ open, onOpenChange, options }: OptionDialogProps) {
  const snap = useSnapshot(open, options)
  const [form, setForm] = useFormState<LocationForm>(open, () => parseLocationForm(snap?.location))
  const [attempted, setAttempted] = useFormState(open, () => false)
  const errors = validateLocationForm(form)
  const set = (patch: Partial<LocationForm>) => setForm((f) => ({ ...f, ...patch }))
  const map =
    form.latitude !== undefined && form.longitude !== undefined && !errors.latitude && !errors.longitude
      ? `https://www.openstreetmap.org/?mlat=${form.latitude}&mlon=${form.longitude}#map=12/${form.latitude}/${form.longitude}`
      : null
  const empty = !form.name.trim() && form.latitude === undefined && form.longitude === undefined
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="位置"
      description="集群的地理位置。节点可以在自己的选项里单独设置。"
      footerExtra={
        !empty && (
          <Button type="button" variant="ghost" onClick={() => setForm({ name: '', latitude: undefined, longitude: undefined })}>
            清空
          </Button>
        )
      }
      onSubmit={async () => {
        setAttempted(true)
        if (hasErrors(errors)) throw new ValidationError()
        await saveOptions(snap, { location: locationValue(form) }, '修改位置')
      }}
    >
      <FormField label="名称" name="name" hint="可选，例如机房或城市。" error={attempted ? errors.name : undefined}>
        <FieldInput value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="可选" />
      </FormField>
      <FormRow>
        <FormField label="纬度" name="latitude" error={attempted ? errors.latitude : undefined}>
          <NumberInput value={form.latitude} onChange={(latitude) => set({ latitude })} decimal min={-90} max={90} unit="°" placeholder="31.2304" />
        </FormField>
        <FormField label="经度" name="longitude" error={attempted ? errors.longitude : undefined}>
          <NumberInput value={form.longitude} onChange={(longitude) => set({ longitude })} decimal min={-180} max={180} unit="°" placeholder="121.4737" />
        </FormField>
      </FormRow>
      {map && (
        <a href={map} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-brand-strong hover:underline">
          <ExternalLink className="size-3.5" aria-hidden /> 在 OpenStreetMap 上查看
        </a>
      )}
    </FormDialog>
  )
}
