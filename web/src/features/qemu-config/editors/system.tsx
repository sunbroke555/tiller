// Editors for the system rows: memory, processors, BIOS, display, machine,
// SCSI controller and vCPU architecture.

import { useMemo, useState } from 'react'

import { useCpuFlags, useCpuModels, useQemuMachines } from '@/api/qemu-config'
import { useClusterResources } from '@/api/queries'
import { isNode } from '@/api/types'
import {
  FieldInput,
  FormDialog,
  FormField,
  FormRow,
  FormSection,
  NumberInput,
  SelectField,
  SizeInput,
  SwitchField,
} from '@/components/form'
import { Skeleton } from '@/components/ui/skeleton'
import { tryParsePropertyString } from '@/lib/propstring'
import { cn } from '@/lib/utils'

import { ALLOWED_SCSIHW, ARCH_LABEL, BIOS, DEFAULT_CPU, DEFAULT_MACHINE, SCSIHW, VGA_TYPES, isWindows, vgaDefaultMemory } from '../constants'
import { useQemuConfig, useSaveConfig, type DialogRenderProps } from '../context'
import {
  displayValue,
  parseHotplug,
  machineFormFrom,
  machineValue,
  memoryFormFrom,
  memoryValues,
  processorFormFrom,
  processorValues,
  updateParams,
  type MachineForm,
  type MemoryForm,
  type ProcessorForm,
} from '../params'
import { SearchSelect, type SearchOption } from '../pickers'
import { Hint, Segmented } from '../ui'

// ---------------------------------------------------------------- memory

export function MemoryDialog(props: DialogRenderProps) {
  const { cfg, digest, running } = useQemuConfig()
  const save = useSaveConfig()
  const [f, setF] = useState<MemoryForm>(() => memoryFormFrom(cfg))
  const set = (patch: Partial<MemoryForm>) => setF((v) => ({ ...v, ...patch }))
  const params = updateParams(cfg, memoryValues(cfg, f), digest)
  const hotplug = parseHotplug(cfg.hotplug).includes('memory')
  const balloonTooBig = f.ballooning && f.balloon !== undefined && f.balloon > f.memory

  return (
    <FormDialog
      {...props}
      title="内存"
      description="分配给虚拟机的内存；启用 Ballooning 后可以在最小值和最大值之间动态调整。"
      submitDisabled={!params || !f.memory || balloonTooBig}
      onSubmit={() => save(params, { title: '修改内存' })}
    >
      <FormField label="内存" name="memory" required>
        <SizeInput value={f.memory} onChange={(memory) => {
          // Keep "minimum = maximum" in sync, like the official editor.
          setF((v) => ({ ...v, memory: memory ?? 0, balloon: v.balloon === v.memory ? (memory ?? 0) : v.balloon }))
        }} min={16} step={1} units={['MiB', 'GiB']} stepper />
      </FormField>
      {running && !hotplug && <Hint>虚拟机运行中且未启用内存热插拔，修改将在重启后生效。</Hint>}
      <FormSection collapsible title="Ballooning 与高级选项" defaultOpen={!f.ballooning || f.balloon !== f.memory || !!f.shares || !f.allowKsm}>
        <SwitchField
          label="Ballooning 设备"
          description="允许宿主机回收客户机空闲的内存，并报告实际内存用量。"
          checked={f.ballooning}
          onCheckedChange={(ballooning) => set({ ballooning })}
        />
        <FormRow>
          <FormField label="最小内存" name="balloon" error={balloonTooBig ? '不能大于内存' : undefined} disabled={!f.ballooning}>
            <SizeInput value={f.balloon} onChange={(balloon) => set({ balloon })} min={1} max={f.memory} disabled={!f.ballooning} />
          </FormField>
          <FormField
            label="份额"
            name="shares"
            hint="自动 Ballooning 时的权重，默认 1000"
            disabled={!f.ballooning || f.balloon === f.memory}
          >
            <NumberInput
              value={f.shares}
              onChange={(shares) => set({ shares })}
              min={0}
              max={50000}
              placeholder="默认 (1000)"
              disabled={!f.ballooning || f.balloon === f.memory}
            />
          </FormField>
        </FormRow>
        <SwitchField
          label="允许 KSM"
          description="允许内核同页合并（KSM）合并这台虚拟机的相同内存页。"
          checked={f.allowKsm}
          onCheckedChange={(allowKsm) => set({ allowKsm })}
        />
      </FormSection>
    </FormDialog>
  )
}

