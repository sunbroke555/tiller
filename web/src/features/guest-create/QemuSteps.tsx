// Steps of the VM creation wizard. Each step edits a slice of QemuForm;
// FormField `name`s are the API parameter names so PVE's field errors land
// under the right control.

import { useEffect, useMemo } from 'react'
import { AppWindow, CircleHelp, Disc, Disc3, HardDrive, Plus, Sun, Terminal, Trash2, XCircle } from 'lucide-react'

import { useClusterResources, useClusterStatus } from '@/api/queries'
import { isNode } from '@/api/types'
import { useSession } from '@/api/useSession'
import { useCpuFlags, useCpuModels, useMachineVersions, useStoragesWithFormats, type CpuModel } from '@/api/guest-create'
import {
  BridgeSelect,
  FieldInput,
  FormField,
  FormRow,
  FormSection,
  NodeSelect,
  NumberInput,
  SelectField,
  SizeInput,
  StorageSelect,
  SwitchField,
  VmidInput,
  type VmidValidity,
} from '@/components/form'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'

import { ChoiceCards, ComboboxField, PoolSelect, TagInput, TemplateShortcut, VolumeSelect, type ComboOption } from './fields'
import {
  AIO_OPTIONS,
  BUS_LABEL,
  CACHE_OPTIONS,
  DEFAULT_CPU_TYPE,
  NIC_MODEL_OPTIONS,
  OS_BASE_LABEL,
  OS_TYPES,
  SCSIHW_OPTIONS,
  VGA_OPTIONS,
  applyOsType,
  freeIndexes,
  newDisk,
  osBaseOf,
  scsihwLabel,
  setDiskBus,
  setMemory,
  setScsihw,
  setVirtioIso,
  totalDiskSlots,
  type DiskBus,
  type DiskFormat,
  type MediaType,
  type OsBase,
  type QemuDisk,
  type QemuForm,
} from './qemu'

export interface QemuStepProps {
  form: QemuForm
  set: (patch: Partial<QemuForm>) => void
  update: (fn: (f: QemuForm) => QemuForm) => void
}

// ---------------------------------------------------------------- shared

/** Node of the cluster resource list (for CPU/memory hints). */
function useNodeInfo(node: string) {
  const { data } = useClusterResources({ select: (all) => all.filter(isNode).find((n) => n.node === node) })
  return data
}

/** Show the format choice when the storage supports more than one (dir, NFS: raw/qcow2/vmdk). */
function DiskFormatField({
  node,
  storage,
  value,
  onChange,
}: {
  node: string
  storage: string
  value: DiskFormat | ''
  onChange: (v: DiskFormat | '') => void
}) {
  const { data } = useStoragesWithFormats(node || undefined, 'images')
  const entry = data?.find((s) => s.storage === storage)
  const supported = (entry?.formats?.supported ?? []).filter((f): f is DiskFormat => f === 'raw' || f === 'qcow2' || f === 'vmdk')
  const preferred: DiskFormat | '' = supported.includes('qcow2') ? 'qcow2' : supported.includes('raw') ? 'raw' : (supported[0] ?? '')

  // Like the official selector: qcow2 when the storage can do it.
  useEffect(() => {
    if (!entry) return
    if (supported.length <= 1) {
      if (value) onChange('')
    } else if (!value || !supported.includes(value)) {
      onChange(preferred)
    }
  }, [entry, storage])

  if (supported.length <= 1) return null
  return (
    <FormField label="格式">
      <SelectField
        value={value || preferred}
        onValueChange={(v) => onChange((v ?? '') as DiskFormat | '')}
        options={supported.map((f) => ({
          value: f,
          label: f === 'raw' ? 'Raw 磁盘镜像 (raw)' : f === 'qcow2' ? 'QEMU 镜像 (qcow2)' : 'VMware 镜像 (vmdk)',
        }))}
      />
    </FormField>
  )
}

function OptionalNumber(props: {
  label: string
  name?: string
  value: number | undefined
  onChange: (v: number | undefined) => void
  placeholder: string
  unit?: string
  min?: number
  max?: number
  decimal?: boolean
  hint?: string
  disabled?: boolean
}) {
  return (
    <FormField label={props.label} name={props.name} hint={props.hint} disabled={props.disabled}>
      <NumberInput
        value={props.value}
        onChange={props.onChange}
        placeholder={props.placeholder}
        unit={props.unit}
        min={props.min}
        max={props.max}
        decimal={props.decimal}
        disabled={props.disabled}
      />
    </FormField>
  )
}

// --------------------------------------------------------------- general

