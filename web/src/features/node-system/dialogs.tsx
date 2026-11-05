// Editors of the node system tab. Each dialog freezes the data it opened with
// (useOpenSnapshot) and diffs against it, so a change saved elsewhere in the
// meantime is rejected by PVE (digest) instead of silently undone.

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { ExternalLink, Search, TriangleAlert } from 'lucide-react'

import {
  setNodeTimezone,
  systemKeys,
  updateNodeDns,
  updateNodeOptions,
  useNodeInterfaces,
  writeNodeHosts,
  type NodeDns,
  type NodeHosts,
  type NodeOptionsConfig,
} from '@/api/node-system'
import {
  CheckboxField,
  FieldCodeTextarea,
  FieldInput,
  FormDialog,
  FormField,
  FormRow,
  NumberInput,
  SelectField,
  type SelectOption,
} from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useOpenSnapshot } from '@/hooks/useOpenSnapshot'
import { propNumber } from '@/lib/propstring'

import {
  BALLOON_TARGET_DEFAULT,
  START_DELAY_MAX,
  checkHosts,
  dnsParams,
  dnsToForm,
  locationMapUrl,
  locationValue,
  normalizeHostsText,
  optionsParams,
  parseLocation,
  parseWakeOnLan,
  searchTimezones,
  validateDnsForm,
  validateLocation,
  validateWol,
  wakeOnLanValue,
  zoneOffset,
  type LocationForm,
  type WolForm,
} from './model'
import { TimezoneList } from './TimezoneList'

interface DialogProps {
  node: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Form state re-initialised from `init` each time the dialog opens. */
function useFormState<T>(open: boolean, init: () => T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(init)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setState(init())
  }
  return [state, setState]
}

class ValidationError extends Error {
  constructor(message = '请先修正标出的问题') {
    super(message)
    this.name = 'ValidationError'
  }
}

const hasErrors = (e: object) => Object.values(e).some(Boolean)

// -------------------------------------------------------------------- DNS

export function DnsDialog({ node, open, onOpenChange, dns }: DialogProps & { dns: NodeDns | undefined }) {
  const snap = useOpenSnapshot(open, dns)
  const [form, setForm] = useFormState(open, () => dnsToForm(snap))
  const [attempted, setAttempted] = useFormState(open, () => false)
  const errors = validateDnsForm(form)
  const noServers = form.servers.every((s) => !s.trim())
  const setServer = (i: number, v: string) =>
    setForm((f) => ({ ...f, servers: f.servers.map((s, j) => (j === i ? v : s)) as typeof f.servers }))

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="DNS"
      description="写入节点的 /etc/resolv.conf，保存后立即生效。"
      onSubmit={async () => {
        setAttempted(true)
        if (hasErrors(errors)) throw new ValidationError()
        const params = dnsParams(snap, form)
        if (!params) return
        await runTask(updateNodeDns(node, params), {
          title: '修改 DNS 设置',
          invalidate: [systemKeys.dns(node)],
          syncSuccessMessage: 'DNS 设置已保存',
        })
      }}
    >
      <FormField label="搜索域" name="search" required error={attempted ? errors.search : undefined} hint="解析不带域名的主机名时追加的域名。">
        <FieldInput
          value={form.search}
          onChange={(e) => setForm((f) => ({ ...f, search: e.target.value }))}
          placeholder="例如 lan"
          autoCapitalize="off"
          spellCheck={false}
        />
      </FormField>
      {form.servers.map((value, i) => {
        const key = `dns${i + 1}` as 'dns1'
        return (
          <FormField key={key} label={`DNS 服务器 ${i + 1}`} name={key} error={attempted ? errors[key] : undefined}>
            <FieldInput
              value={value}
              onChange={(e) => setServer(i, e.target.value)}
              placeholder={i === 0 ? '例如 192.168.1.1' : '不设置'}
              inputMode="text"
              autoCapitalize="off"
              spellCheck={false}
              className="tabular"
            />
          </FormField>
        )
      })}
      {noServers && (
        <p role="note" className="flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2.5 text-sm text-warning-strong">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          没有 DNS 服务器时，节点无法解析域名（软件更新、ACME 等会失败）。
        </p>
      )}
    </FormDialog>
  )
}

// ------------------------------------------------------------------ hosts