// ------------------------------------------------------------- processors

export function ProcessorDialog(props: DialogRenderProps) {
  const { cfg, digest, node, arch, isRoot } = useQemuConfig()
  const save = useSaveConfig()
  const [f, setF] = useState<ProcessorForm>(() => processorFormFrom(cfg, arch))
  const set = (patch: Partial<ProcessorForm>) => setF((v) => ({ ...v, ...patch }))
  const { data: cgroupMode } = useClusterResources({
    select: (all) => all.filter(isNode).find((n) => n.node === node)?.['cgroup-mode'],
  })
  const unitsDefault = cgroupMode === 1 ? 1024 : 100
  const params = updateParams(cfg, processorValues(cfg, f, unitsDefault), digest)
  const total = f.sockets * f.cores
  const kvm = cfg.kvm !== '0'
  const models = useCpuModels(node, arch)
  const vcpusInvalid = f.vcpus !== undefined && f.vcpus > total
  const affinityInvalid = f.affinity.trim() !== '' && !/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(f.affinity.trim())

  const options = useMemo<SearchOption[]>(() => {
    const list = [...(models.data ?? [])].sort((a, b) =>
      a.custom !== b.custom ? b.custom - a.custom : a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name, undefined, { numeric: true }),
    )
    const vendorLabel = (v: string) =>
      v === 'GenuineIntel' ? 'Intel' : v === 'AuthenticAMD' ? 'AMD' : v === 'default' ? '通用' : v === 'ARM' ? 'ARM' : v
    const out: SearchOption[] = list.map((m) => ({
      value: m.name,
      label: m.custom ? m.name.replace(/^custom-/, '') : m.name,
      group: m.custom ? '自定义型号' : vendorLabel(m.vendor),
      description: m.name === DEFAULT_CPU[arch] ? '推荐' : undefined,
    }))
    return out
  }, [models.data, arch])

  return (
    <FormDialog
      {...props}
      size="lg"
      title="处理器"
      submitDisabled={!params || vcpusInvalid || affinityInvalid}
      onSubmit={() => save(params, { title: '修改处理器' })}
    >
      <FormRow>
        <FormField label="插槽" name="sockets" required>
          <NumberInput value={f.sockets} onChange={(sockets) => set({ sockets: sockets ?? 1 })} min={1} max={4} stepper />
        </FormField>
        <FormField label="每插槽核心" name="cores" required>
          <NumberInput value={f.cores} onChange={(cores) => set({ cores: cores ?? 1 })} min={1} max={256} stepper />
        </FormField>
      </FormRow>
      <p className="-mt-2 text-xs text-muted-foreground">
        共 <span className="font-medium text-foreground tabular">{total}</span> 个核心
      </p>
      <FormField
        label="CPU 类型"
        name="cpu"
        hint={
          f.cputype === 'host'
            ? 'host：直通宿主机 CPU 的全部特性，性能最好，但不能在不同 CPU 的节点间实时迁移。'
            : `默认推荐 ${DEFAULT_CPU[arch]}，兼容性好；需要宿主机全部特性时选 host。`
        }
      >
        <SearchSelect
          value={f.cputype}
          onValueChange={(cputype) => set({ cputype })}
          options={options}
          loading={models.isPending}
          emptyOption={arch === 'aarch64' ? `默认 (${DEFAULT_CPU.aarch64})` : undefined}
          searchPlaceholder="搜索 CPU 型号…"
          allowCustom
        />
      </FormField>

      <FormSection collapsible title="高级选项" defaultOpen={!!(f.vcpus || f.cpulimit || f.cpuunits || f.affinity || f.numa)}>
        <FormRow>
          <FormField label="vCPU 数" name="vcpus" hint="启动时启用的 vCPU 数（需要 CPU 热插拔）" error={vcpusInvalid ? `不能超过 ${total}` : undefined}>
            <NumberInput value={f.vcpus} onChange={(vcpus) => set({ vcpus })} min={1} max={total} placeholder={String(total)} />
          </FormField>
          <FormField label="CPU 限制" name="cpulimit" hint="最多使用的 CPU 时间（核数），0 为不限">
            <NumberInput value={f.cpulimit} onChange={(cpulimit) => set({ cpulimit })} min={0} max={128} decimal placeholder="不限" />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label="CPU 权重" name="cpuunits" hint={`调度权重，默认 ${unitsDefault}`}>
            <NumberInput
              value={f.cpuunits}
              onChange={(cpuunits) => set({ cpuunits })}
              min={cgroupMode === 1 ? 2 : 1}
              max={cgroupMode === 1 ? 262144 : 10000}
              placeholder={`默认 (${unitsDefault})`}
            />
          </FormField>
          <FormField
            label="CPU 亲和性"
            name="affinity"
            hint={isRoot ? '宿主机核心列表，例如 0-3,8' : '仅 root@pam 可以设置'}
            error={affinityInvalid ? '格式：0-3,8,10-11' : undefined}
            disabled={!isRoot}
          >
            <FieldInput value={f.affinity} onChange={(e) => set({ affinity: e.target.value })} placeholder="所有核心" inputMode="numeric" />
          </FormField>
        </FormRow>
        <SwitchField label="启用 NUMA" description="按插槽模拟 NUMA 节点，内存/CPU 热插拔需要它。" checked={f.numa} onCheckedChange={(numa) => set({ numa })} />
        <CpuFlagsEditor node={node} arch={arch} kvm={kvm} flags={f.flags} onChange={(flags) => set({ flags })} />
      </FormSection>
    </FormDialog>
  )
}