export function QemuGeneralStep({ form, set, onVmidValidity }: QemuStepProps & { onVmidValidity: (v: VmidValidity) => void }) {
  const { data: status } = useClusterStatus()
  const inCluster = !!status?.some((e) => e.type === 'cluster')
  return (
    <div className="grid gap-5">
      <TemplateShortcut type="qemu" />
      <FormRow>
        <FormField label="节点" name="node" required>
          <NodeSelect value={form.node} onValueChange={(node) => set({ node: node ?? '' })} preferLocal />
        </FormField>
        <FormField label="VM ID" name="vmid" required>
          <VmidInput value={form.vmid} onChange={(vmid) => set({ vmid })} onValidityChange={onVmidValidity} />
        </FormField>
      </FormRow>
      <FormField label="名称" name="name" hint="可选，例如 web-01。只能包含字母、数字、连字符和点。">
        <FieldInput value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="未命名" autoCapitalize="none" spellCheck={false} />
      </FormField>
      <FormRow>
        <FormField label="资源池" name="pool">
          <PoolSelect value={form.pool} onChange={(pool) => set({ pool })} />
        </FormField>
        <FormField label="标签" name="tags">
          <TagInput value={form.tags} onChange={(tags) => set({ tags })} />
        </FormField>
      </FormRow>
      <div className="grid gap-1">
        <SwitchField label="开机自启" description="节点启动时自动启动这台虚拟机" checked={form.onboot} onCheckedChange={(onboot) => set({ onboot })} />
        {inCluster && (
          <SwitchField
            label="加入 HA"
            description="创建后作为高可用资源由集群管理"
            checked={form.haManaged}
            onCheckedChange={(haManaged) => set({ haManaged })}
          />
        )}
      </div>
      <FormSection collapsible title="启动顺序与延时">
        <FormRow cols={3}>
          <OptionalNumber label="启动顺序" name="startup" value={form.startupOrder} onChange={(startupOrder) => set({ startupOrder })} placeholder="任意" min={0} />
          <OptionalNumber label="启动延时" value={form.startupUp} onChange={(startupUp) => set({ startupUp })} placeholder="默认" unit="秒" min={0} />
          <OptionalNumber label="关机超时" value={form.startupDown} onChange={(startupDown) => set({ startupDown })} placeholder="默认" unit="秒" min={0} />
        </FormRow>
      </FormSection>
    </div>
  )
}

// -------------------------------------------------------------------- OS

const OS_BASE_ICON: Record<OsBase, typeof Terminal> = {
  Linux: Terminal,
  'Microsoft Windows': AppWindow,
  'Solaris Kernel': Sun,
  Other: CircleHelp,
}

export function QemuOsStep({ form, set, update }: QemuStepProps) {
  const base = osBaseOf(form.ostype)
  const versions = OS_TYPES[base]
  const windows = base === 'Microsoft Windows'
  return (
    <div className="grid gap-6">
      <FormSection title="安装介质" description="安装系统用的光盘，挂在 ide2 上。">
        <ChoiceCards<MediaType>
          aria-label="安装介质"
          value={form.media}
          onChange={(media) => set({ media })}
          options={[
            { value: 'iso', label: 'ISO 镜像', description: '从存储上的 ISO 文件安装', icon: <Disc3 /> },
            { value: 'cdrom', label: '物理光驱', description: '使用主机的光驱', icon: <Disc /> },
            { value: 'none', label: '不使用介质', description: '稍后再挂载或网络启动', icon: <XCircle /> },
          ]}
        />
        {form.media === 'iso' && (
          <FormRow>
            <FormField label="存储" name="isoStorage" required>
              <StorageSelect
                node={form.node}
                content="iso"
                value={form.isoStorage}
                onValueChange={(isoStorage) => set({ isoStorage: isoStorage ?? '', iso: '' })}
              />
            </FormField>
            <FormField label="ISO 镜像" name="ide2" required>
              <VolumeSelect node={form.node} storage={form.isoStorage} content="iso" value={form.iso} onChange={(iso) => set({ iso })} placeholder="选择 ISO" />
            </FormField>
          </FormRow>
        )}
      </FormSection>

      <FormSection title="客户机操作系统" description="会按系统类型调整磁盘总线、网卡型号等默认值。">
        <ChoiceCards<OsBase>
          aria-label="系统类型"
          columns={4}
          size="sm"
          value={base}
          onChange={(b) => update((f) => applyOsType(f, OS_TYPES[b][0]!.value))}
          options={(Object.keys(OS_TYPES) as OsBase[]).map((b) => {
            const Icon = OS_BASE_ICON[b]
            return { value: b, label: OS_BASE_LABEL[b], icon: <Icon /> }
          })}
        />
        {versions.length > 1 && (
          <FormField label="版本" name="ostype">
            <SelectField
              value={form.ostype}
              onValueChange={(v) => v && update((f) => applyOsType(f, v))}
              options={versions.map((v) => ({ value: v.value, label: v.label, description: v.value }))}
            />
          </FormField>
        )}
        {windows && (
          <div className="grid gap-4 rounded-xl border border-border px-3.5 py-1.5">
            <SwitchField
              label="添加 VirtIO 驱动光驱"
              description="再挂一个光驱 (ide0) 放 virtio-win 驱动，磁盘改用 SCSI、网卡改用 VirtIO"
              checked={form.virtioIso}
              onCheckedChange={(on) => update((f) => setVirtioIso(f, on))}
            />
            {form.virtioIso && (
              <FormRow className="pb-3">
                <FormField label="存储">
                  <StorageSelect
                    node={form.node}
                    content="iso"
                    value={form.virtioIsoStorage}
                    onValueChange={(s) => set({ virtioIsoStorage: s ?? '', virtioIsoVolume: '' })}
                  />
                </FormField>
                <FormField label="驱动 ISO" name="ide0" required>
                  <VolumeSelect
                    node={form.node}
                    storage={form.virtioIsoStorage}
                    content="iso"
                    value={form.virtioIsoVolume}
                    onChange={(virtioIsoVolume) => set({ virtioIsoVolume })}
                    placeholder="选择 virtio-win ISO"
                  />
                </FormField>
              </FormRow>
            )}
          </div>
        )}
      </FormSection>
    </div>
  )
}