export function HostsDialog({ node, open, onOpenChange, hosts }: DialogProps & { hosts: NodeHosts | undefined }) {
  const snap = useOpenSnapshot(open, hosts)
  const initial = snap?.data ?? ''
  const [text, setText] = useFormState(open, () => initial)
  const [ack, setAck] = useFormState(open, () => false)
  const check = useMemo(() => checkHosts(text, node), [text, node])
  const changed = text !== initial

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="编辑 /etc/hosts"
      description={`节点 ${node} 的主机名解析表，保存后立即生效。`}
      size="lg"
      submitDisabled={!changed || (check.missingNode && !ack)}
      onSubmit={() =>
        runTask(writeNodeHosts(node, normalizeHostsText(text), snap?.digest), {
          title: '保存 /etc/hosts',
          invalidate: [systemKeys.hosts(node)],
          syncSuccessMessage: '/etc/hosts 已保存',
        })
      }
    >
      <FormField label="文件内容" name="data">
        <FieldCodeTextarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={16}
          className="min-h-72"
        />
      </FormField>
      {check.invalidLines.length > 0 && (
        <p role="note" className="flex items-start gap-2 text-xs text-warning-strong">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          第 {check.invalidLines.slice(0, 8).join('、')}
          {check.invalidLines.length > 8 ? ' 等' : ''} 行不是“IP 地址 主机名…”格式，系统会忽略这些行。
        </p>
      )}
      {check.missingNode && (
        <div role="alert" className="grid gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5">
          <p className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            没有指向本节点 {node} 的条目。集群通信和 Web 服务依赖它，删掉后节点可能脱离集群。
          </p>
          <CheckboxField label="我了解风险，仍然保存" checked={ack} onCheckedChange={setAck} />
        </div>
      )}
    </FormDialog>
  )
}

// ------------------------------------------------------------------- time

export function TimezoneDialog({ node, open, onOpenChange, timezone }: DialogProps & { timezone: string | undefined }) {
  const initial = useOpenSnapshot(open, timezone)
  const [value, setValue] = useFormState(open, () => initial ?? '')
  const [query, setQuery] = useFormState(open, () => '')
  const zones = useMemo(() => searchTimezones(query), [query])
  const selectedOffset = useMemo(() => open && value ? zoneOffset(value, new Date()) : null, [open, value])

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="时区"
      description="修改节点的系统时区（/etc/localtime），立即生效。"
      submitDisabled={!value || value === initial}
      onSubmit={() =>
        runTask(setNodeTimezone(node, value), {
          title: `设置时区为 ${value}`,
          invalidate: [systemKeys.time(node)],
          syncSuccessMessage: `时区已设为 ${value}`,
        })
      }
    >
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium">已选</span>
          <span className="min-w-0 truncate text-muted-foreground tabular">
            {value || '—'}
            {selectedOffset ? ` · ${selectedOffset}` : ''}
          </span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索城市或时区，如 上海、Tokyo"
            aria-label="搜索时区"
            autoCapitalize="off"
            spellCheck={false}
            className="pl-9"
          />
        </div>
        <TimezoneList zones={zones} value={value} onValueChange={setValue} />
      </div>
    </FormDialog>
  )
}

// ---------------------------------------------------------- node options

interface OptionDialogProps extends DialogProps {
  config: NodeOptionsConfig | undefined
}

function saveOptions(node: string, params: NonNullable<ReturnType<typeof optionsParams>>, title: string) {
  return runTask(updateNodeOptions(node, params), {
    title,
    invalidate: [systemKeys.config(node)],
    syncSuccessMessage: `${title}：已保存`,
  })
}

export function NumberOptionDialog({
  node,
  open,
  onOpenChange,
  config,
  option,
}: OptionDialogProps & { option: 'startall-onboot-delay' | 'ballooning-target' }) {
  const snap = useOpenSnapshot(open, config)
  const [value, setValue] = useFormState<number | undefined>(open, () => propNumber(snap?.[option]))
  const meta =
    option === 'startall-onboot-delay'
      ? {
          title: '开机启动延迟',
          label: '延迟',
          unit: '秒',
          max: START_DELAY_MAX,
          placeholder: '0',
          hint: `节点开机后，等待这么久再启动设置了“开机自启”的客户机（0–${START_DELAY_MAX} 秒）。留空使用默认值 0。`,
        }
      : {
          title: 'Ballooning 目标',
          label: '内存使用目标',
          unit: '%',
          max: 100,
          placeholder: String(BALLOON_TARGET_DEFAULT),
          hint: `节点内存使用率超过这个比例时，开始回收启用了 Ballooning 的虚拟机内存（0–100%）。留空使用默认值 ${BALLOON_TARGET_DEFAULT}%。`,
        }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={meta.title}
      onSubmit={async () => {
        const params = optionsParams(snap, { [option]: value })
        if (params) await saveOptions(node, params, `修改${meta.title}`)
      }}
    >
      <FormField label={meta.label} name={option} hint={meta.hint}>
        <NumberInput value={value} onChange={setValue} min={0} max={meta.max} unit={meta.unit} placeholder={meta.placeholder} stepper />
      </FormField>
    </FormDialog>
  )
}

