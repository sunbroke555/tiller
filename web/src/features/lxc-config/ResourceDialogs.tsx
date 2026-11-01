// Dialogs of the Resources tab: memory, CPU, resize, move storage, reassign
// owner and device passthrough. The mount point editor is MountPointDialog.

import { useMemo } from 'react'
import { ArrowRight, Info } from 'lucide-react'

import { moveLxcVolume, reassignLxcVolume, resizeLxcVolume, useLxcConfig as useOtherLxcConfig } from '@/api/lxc-config'
import { queryKeys, useClusterResources } from '@/api/queries'
import { isGuest, isNode } from '@/api/types'
import {
  CheckboxField,
  FieldInput,
  FormDialog,
  FormField,
  FormRow,
  FormSection,
  NumberInput,
  SelectField,
  SizeInput,
  StorageSelect,
  SwitchField,
} from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { formatBytes } from '@/lib/format'
import { guestName } from '@/lib/resources'
import { parsePveSize } from '@/lib/size'
import { cn } from '@/lib/utils'

import { useFormState, ValidationError } from './hooks'
import {
  cpuUnitsRange,
  deviceToForm,
  formToDevice,
  keysWithPrefix,
  nextFreeIndex,
  parseLxcMount,
  splitKey,
  splitVolume,
  validateDeviceForm,
} from './model'
import { Segmented, useDialogConfig, type LxcConfigApi } from './shared'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  api: LxcConfigApi
}

/** 4096 → "4 GiB", 512 → "512 MiB". */
export function formatMiB(v: number | string | undefined): string {
  const n = Number(v)
  if (v === undefined || v === '' || !Number.isFinite(n)) return '—'
  return n >= 1024 && n % 1024 === 0 ? `${n / 1024} GiB` : `${n} MiB`
}

