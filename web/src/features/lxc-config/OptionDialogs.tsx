// Dialogs of the container Options tab.

import { useId, useMemo, type ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'

import { get, p } from '@/api/client'
import { queryKeys, useNodeStorages } from '@/api/queries'
import {
  CheckboxField,
  FieldInput,
  FormDialog,
  FormField,
  FormRow,
  FormSection,
  NumberInput,
  SelectField,
  type SelectOption,
} from '@/components/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { useFormState, ValidationError } from './hooks'
import { keyLabel } from './labels'
import { parseEnv, parseFeatures, parseStartup, stringifyEnv, stringifyFeatures, stringifyStartup, validateEnv, type EnvVar, type Features } from './model'
import { useDialogConfig, type LxcConfigApi } from './shared'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  api: LxcConfigApi
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs leading-relaxed text-foreground/85">
      <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning-strong" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

// --------------------------------------------------------------- select

export function SelectOptionDialog({
  open,
  onOpenChange,
  api: liveApi,
  configKey,
  options,
  emptyOption,
  hint,
  warning,
}: DialogProps & {
  configKey: string | undefined
  options: readonly SelectOption[]
  /** "默认 (tty)": picking it deletes the key. */
  emptyOption?: string
  hint?: string
  warning?: string
}) {
  const api = useDialogConfig(liveApi, open)
  const [value, setValue] = useFormState<string | undefined>(open, () => (configKey ? api.cfg[configKey] : undefined))
  const label = configKey ? keyLabel(configKey) : ''
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={label}
      submitDisabled={!emptyOption && !value}
      onSubmit={async () => {
        if (!configKey) return
        await api.save({ [configKey]: value }, `修改${label}`)
      }}
    >
      <FormField label={label} name={configKey} hint={hint}>
        <SelectField value={value} onValueChange={setValue} options={options} emptyOption={emptyOption} />
      </FormField>
      {warning && <Warning>{warning}</Warning>}
    </FormDialog>
  )
}

// ------------------------------------------------------------------ tty

export function TtyDialog({ open, onOpenChange, api: liveApi }: DialogProps) {
  const api = useDialogConfig(liveApi, open)
  const [value, setValue] = useFormState<number | undefined>(open, () => (api.cfg.tty ? Number(api.cfg.tty) : undefined))
  const error = value !== undefined && (value < 0 || value > 6) ? '范围 0–6' : undefined
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="TTY 数量"
      description="容器可用的虚拟终端（/dev/tty1…）数量。"
      onSubmit={async () => {
        if (error) throw new ValidationError()
        await api.save({ tty: value }, '修改 TTY 数量')
      }}
    >
      <FormField label="TTY 数量" name="tty" error={error} hint="留空使用默认值 2。">
        <NumberInput value={value} onChange={setValue} min={0} max={6} stepper placeholder="2" />
      </FormField>
    </FormDialog>
  )
}

// -------------------------------------------------------------- startup

export function StartupDialog({ open, onOpenChange, api: liveApi }: DialogProps) {
  const api = useDialogConfig(liveApi, open)
  const [form, setForm] = useFormState(open, () => parseStartup(api.cfg.startup))
  const bad = (v: number | undefined) => v !== undefined && (v < 0 || !Number.isInteger(v))
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="启动/关机顺序"
      description="节点开机时按顺序从小到大启动开启了“开机自启”的客户机，关机时反向。"
      onSubmit={async () => {
        if (bad(form.order) || bad(form.up) || bad(form.down)) throw new ValidationError('请填写非负整数')
        await api.save({ startup: stringifyStartup(form) }, '修改启动/关机顺序')
      }}
    >
      <FormField label="启动顺序" name="startup" hint="留空表示不限（排在有顺序的客户机之后）。">
        <NumberInput value={form.order} onChange={(order) => setForm((f) => ({ ...f, order }))} min={0} placeholder="不限" />
      </FormField>
      <FormRow>
        <FormField label="启动延迟" hint="启动后等待多久再启动下一台。">
          <NumberInput value={form.up} onChange={(up) => setForm((f) => ({ ...f, up }))} min={0} unit="秒" placeholder="默认" />
        </FormField>
        <FormField label="关机超时" hint="等待关机完成的最长时间。">
          <NumberInput value={form.down} onChange={(down) => setForm((f) => ({ ...f, down }))} min={0} unit="秒" placeholder="默认" />
        </FormField>
      </FormRow>
    </FormDialog>
  )
}

// ------------------------------------------------------------- features