// ---------------------------------------------------------------- system

export function QemuSystemStep({ form, set, update }: QemuStepProps) {
  const { data: machines, isPending: machinesLoading } = useMachineVersions(form.node || undefined)
  const machineType = form.machine === 'q35' ? 'q35' : 'i440fx'
  const versionOptions = (machines ?? [])
    .filter((m) => m.type === machineType)
    .map((m) => ({ value: m.id, label: m.version, description: m.changes ? '有兼容性变更' : undefined }))
  return (
    <div className="grid gap-6">
      <FormRow>
        <FormField label="显卡" name="vga">
          <SelectField value={form.vga} onValueChange={(v) => set({ vga: v ?? '' })} options={VGA_OPTIONS} emptyOption="默认" />
        </FormField>
        <FormField label="机器类型" name="machine">
          <SelectField
            value={form.machine}
            onValueChange={(v) => set({ machine: (v ?? '') as QemuForm['machine'], machineVersion: '' })}
            options={[{ value: 'q35', label: 'q35', description: 'PCIe，新系统推荐' }]}
            emptyOption="默认 (i440fx)"
          />
        </FormField>
      </FormRow>

      <FormSection title="固件">
        <FormField label="BIOS" name="bios">
          <SelectField
            value={form.bios}
            onValueChange={(v) => set({ bios: (v ?? '') as QemuForm['bios'] })}
            options={[
              { value: 'seabios', label: 'SeaBIOS', description: '传统 BIOS' },
              { value: 'ovmf', label: 'OVMF (UEFI)', description: 'UEFI / 安全启动' },
            ]}
            emptyOption="默认 (SeaBIOS)"
          />
        </FormField>
        {form.bios === 'ovmf' && (
          <div className="grid gap-4 rounded-xl border border-border px-3.5 py-1.5">
            <SwitchField
              label="添加 EFI 磁盘"
              description="保存 UEFI 变量（启动项、安全启动密钥）。不添加时每次启动都会重置。"
              checked={form.efiDisk}
              onCheckedChange={(efiDisk) => set({ efiDisk })}
            />
            {form.efiDisk && (
              <div className="grid gap-4 pb-3">
                <FormRow>
                  <FormField label="EFI 存储" name="efidisk0" required>
                    <StorageSelect node={form.node} content="images" value={form.efiStorage} onValueChange={(s) => set({ efiStorage: s ?? '' })} />
                  </FormField>
                  <DiskFormatField node={form.node} storage={form.efiStorage} value={form.efiFormat} onChange={(efiFormat) => set({ efiFormat })} />
                </FormRow>
                <SwitchField
                  label="预注册密钥"
                  description="使用带发行版和 Microsoft 安全启动密钥的 EFI 变量"
                  checked={form.efiPreEnrolledKeys}
                  onCheckedChange={(efiPreEnrolledKeys) => set({ efiPreEnrolledKeys })}
                />
              </div>
            )}
          </div>
        )}
      </FormSection>

      <FormSection title="设备">
        <FormField label="SCSI 控制器" name="scsihw">
          <SelectField value={form.scsihw} onValueChange={(v) => update((f) => setScsihw(f, v ?? ''))} options={SCSIHW_OPTIONS} emptyOption="默认 (LSI 53C895A)" />
        </FormField>
        <div className="grid gap-1">
          <SwitchField
            label="QEMU Guest Agent"
            description="系统里装了 qemu-guest-agent 时打开，可显示 IP、正常关机"
            checked={form.agent}
            onCheckedChange={(agent) => set({ agent })}
          />
          <SwitchField label="添加 TPM" description="Windows 11 需要 TPM 2.0" checked={form.tpm} onCheckedChange={(tpm) => set({ tpm })} />
        </div>
        {form.tpm && (
          <FormRow>
            <FormField label="TPM 存储" name="tpmstate0" required>
              <StorageSelect node={form.node} content="images" value={form.tpmStorage} onValueChange={(s) => set({ tpmStorage: s ?? '' })} />
            </FormField>
            <FormField label="TPM 版本">
              <SelectField
                value={form.tpmVersion}
                onValueChange={(v) => set({ tpmVersion: (v ?? 'v2.0') as QemuForm['tpmVersion'] })}
                options={[
                  { value: 'v2.0', label: 'v2.0' },
                  { value: 'v1.2', label: 'v1.2' },
                ]}
              />
            </FormField>
          </FormRow>
        )}
      </FormSection>

      <FormSection collapsible title="高级选项">
        <FormField label="机器版本" hint="一般用最新版本；迁移老虚拟机或排查兼容问题时才需要固定。">
          <SelectField
            value={form.machineVersion}
            onValueChange={(v) => set({ machineVersion: v ?? '' })}
            options={versionOptions}
            emptyOption="最新"
            loading={machinesLoading && !!form.node}
          />
        </FormField>
      </FormSection>
    </div>
  )
}

