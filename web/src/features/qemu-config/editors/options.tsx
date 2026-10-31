// Editors of the VM options tab.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowDown, ArrowUp, Cloud, Disc3, GripVertical, HardDrive, Microchip, Network, Usb, Wand2 } from 'lucide-react'

import {
  CheckboxField,
  FieldInput,
  FormDialog,
  FormField,
  FormRow,
  FormSection,
  NumberInput,
  SelectField,
  StorageSelect,
  SwitchField,
} from '@/components/form'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { tryParsePropertyString } from '@/lib/propstring'
import { cn } from '@/lib/utils'

import { HOTPLUG_FEATURES, KEYMAPS, OS_TYPES } from '../constants'
import { useQemuConfig, useSaveConfig, type DialogRenderProps } from '../context'
import { hasSpiceDisplay } from '../options-model'
import {
  agentFormFrom,
  agentValue,
  bootDevices,
  bootValue,
  hotplugValue,
  parseHotplug,
  parseSmbios,
  sevFormFrom,
  sevValue,
  smbiosValue,
  spiceValue,
  startupValue,
  tdxFormFrom,
  tdxValue,
  updateParams,
  type AgentForm,
  type BootDevice,
  type SevForm,
  type SmbiosForm,
  type StartupForm,
  type TdxForm,
} from '../params'
import { SearchSelect, VolumeSelect } from '../pickers'
import { Hint, Segmented } from '../ui'

const DNS_NAME = /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/

export function NameDialog(props: DialogRenderProps) {
  const { cfg, digest, guest } = useQemuConfig()
  const save = useSaveConfig()
  const [name, setName] = useState(cfg.name ?? '')
  const invalid = name.trim() !== '' && !DNS_NAME.test(name.trim())
  const params = updateParams(cfg, { name: name.trim() }, digest)
  return (
    <FormDialog {...props} size="sm" title="名称" submitDisabled={!params || invalid} onSubmit={() => save(params, { title: '修改名称' })}>
      <FormField label="名称" name="name" hint="只能包含字母、数字、连字符和点（DNS 名称）" error={invalid ? '名称格式不正确' : undefined}>
        <FieldInput value={name} onChange={(e) => setName(e.target.value)} placeholder={`VM ${guest.vmid}`} autoFocus autoCapitalize="off" spellCheck={false} />
      </FormField>
    </FormDialog>
  )
}

export function StartupDialog(props: DialogRenderProps) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const s = tryParsePropertyString(cfg.startup, 'order')
  const [f, setF] = useState<StartupForm>({
    order: s.order ? Number(s.order) : undefined,
    up: s.up ? Number(s.up) : undefined,
    down: s.down ? Number(s.down) : undefined,
  })
  const params = updateParams(cfg, { startup: startupValue(f) }, digest)
  return (
    <FormDialog
      {...props}
      title="启动/关机顺序"
      description="节点开机时按顺序启动“开机自启”的客户机，关机时按相反顺序关闭。"
      submitDisabled={!params}
      onSubmit={() => save(params, { title: '修改启动顺序' })}
    >
      <FormField label="启动顺序" name="startup" hint="数字越小越先启动；留空表示任意顺序（最后启动）。">
        <NumberInput value={f.order} onChange={(order) => setF({ ...f, order })} min={0} placeholder="任意" stepper />
      </FormField>
      <FormRow>
        <FormField label="启动延迟" hint="启动后等待多久再启动下一台">
          <NumberInput value={f.up} onChange={(up) => setF({ ...f, up })} min={0} unit="秒" placeholder="默认" />
        </FormField>
        <FormField label="关机超时" hint="等待关机的最长时间">
          <NumberInput value={f.down} onChange={(down) => setF({ ...f, down })} min={0} unit="秒" placeholder="默认" />
        </FormField>
      </FormRow>
    </FormDialog>
  )
}

