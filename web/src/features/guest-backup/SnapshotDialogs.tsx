// Dialogs of the snapshot tab: take, rollback, delete, and the details sheet
// (description edit + stored config).

import { useEffect, useId, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { History, Loader2, MemoryStick, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  backupKeys,
  createSnapshot,
  deleteSnapshot,
  rollbackSnapshot,
  updateSnapshotDescription,
  useGuestConfig,
  useSnapshotConfig,
  useSnapshotFeature,
  useSnapshots,
  type Snapshot,
} from '@/api/guest-backup'
import type { GuestType } from '@/api/types'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { CheckboxField, FieldInput, FieldTextarea, FormDialog, FormField, FormSection, SwitchField } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { errorMessage } from '@/lib/errors'
import { DASH, formatDateTime, formatRelativeTime } from '@/lib/format'

import { agentEnabled, suggestSnapshotName, validateSnapshotName } from './logic'
import { Chip, ConfigLines, InfoList, Notice, useVmCap } from './ui'

export interface SnapshotGuest {
  node: string
  type: GuestType
  vmid: number
  /** Display name ("web-01" / "VM 100"). */
  name: string
  running: boolean
  /** Lock of the guest (backup, snapshot, rollback…), blocks snapshot operations. */
  lock?: string | undefined
  /** Resource pool, for permission checks. */
  pool?: string | undefined
}

const kind = (type: GuestType) => (type === 'qemu' ? '虚拟机' : '容器')

// ------------------------------------------------------------------ take

export function TakeSnapshotDialog({ guest, open, onOpenChange }: { guest: SnapshotGuest; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { node, type, vmid } = guest
  const snapshots = useSnapshots(node, type, vmid)
  const feature = useSnapshotFeature(node, type, vmid, open)
  const config = useGuestConfig(node, type, vmid, open && type === 'qemu' && guest.running)
  const existing = useMemo(() => (snapshots.data ?? []).map((s) => s.name), [snapshots.data])

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [vmstate, setVmstate] = useState(true)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (open) {
      setName(suggestSnapshotName(new Date(), existing))
      setDescription('')
      setVmstate(true)
      setTouched(false)
    }
    // Reset only when the dialog opens.
  }, [open])

  const nameError = validateSnapshotName(name, existing)
  const canRam = type === 'qemu' && guest.running
  const noAgent = canRam && config.data !== undefined && !agentEnabled(config.data.agent)
  const unsupported = feature.data === false

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="创建快照"
      description={`${kind(type)} ${guest.name}（${vmid}）`}
      submitLabel="创建快照"
      submitDisabled={!!nameError || unsupported || !!guest.lock}
      onSubmit={async () => {
        setTouched(true)
        if (nameError) throw new Error(nameError)
        const snapname = name.trim()
        await runTask(createSnapshot(node, type, vmid, { snapname, description: description.trim(), vmstate: canRam && vmstate }), {
          title: `创建快照 ${snapname}（${guest.name}）`,
        })
      }}
    >
      {unsupported && <Notice tone="warning">当前配置不支持快照：有磁盘所在的存储不支持快照（例如 raw 格式的目录存储），或者挂载了不能快照的设备。</Notice>}
      {guest.lock && <Notice tone="warning">客户机已锁定（{guest.lock}），等当前操作结束后再创建快照。</Notice>}
      <FormField label="名称" name="snapname" required error={touched || name ? nameError : undefined} hint="字母开头，可包含字母、数字、- 和 _">
        <FieldInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          className="font-mono"
        />
      </FormField>
      {canRam && (
        <SwitchField
          label="包含内存（RAM）"
          description="回滚时恢复到完全相同的运行状态。快照更慢，也会占用与内存相当的空间。"
          checked={vmstate}
          onCheckedChange={setVmstate}
        />
      )}
      {noAgent && !vmstate && (
        <Notice tone="warning">运行中的虚拟机未启用 QEMU Guest Agent。建议包含内存，或启用 Guest Agent，避免文件系统不一致。</Notice>
      )}
      <FormField label="描述" name="description">
        <FieldTextarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="例如：升级前" className="min-h-20" />
      </FormField>
    </FormDialog>
  )
}