// ----------------------------------------------------------------- disks

const BUS_OPTIONS: { value: DiskBus; label: string }[] = [
  { value: 'scsi', label: 'SCSI' },
  { value: 'virtio', label: 'VirtIO Block' },
  { value: 'sata', label: 'SATA' },
  { value: 'ide', label: 'IDE' },
]

function DiskCard({ form, disk, update, onRemove }: QemuStepProps & { disk: QemuDisk; onRemove: () => void }) {
  const id = `${disk.bus}${disk.index}`
  const patch = (p: Partial<QemuDisk>) => update((f) => ({ ...f, disks: f.disks.map((d) => (d.key === disk.key ? { ...d, ...p } : d)) }))
  const indexes = freeIndexes(form, disk.bus, disk.key)
  const supportsIothread = disk.bus === 'virtio' || disk.bus === 'scsi'
  return (
    <section aria-label={`磁盘 ${id}`} className="grid gap-4 rounded-xl border border-border bg-(--field) p-3.5 sm:p-4">
      <header className="flex items-center gap-2.5">
        <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand/12 text-brand-strong paper:bg-primary/10 paper:text-primary">
          <HardDrive className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm font-medium text-foreground">{id}</div>
          <div className="text-xs text-muted-foreground">
            {BUS_LABEL[disk.bus]}
            {disk.bus === 'scsi' && ` · 控制器 ${scsihwLabel(form.scsihw)}`}
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={`删除磁盘 ${id}`} className="text-muted-foreground hover:text-destructive">
          <Trash2 />
        </Button>
      </header>

      <FormRow>
        <FormField label="总线">
          <SelectField value={disk.bus} onValueChange={(b) => b && update((f) => setDiskBus(f, disk.key, b as DiskBus))} options={BUS_OPTIONS} />
        </FormField>
        <FormField label="编号">
          <SelectField
            value={String(disk.index)}
            onValueChange={(v) => v !== undefined && patch({ index: Number(v) })}
            options={[disk.index, ...indexes.filter((i) => i !== disk.index)].sort((a, b) => a - b).map((i) => ({ value: String(i), label: `${disk.bus}${i}` }))}
          />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="存储" name={id} required>
          <StorageSelect node={form.node} content="images" value={disk.storage} onValueChange={(storage) => patch({ storage: storage ?? '' })} />
        </FormField>
        <FormField label="大小" required>
          <SizeInput value={disk.size} onChange={(size) => patch({ size })} baseUnit="GiB" units={['GiB', 'TiB']} min={1} />
        </FormField>
      </FormRow>
      <DiskFormatField node={form.node} storage={disk.storage} value={disk.format} onChange={(format) => patch({ format })} />

      <div className="grid gap-x-6 sm:grid-cols-3">
        <SwitchField label="Discard" description="释放已删除数据的空间（精简存储）" checked={disk.discard} onCheckedChange={(discard) => patch({ discard })} />
        <SwitchField
          label="IO thread"
          description={supportsIothread ? '独立 IO 线程' : '仅 VirtIO / SCSI'}
          checked={disk.iothread && supportsIothread}
          disabled={!supportsIothread}
          onCheckedChange={(iothread) => patch({ iothread })}
        />
        <SwitchField
          label="SSD 仿真"
          description={disk.bus === 'virtio' ? 'VirtIO Block 不支持' : '对系统报告为 SSD'}
          checked={disk.ssd && disk.bus !== 'virtio'}
          disabled={disk.bus === 'virtio'}
          onCheckedChange={(ssd) => patch({ ssd })}
        />
      </div>

      <FormSection collapsible title="高级选项">
        <FormRow>
          <FormField label="缓存">
            <SelectField value={disk.cache} onValueChange={(v) => patch({ cache: v ?? '' })} options={CACHE_OPTIONS} emptyOption="默认（无缓存）" />
          </FormField>
          <FormField label="异步 IO">
            <SelectField value={disk.aio} onValueChange={(v) => patch({ aio: v ?? '' })} options={AIO_OPTIONS} emptyOption="默认 (io_uring)" />
          </FormField>
        </FormRow>
        <div className="grid gap-x-6 sm:grid-cols-3">
          <SwitchField label="加入备份" checked={disk.backup} onCheckedChange={(backup) => patch({ backup })} />
          <SwitchField label="跳过复制" checked={disk.noReplicate} onCheckedChange={(noReplicate) => patch({ noReplicate })} />
          <SwitchField
            label="只读"
            description={supportsIothread ? undefined : '仅 VirtIO / SCSI'}
            checked={disk.readonly && supportsIothread}
            disabled={!supportsIothread}
            onCheckedChange={(readonly) => patch({ readonly })}
          />
        </div>
        <div className="grid gap-3">
          <div className="text-sm font-medium text-foreground">限速</div>
          <FormRow cols={4}>
            <OptionalNumber label="读 MB/s" value={disk.mbps_rd} onChange={(mbps_rd) => patch({ mbps_rd })} placeholder="不限" min={1} decimal />
            <OptionalNumber label="写 MB/s" value={disk.mbps_wr} onChange={(mbps_wr) => patch({ mbps_wr })} placeholder="不限" min={1} decimal />
            <OptionalNumber label="读 IOPS" value={disk.iops_rd} onChange={(iops_rd) => patch({ iops_rd })} placeholder="不限" min={10} />
            <OptionalNumber label="写 IOPS" value={disk.iops_wr} onChange={(iops_wr) => patch({ iops_wr })} placeholder="不限" min={10} />
          </FormRow>
          <FormRow cols={4}>
            <OptionalNumber label="读突发 MB/s" value={disk.mbps_rd_max} onChange={(mbps_rd_max) => patch({ mbps_rd_max })} placeholder="默认" min={1} decimal />
            <OptionalNumber label="写突发 MB/s" value={disk.mbps_wr_max} onChange={(mbps_wr_max) => patch({ mbps_wr_max })} placeholder="默认" min={1} decimal />
            <OptionalNumber label="读突发 IOPS" value={disk.iops_rd_max} onChange={(iops_rd_max) => patch({ iops_rd_max })} placeholder="默认" min={10} />
            <OptionalNumber label="写突发 IOPS" value={disk.iops_wr_max} onChange={(iops_wr_max) => patch({ iops_wr_max })} placeholder="默认" min={10} />
          </FormRow>
        </div>
      </FormSection>
    </section>
  )
}

