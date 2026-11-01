// Custom CPU models (/cluster/qemu/custom-cpu-models): a base model reported
// to the guest plus extra flags and CPUID tweaks; VMs use them as
// cpu: custom-<name>.

import { useMemo, useState } from 'react'
import { Cpu, Pencil, Plus, Search, Trash2 } from 'lucide-react'

import { usePermissions } from '@/api/permissions'
import { useClusterResources } from '@/api/queries'
import { useCpuModels } from '@/api/qemu-config'
import { cpuModelApi, mappingKeys, useClusterCpuFlags, useCustomCpuModels, type CustomCpuModel } from '@/api/resource-mappings'
import { isNode } from '@/api/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { SectionHeader } from '@/components/PageHeader'
import { ErrorCard, LoadingRows } from '@/components/QueryState'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { FieldInput, FormDialog, FormField, FormRow, FormSection, NumberInput, SelectField, SwitchField } from '@/components/form'
import { cn } from '@/lib/utils'

import {
  cpuModelForm,
  createCpuModelParams,
  customCpuName,
  parseFlags,
  updateCpuModelParams,
  validateCpuModelForm,
  type CpuFormErrors,
  type CpuModelForm,
  type FlagState,
} from './logic'
import { Chip, RowMenu, ValidationError, useDialog, useFormState } from './ui'

async function cpuWrite(start: Promise<unknown>, title: string) {
  // The node CPU lists (VM processor editor) include custom models too.
  await runTask(start, { title, invalidate: [mappingKeys.cpuModels(), ['pve', 'nodes']], syncSuccessMessage: `${title}：已保存` })
}

export function CpuModelsView() {
  const query = useCustomCpuModels()
  const perms = usePermissions()
  const canCreate = perms.can({ privs: 'Mapping.Modify', path: '/mapping/cpu' })
  const canModify = (m: CustomCpuModel) =>
    perms.can({ privs: 'Mapping.Modify', path: [`/mapping/cpu/${m.cputype}`, `/mapping/cpu/${customCpuName(m.cputype)}`, '/mapping/cpu'] })
  const edit = useDialog<CustomCpuModel | undefined>()
  const remove = useDialog<CustomCpuModel>()
  const models = [...(query.data ?? [])].sort((a, b) => a.cputype.localeCompare(b.cputype))

  let body
  if (query.isPending) {
    body = (
      <GlassCard flush>
        <LoadingRows rows={3} />
      </GlassCard>
    )
  } else if (query.isError) {
    body = <ErrorCard error={query.error} onRetry={() => void query.refetch()} />
  } else if (models.length === 0) {
    body = (
      <GlassCard>
        <EmptyState
          icon={Cpu}
          title="没有自定义 CPU 型号"
          description="基于内置型号加减 CPU 标志、隐藏虚拟化特征，供多台虚拟机共用（cpu: custom-名称）。"
          action={
            canCreate ? (
              <Button onClick={() => edit.show(undefined)}>
                <Plus /> 添加 CPU 型号
              </Button>
            ) : undefined
          }
        />
      </GlassCard>
    )
  } else {
    body = (
      <GlassCard flush className="overflow-hidden">
        <ul className="divide-y divide-border/70">
          {models.map((m) => (
            <CpuModelRow
              key={m.cputype}
              model={m}
              canEdit={canModify(m)}
              onEdit={() => edit.show(m)}
              onRemove={() => remove.show(m)}
            />
          ))}
        </ul>
      </GlassCard>
    )
  }

  const r = remove.data
  return (
    <section aria-label="自定义 CPU 型号" className="min-w-0">
      <SectionHeader title={query.data ? `自定义 CPU 型号 ${models.length}` : '自定义 CPU 型号'} className="mb-2.5 min-h-9">
        {canCreate && (
          <Button size="sm" onClick={() => edit.show(undefined)} className="pointer-coarse:h-10">
            <Plus /> 添加 CPU 型号
          </Button>
        )}
      </SectionHeader>
      {body}
      <CpuModelDialog {...edit.props} model={edit.data} />
      <ConfirmDialog
        {...remove.props}
        destructive
        confirmLabel="删除"
        title={`删除 CPU 型号 ${r ? customCpuName(r.cputype) : ''}？`}
        description="使用这个型号的虚拟机将无法启动，直到改用其他 CPU 类型。"
        onConfirm={async () => {
          if (r) await cpuWrite(cpuModelApi.remove(r.cputype), `删除 CPU 型号 ${customCpuName(r.cputype)}`)
        }}
      />
    </section>
  )
}