export function OsTypeDialog(props: DialogRenderProps) {
  const { cfg, digest, arch } = useQemuConfig()
  const save = useSaveConfig()
  const [ostype, setOstype] = useState(cfg.ostype ?? 'other')
  const params = updateParams(cfg, { ostype }, digest)
  const groups = arch === 'aarch64' ? OS_TYPES.filter((g) => g.group === 'Linux' || g.group === '其他') : OS_TYPES
  return (
    <FormDialog {...props} title="操作系统类型" description="PVE 会按操作系统类型优化一些设置（如时钟、Hyper-V 增强）。" submitDisabled={!params} onSubmit={() => save(params, { title: '修改操作系统类型' })}>
      <FormField label="类型" name="ostype">
        <SearchSelect
          value={ostype}
          onValueChange={(v) => v && setOstype(v)}
          options={groups.flatMap((g) =>
            g.items.filter((i) => arch !== 'aarch64' || i.value === 'l26' || i.value === 'other').map((i) => ({ value: i.value, label: i.label, group: g.group, description: i.value })),
          )}
          searchPlaceholder="搜索操作系统…"
        />
      </FormField>
    </FormDialog>
  )
}

// ------------------------------------------------------------ boot order

function deviceIcon(d: BootDevice) {
  if (/^net/.test(d.key)) return Network
  if (/^usb/.test(d.key)) return Usb
  if (/^hostpci/.test(d.key)) return Microchip
  if (/media=cdrom/.test(d.value)) return Disc3
  if (/cloudinit/.test(d.value)) return Cloud
  return HardDrive
}