export function QemuDisksStep({ form, set, update }: QemuStepProps) {
  const full = form.disks.length >= totalDiskSlots()
  const add = () =>
    update((f) => {
      const last = f.disks[f.disks.length - 1]
      const bus: DiskBus = last?.bus ?? 'scsi'
      const usable = freeIndexes(f, bus).length ? bus : (['scsi', 'virtio', 'sata', 'ide'] as const).find((b) => freeIndexes(f, b).length) ?? 'scsi'
      return { ...f, disks: [...f.disks, newDisk(f, usable, last?.storage ?? '')] }
    })
  return (
    <div className="grid gap-4">
      {form.disks.length === 0 && (
        <div className="rounded-xl border border-dashed border-input px-4 py-8 text-center text-sm text-muted-foreground">
          不添加硬盘。之后可以在“硬件”里添加或导入磁盘。
        </div>
      )}
      {form.disks.map((d) => (
        <DiskCard key={d.key} form={form} set={set} update={update} disk={d} onRemove={() => update((f) => ({ ...f, disks: f.disks.filter((x) => x.key !== d.key) }))} />
      ))}
      <Button type="button" variant="outline" onClick={add} disabled={full} className="h-11 border-dashed">
        <Plus /> 添加磁盘
      </Button>
    </div>
  )
}