// -------------------------------------------------------------- rollback

export function RollbackSnapshotDialog({
  guest,
  snapshot,
  open,
  onOpenChange,
}: {
  guest: SnapshotGuest
  snapshot: Snapshot | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [start, setStart] = useState(false)
  useEffect(() => {
    if (open) setStart(guest.running)
  }, [open])
  const withRam = snapshot?.vmstate === 1
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={`回滚到 ${snapshot?.name ?? ''}？`}
      description={`${kind(guest.type)} ${guest.name}（${guest.vmid}）`}
      submitLabel="回滚"
      destructive
      submitDisabled={!snapshot || !!guest.lock}
      onSubmit={async () => {
        if (!snapshot) return
        await runTask(rollbackSnapshot(guest.node, guest.type, guest.vmid, snapshot.name, { start: !withRam && start }), {
          title: `回滚 ${guest.name} 到 ${snapshot.name}`,
        })
      }}
    >
      <Notice tone="warning">当前状态会丢失：自这个快照以来的所有磁盘和配置改动都会被丢弃，且无法撤销。</Notice>
      {guest.lock && <Notice tone="error">客户机已锁定（{guest.lock}），暂时不能回滚。</Notice>}
      {withRam ? (
        <Notice>这个快照包含内存，回滚后会自动恢复到当时的运行状态。</Notice>
      ) : (
        <SwitchField label="回滚后启动" description={`回滚完成后自动启动${kind(guest.type)}`} checked={start} onCheckedChange={setStart} />
      )}
    </FormDialog>
  )
}

// ---------------------------------------------------------------- delete