export function BootOrderDialog(props: DialogRenderProps) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const [devices, setDevices] = useState<BootDevice[]>(() => bootDevices(cfg))
  const params = updateParams(cfg, { boot: bootValue(devices) }, digest)
  const enabledCount = devices.filter((d) => d.enabled).length
  const rngHint = cfg.bios === 'ovmf' && !cfg.rng0 && devices.some((d) => d.enabled && d.key.startsWith('net'))
  const listRef = useRef<HTMLOListElement>(null)
  const drag = useRef<{ index: number; startY: number; rowH: number } | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)

  const move = (from: number, to: number) => {
    if (to < 0 || to >= devices.length || from === to) return
    setDevices((list) => {
      const next = [...list]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item!)
      return next
    })
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    const row = (e.currentTarget.closest('li') as HTMLElement | null)?.getBoundingClientRect()
    drag.current = { index, startY: e.clientY, rowH: row?.height ?? 56 }
    setDragging(index)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    const steps = Math.round((e.clientY - d.startY) / d.rowH)
    const target = Math.max(0, Math.min(devices.length - 1, d.index + steps))
    if (target !== d.index) {
      move(d.index, target)
      d.startY += (target - d.index) * d.rowH
      d.index = target
      setDragging(target)
    }
  }
  const endDrag = () => {
    drag.current = null
    setDragging(null)
  }

  return (
    <FormDialog
      {...props}
      size="lg"
      title="启动顺序"
      description="拖动左侧手柄或用箭头调整顺序，勾选的设备才会参与启动。"
      submitDisabled={!params}
      onSubmit={() => save(params, { title: '修改启动顺序' })}
    >
      {devices.length === 0 ? (
        <Hint>这台虚拟机没有可启动的设备。</Hint>
      ) : (
        <ol ref={listRef} className="grid min-w-0 grid-cols-1 gap-1.5" aria-label="启动设备">
          {devices.map((d, i) => {
            const Icon = deviceIcon(d)
            return (
              <li
                key={d.key}
                className={cn(
                  'flex min-h-14 min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-(--field) py-1.5 pr-1.5 pl-1 transition-shadow',
                  dragging === i && 'relative z-10 border-brand/50 shadow-lg ring-2 ring-brand/30',
                  !d.enabled && 'opacity-70',
                )}
              >
                <button
                  type="button"
                  aria-label={`拖动 ${d.key}`}
                  className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-faint hover:text-foreground active:cursor-grabbing pointer-coarse:size-11"
                  onPointerDown={(e) => onPointerDown(e, i)}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  <GripVertical className="size-4" />
                </button>
                <span className={cn('w-5 shrink-0 text-center text-xs tabular', d.enabled ? 'font-medium text-brand' : 'text-faint')}>
                  {d.enabled ? devices.slice(0, i + 1).filter((x) => x.enabled).length : '–'}
                </span>
                <Checkbox
                  checked={d.enabled}
                  onCheckedChange={(c) => setDevices((list) => list.map((x, j) => (j === i ? { ...x, enabled: c === true } : x)))}
                  aria-label={`${d.key} 参与启动`}
                />
                <Icon className="ml-1 hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{d.key}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{d.value.split(',')[0]}</div>
                </div>
                <div className="flex shrink-0">
                  <Button type="button" variant="ghost" size="icon" aria-label={`${d.key} 上移`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={`${d.key} 下移`} disabled={i === devices.length - 1} onClick={() => move(i, i + 1)}>
                    <ArrowDown />
                  </Button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {enabledCount === 0 && devices.length > 0 && <Hint tone="warning">没有选择任何启动设备，虚拟机可能无法启动。</Hint>}
      {rngHint && <Hint tone="warning">OVMF 下通过网络 (PXE) 启动需要添加 VirtIO RNG 设备。</Hint>}
    </FormDialog>
  )
}

// --------------------------------------------------------------- others

export function HotplugDialog(props: DialogRenderProps) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const [features, setFeatures] = useState<string[]>(() => parseHotplug(cfg.hotplug))
  const params = updateParams(cfg, { hotplug: hotplugValue(features) }, digest)
  const toggle = (f: string, on: boolean) => setFeatures((list) => (on ? [...list, f] : list.filter((x) => x !== f)))
  return (
    <FormDialog {...props} size="sm" title="热插拔" submitDisabled={!params} onSubmit={() => save(params, { title: '修改热插拔' })}>
      <div className="grid gap-1">
        {HOTPLUG_FEATURES.map((f) => (
          <CheckboxField key={f.value} label={f.label} checked={features.includes(f.value)} onCheckedChange={(on) => toggle(f.value, on)} />
        ))}
      </div>
      {(features.includes('memory') || features.includes('cpu')) && (
        <Hint>内存和 CPU 热插拔需要启用 NUMA，且客户机系统要支持（Linux 需要 udev 规则）。</Hint>
      )}
    </FormDialog>
  )
}

export function LocaltimeDialog(props: DialogRenderProps) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const [value, setValue] = useState<string | undefined>(cfg.localtime)
  const params = updateParams(cfg, { localtime: value ?? '' }, digest)
  return (
    <FormDialog {...props} size="sm" title="RTC 使用本地时间" submitDisabled={!params} onSubmit={() => save(params, { title: '修改 RTC 本地时间' })}>
      <FormField label="实时时钟" name="localtime">
        <SelectField
          value={value}
          onValueChange={setValue}
          emptyOption="默认（Windows 启用）"
          options={[
            { value: '1', label: '是（本地时间）' },
            { value: '0', label: '否（UTC）' },
          ]}
        />
      </FormField>
    </FormDialog>
  )
}

export function StartDateDialog(props: DialogRenderProps) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const [value, setValue] = useState(cfg.startdate ?? '')
  const v = value.trim()
  const invalid = v !== '' && !/^(now|\d{4}-\d{1,2}-\d{1,2}(T\d{1,2}:\d{1,2}:\d{1,2})?)$/.test(v)
  const params = updateParams(cfg, { startdate: v === 'now' ? '' : v }, digest)
  return (
    <FormDialog {...props} size="sm" title="RTC 起始日期" submitDisabled={!params || invalid} onSubmit={() => save(params, { title: '修改 RTC 起始日期' })}>
      <FormField label="起始日期" name="startdate" hint="now，或 2006-06-17、2006-06-17T16:01:21" error={invalid ? '格式不正确' : undefined}>
        <FieldInput value={value} onChange={(e) => setValue(e.target.value)} placeholder="now" className="font-mono" spellCheck={false} />
      </FormField>
    </FormDialog>
  )
}

export function KeyboardDialog(props: DialogRenderProps) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const [value, setValue] = useState<string | undefined>(cfg.keyboard)
  const params = updateParams(cfg, { keyboard: value ?? '' }, digest)
  return (
    <FormDialog {...props} size="sm" title="VNC 键盘布局" description="通常不需要设置：noVNC 会自动处理键盘布局。" submitDisabled={!params} onSubmit={() => save(params, { title: '修改键盘布局' })}>
      <FormField label="布局" name="keyboard">
        <SearchSelect
          value={value}
          onValueChange={setValue}
          emptyOption="默认"
          options={Object.entries(KEYMAPS).map(([k, label]) => ({ value: k, label, description: k }))}
        />
      </FormField>
    </FormDialog>
  )
}

const UUID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function SmbiosDialog(props: DialogRenderProps) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const parsed = parseSmbios(cfg.smbios1)
  const [f, setF] = useState<SmbiosForm>({
    uuid: parsed.uuid,
    manufacturer: parsed.manufacturer,
    product: parsed.product,
    version: parsed.version,
    serial: parsed.serial,
    sku: parsed.sku,
    family: parsed.family,
  })
  const set = (patch: Partial<SmbiosForm>) => setF((v) => ({ ...v, ...patch }))
  const uuidInvalid = f.uuid.trim() !== '' && !UUID_RE.test(f.uuid.trim())
  const params = updateParams(cfg, { smbios1: smbiosValue(f, parsed.rest) }, digest)
  const fields: [keyof SmbiosForm, string][] = [
    ['manufacturer', '制造商'],
    ['product', '产品'],
    ['version', '版本'],
    ['serial', '序列号'],
    ['sku', 'SKU'],
    ['family', '系列'],
  ]
  return (
    <FormDialog
      {...props}
      size="lg"
      title="SMBIOS 设置 (type1)"
      description="客户机看到的系统信息。除 UUID 外的值会以 base64 保存，可以包含任意字符。"
      submitDisabled={!params || uuidInvalid}
      onSubmit={() => save(params, { title: '修改 SMBIOS' })}
    >
      <FormField label="UUID" name="smbios1" error={uuidInvalid ? 'UUID 格式不正确' : undefined}>
        <div className="flex gap-2">
          <FieldInput value={f.uuid} onChange={(e) => set({ uuid: e.target.value })} className="font-mono" spellCheck={false} />
          <Button type="button" variant="outline" onClick={() => set({ uuid: crypto.randomUUID() })} aria-label="生成新的 UUID">
            <Wand2 />
            <span className="hidden sm:inline">生成</span>
          </Button>
        </div>
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(([k, label]) => (
          <FormField key={k} label={label}>
            <FieldInput value={f[k]} onChange={(e) => set({ [k]: e.target.value })} />
          </FormField>
        ))}
      </div>
    </FormDialog>
  )
}