function CpuModelRow({ model: m, canEdit, onEdit, onRemove }: { model: CustomCpuModel; canEdit: boolean; onEdit: () => void; onRemove: () => void }) {
  const name = customCpuName(m.cputype)
  const flags = Object.entries(parseFlags(m.flags))
  const details = [
    m['phys-bits'] !== undefined && `物理地址 ${m['phys-bits']} 位`,
    m['guest-phys-bits'] !== undefined && `客户机地址 ${m['guest-phys-bits']} 位`,
    m.level !== undefined && `CPUID level ${m.level}`,
    m['hv-vendor-id'] && `Hyper-V 厂商 ${m['hv-vendor-id']}`,
  ].filter(Boolean)
  return (
    <li className="flex min-w-0 items-stretch" data-cpu-model={name}>
      <button
        type="button"
        disabled={!canEdit}
        onClick={onEdit}
        aria-label={`CPU 型号 ${name}`}
        className="grid min-h-14 min-w-0 flex-1 gap-1 px-(--card-p) py-(--row-py) text-left outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate font-mono text-[15px] font-medium">{name}</span>
          <span className="text-xs text-muted-foreground">基于 {m['reported-model'] ?? 'kvm64'}</span>
          {(m.hidden === 1 || m.hidden === true) && <Chip tone="brand">隐藏虚拟化</Chip>}
        </span>
        {details.length > 0 && <span className="text-xs text-muted-foreground">{details.join(' · ')}</span>}
        {flags.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {flags.map(([f, s]) => (
              <span
                key={f}
                className={cn(
                  'rounded-md px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-inset',
                  s === '+' ? 'bg-success/10 text-success-strong ring-success/25' : 'bg-destructive/10 text-destructive ring-destructive/25',
                )}
              >
                {s}
                {f}
              </span>
            ))}
          </span>
        )}
      </button>
      {canEdit && (
        <RowMenu
          label={name}
          className="mr-1 self-center"
          actions={[
            { id: 'edit', label: '编辑', icon: Pencil, onSelect: onEdit },
            { id: 'delete', label: '删除', icon: Trash2, destructive: true, separated: true, onSelect: onRemove },
          ]}
        />
      )}
    </li>
  )
}

// ---------------------------------------------------------------- dialog

type PhysMode = 'default' | 'host' | 'custom'

