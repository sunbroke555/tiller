// Add / edit a mount point, edit the root disk options, or mount an unused
// volume. Mirrors PVE.lxc.MountPointInputPanel: new volumes are written as
// "<storage>:<GiB>", bind mounts as the host path (root@pam only).

import { useState, type ReactNode } from 'react'
import { FolderInput, HardDrive, Plus, Trash2 } from 'lucide-react'

import { useNodeStorages } from '@/api/queries'
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
import { cn } from '@/lib/utils'

import { useFormState, ValidationError } from './hooks'
import {
  MOUNT_OPTIONS,
  ROOTFS_MOUNT_OPTIONS,
  formToMount,
  mountKind,
  mountPaths,
  mountSize,
  mountToForm,
  newMountForm,
  nextFreeIndex,
  parseIdMap,
  parseLxcMount,
  splitKey,
  splitVolume,
  stringifyIdMap,
  validateMountForm,
  type IdMapEntry,
  type MountForm,
} from './model'
import { Segmented, type LxcConfigApi } from './shared'

/** What the dialog edits: a new mount point, an existing rootfs/mp[n], or an unused[n] to mount. */
export type MountTargetKey = { mode: 'create' } | { mode: 'edit'; key: string } | { mode: 'attach'; key: string }

export function MountPointDialog({
  open,
  onOpenChange,
  api,
  target,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  api: LxcConfigApi
  target: MountTargetKey | undefined
}) {
  const mode = target?.mode ?? 'create'
  const sourceKey = target && target.mode !== 'create' ? target.key : undefined
  const isRoot = sourceKey === 'rootfs'
  const existing = sourceKey ? api.cfg[sourceKey] : undefined
  const unprivileged = api.cfg.unprivileged === '1'

  const [form, setForm] = useFormState<MountForm>(open, () =>
    mode === 'edit' && existing ? mountToForm(existing) : { ...newMountForm(), backup: true },
  )
  const [mpIndex, setMpIndex] = useFormState<number | undefined>(open, () => nextFreeIndex(api.cfg, 'mp') ?? undefined)
  const [attempted, setAttempted] = useFormState(open, () => false)
  // Remount the id map editor (it keeps rows of its own) every time the dialog opens.
  const [openKey] = useFormState(open, () => Math.random())
  const set = <K extends keyof MountForm>(key: K, value: MountForm[K]) => setForm((f) => ({ ...f, [key]: value }))

  // The volume this dialog is about (null for a new one).
  const volume = mode === 'create' ? null : parseLxcMount(existing).volume
  const kind = volume ? mountKind(volume) : form.kind
  const storageId = volume ? splitVolume(volume).storage : form.storage
  const { data: storages } = useNodeStorages(api.node, 'rootdir')
  const storageType = storages?.find((s) => s.storage === storageId)?.type
  const quotaAllowed = kind === 'volume' && !unprivileged && storageType !== 'zfs' && storageType !== 'zfspool'

  const key = mode === 'edit' ? sourceKey! : mpIndex !== undefined ? `mp${mpIndex}` : ''
  const keyTaken = mode !== 'edit' && !!key && key in api.cfg
  const errors = validateMountForm(form, {
    isRoot,
    isCreate: mode === 'create',
    otherPaths: mountPaths(api.cfg, mode === 'edit' ? sourceKey : undefined),
  })
  const shown = (field: keyof MountForm) => (attempted ? errors[field] : undefined)
  const mountOptions = isRoot ? ROOTFS_MOUNT_OPTIONS : MOUNT_OPTIONS

  const title =
    mode === 'create'
      ? '添加挂载点'
      : mode === 'attach'
        ? `挂载未使用的磁盘 ${splitKey(sourceKey!)?.index ?? ''}`
        : isRoot
          ? '根磁盘选项'
          : `挂载点 ${sourceKey}`

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="lg"
      submitLabel={mode === 'edit' ? '保存' : mode === 'attach' ? '挂载' : '添加'}
      description={
        api.running && mode !== 'edit'
          ? '容器运行中：能热插的挂载点会立即生效，否则在重启后生效。'
          : isRoot
            ? '根磁盘的存储和大小在“扩容”“迁移存储”里修改。'
            : undefined
      }
      onSubmit={async () => {
        setAttempted(true)
        if (Object.keys(errors).length || !key || keyTaken) throw new ValidationError()
        const value = formToMount(form, {
          key,
          previous: mode === 'edit' ? existing : undefined,
          volume: mode === 'attach' ? (volume ?? undefined) : undefined,
        })
        const verb = mode === 'create' ? '添加' : mode === 'attach' ? '挂载' : '修改'
        await api.save({ [key]: value }, `${verb}${isRoot ? '根磁盘' : `挂载点 ${key}`}`)
      }}
    >
      {mode === 'create' ? (
        <>
          <FormField label="类型">
            <Segmented
              aria-label="挂载点类型"
              value={form.kind}
              onChange={(k) => set('kind', k)}
              options={[
                { value: 'volume', label: '新建存储卷' },
                { value: 'bind', label: api.isRoot ? '绑定主机目录' : '绑定目录（仅 root）' },
              ]}
            />
          </FormField>
          {form.kind === 'bind' && !api.isRoot && (
            <p className="text-xs text-warning">只有 root@pam 可以添加绑定挂载。</p>
          )}
          {form.kind === 'volume' ? (
            <FormRow>
              <FormField label="存储" error={shown('storage')} required>
                <StorageSelect node={api.node} content="rootdir" value={form.storage} onValueChange={(s) => set('storage', s ?? '')} />
              </FormField>
              <FormField label="大小" error={shown('sizeGiB')} required>
                <NumberInput value={form.sizeGiB} onChange={(v) => set('sizeGiB', v)} min={0} decimal unit="GiB" />
              </FormField>
            </FormRow>
          ) : (
            <FormField label="主机路径" error={shown('hostPath')} hint="主机上已存在的目录，例如 /srv/share。" required>
              <FieldInput
                value={form.hostPath}
                onChange={(e) => set('hostPath', e.target.value)}
                placeholder="/srv/share"
                autoCapitalize="off"
                spellCheck={false}
                disabled={!api.isRoot}
              />
            </FormField>
          )}
        </>
      ) : (
        <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
          {kind === 'volume' ? (
            <HardDrive className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <FolderInput className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <div className="grid min-w-0 flex-1">
            <span className="truncate text-sm">{volume}</span>
            <span className="text-xs text-muted-foreground">
              {kind === 'volume' ? `存储卷${mountSize(parseLxcMount(existing)) ? ` · ${mountSize(parseLxcMount(existing))}` : ''}` : kind === 'bind' ? '绑定挂载' : '设备挂载'}
            </span>
          </div>
        </div>
      )}

      {!isRoot && (
        <FormRow>
          {mode !== 'edit' && (
            <FormField label="挂载点编号" error={keyTaken ? `${key} 已被占用` : undefined} hint={key ? `写入配置 ${key}` : undefined}>
              <NumberInput value={mpIndex} onChange={setMpIndex} min={0} max={255} />
            </FormField>
          )}
          <FormField label="容器内路径" name={key} error={shown('mp')} required className={mode === 'edit' ? 'sm:col-span-2' : undefined}>
            <FieldInput
              value={form.mp}
              onChange={(e) => set('mp', e.target.value)}
              placeholder="/mnt/data"
              autoCapitalize="off"
              spellCheck={false}
            />
          </FormField>
        </FormRow>
      )}

      {!isRoot && kind === 'volume' && (
        <SwitchField
          label="包含在备份中"
          description="备份容器时一并备份这个卷。"
          checked={form.backup}
          onCheckedChange={(v) => set('backup', v)}
        />
      )}

      <FormSection collapsible title="高级选项" defaultOpen={isRoot}>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {!isRoot && <CheckboxField label="只读" checked={form.ro} onCheckedChange={(v) => set('ro', v)} />}
          <CheckboxField
            label="启用配额"
            description={!quotaAllowed ? (unprivileged ? '非特权容器不支持' : kind !== 'volume' ? '绑定挂载不支持' : 'ZFS 不支持') : undefined}
            checked={form.quota && quotaAllowed}
            onCheckedChange={(v) => set('quota', v)}
            disabled={!quotaAllowed}
          />
          <CheckboxField
            label="跳过复制"
            description="存储复制时忽略这个卷。"
            checked={form.skipReplication}
            onCheckedChange={(v) => set('skipReplication', v)}
          />
          {!isRoot && (
            <CheckboxField
              label="保留属性"
              description="保留挂载目录原有的所有者和权限。"
              checked={form.keepattrs}
              onCheckedChange={(v) => set('keepattrs', v)}
            />
          )}
          {kind !== 'volume' && (
            <CheckboxField
              label="共享"
              description="这个路径在所有节点上都可用（迁移时不复制）。"
              checked={form.shared}
              onCheckedChange={(v) => set('shared', v)}
            />
          )}
        </div>
        {kind !== 'bind' && (
          <FormField label="ACL">
            <SelectField
              value={form.acl || undefined}
              onValueChange={(v) => set('acl', (v ?? '') as MountForm['acl'])}
              emptyOption="默认"
              options={[
                { value: '1', label: '启用' },
                { value: '0', label: '禁用' },
              ]}
            />
          </FormField>
        )}
        <FormField label="挂载选项">
          <div role="group" aria-label="挂载选项" className="flex flex-wrap gap-1.5">
            {mountOptions.map((o) => {
              const on = form.mountoptions.includes(o)
              return (
                <button
                  key={o}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    set('mountoptions', on ? form.mountoptions.filter((x) => x !== o) : [...form.mountoptions, o])
                  }
                  className={cn(
                    'h-9 rounded-full border border-input bg-(--field) px-3.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground pointer-coarse:h-10',
                    on && 'border-brand/50 bg-brand/12 text-foreground paper:bg-secondary',
                  )}
                >
                  {o}
                </button>
              )
            })}
          </div>
        </FormField>
        <IdMapEditor key={openKey} value={form.idmap} onChange={(v) => set('idmap', v)} error={shown('idmap')} />
      </FormSection>
    </FormDialog>
  )
}