function Presets<T extends number>({
  values,
  current,
  onPick,
  format,
  label,
}: {
  values: readonly T[]
  current: number | undefined
  onPick: (v: T) => void
  format: (v: T) => string
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          aria-pressed={current === v}
          className={cn(
            'h-8 rounded-full border border-input bg-(--field) px-3 text-xs text-muted-foreground tabular transition-colors hover:bg-accent hover:text-foreground pointer-coarse:h-9',
            current === v && 'border-brand/40 bg-brand/10 text-foreground paper:bg-secondary',
          )}
        >
          {format(v)}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- memory

export function MemoryDialog({ open, onOpenChange, api: liveApi }: DialogProps) {
  const api = useDialogConfig(liveApi, open)
  const [form, setForm] = useFormState<{ memory: number | undefined; swap: number | undefined }>(open, () => ({
    memory: Number(api.cfg.memory ?? 512),
    swap: Number(api.cfg.swap ?? 512),
  }))
  const errors = {
    memory: form.memory === undefined || !(form.memory >= 16) ? '最少 16 MiB' : undefined,
    swap: form.swap === undefined || form.swap < 0 ? '请填写交换分区大小（0 表示不使用）' : undefined,
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="内存与交换分区"
      description={api.running ? '修改会立即应用到运行中的容器。' : undefined}
      onSubmit={async () => {
        if (errors.memory || errors.swap) throw new ValidationError()
        await api.save({ memory: form.memory, swap: form.swap }, `修改 ${api.name} 的内存`)
      }}
    >
      <FormField label="内存" name="memory" error={errors.memory} required>
        <SizeInput value={form.memory} onChange={(memory) => setForm((f) => ({ ...f, memory }))} min={16} />
      </FormField>
      <Presets
        label="常用内存大小"
        values={[256, 512, 1024, 2048, 4096, 8192] as const}
        current={form.memory}
        onPick={(memory) => setForm((f) => ({ ...f, memory }))}
        format={formatMiB}
      />
      <FormField label="交换分区" name="swap" error={errors.swap} hint="0 表示不使用交换分区。">
        <SizeInput value={form.swap} onChange={(swap) => setForm((f) => ({ ...f, swap }))} min={0} />
      </FormField>
    </FormDialog>
  )
}

// ------------------------------------------------------------------- CPU

export function CpuDialog({ open, onOpenChange, api: liveApi }: DialogProps) {
  const api = useDialogConfig(liveApi, open)
  const { data: nodeInfo } = useClusterResources({
    select: (all) => all.filter(isNode).find((n) => n.node === api.node),
  })
  const units = cpuUnitsRange(nodeInfo?.['cgroup-mode'])
  const hostCpus = nodeInfo?.maxcpu
  const [form, setForm] = useFormState(open, () => ({
    cores: api.cfg.cores ? Number(api.cfg.cores) : undefined,
    cpulimit: api.cfg.cpulimit && api.cfg.cpulimit !== '0' ? Number(api.cfg.cpulimit) : undefined,
    cpuunits: api.cfg.cpuunits ? Number(api.cfg.cpuunits) : undefined,
  }))
  const errors = {
    cores: form.cores !== undefined && (form.cores < 1 || form.cores > 8192) ? '范围 1–8192' : undefined,
    cpulimit: form.cpulimit !== undefined && (form.cpulimit < 0 || form.cpulimit > 8192) ? '范围 0–8192' : undefined,
    cpuunits:
      form.cpuunits !== undefined && (form.cpuunits < 8 || form.cpuunits > units.max) ? `范围 8–${units.max}` : undefined,
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="处理器"
      description={api.running ? '修改会立即应用到运行中的容器。' : undefined}
      onSubmit={async () => {
        if (errors.cores || errors.cpulimit || errors.cpuunits) throw new ValidationError()
        await api.save(
          {
            cores: form.cores,
            cpulimit: form.cpulimit ? form.cpulimit : undefined,
            cpuunits: form.cpuunits === units.def ? undefined : form.cpuunits,
          },
          `修改 ${api.name} 的处理器`,
        )
      }}
    >
      <FormField
        label="核心数"
        name="cores"
        error={errors.cores}
        hint={`留空表示可以使用主机的全部核心${hostCpus ? `（${hostCpus} 个）` : ''}。`}
      >
        <NumberInput
          value={form.cores}
          onChange={(cores) => setForm((f) => ({ ...f, cores }))}
          min={1}
          max={8192}
          stepper
          placeholder="不限"
          unit="核"
        />
      </FormField>
      <FormRow>
        <FormField label="CPU 限制" name="cpulimit" error={errors.cpulimit} hint="1 表示一个核心的全部时间；留空或 0 表示不限。">
          <NumberInput
            value={form.cpulimit}
            onChange={(cpulimit) => setForm((f) => ({ ...f, cpulimit }))}
            min={0}
            max={8192}
            decimal
            placeholder="不限"
          />
        </FormField>
        <FormField
          label="CPU 权重"
          name="cpuunits"
          error={errors.cpuunits}
          hint={`与其他客户机争用 CPU 时的相对权重，默认 ${units.def}。`}
        >
          <NumberInput
            value={form.cpuunits}
            onChange={(cpuunits) => setForm((f) => ({ ...f, cpuunits }))}
            min={8}
            max={units.max}
            placeholder={String(units.def)}
          />
        </FormField>
      </FormRow>
    </FormDialog>
  )
}

// ---------------------------------------------------------------- resize

export function ResizeDialog({ open, onOpenChange, api, disk }: DialogProps & { disk: string | undefined }) {
  const value = disk ? api.cfg[disk] : undefined
  const mount = parseLxcMount(value)
  const current = parsePveSize(mount.size)
  const [add, setAdd] = useFormState<number | undefined>(open, () => 1)
  const error = add === undefined || !(add > 0) ? '请填写要增加的大小' : add > 131072 ? '一次最多增加 128 TiB' : undefined
  const after = current !== null && add ? current + add * 1024 ** 3 : null
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`扩容 ${disk === 'rootfs' ? '根磁盘' : (disk ?? '')}`}
      description="只能增大，不能缩小。文件系统会在线扩展。"
      submitLabel="扩容"
      onSubmit={async () => {
        if (error || !disk) throw new ValidationError()
        await runTask(resizeLxcVolume(api.node, api.vmid, disk, add!, api.config?.digest), {
          title: `扩容 ${api.name} 的 ${disk}`,
          invalidate: [queryKeys.guest(api.node, 'lxc', api.vmid)],
        })
      }}
    >
      <div className="grid gap-1 rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
        <span className="truncate text-xs text-muted-foreground">{mount.volume}</span>
        <span className="flex flex-wrap items-center gap-2 tabular">
          {current !== null ? formatBytes(current) : '大小未知'}
          {after !== null && (
            <>
              <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="font-medium text-foreground">{formatBytes(after)}</span>
            </>
          )}
        </span>
      </div>
      <FormField label="增加" name="size" error={error} required>
        <NumberInput value={add} onChange={setAdd} min={0} decimal unit="GiB" />
      </FormField>
      <Presets label="常用增量" values={[1, 4, 8, 16, 32] as const} current={add} onPick={setAdd} format={(v) => `+${v} GiB`} />
    </FormDialog>
  )
}