function CpuModelDialog({ open, onOpenChange, model }: { open: boolean; onOpenChange: (open: boolean) => void; model: CustomCpuModel | undefined }) {
  const isCreate = !model
  const [f, setF] = useFormState<CpuModelForm>(open, () => cpuModelForm(model))
  const set = (patch: Partial<CpuModelForm>) => setF((v) => ({ ...v, ...patch }))
  const [errors, setErrors] = useState<CpuFormErrors>({})
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setErrors({})
  }
  const physMode: PhysMode = f.physBits === '' ? 'default' : f.physBits === 'host' ? 'host' : 'custom'
  const params = model ? updateCpuModelParams(model, f) : null

  const node = useClusterResources({ select: (all) => all.filter(isNode).find((n) => n.status === 'online')?.node })
  const builtin = useCpuModels(node.data ?? '', 'x86_64')
  const builtinOptions = useMemo(
    () =>
      (builtin.data ?? [])
        .filter((m) => !m.custom && !/^x86-64-v/.test(m.name))
        .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name, undefined, { numeric: true }))
        .map((m) => ({
          value: m.name,
          label: m.name,
          description: m.vendor === 'GenuineIntel' ? 'Intel' : m.vendor === 'AuthenticAMD' ? 'AMD' : m.vendor === 'default' ? '通用' : m.vendor,
        })),
    [builtin.data],
  )
  const modelOptions =
    f.reportedModel && !builtinOptions.some((o) => o.value === f.reportedModel)
      ? [{ value: f.reportedModel, label: f.reportedModel, description: '' }, ...builtinOptions]
      : builtinOptions

  async function submit() {
    const found = validateCpuModelForm(f, isCreate)
    setErrors(found)
    if (Object.keys(found).length) throw new ValidationError()
    const name = f.name.trim().replace(/^custom-/, '')
    if (isCreate) await cpuWrite(cpuModelApi.create(createCpuModelParams(f)), `添加 CPU 型号 ${name}`)
    else if (params) await cpuWrite(cpuModelApi.update(model.cputype, params), `修改 CPU 型号 ${name}`)
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={isCreate ? '添加 CPU 型号' : `编辑 CPU 型号 ${customCpuName(model.cputype)}`}
      submitLabel={isCreate ? '添加' : '保存'}
      submitDisabled={!isCreate && !params}
      onSubmit={submit}
    >
      <FormRow>
        <FormField label="名称" name="cputype" required={isCreate} error={errors.name} hint={isCreate ? '虚拟机里显示为 custom-名称' : undefined}>
          {isCreate ? (
            <FieldInput value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="例如 win-gaming" maxLength={48} autoFocus />
          ) : (
            <p className="flex h-9 items-center font-mono text-sm">{customCpuName(model.cputype)}</p>
          )}
        </FormField>
        <FormField label="基础型号" name="reported-model" required={isCreate} error={errors.reportedModel} hint="报告给客户机的 CPU 型号和厂商，其他设置在它的基础上调整。">
          <SelectField
            value={f.reportedModel || undefined}
            onValueChange={(v) => set({ reportedModel: v ?? '' })}
            options={modelOptions}
            loading={builtin.isPending}
            placeholder="选择型号"
            position="popper"
          />
        </FormField>
      </FormRow>

      <SwitchField
        label="隐藏虚拟化特征"
        description="在 CPUID 里隐藏 KVM 签名，给检测到虚拟机就不工作的程序（如旧版 NVIDIA 驱动）用。"
        checked={f.hidden}
        onCheckedChange={(hidden) => set({ hidden })}
      />

      <FormRow>
        <FormField label="Hyper-V 厂商 ID" name="hv-vendor-id" error={errors.hvVendorId} hint="部分 Windows 驱动需要特定值，最多 12 个字母或数字。">
          <FieldInput value={f.hvVendorId} onChange={(e) => set({ hvVendorId: e.target.value })} placeholder="不设置" maxLength={12} className="font-mono" />
        </FormField>
        <FormField label="物理地址位数" name="phys-bits" error={errors.physBits} hint="不能大于宿主机；host 会阻止迁移到不同 CPU 的节点。">
          <div className="flex gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              value={physMode}
              onValueChange={(v) => v && set({ physBits: v === 'default' ? '' : v === 'host' ? 'host' : physMode === 'custom' ? f.physBits : '40' })}
              aria-label="物理地址位数"
              className="shrink-0"
            >
              <ToggleGroupItem value="default" className="px-2.5 pointer-coarse:h-10">
                默认
              </ToggleGroupItem>
              <ToggleGroupItem value="host" className="px-2.5 pointer-coarse:h-10">
                host
              </ToggleGroupItem>
              <ToggleGroupItem value="custom" className="px-2.5 pointer-coarse:h-10">
                指定
              </ToggleGroupItem>
            </ToggleGroup>
            {physMode === 'custom' && (
              <NumberInput
                value={Number(f.physBits) || undefined}
                onChange={(v) => set({ physBits: v === undefined ? '' : String(v) })}
                min={8}
                max={64}
                unit="位"
                aria-label="物理地址位数"
              />
            )}
          </div>
        </FormField>
      </FormRow>

      <FormSection collapsible title="高级选项" defaultOpen={f.guestPhysBits !== undefined || f.level !== undefined}>
        <FormRow>
          <FormField label="客户机物理地址位数" name="guest-phys-bits" hint="32–64，留空不设置。">
            <NumberInput value={f.guestPhysBits} onChange={(guestPhysBits) => set({ guestPhysBits })} min={32} max={64} placeholder="不设置" />
          </FormField>
          <FormField label="CPUID level" name="level" hint="客户机可查询的最大基本 CPUID 叶；Windows 在新 Intel 上启动失败时常设 30。">
            <NumberInput value={f.level} onChange={(level) => set({ level })} min={0} max={4294967295} placeholder="不设置" />
          </FormField>
        </FormRow>
      </FormSection>

      <FlagsEditor flags={f.flags} onChange={(flags) => set({ flags })} open={open} />
    </FormDialog>
  )
}