// ------------------------------------------------------------------- CPU

const GENERIC_CPU_ORDER = ['x86-64-v2-AES', 'host', 'x86-64-v3', 'x86-64-v4', 'x86-64-v2', 'max', 'kvm64', 'qemu64', 'kvm32', 'qemu32']

function cpuOptions(models: CpuModel[] | undefined): ComboOption[] {
  const list = models ?? []
  const names = new Set(list.map((m) => m.name))
  if (!names.has(DEFAULT_CPU_TYPE)) list.push({ name: DEFAULT_CPU_TYPE, vendor: 'default', custom: 0 })
  const vendorLabel = (v: string) => (v === 'AuthenticAMD' ? 'AMD' : v === 'GenuineIntel' ? 'Intel' : v === 'default' ? '通用' : v)
  const group = (m: CpuModel) => (m.custom ? '自定义' : vendorLabel(m.vendor))
  const rank = (m: CpuModel) => {
    const g = GENERIC_CPU_ORDER.indexOf(m.name)
    if (g >= 0) return g
    if (m.custom) return 1000
    return m.vendor === 'AuthenticAMD' ? 100 : m.vendor === 'GenuineIntel' ? 200 : 300
  }
  return [...list]
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((m) => ({
      value: m.name,
      label: m.name.replace(/^custom-/, ''),
      group: GENERIC_CPU_ORDER.includes(m.name) ? '通用' : group(m),
      description: m.name === DEFAULT_CPU_TYPE ? '默认' : m.name === 'host' ? '与主机相同，性能最好' : undefined,
      keywords: [vendorLabel(m.vendor)],
    }))
}

/** Chinese descriptions of the flags PVE offers (the API text is English). */
const CPU_FLAG_TEXT: Record<string, string> = {
  'nested-virt': '嵌套虚拟化（AMD 为 svm，Intel 为 vmx）。CPU 型号请选与主机同厂商的型号，不要用 x86-64-vX。',
  aes: '启用 AES 指令集硬件加速。',
  'amd-ssbd': '提升 AMD CPU 上 Spectre 缓解的性能，建议与 virt-ssbd 一起使用。',
  ibpb: '改进 AMD CPU 上的 Spectre 缓解。',
  'md-clear': '让客户机知道 MDS 已被正确缓解。',
  pcid: '降低 Westmere、Sandy Bridge、Ivy Bridge 等 Intel CPU 上 Meltdown 修复的开销。',
  pdpe1gb: '允许客户机使用 1GB 大页（需主机硬件支持）。',
  'spec-ctrl': '改进 Intel CPU 上的 Spectre 缓解。',
  ssbd: 'Intel 型号的“推测存储旁路”防护。',
  'amd-no-ssb': '告知客户机主机不受 AMD Spectre 漏洞影响。',
  'hv-evmcs': '提升嵌套虚拟化性能，仅 Intel CPU。',
  'hv-tlbflush': '提升超分配 Windows 客户机的性能，老 CPU 上可能蓝屏。',
  'virt-ssbd': 'AMD 型号“推测存储旁路”防护的基础。',
}

function CpuFlags({ form, set }: QemuStepProps) {
  const { data, isPending } = useCpuFlags(form.node || undefined)
  const flags = (data ?? []).filter((f) => f.name === 'nested-virt' || (f['supported-on']?.length ?? 0) > 0 || form.cpuFlags[f.name])
  if (isPending && form.node) return <p className="text-sm text-muted-foreground">正在加载 CPU 标志…</p>
  if (!flags.length) return <p className="text-sm text-muted-foreground">没有可用的 CPU 标志。</p>
  return (
    <ul className="grid divide-y divide-border/70 overflow-hidden rounded-xl border border-border" aria-label="CPU 标志">
      {flags.map((f) => {
        const state = form.cpuFlags[f.name] ?? '='
        return (
          <li key={f.name} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-sm text-foreground">{f.name}</div>
              <div className="text-xs leading-relaxed text-muted-foreground">{CPU_FLAG_TEXT[f.name] ?? f.description}</div>
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={state}
              aria-label={`${f.name} 状态`}
              onValueChange={(v) => {
                if (!v) return
                const next = { ...form.cpuFlags }
                if (v === '=') delete next[f.name]
                else next[f.name] = v as '+' | '-'
                set({ cpuFlags: next })
              }}
              className="shrink-0"
            >
              <ToggleGroupItem value="-" aria-label="关闭" className="px-3 pointer-coarse:h-10">
                关
              </ToggleGroupItem>
              <ToggleGroupItem value="=" aria-label="默认" className="px-3 pointer-coarse:h-10">
                默认
              </ToggleGroupItem>
              <ToggleGroupItem value="+" aria-label="开启" className="px-3 pointer-coarse:h-10">
                开
              </ToggleGroupItem>
            </ToggleGroup>
          </li>
        )
      })}
    </ul>
  )
}