export function WakeOnLanDialog({ node, open, onOpenChange, config }: OptionDialogProps) {
  const snap = useOpenSnapshot(open, config)
  const [form, setForm] = useFormState<WolForm>(open, () => parseWakeOnLan(snap?.wakeonlan))
  const [attempted, setAttempted] = useFormState(open, () => false)
  const errors = validateWol(form)
  const ifaces = useNodeInterfaces(node, { enabled: open })
  const options = useMemo<SelectOption[]>(() => {
    const list = (ifaces.data ?? [])
      .filter((i) => !['alias', 'unknown', 'vnet', 'fabric'].includes(i.type))
      .map((i) => ({ value: i.iface, label: i.iface, description: i.type }))
    if (form.bindInterface && !list.some((o) => o.value === form.bindInterface)) {
      list.unshift({ value: form.bindInterface, label: form.bindInterface, description: '当前' })
    }
    return list
  }, [ifaces.data, form.bindInterface])
  const set = (patch: Partial<WolForm>) => setForm((f) => ({ ...f, ...patch }))

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Wake-on-LAN"
      description="其他节点可以向这个 MAC 地址发送网络唤醒包来开机。"
      onSubmit={async () => {
        setAttempted(true)
        if (hasErrors(errors)) throw new ValidationError()
        const params = optionsParams(snap, { wakeonlan: wakeOnLanValue(snap?.wakeonlan, form) })
        if (params) await saveOptions(node, params, '修改 Wake-on-LAN')
      }}
    >
      <FormField label="MAC 地址" name="wakeonlan" error={attempted ? errors.mac : undefined} hint="网卡的物理地址，留空表示不设置。">
        <FieldInput
          value={form.mac}
          onChange={(e) => set({ mac: e.target.value })}
          placeholder="01:23:45:67:89:ab"
          autoCapitalize="off"
          spellCheck={false}
          className="font-mono"
        />
      </FormField>
      <FormRow>
        <FormField label="发送接口" error={attempted ? errors.bindInterface : undefined}>
          <SelectField
            value={form.bindInterface}
            onValueChange={(v) => set({ bindInterface: v ?? '' })}
            options={options}
            emptyOption="自动"
            loading={ifaces.isPending}
            disabled={!form.mac.trim()}
          />
        </FormField>
        <FormField label="广播地址" error={attempted ? errors.broadcast : undefined}>
          <FieldInput
            value={form.broadcast}
            onChange={(e) => set({ broadcast: e.target.value })}
            placeholder="255.255.255.255"
            disabled={!form.mac.trim()}
            autoCapitalize="off"
            spellCheck={false}
            className="tabular"
          />
        </FormField>
      </FormRow>
    </FormDialog>
  )
}

export function LocationDialog({ node, open, onOpenChange, config }: OptionDialogProps) {
  const snap = useOpenSnapshot(open, config)
  const [form, setForm] = useFormState<LocationForm>(open, () => parseLocation(snap?.location))
  const [attempted, setAttempted] = useFormState(open, () => false)
  const errors = validateLocation(form)
  const set = (patch: Partial<LocationForm>) => setForm((f) => ({ ...f, ...patch }))
  const map = errors.latitude || errors.longitude ? null : locationMapUrl(form)
  const empty = !form.name.trim() && form.latitude === undefined && form.longitude === undefined

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="位置"
      description="节点的地理位置，覆盖数据中心选项里的位置。全部留空则使用数据中心设置。"
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
        const params = optionsParams(snap, { location: locationValue(snap?.location, form) })
        if (params) await saveOptions(node, params, '修改节点位置')
      }}
    >
      <FormField label="名称" name="location" error={attempted ? errors.name : undefined} hint="可选，例如机房或城市（仅限英文字符）。">
        <FieldInput value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="可选" />
      </FormField>
      <FormRow>
        <FormField label="纬度" error={attempted ? errors.latitude : undefined}>
          <NumberInput value={form.latitude} onChange={(v) => set({ latitude: v })} decimal min={-90} max={90} unit="°" placeholder="31.2304" />
        </FormField>
        <FormField label="经度" error={attempted ? errors.longitude : undefined}>
          <NumberInput value={form.longitude} onChange={(v) => set({ longitude: v })} decimal min={-180} max={180} unit="°" placeholder="121.4737" />
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