export function FeaturesDialog({ open, onOpenChange, api: liveApi }: DialogProps) {
  const api = useDialogConfig(liveApi, open)
  const unprivileged = api.cfg.unprivileged === '1'
  const [f, setF] = useFormState<Features>(open, () => parseFeatures(api.cfg.features))
  const set = (k: keyof Features, v: boolean) => setF((x) => ({ ...x, [k]: v }))
  const locked = !api.isRoot && !unprivileged
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="特性"
      description="允许容器使用的高级功能。运行中的容器在重启后生效。"
      onSubmit={async () => {
        const value = stringifyFeatures(f)
        await api.save({ features: value || undefined }, '修改容器特性')
      }}
    >
      {locked && <Warning>特权容器的特性只有 root@pam 可以修改。</Warning>}
      <div className="grid">
        <CheckboxField
          label="嵌套（nesting）"
          description="允许在容器里运行容器或 systemd 的部分新功能，现代发行版通常需要开启。"
          checked={f.nesting}
          onCheckedChange={(v) => set('nesting', v)}
        />
        <CheckboxField
          label="keyctl"
          description={unprivileged ? '允许使用 keyctl() 系统调用（Docker 等需要）。' : '仅非特权容器可用。'}
          checked={f.keyctl}
          onCheckedChange={(v) => set('keyctl', v)}
          disabled={!unprivileged}
        />
        <CheckboxField label="FUSE" description="允许在容器内使用 FUSE 文件系统。" checked={f.fuse} onCheckedChange={(v) => set('fuse', v)} />
        <CheckboxField
          label="创建设备节点（mknod）"
          description="实验性功能：允许通过 mknod 创建部分设备节点。"
          checked={f.mknod}
          onCheckedChange={(v) => set('mknod', v)}
        />
        <CheckboxField
          label="挂载 NFS"
          description={unprivileged ? '仅特权容器可用。' : '允许在容器内挂载 NFS。'}
          checked={f.nfs}
          onCheckedChange={(v) => set('nfs', v)}
          disabled={unprivileged}
        />
        <CheckboxField
          label="挂载 SMB/CIFS"
          description={unprivileged ? '仅特权容器可用。' : '允许在容器内挂载 SMB/CIFS。'}
          checked={f.cifs}
          onCheckedChange={(v) => set('cifs', v)}
          disabled={unprivileged}
        />
      </div>
      <FormSection collapsible title="高级选项" defaultOpen={f.forceRwSys}>
        <CheckboxField
          label="force_rw_sys"
          description="以可读写方式挂载 /sys（默认是混合模式），可能降低隔离性。"
          checked={f.forceRwSys}
          onCheckedChange={(v) => set('forceRwSys', v)}
        />
        {f.otherMounts.length > 0 && (
          <p className="text-xs text-muted-foreground">其他允许挂载的文件系统：{f.otherMounts.join('、')}（保持不变）</p>
        )}
      </FormSection>
    </FormDialog>
  )
}

// ----------------------------------------------------------- hookscript

export function HookscriptDialog({ open, onOpenChange, api: liveApi }: DialogProps) {
  const api = useDialogConfig(liveApi, open)
  const [value, setValue] = useFormState(open, () => api.cfg.hookscript ?? '')
  const listId = useId()
  const { data: storages = [] } = useNodeStorages(open ? api.node : null, 'snippets')
  const contents = useQueries({
    queries: storages.map((s) => ({
      queryKey: [...queryKeys.storage(api.node, s.storage), 'content', 'snippets'],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        get<{ volid: string }[]>(p`/nodes/${api.node}/storage/${s.storage}/content`, { content: 'snippets' }, { signal }),
      enabled: open,
      staleTime: 30_000,
    })),
  })
  const snippets = useMemo(() => contents.flatMap((c) => c.data ?? []).map((c) => c.volid), [contents])
  const trimmed = value.trim()
  const error = trimmed && !/^[a-z][a-z0-9\-_.]*[a-z0-9]:snippets\/\S+$/i.test(trimmed) ? '格式为 <存储>:snippets/<文件名>' : undefined
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="钩子脚本"
      description="容器启动、停止等阶段执行的脚本，需要放在支持 snippets 内容的存储上。"
      onSubmit={async () => {
        if (error) throw new ValidationError()
        await api.save({ hookscript: trimmed }, '修改钩子脚本')
      }}
    >
      <FormField
        label="脚本"
        name="hookscript"
        error={error}
        hint={
          storages.length === 0
            ? '这个节点上没有启用 snippets 内容的存储。'
            : snippets.length
              ? `可选：${snippets.length} 个脚本。留空表示不使用。`
              : '留空表示不使用。'
        }
      >
        <FieldInput
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="local:snippets/hook.pl"
          list={listId}
          autoCapitalize="off"
          spellCheck={false}
        />
      </FormField>
      <datalist id={listId}>
        {snippets.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </FormDialog>
  )
}