// ------------------------------------------------------------ move volume

export function MoveVolumeDialog({ open, onOpenChange, api, disk }: DialogProps & { disk: string | undefined }) {
  const mount = parseLxcMount(disk ? api.cfg[disk] : undefined)
  const source = splitVolume(mount.volume).storage
  const [form, setForm] = useFormState(open, () => ({
    storage: undefined as string | undefined,
    deleteSource: false,
    bwlimit: undefined as number | undefined,
  }))
  const filter = useMemo(() => (s: { storage: string }) => s.storage !== source, [source])
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`迁移存储：${disk === 'rootfs' ? '根磁盘' : (disk ?? '')}`}
      description="把卷复制到另一个存储。容器需要先关机。"
      submitLabel="迁移"
      submitDisabled={!form.storage}
      onSubmit={async () => {
        if (!disk || !form.storage) throw new ValidationError('请选择目标存储')
        await runTask(
          moveLxcVolume(api.node, api.vmid, {
            volume: disk,
            storage: form.storage,
            delete: form.deleteSource,
            bwlimit: form.bwlimit ? Math.round(form.bwlimit * 1024) : undefined,
            digest: api.config?.digest,
          }),
          { title: `迁移 ${api.name} 的 ${disk} 到 ${form.storage}`, invalidate: [queryKeys.guest(api.node, 'lxc', api.vmid)] },
        )
      }}
    >
      <div className="grid gap-1 rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
        <span className="text-xs text-muted-foreground">当前位置</span>
        <span className="truncate">{mount.volume}</span>
      </div>
      <FormField label="目标存储" name="storage" required>
        <StorageSelect
          node={api.node}
          content="rootdir"
          value={form.storage}
          onValueChange={(storage) => setForm((f) => ({ ...f, storage }))}
          filter={filter}
          autoSelect={false}
        />
      </FormField>
      <SwitchField
        label="删除源卷"
        description="关闭时旧卷会保留为“未使用的磁盘”。"
        checked={form.deleteSource}
        onCheckedChange={(deleteSource) => setForm((f) => ({ ...f, deleteSource }))}
      />
      <FormSection collapsible title="高级选项">
        <FormField label="带宽限制" name="bwlimit" hint="留空使用数据中心或存储的默认限制。">
          <NumberInput
            value={form.bwlimit}
            onChange={(bwlimit) => setForm((f) => ({ ...f, bwlimit }))}
            min={0}
            decimal
            unit="MiB/s"
            placeholder="默认"
          />
        </FormField>
      </FormSection>
    </FormDialog>
  )
}

// -------------------------------------------------------- reassign owner