export function AgentDialog(props: DialogRenderProps) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const [f, setF] = useState<AgentForm>(() => agentFormFrom(cfg.agent))
  const set = (patch: Partial<AgentForm>) => setF((v) => ({ ...v, ...patch }))
  const params = updateParams(cfg, { agent: agentValue(cfg.agent, f) }, digest)
  return (
    <FormDialog {...props} title="QEMU Guest Agent" submitDisabled={!params} onSubmit={() => save(params, { title: '修改 Guest Agent' })}>
      <SwitchField label="使用 QEMU Guest Agent" description="用于获取 IP、正常关机、冻结文件系统等。" checked={f.enabled} onCheckedChange={(enabled) => set({ enabled })} />
      <SwitchField
        label="迁移/移动磁盘后运行 fstrim"
        checked={f.fstrim}
        disabled={!f.enabled}
        onCheckedChange={(fstrim) => set({ fstrim })}
      />
      <SwitchField
        label="冻结/解冻文件系统"
        description="快照、备份等操作时保持文件系统一致"
        checked={f.freezeFs}
        disabled={!f.enabled}
        onCheckedChange={(freezeFs) => set({ freezeFs })}
      />
      {f.enabled && !f.freezeFs && <Hint tone="warning">关闭冻结后，快照和备份时磁盘镜像可能不一致。</Hint>}
      {f.enabled && <Hint>请确认客户机里已经安装并运行 qemu-guest-agent。</Hint>}
      <FormSection collapsible title="高级选项" defaultOpen={!!f.type}>
        <FormField label="类型" name="type">
          <SelectField
            value={f.type}
            onValueChange={(type) => set({ type })}
            emptyOption="默认 (VirtIO)"
            options={[
              { value: 'virtio', label: 'VirtIO' },
              { value: 'isa', label: 'ISA' },
            ]}
            disabled={!f.enabled}
          />
        </FormField>
      </FormSection>
    </FormDialog>
  )
}