// ------------------------------------------------------------- timezone

const COMMON_ZONES = ['host', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC']

function allZones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    return intl.supportedValuesOf?.('timeZone') ?? []
  } catch {
    return []
  }
}

export function TimezoneDialog({ open, onOpenChange, api: liveApi }: DialogProps) {
  const api = useDialogConfig(liveApi, open)
  const [value, setValue] = useFormState(open, () => api.cfg.timezone ?? '')
  const listId = useId()
  const zones = useMemo(() => ['host', ...allZones()], [])
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="时区"
      description="容器启动时设置的时区。留空表示不修改容器内的设置。"
      onSubmit={() => api.save({ timezone: value.trim() }, '修改时区')}
    >
      <FormField label="时区" name="timezone" hint="host 表示与主机相同，或填写 /usr/share/zoneinfo 下的时区名。">
        <FieldInput
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="不设置"
          list={listId}
          autoCapitalize="off"
          spellCheck={false}
        />
      </FormField>
      <datalist id={listId}>
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      <div role="group" aria-label="常用时区" className="flex flex-wrap gap-1.5">
        {COMMON_ZONES.map((z) => (
          <button
            key={z}
            type="button"
            aria-pressed={value === z}
            onClick={() => setValue(z)}
            className={cn(
              'h-8 rounded-full border border-input bg-(--field) px-3 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground pointer-coarse:h-9',
              value === z && 'border-brand/40 bg-brand/10 text-foreground paper:bg-secondary',
            )}
          >
            {z === 'host' ? '跟随主机' : z}
          </button>
        ))}
      </div>
    </FormDialog>
  )
}

// ----------------------------------------------------------- entrypoint

export function EntrypointDialog({ open, onOpenChange, api: liveApi }: DialogProps) {
  const api = useDialogConfig(liveApi, open)
  const [value, setValue] = useFormState(open, () => api.cfg.entrypoint ?? '')
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="入口命令"
      description="容器启动时作为 init 运行的命令，可以带参数。"
      onSubmit={async () => {
        if (/[\x00-\x08\x0a-\x1f\x7f]/.test(value)) throw new ValidationError('不能包含控制字符')
        await api.save({ entrypoint: value.trim() }, '修改入口命令')
      }}
    >
      <FormField label="命令" name="entrypoint" hint="留空使用默认的 /sbin/init。">
        <FieldInput
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="/sbin/init"
          autoCapitalize="off"
          spellCheck={false}
          className="font-mono"
        />
      </FormField>
      <Warning>修改入口命令可能导致容器无法启动。</Warning>
    </FormDialog>
  )
}

// ------------------------------------------------------------------ env

export function EnvDialog({ open, onOpenChange, api: liveApi }: DialogProps) {
  const api = useDialogConfig(liveApi, open)
  const [rows, setRows] = useFormState<EnvVar[]>(open, () => {
    const vars = parseEnv(api.cfg.env)
    return vars.length ? vars : [{ name: '', value: '' }]
  })
  const [attempted, setAttempted] = useFormState(open, () => false)
  const errors = validateEnv(rows)
  const update = (i: number, patch: Partial<EnvVar>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="环境变量"
      description="容器运行时的环境变量（主要用于 OCI 应用容器）。"
      onSubmit={async () => {
        setAttempted(true)
        if (Object.keys(errors).length) throw new ValidationError()
        await api.save({ env: stringifyEnv(rows) }, '修改环境变量')
      }}
    >
      <ul className="grid gap-2" aria-label="环境变量">
        {rows.map((r, i) => (
          <li key={i} className="grid gap-1">
            <div className="flex items-center gap-2">
              <Input
                value={r.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="名称"
                aria-label={`第 ${i + 1} 个变量的名称`}
                aria-invalid={attempted && !!errors[i] ? true : undefined}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className="w-[40%] font-mono text-base md:text-sm"
              />
              <span aria-hidden className="text-muted-foreground">
                =
              </span>
              <Input
                value={r.value}
                onChange={(e) => update(i, { value: e.target.value })}
                placeholder="值"
                aria-label={`第 ${i + 1} 个变量的值`}
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 font-mono text-base md:text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`删除第 ${i + 1} 个变量`}
                className="text-muted-foreground"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
            {attempted && errors[i] && <p className="text-xs text-destructive">{errors[i]}</p>}
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start pointer-coarse:h-10"
        onClick={() => setRows((r) => [...r, { name: '', value: '' }])}
      >
        <Plus /> 添加变量
      </Button>
    </FormDialog>
  )
}