export function QemuCpuStep(props: QemuStepProps) {
  const { form, set } = props
  const node = useNodeInfo(form.node)
  const { data: models, isPending } = useCpuModels(form.node || undefined)
  const options = useMemo(() => cpuOptions(models ? [...models] : undefined), [models])
  const isRoot = useSession()?.username === 'root@pam'
  const total = (form.sockets ?? 1) * (form.cores ?? 1)
  const over = node?.maxcpu !== undefined && total > node.maxcpu
  return (
    <div className="grid gap-6">
      <FormRow>
        <FormField label="插槽" name="sockets" required>
          <NumberInput value={form.sockets} onChange={(sockets) => set({ sockets })} min={1} max={4} stepper />
        </FormField>
        <FormField label="每插槽核心" name="cores" required>
          <NumberInput value={form.cores} onChange={(cores) => set({ cores })} min={1} max={256} stepper />
        </FormField>
      </FormRow>
      <div
        className={cn(
          'flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm',
          over ? 'border-warning/40 bg-warning/10' : 'border-border bg-(--field)',
        )}
      >
        <span className="text-muted-foreground">总核心数</span>
        <span className="tabular">
          <span className="text-lg font-medium text-foreground">{total}</span>
          {node?.maxcpu !== undefined && <span className="text-muted-foreground"> / 节点 {node.maxcpu} 个 CPU</span>}
        </span>
      </div>
      <FormField label="类型" name="cpu" hint="默认 x86-64-v2-AES 兼容性好，可在不同 CPU 的节点间迁移；单节点用 host 性能最好。">
        <ComboboxField value={form.cputype} onChange={(cputype) => set({ cputype })} options={options} loading={isPending && !!form.node} searchPlaceholder="搜索 CPU 型号" />
      </FormField>

      <FormSection collapsible title="高级选项">
        <FormRow>
          <OptionalNumber label="vCPU" name="vcpus" value={form.vcpus} onChange={(vcpus) => set({ vcpus })} placeholder={String(total)} min={1} max={total} hint="启动时启用的 CPU 数，用于热插拔" />
          <OptionalNumber label="CPU 限制" name="cpulimit" value={form.cpulimit} onChange={(cpulimit) => set({ cpulimit })} placeholder="不限制" unit="核" min={0} max={128} decimal />
        </FormRow>
        <FormRow>
          <OptionalNumber label="CPU 权重" name="cpuunits" value={form.cpuunits} onChange={(cpuunits) => set({ cpuunits })} placeholder="100" min={1} max={10000} hint="越大分到的 CPU 时间越多" />
          <FormField
            label="CPU 亲和"
            name="affinity"
            disabled={!isRoot}
            hint={isRoot ? '例如 0-3,8；留空为全部核心' : '只有 root@pam 可以设置'}
          >
            <FieldInput value={form.affinity} onChange={(e) => set({ affinity: e.target.value })} placeholder="全部核心" inputMode="numeric" />
          </FormField>
        </FormRow>
        <SwitchField label="启用 NUMA" checked={form.numa} onCheckedChange={(numa) => set({ numa })} />
        <FormField label="CPU 标志">
          <CpuFlags {...props} />
        </FormField>
      </FormSection>
    </div>
  )
}

// ---------------------------------------------------------------- memory

const MEMORY_PRESETS = [512, 1024, 2048, 4096, 8192, 16384]

export function MemoryPresets({ value, onPick, max }: { value: number | undefined; onPick: (v: number) => void; max?: number }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="常用大小">
      {MEMORY_PRESETS.filter((m) => !max || m <= max).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={value === m}
          onClick={() => onPick(m)}
          className={cn(
            'inline-flex h-8 items-center rounded-full border px-3 text-xs tabular transition-colors pointer-coarse:h-10 pointer-coarse:px-3.5',
            value === m
              ? 'border-brand/60 bg-brand/12 text-foreground paper:border-primary paper:bg-primary/10'
              : 'border-input bg-(--field) text-muted-foreground hover:text-foreground',
          )}
        >
          {m >= 1024 ? `${m / 1024} GiB` : `${m} MiB`}
        </button>
      ))}
    </div>
  )
}