export function SpiceDialog(props: DialogRenderProps) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const s = tryParsePropertyString(cfg.spice_enhancements)
  const [folder, setFolder] = useState(s.foldersharing === '1')
  const [video, setVideo] = useState(s.videostreaming ?? 'off')
  const params = updateParams(cfg, { spice_enhancements: spiceValue({ foldersharing: folder, videostreaming: video }) }, digest)
  return (
    <FormDialog {...props} title="SPICE 增强" submitDisabled={!params} onSubmit={() => save(params, { title: '修改 SPICE 增强' })}>
      {!hasSpiceDisplay(cfg) && <Hint tone="warning">要使用这些功能，请先在硬件里把显示设为 SPICE。</Hint>}
      <SwitchField label="文件夹共享" description="需要客户机安装 SPICE WebDAV 守护进程" checked={folder} onCheckedChange={setFolder} />
      <FormField label="视频流" name="videostreaming">
        <Segmented
          aria-label="视频流"
          value={video}
          onValueChange={setVideo}
          options={[
            { value: 'off', label: '关闭' },
            { value: 'all', label: '全部' },
            { value: 'filter', label: '过滤' },
          ]}
        />
      </FormField>
    </FormDialog>
  )
}

export function VmStateStorageDialog(props: DialogRenderProps) {
  const { cfg, digest, node } = useQemuConfig()
  const save = useSaveConfig()
  const [value, setValue] = useState<string | undefined>(cfg.vmstatestorage)
  const params = updateParams(cfg, { vmstatestorage: value ?? '' }, digest)
  return (
    <FormDialog {...props} title="VM 状态存储" description="休眠和带内存的快照把内存状态保存在这里。" submitDisabled={!params} onSubmit={() => save(params, { title: '修改 VM 状态存储' })}>
      <FormField label="存储" name="vmstatestorage">
        <StorageSelect node={node} content="images" value={value} onValueChange={setValue} emptyOption="自动（虚拟机所在存储或 local）" />
      </FormField>
    </FormDialog>
  )
}