export function ReassignDialog({ open, onOpenChange, api, disk }: DialogProps & { disk: string | undefined }) {
  const sourceUnused = !!disk && splitKey(disk)?.prefix === 'unused'
  const { data: targets = [] } = useClusterResources({
    select: (all) =>
      all
        .filter(isGuest)
        .filter((g) => g.type === 'lxc' && g.node === api.node && g.vmid !== api.vmid && g.template !== 1)
        .sort((a, b) => a.vmid - b.vmid),
  })
  const [form, setForm] = useFormState(open, () => ({
    target: undefined as number | undefined,
    kind: (sourceUnused ? 'unused' : 'mp') as 'mp' | 'unused',
    index: undefined as number | undefined,
  }))
  const targetConfig = useOtherLxcConfig(api.node, open ? form.target : undefined)
  const used = targetConfig.data ? keysWithPrefix(targetConfig.data, form.kind) : []
  const free = targetConfig.data ? nextFreeIndex(targetConfig.data, form.kind) : null
  const index = form.index ?? free ?? undefined
  const targetKey = index !== undefined ? `${form.kind}${index}` : undefined
  const taken = !!targetKey && used.includes(targetKey)
  const mount = parseLxcMount(disk ? api.cfg[disk] : undefined)
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`转移所有者：${disk ?? ''}`}
      description="把这个卷交给同一节点上的另一个容器，它会从当前容器中移除。"
      submitLabel="转移"
      submitDisabled={!form.target || !targetKey || taken || targetConfig.isPending}
      onSubmit={async () => {
        if (!disk || !form.target || !targetKey) throw new ValidationError('请选择目标容器')
        await runTask(
          reassignLxcVolume(api.node, api.vmid, {
            volume: disk,
            targetVmid: form.target,
            targetVolume: targetKey,
            digest: api.config?.digest,
            targetDigest: typeof targetConfig.data?.digest === 'string' ? targetConfig.data.digest : undefined,
          }),
          { title: `转移 ${disk} 到 CT ${form.target}`, invalidate: [queryKeys.node(api.node)] },
        )
      }}
    >
      <div className="grid gap-1 rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
        <span className="text-xs text-muted-foreground">卷</span>
        <span className="truncate">{mount.volume}</span>
      </div>
      <FormField label="目标容器" name="target-vmid" required>
        <SelectField
          value={form.target !== undefined ? String(form.target) : undefined}
          onValueChange={(v) => setForm((f) => ({ ...f, target: v ? Number(v) : undefined, index: undefined }))}
          options={targets.map((g) => ({
            value: String(g.vmid),
            label: `${g.vmid} · ${guestName(g)}`,
            description: g.status === 'running' ? '运行中' : '已停止',
          }))}
          placeholder={targets.length ? '选择容器' : '这个节点上没有其他容器'}
          disabled={targets.length === 0}
        />
      </FormField>
      <FormRow>
        <FormField label="挂载为">
          <Segmented
            aria-label="目标类型"
            value={form.kind}
            onChange={(kind) => setForm((f) => ({ ...f, kind, index: undefined }))}
            options={[
              { value: 'mp', label: '挂载点' },
              { value: 'unused', label: '未使用的磁盘' },
            ]}
            disabled={sourceUnused}
          />
        </FormField>
        <FormField
          label="目标编号"
          name="target-volume"
          error={taken ? `${targetKey} 已被占用` : undefined}
          hint={targetKey ? `将写入目标容器的 ${targetKey}` : undefined}
        >
          <NumberInput
            value={index}
            onChange={(i) => setForm((f) => ({ ...f, index: i }))}
            min={0}
            max={255}
            disabled={!form.target}
            placeholder={form.target ? '自动' : '先选择容器'}
          />
        </FormField>
      </FormRow>
      {sourceUnused && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          未使用的磁盘只能作为“未使用的磁盘”转移，之后可以在目标容器里挂载。
        </p>
      )}
    </FormDialog>
  )
}

// ---------------------------------------------------------------- device

export function DeviceDialog({ open, onOpenChange, api: liveApi, devKey }: DialogProps & { devKey: string | undefined }) {
  const api = useDialogConfig(liveApi, open)
  const isCreate = !devKey
  const [form, setForm] = useFormState(open, () => deviceToForm(devKey ? api.cfg[devKey] : undefined))
  const errors = validateDeviceForm(form)
  const key = devKey ?? `dev${nextFreeIndex(api.cfg, 'dev') ?? 0}`
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isCreate ? '添加设备直通' : `设备 ${devKey}`}
      description="把主机上的设备节点直通给容器（仅 root@pam）。"
      submitLabel={isCreate ? '添加' : '保存'}
      onSubmit={async () => {
        if (Object.keys(errors).length) throw new ValidationError()
        await api.save({ [key]: formToDevice(form) }, `${isCreate ? '添加' : '修改'}设备 ${key}`)
      }}
    >
      <FormField label="设备路径" name={key} error={form.path ? errors.path : undefined} required>
        <FieldInput
          value={form.path}
          onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
          placeholder="/dev/dri/renderD128"
          autoCapitalize="off"
          spellCheck={false}
        />
      </FormField>
      <FormRow>
        <FormField label="容器内 UID" error={errors.uid}>
          <NumberInput value={form.uid} onChange={(uid) => setForm((f) => ({ ...f, uid }))} min={0} placeholder="0" />
        </FormField>
        <FormField label="容器内 GID" error={errors.gid}>
          <NumberInput value={form.gid} onChange={(gid) => setForm((f) => ({ ...f, gid }))} min={0} placeholder="0" />
        </FormField>
      </FormRow>
      <FormField label="访问权限" error={errors.mode} hint="八进制，留空为 0660。">
        <FieldInput
          value={form.mode}
          onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}
          placeholder="0660"
          inputMode="numeric"
          className="tabular"
        />
      </FormField>
      <CheckboxField
        label="只读"
        description="禁止容器写入这个设备。"
        checked={form.denyWrite}
        onCheckedChange={(denyWrite) => setForm((f) => ({ ...f, denyWrite }))}
      />
    </FormDialog>
  )
}