export function DeleteSnapshotDialog({
  guest,
  snapshot,
  open,
  onOpenChange,
}: {
  guest: SnapshotGuest
  snapshot: Snapshot | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [force, setForce] = useState(false)
  const [typed, setTyped] = useState('')
  const confirmId = useId()
  useEffect(() => {
    if (open) {
      setForce(false)
      setTyped('')
    }
  }, [open])
  // Irreversible: type the snapshot name, like other deletions.
  const confirmed = !!snapshot && typed.trim() === snapshot.name
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={`删除快照 ${snapshot?.name ?? ''}？`}
      description="快照中的数据会被永久删除，当前状态不受影响。"
      submitLabel="删除"
      destructive
      dirty={false}
      submitDisabled={!snapshot || !confirmed || (!!guest.lock && !force)}
      onSubmit={async () => {
        if (!snapshot) return
        await runTask(deleteSnapshot(guest.node, guest.type, guest.vmid, snapshot.name, { force }), {
          title: `删除快照 ${snapshot.name}（${guest.name}）`,
        })
      }}
    >
      {guest.lock && <Notice tone="warning">客户机已锁定（{guest.lock}），只能强制删除。</Notice>}
      <CheckboxField
        label="强制删除"
        description="即使删除磁盘上的快照失败，也从配置中移除这个快照。"
        checked={force}
        onCheckedChange={setForce}
      />
      {snapshot && (
        <div className="grid gap-2">
          {/* Plain block, not Label (flex + select-none): long names wrap and can be copied. */}
          <label htmlFor={confirmId} className="block text-sm leading-relaxed text-muted-foreground">
            请输入 <span className="font-mono font-medium break-all text-foreground select-all">{snapshot.name}</span> 以确认
          </label>
          <Input
            id={confirmId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
      )}
    </FormDialog>
  )
}

// --------------------------------------------------------------- details

/**
 * Snapshot details: time, RAM, description (editable) and the stored config;
 * rollback and delete from the footer.
 */
export function SnapshotDetailDialog({
  guest,
  snapshot,
  open,
  onOpenChange,
  onRollback,
  onDelete,
}: {
  guest: SnapshotGuest
  snapshot: Snapshot | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRollback: (s: Snapshot) => void
  onDelete: (s: Snapshot) => void
}) {
  const qc = useQueryClient()
  const canEdit = useVmCap('VM.Snapshot', guest.vmid, guest.pool)
  const canRollback = useVmCap('VM.Snapshot.Rollback', guest.vmid, guest.pool)
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const config = useSnapshotConfig(guest.node, guest.type, guest.vmid, open && showConfig ? snapshot?.name : null)

  useEffect(() => {
    if (open) {
      setDescription(snapshot?.description ?? '')
      setShowConfig(false)
    }
  }, [open, snapshot?.name])

  const lines = useMemo(
    () =>
      Object.entries(config.data ?? {})
        .filter(([k]) => k !== 'description' && k !== 'snaptime' && k !== 'digest')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => ({ key, value: String(value) })),
    [config.data],
  )

  if (!snapshot) return null
  const dirty = description !== (snapshot.description ?? '')
  const busy = !!snapshot.snapstate

  const save = async () => {
    setSaving(true)
    try {
      await updateSnapshotDescription(guest.node, guest.type, guest.vmid, snapshot.name, description)
      toast.success('描述已保存')
      await qc.invalidateQueries({ queryKey: backupKeys.snapshots(guest.node, guest.type, guest.vmid) })
    } catch (e) {
      toast.error('保存描述失败', { description: errorMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={<span className="font-mono">{snapshot.name}</span>}
      headerExtra={snapshot.vmstate === 1 ? <Chip tone="brand" icon={<MemoryStick />}>含内存</Chip> : undefined}
      description={`${kind(guest.type)} ${guest.name} 的快照`}
      footer={
        <>
          <Button type="button" variant="outline" className="text-destructive hover:text-destructive" disabled={!canEdit || busy} onClick={() => onDelete(snapshot)}>
            <Trash2 />
            删除
          </Button>
          <Button type="button" disabled={!canRollback || busy} onClick={() => onRollback(snapshot)}>
            <History />
            回滚到此快照
          </Button>
        </>
      }
    >
      <div className="grid gap-5 pt-1 pb-2">
        {busy && <Notice tone="warning">快照正在{snapshot.snapstate === 'delete' ? '删除' : '创建'}中…</Notice>}
        <InfoList
          items={[
            {
              label: '创建时间',
              value: snapshot.snaptime ? (
                <>
                  <span className="tabular">{formatDateTime(snapshot.snaptime)}</span>
                  <span className="ml-2 text-muted-foreground">{formatRelativeTime(snapshot.snaptime)}</span>
                </>
              ) : (
                DASH
              ),
            },
            { label: '包含内存', value: guest.type === 'qemu' ? (snapshot.vmstate === 1 ? '是' : '否') : '容器不支持' },
            { label: '上一个快照', value: snapshot.parent ? <span className="font-mono">{snapshot.parent}</span> : '无（最早的快照）' },
          ]}
        />
        <FormField label="描述" name="description">
          <FieldTextarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            readOnly={!canEdit}
            placeholder={canEdit ? '添加描述…' : '无描述'}
            className="min-h-20"
          />
        </FormField>
        {canEdit && (
          <div className="-mt-3 flex justify-end">
            <Button type="button" size="sm" variant="secondary" disabled={!dirty || saving} onClick={() => void save()}>
              {saving && <Loader2 className="animate-spin" />}
              保存描述
            </Button>
          </div>
        )}
        <FormSection collapsible title="快照中的配置" defaultOpen={false} className="gap-3">
          <ConfigShow onShow={() => setShowConfig(true)} />
          {config.isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 正在读取…
            </div>
          ) : config.error ? (
            <Notice tone="error">{errorMessage(config.error)}</Notice>
          ) : (
            <ConfigLines lines={lines} />
          )}
        </FormSection>
      </div>
    </ResponsiveDialog>
  )
}

/** Mounted only while the collapsible is open: starts loading the config. */
function ConfigShow({ onShow }: { onShow: () => void }) {
  useEffect(() => {
    onShow()
  }, [onShow])
  return null
}