export function SevDialog(props: DialogRenderProps) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const [f, setF] = useState<SevForm>(() => sevFormFrom(cfg['amd-sev']))
  const set = (patch: Partial<SevForm>) => setF((v) => ({ ...v, ...patch }))
  const params = updateParams(cfg, { 'amd-sev': sevValue(f) }, digest)
  const enabled = !!f.type
  return (
    <FormDialog {...props} title="AMD SEV" description="内存加密的机密计算，需要 OVMF 和支持 SEV 的 AMD 宿主机。" submitDisabled={!params} onSubmit={() => save(params, { title: '修改 AMD SEV' })}>
      <FormField label="类型" name="amd-sev">
        <SelectField
          value={f.type}
          onValueChange={(type) => set({ type })}
          emptyOption="默认（禁用）"
          options={[
            { value: 'std', label: 'AMD SEV' },
            { value: 'es', label: 'AMD SEV-ES' },
            { value: 'snp', label: 'AMD SEV-SNP' },
          ]}
        />
      </FormField>
      {f.type === 'snp' && <Hint tone="warning">SEV-SNP 不会加载 EFI 磁盘，需要宿主机内核 6.11 或更高。</Hint>}
      {enabled && (
        <FormSection collapsible title="高级选项">
          <SwitchField label="允许调试" checked={f.debug} onCheckedChange={(debug) => set({ debug })} />
          {f.type !== 'snp' && <SwitchField label="允许密钥共享" checked={f.keySharing} onCheckedChange={(keySharing) => set({ keySharing })} />}
          {f.type === 'snp' && <SwitchField label="允许 SMT" checked={f.smt} onCheckedChange={(smt) => set({ smt })} />}
          <SwitchField label="启用内核哈希" checked={f.kernelHashes} onCheckedChange={(kernelHashes) => set({ kernelHashes })} />
        </FormSection>
      )}
    </FormDialog>
  )
}

export function TdxDialog(props: DialogRenderProps) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const [f, setF] = useState<TdxForm>(() => tdxFormFrom(cfg['intel-tdx']))
  const set = (patch: Partial<TdxForm>) => setF((v) => ({ ...v, ...patch }))
  const params = updateParams(cfg, { 'intel-tdx': tdxValue(f) }, digest)
  return (
    <FormDialog {...props} title="Intel TDX" description="Intel 可信域扩展，需要较新的 Intel CPU 和 6.16 以上的宿主机内核。" submitDisabled={!params} onSubmit={() => save(params, { title: '修改 Intel TDX' })}>
      <SwitchField label="启用 Intel TDX" checked={f.enabled} onCheckedChange={(enabled) => set({ enabled })} />
      {f.enabled && (
        <>
          <Hint tone="warning">使用 Intel TDX 时不会加载 EFI 磁盘。</Hint>
          <SwitchField label="启用远程证明" checked={f.attestation} onCheckedChange={(attestation) => set({ attestation })} />
          <FormRow>
            <FormField label="vsock CID">
              <NumberInput value={f.cid} onChange={(cid) => set({ cid })} min={2} disabled={!f.attestation} />
            </FormField>
            <FormField label="vsock 端口">
              <NumberInput value={f.port} onChange={(port) => set({ port })} min={0} disabled={!f.attestation} />
            </FormField>
          </FormRow>
        </>
      )}
    </FormDialog>
  )
}

export function HookscriptDialog(props: DialogRenderProps) {
  const { cfg, digest, node, isRoot } = useQemuConfig()
  const save = useSaveConfig()
  const [script, setScript] = useState<string | undefined>(cfg.hookscript)
  const [storage, setStorage] = useState<string | undefined>(cfg.hookscript?.split(':')[0])
  const params = updateParams(cfg, { hookscript: script ?? '' }, digest)
  return (
    <FormDialog
      {...props}
      title="钩子脚本"
      description="在虚拟机生命周期的各个阶段（启动前后、停止前后）执行的脚本，放在存储的 snippets 目录里。"
      submitDisabled={!params || !isRoot}
      onSubmit={() => save(params, { title: script ? '设置钩子脚本' : '移除钩子脚本' })}
    >
      {!isRoot && <Hint tone="warning">只有 root@pam 可以设置钩子脚本。</Hint>}
      <FormRow>
        <FormField label="存储">
          <StorageSelect node={node} content="snippets" value={storage} onValueChange={setStorage} autoSelect={!storage} disabled={!isRoot} />
        </FormField>
        <FormField label="脚本" name="hookscript">
          <VolumeSelect node={node} storage={storage} content="snippets" value={script} onValueChange={setScript} placeholder="选择脚本" />
        </FormField>
      </FormRow>
      {script && (
        <Button type="button" variant="outline" onClick={() => setScript(undefined)} disabled={!isRoot}>
          不使用钩子脚本
        </Button>
      )}
    </FormDialog>
  )
}