// ------------------------------------------------------------- id map

interface Row extends Omit<IdMapEntry, 'ct' | 'host' | 'length'> {
  ct: number | undefined
  host: number | undefined
  length: number | undefined
}

/** ID mapping: passthrough or a list of uid/gid ranges (container → host). */
export function IdMapEditor({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string | undefined }) {
  const passthrough = value === 'passthrough'
  const [rows, setRows] = useState<Row[]>(() => (passthrough ? [] : (parseIdMap(value) ?? [])))
  const [stashed, setStashed] = useState('')

  const commit = (next: Row[]) => {
    setRows(next)
    const complete = next.filter(
      (r): r is IdMapEntry => r.ct !== undefined && r.host !== undefined && r.length !== undefined && r.length > 0,
    )
    onChange(stringifyIdMap(complete))
  }
  const update = (i: number, patch: Partial<Row>) => commit(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <FormField label="ID 映射" error={error} hint="把容器内的 UID/GID 范围映射到主机上的范围；留空使用默认映射。">
      <div className="grid gap-2">
        <SwitchField
          label="直通（passthrough）"
          description="容器内的 ID 与主机相同。"
          checked={passthrough}
          onCheckedChange={(on) => {
            if (on) {
              setStashed(value)
              onChange('passthrough')
            } else {
              onChange(stashed)
              setRows(parseIdMap(stashed) ?? [])
            }
          }}
        />
        {!passthrough && (
          <>
            {rows.length > 0 && (
              <ul className="grid gap-2">
                {rows.map((r, i) => (
                  <li
                    key={i}
                    className="grid grid-cols-2 gap-2 rounded-xl border border-border/70 p-2.5 sm:grid-cols-[6rem_1fr_1fr_1fr_auto] sm:items-end sm:border-0 sm:p-0"
                  >
                    <MiniField label="类型">
                      <SelectField
                        value={r.type}
                        onValueChange={(v) => update(i, { type: (v ?? 'u') as 'u' | 'g' })}
                        options={[
                          { value: 'u', label: 'UID' },
                          { value: 'g', label: 'GID' },
                        ]}
                        aria-label="ID 类型"
                      />
                    </MiniField>
                    <MiniField label="容器内起始">
                      <NumberInput value={r.ct} onChange={(ct) => update(i, { ct })} min={0} aria-label="容器内起始 ID" />
                    </MiniField>
                    <MiniField label="主机起始">
                      <NumberInput value={r.host} onChange={(host) => update(i, { host })} min={0} aria-label="主机起始 ID" />
                    </MiniField>
                    <MiniField label="数量">
                      <NumberInput value={r.length} onChange={(length) => update(i, { length })} min={1} aria-label="ID 数量" />
                    </MiniField>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="删除这条映射"
                      className="col-span-2 justify-self-end text-muted-foreground sm:col-span-1"
                      onClick={() => commit(rows.filter((_, j) => j !== i))}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start pointer-coarse:h-10"
              onClick={() => commit([...rows, { type: 'u', ct: 0, host: 100000, length: 65536 }])}
            >
              <Plus /> 添加映射
            </Button>
          </>
        )}
      </div>
    </FormField>
  )
}

function MiniField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}