export function QemuMemoryStep({ form, set, update }: QemuStepProps) {
  const node = useNodeInfo(form.node)
  const nodeMemMiB = node?.maxmem ? Math.floor(node.maxmem / 1024 ** 2) : undefined
  return (
    <div className="grid gap-6">
      <FormField
        label="内存"
        name="memory"
        required
        hint={node?.maxmem ? `节点内存 ${formatBytes(node.maxmem)}，已用 ${formatBytes(node.mem ?? 0)}` : undefined}
      >
        <SizeInput value={form.memory} onChange={(m) => update((f) => setMemory(f, m))} baseUnit="MiB" units={['MiB', 'GiB']} min={16} />
      </FormField>
      <MemoryPresets value={form.memory} onPick={(m) => update((f) => setMemory(f, m))} max={nodeMemMiB} />

      <FormSection title="动态内存">
        <SwitchField
          label="Ballooning 设备"
          description="可在内存紧张时回收客户机空闲内存，并显示真实内存用量"
          checked={form.ballooning}
          onCheckedChange={(ballooning) => set({ ballooning })}
        />
        {form.ballooning && (
          <FormRow>
            <FormField label="最小内存" name="balloon" hint="与内存相同表示不动态回收">
              <SizeInput value={form.balloon} onChange={(balloon) => set({ balloon })} baseUnit="MiB" units={['MiB', 'GiB']} min={1} max={form.memory} />
            </FormField>
            <OptionalNumber
              label="份额"
              name="shares"
              value={form.shares}
              onChange={(shares) => set({ shares })}
              placeholder="默认 (1000)"
              min={0}
              max={50000}
              disabled={form.balloon === form.memory}
              hint="内存回收时的相对权重"
            />
          </FormRow>
        )}
        <SwitchField label="允许 KSM" description="合并相同内存页以节省内存" checked={form.allowKsm} onCheckedChange={(allowKsm) => set({ allowKsm })} />
      </FormSection>
    </div>
  )
}

// --------------------------------------------------------------- network

export function QemuNetworkStep({ form, set }: QemuStepProps) {
  return (
    <div className="grid gap-5">
      <SwitchField label="不添加网卡" description="之后可以在“硬件”里添加" checked={form.noNetwork} onCheckedChange={(noNetwork) => set({ noNetwork })} />
      {!form.noNetwork && (
        <>
          <FormRow>
            <FormField label="网桥" name="bridge" required>
              <BridgeSelect node={form.node} value={form.bridge} onValueChange={(bridge) => set({ bridge: bridge ?? '' })} />
            </FormField>
            <OptionalNumber label="VLAN 标签" name="tag" value={form.vlan} onChange={(vlan) => set({ vlan })} placeholder="无" min={1} max={4094} />
          </FormRow>
          <FormRow>
            <FormField label="型号" name="model">
              <SelectField value={form.model} onValueChange={(v) => v && set({ model: v })} options={NIC_MODEL_OPTIONS} />
            </FormField>
            <FormField label="MAC 地址" name="macaddr">
              <FieldInput value={form.macaddr} onChange={(e) => set({ macaddr: e.target.value.trim() })} placeholder="自动生成" autoCapitalize="characters" spellCheck={false} className="font-mono" />
            </FormField>
          </FormRow>
          <SwitchField label="防火墙" description="在这个网卡上启用 PVE 防火墙" checked={form.firewall} onCheckedChange={(firewall) => set({ firewall })} />
          <FormSection collapsible title="高级选项">
            <SwitchField label="断开连接" description="网卡存在但不接入网络" checked={form.disconnect} onCheckedChange={(disconnect) => set({ disconnect })} />
            <FormRow>
              <OptionalNumber
                label="MTU"
                name="mtu"
                value={form.mtu}
                onChange={(mtu) => set({ mtu })}
                placeholder="与网桥相同"
                min={1}
                max={65520}
                disabled={form.model !== 'virtio'}
                hint={form.model !== 'virtio' ? '仅 VirtIO 网卡' : '填 1 继承网桥的 MTU'}
              />
              <OptionalNumber label="限速" name="rate" value={form.rate} onChange={(rate) => set({ rate })} placeholder="不限" unit="MB/s" min={0} max={10240} decimal />
            </FormRow>
            <OptionalNumber label="多队列" name="queues" value={form.queues} onChange={(queues) => set({ queues })} placeholder="不启用" min={1} max={64} />
          </FormSection>
        </>
      )}
    </div>
  )
}