/** Tri-state list of every flag QEMU knows (custom models may use any of them). */
function FlagsEditor({
  flags,
  onChange,
  open,
}: {
  flags: Record<string, FlagState | undefined>
  onChange: (flags: Record<string, FlagState | undefined>) => void
  open: boolean
}) {
  const query = useClusterCpuFlags('x86_64', open)
  const [search, setSearch] = useState('')
  const [onlySet, setOnlySet] = useState(false)
  const q = search.trim().toLowerCase()
  const list = useMemo(() => {
    const known = query.data ?? []
    const unknown = Object.keys(flags)
      .filter((n) => flags[n] && !known.some((k) => k.name === n))
      .map((name) => ({ name, description: '不在 QEMU 的标志列表里，可能导致虚拟机无法启动。', unknown: true }))
    const all = [...unknown, ...known.map((k) => ({ ...k, unknown: false }))]
    return all
      .filter((fl) => !onlySet || flags[fl.name])
      .filter((fl) => !q || fl.name.toLowerCase().includes(q) || fl.description?.toLowerCase().includes(q))
  }, [query.data, flags, q, onlySet])
  const count = Object.values(flags).filter(Boolean).length

  return (
    <FormField label="CPU 标志" labelExtra={count ? `已设置 ${count} 个` : undefined} hint="“默认”表示由基础型号决定；开 = +标志，关 = -标志。">
      <div className="grid gap-2">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索标志" aria-label="搜索 CPU 标志" className="pl-9" />
          </div>
          <Button type="button" variant={onlySet ? 'secondary' : 'outline'} aria-pressed={onlySet} onClick={() => setOnlySet((v) => !v)} className="shrink-0 pointer-coarse:h-10">
            只看已设置
          </Button>
        </div>
        {query.isPending ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : query.isError ? (
          <p className="text-sm text-muted-foreground">无法加载 CPU 标志列表。</p>
        ) : (
          <ul aria-label="CPU 标志" className="max-h-80 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/70">
            {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">没有匹配的标志</li>}
            {list.map((fl) => (
              <li key={fl.name} className="flex items-center gap-3 px-3 py-2" data-flag={fl.name}>
                <div className="min-w-0 flex-1">
                  <div className={cn('font-mono text-sm', fl.unknown && 'text-warning-strong')}>{fl.name}</div>
                  {fl.description && <div className="line-clamp-2 text-xs text-muted-foreground">{fl.description}</div>}
                </div>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={flags[fl.name] ?? '='}
                  onValueChange={(v) => v && onChange({ ...flags, [fl.name]: v === '=' ? undefined : (v as FlagState) })}
                  aria-label={`${fl.name} 标志`}
                  className="w-[9.5rem] shrink-0 grid-cols-3"
                >
                  <ToggleGroupItem value="-" className="flex-1 text-xs pointer-coarse:h-9">
                    关
                  </ToggleGroupItem>
                  <ToggleGroupItem value="=" className="flex-1 text-xs pointer-coarse:h-9">
                    默认
                  </ToggleGroupItem>
                  <ToggleGroupItem value="+" className="flex-1 text-xs pointer-coarse:h-9">
                    开
                  </ToggleGroupItem>
                </ToggleGroup>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FormField>
  )
}