function CpuFlagsEditor({
  node,
  arch,
  kvm,
  flags,
  onChange,
}: {
  node: string
  arch: string
  kvm: boolean
  flags: Record<string, '+' | '-' | undefined>
  onChange: (flags: Record<string, '+' | '-' | undefined>) => void
}) {
  const { data, isPending, isError } = useCpuFlags(node, arch, kvm ? 'kvm' : 'tcg')
  const list = useMemo(() => {
    const known = (data ?? []).filter(
      (fl) => fl.name === 'nested-virt' || (fl['supported-on']?.length ?? 0) > 0 || flags[fl.name] !== undefined,
    )
    const unknown = Object.keys(flags)
      .filter((n) => flags[n] && !(data ?? []).some((fl) => fl.name === n))
      .map((name) => ({ name, description: '未知或不受支持的标志，可能导致虚拟机无法启动。', unknown: true }))
    return [...unknown, ...known.map((k) => ({ ...k, unknown: (k['supported-on']?.length ?? 1) === 0 && k.name !== 'nested-virt' }))]
  }, [data, flags])

  return (
    <FormField label="额外的 CPU 标志" hint={`显示 ${kvm ? 'KVM' : 'TCG'} 下可用的标志；“默认”表示由 CPU 型号决定。`}>
      {isPending ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : isError ? (
        <p className="text-sm text-muted-foreground">无法加载 CPU 标志。</p>
      ) : (
        <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/70">
          {list.map((fl) => (
            <li key={fl.name} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className={cn('font-mono text-sm', fl.unknown && 'text-warning')}>{fl.name}</div>
                {fl.description && <div className="line-clamp-2 text-xs text-muted-foreground">{fl.description}</div>}
              </div>
              <Segmented
                size="sm"
                aria-label={`${fl.name} 标志`}
                className="w-[9.5rem] shrink-0"
                value={flags[fl.name] ?? '='}
                onValueChange={(v) => onChange({ ...flags, [fl.name]: v === '=' ? undefined : v })}
                options={[
                  { value: '-', label: '关' },
                  { value: '=', label: '默认' },
                  { value: '+', label: '开' },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
    </FormField>
  )
}

// ------------------------------------------------------------------ BIOS

export function BiosDialog(props: DialogRenderProps) {
  const { cfg, digest, arch } = useQemuConfig()
  const save = useSaveConfig()
  const [bios, setBios] = useState<string | undefined>(cfg.bios)
  const params = updateParams(cfg, { bios: bios ?? '' }, digest)
  const allowed = arch === 'aarch64' ? ['ovmf'] : ['seabios', 'ovmf']
  return (
    <FormDialog {...props} size="sm" title="BIOS" submitDisabled={!params} onSubmit={() => save(params, { title: '修改 BIOS' })}>
      <FormField label="固件" name="bios">
        <SelectField
          value={bios}
          onValueChange={setBios}
          emptyOption={`默认 (${arch === 'aarch64' ? 'OVMF (UEFI)' : 'SeaBIOS'})`}
          options={allowed.map((b) => ({ value: b, label: BIOS[b] ?? b }))}
        />
      </FormField>
      {bios === 'ovmf' && !cfg.efidisk0 && (
        <Hint tone="warning">使用 OVMF (UEFI) 时需要添加 EFI 磁盘来保存 UEFI 设置，否则每次启动都会重置。可在“添加硬件”中添加。</Hint>
      )}
    </FormDialog>
  )
}

// --------------------------------------------------------------- display

export function DisplayDialog(props: DialogRenderProps) {
  const { cfg, digest } = useQemuConfig()
  const save = useSaveConfig()
  const initial = tryParsePropertyString(cfg.vga, 'type')
  const [type, setType] = useState<string | undefined>(initial.type)
  const [memory, setMemory] = useState<number | undefined>(initial.memory ? Number(initial.memory) : undefined)
  const [clipboard, setClipboard] = useState<string | undefined>(initial.clipboard)
  const nonGui = !!type && /^(serial\d|none)$/.test(type)
  const serialMissing = !!type && /^serial\d$/.test(type) && cfg[type] !== 'socket'
  const params = updateParams(cfg, { vga: displayValue(type, nonGui ? undefined : memory, nonGui ? undefined : clipboard) }, digest)
  return (
    <FormDialog
      {...props}
      title="显示"
      submitDisabled={!params || serialMissing}
      onSubmit={() => save(params, { title: '修改显示' })}
    >
      <FormField label="显卡" name="vga" error={serialMissing ? `串口 ${type} 未配置为 socket，请先添加串口。` : undefined}>
        <SelectField
          value={type}
          onValueChange={setType}
          emptyOption="默认"
          options={Object.entries(VGA_TYPES).map(([value, label]) => ({ value, label, description: value }))}
        />
      </FormField>
      <FormField label="显存" name="memory" hint="4 – 512 MiB">
        <NumberInput
          value={memory}
          onChange={setMemory}
          min={4}
          max={512}
          unit="MiB"
          disabled={nonGui}
          placeholder={nonGui ? '不适用' : `默认 (${vgaDefaultMemory(type)})`}
        />
      </FormField>
      <FormField label="剪贴板" name="clipboard">
        <SelectField
          value={clipboard}
          onValueChange={setClipboard}
          emptyOption="默认"
          options={[{ value: 'vnc', label: 'VNC' }]}
          disabled={nonGui}
        />
      </FormField>
      {clipboard === 'vnc' && !nonGui && (
        <Hint>选择 VNC 剪贴板后不能使用 SPICE 剪贴板；客户机需要安装 spice-tools。机器版本低于 10.1 时无法实时迁移。</Hint>
      )}
    </FormDialog>
  )
}

// --------------------------------------------------------------- machine

export function MachineDialog(props: DialogRenderProps) {
  const { cfg, digest, node, arch } = useQemuConfig()
  const save = useSaveConfig()
  const [f, setF] = useState<MachineForm>(() => machineFormFrom(cfg))
  const set = (patch: Partial<MachineForm>) => setF((v) => ({ ...v, ...patch }))
  const machines = useQemuMachines(node, arch)
  const family = f.type === 'q35' || f.type.includes('q35') ? 'q35' : ''
  const pinned = f.type !== '' && f.type !== 'q35' ? f.type : undefined
  const params = updateParams(cfg, { machine: machineValue(cfg, f, arch) }, digest)
  const familyType = family === 'q35' ? 'q35' : arch === 'aarch64' ? 'virt' : 'i440fx'
  const versions = (machines.data ?? []).filter((m) => m.type === familyType)
  const windows = isWindows(cfg.ostype)

  return (
    <FormDialog {...props} title="机器类型" submitDisabled={!params} onSubmit={() => save(params, { title: '修改机器类型' })}>
      <FormField label="机器" name="machine">
        {arch === 'aarch64' ? (
          <SelectField value="virt" onValueChange={() => undefined} options={[{ value: 'virt', label: '默认 (virt)' }]} disabled />
        ) : (
          <Segmented
            aria-label="机器"
            value={family || 'i440fx'}
            onValueChange={(v) => set({ type: v === 'q35' ? 'q35' : '', viommu: v === 'q35' ? f.viommu : f.viommu === 'intel' ? undefined : f.viommu })}
            options={[
              { value: 'i440fx', label: 'i440fx（默认）' },
              { value: 'q35', label: 'q35' },
            ]}
          />
        )}
      </FormField>
      <FormField
        label="版本"
        name="version"
        hint={windows && !pinned ? 'Windows 虚拟机未固定版本时，按创建时的 QEMU 版本自动选择；建议固定一个版本。' : '更换机器版本可能改变客户机内的硬件布局。'}
      >
        <SelectField
          value={pinned}
          onValueChange={(v) => set({ type: v ?? (family === 'q35' ? 'q35' : '') })}
          emptyOption="最新"
          loading={machines.isPending}
          options={versions.map((m) => ({ value: m.id, label: m.version, description: m.changes }))}
        />
      </FormField>
      <FormSection collapsible title="高级选项" defaultOpen={!!(f.viommu || f.awBits || f.enableS3 !== undefined || f.enableS4 !== undefined)}>
        <FormField label="vIOMMU" name="viommu" hint="为客户机模拟 IOMMU（嵌套直通需要）">
          <SelectField
            value={f.viommu}
            onValueChange={(viommu) => set({ viommu })}
            emptyOption="默认（无）"
            options={[
              ...(family === 'q35' ? [{ value: 'intel', label: 'Intel（兼容 AMD）' }] : []),
              { value: 'virtio', label: 'VirtIO' },
            ]}
          />
        </FormField>
        <FormField label="地址位宽" name="aw-bits" hint="vIOMMU 的地址宽度（32–64）">
          <NumberInput value={f.awBits} onChange={(awBits) => set({ awBits })} min={32} max={64} placeholder="默认" disabled={!f.viommu} />
        </FormField>
        <FormRow>
          <FormField label="S3（挂起到内存）">
            <SelectField
              value={f.enableS3 === undefined ? undefined : f.enableS3 ? '1' : '0'}
              onValueChange={(v) => set({ enableS3: v === undefined ? undefined : v === '1' })}
              emptyOption="默认"
              options={[{ value: '1', label: '启用' }, { value: '0', label: '禁用' }]}
            />
          </FormField>
          <FormField label="S4（挂起到磁盘）">
            <SelectField
              value={f.enableS4 === undefined ? undefined : f.enableS4 ? '1' : '0'}
              onValueChange={(v) => set({ enableS4: v === undefined ? undefined : v === '1' })}
              emptyOption="默认"
              options={[{ value: '1', label: '启用' }, { value: '0', label: '禁用' }]}
            />
          </FormField>
        </FormRow>
      </FormSection>
      <p className="text-xs text-muted-foreground">默认机器：{DEFAULT_MACHINE[arch]}</p>
    </FormDialog>
  )
}

// ------------------------------------------------------------- SCSI / arch

export function ScsiHwDialog(props: DialogRenderProps) {
  const { cfg, digest, arch } = useQemuConfig()
  const save = useSaveConfig()
  const [scsihw, setScsihw] = useState<string | undefined>(cfg.scsihw)
  const params = updateParams(cfg, { scsihw: scsihw ?? '' }, digest)
  return (
    <FormDialog {...props} size="sm" title="SCSI 控制器" submitDisabled={!params} onSubmit={() => save(params, { title: '修改 SCSI 控制器' })}>
      <FormField label="类型" name="scsihw" hint="VirtIO SCSI single 为每个磁盘提供独立控制器，配合 IO thread 性能最好。">
        <SelectField
          value={scsihw}
          onValueChange={setScsihw}
          emptyOption={arch === 'x86_64' ? '默认 (LSI 53C895A)' : undefined}
          options={ALLOWED_SCSIHW[arch].map((v) => ({ value: v, label: SCSIHW[v] ?? v }))}
        />
      </FormField>
    </FormDialog>
  )
}

export function ArchDialog(props: DialogRenderProps) {
  const { cfg, digest, isRoot } = useQemuConfig()
  const save = useSaveConfig()
  const [arch, setArch] = useState<string | undefined>(cfg.arch)
  const params = updateParams(cfg, { arch: arch ?? '' }, digest)
  return (
    <FormDialog {...props} size="sm" title="vCPU 架构" submitDisabled={!params || !isRoot} onSubmit={() => save(params, { title: '修改 vCPU 架构' })}>
      <FormField label="架构" name="arch" hint={isRoot ? '非宿主机架构会使用 TCG 模拟，速度较慢。' : '只有 root@pam 可以修改架构。'}>
        <SelectField
          value={arch}
          onValueChange={setArch}
          emptyOption="默认（宿主机架构）"
          options={(['x86_64', 'aarch64'] as const).map((a) => ({ value: a, label: ARCH_LABEL[a] }))}
          disabled={!isRoot}
        />
      </FormField>
    </FormDialog>
  )
}
