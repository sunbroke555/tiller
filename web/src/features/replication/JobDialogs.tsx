// Create / edit and delete dialogs of replication jobs.

import { useEffect, useId, useMemo, useState } from 'react'

import { usePveFeature } from '@/api/pve-features'
import { useClusterResources } from '@/api/queries'
import {
  createReplicationJob,
  deleteReplicationJob,
  updateReplicationJob,
  useReplicationJob,
  useReplicationJobs,
  type ReplicationJob,
} from '@/api/replication'
import { isGuest, type GuestResource } from '@/api/types'
import { FieldInput, FormDialog, FormField, FormRow, NodeSelect, NumberInput, SelectField, SwitchField, type SelectOption } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { guestName } from '@/lib/resources'
import { cn } from '@/lib/utils'

import {
  createJobParams,
  deleteOptions,
  emptyJobForm,
  jobToForm,
  takenTargets,
  updateJobParams,
  validateJobForm,
  type DeleteMode,
  type JobForm,
} from './logic'
import { ScheduleField, useScheduleCheck } from './ScheduleField'
import { Notice, useCanReplicate } from './ui'

// ------------------------------------------------------------ create/edit

export interface JobDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this job; create a new one when missing. */
  job?: ReplicationJob | null
  /** Create for this guest only (guest page). */
  guest?: number
  /** Offer only guests on this node (node page). */
  node?: string
}

export function JobDialog({ open, onOpenChange, job, guest: fixedGuest, node }: JobDialogProps) {
  const isCreate = !job
  const jobs = useReplicationJobs(open)
  // Edit: re-read the job for its digest.
  const fresh = useReplicationJob(open && job ? job.id : null)
  const current = fresh.data ?? job ?? null
  const canReplicate = useCanReplicate()
  const guests = useClusterResources({ select: (all) => all.filter(isGuest).sort((a, b) => a.vmid - b.vmid) })
  const nodeCount = useClusterResources({ select: (all) => all.filter((r) => r.type === 'node').length }).data ?? 0
  const skipFreezeSupport = usePveFeature('replicationSkipFreezeFs')
  // Older PVE rejects the key; a job that already carries it proves support.
  const showSkipFreeze = skipFreezeSupport === 'supported' || current?.['skip-freeze-fs'] !== undefined

  const [form, setForm] = useState<JobForm>(() => emptyJobForm(fixedGuest))
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!open) return
    setForm(job ? jobToForm(job) : emptyJobForm(fixedGuest))
    setTouched(false)
    // Reset when the dialog opens.
  }, [open])
  const set = <K extends keyof JobForm>(key: K, value: JobForm[K]) => setForm((f) => ({ ...f, [key]: value }))

  const guestOptions: SelectOption[] = useMemo(
    () =>
      (guests.data ?? [])
        .filter((g) => (!node || g.node === node) && canReplicate(g.vmid, g.pool))
        .map((g) => ({
          value: String(g.vmid),
          label: `${g.vmid} · ${guestName(g)}`,
          description: `${g.type === 'qemu' ? '虚拟机' : '容器'} · ${g.node}`,
        })),
    // canReplicate is a fresh closure every render; the permission map is stable enough.
    [guests.data, node],
  )
  const guestRes: GuestResource | undefined = (guests.data ?? []).find((g) => g.vmid === form.guest)
  const source = guestRes?.node ?? current?.source
  const exclude = form.guest ? takenTargets(jobs.data ?? [], form.guest, source, job?.id) : []

  const scheduleCheck = useScheduleCheck(form.schedule, open)
  const errors = validateJobForm(form, isCreate)
  const invalid = Object.keys(errors).length > 0 || !!scheduleCheck.error
  const changes = !isCreate && current ? updateJobParams(current, form) : null

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isCreate ? '添加复制任务' : `编辑复制任务 ${job?.id ?? ''}`}
      description={
        isCreate
          ? '按计划把客户机在本地 ZFS 存储上的磁盘增量同步到另一个节点。'
          : `${guestRes ? guestName(guestRes) : `客户机 ${job?.guest}`} → ${job?.target}`
      }
      submitLabel={isCreate ? '添加' : '保存'}
      submitDisabled={(touched && invalid) || !!scheduleCheck.error || (!isCreate && !changes) || (isCreate && jobs.isPending)}
      onSubmit={async () => {
        setTouched(true)
        if (invalid) throw new Error(Object.values(errors)[0] ?? scheduleCheck.error ?? '请检查表单')
        if (isCreate) {
          const params = createJobParams(form, jobs.data ?? [])
          await runTask(createReplicationJob(params), { title: `添加复制任务 ${String(params.id)}` })
        } else if (current) {
          const params = updateJobParams(current, form)
          if (!params) return
          await runTask(updateReplicationJob(current.id, params), { title: `修改复制任务 ${current.id}` })
        }
      }}
    >
      {isCreate && nodeCount > 0 && nodeCount < 2 && <Notice tone="warning">存储复制需要至少两个节点的集群。</Notice>}
      {fresh.data?.remove_job && <Notice tone="warning">这个任务已标记删除，正在等待清理。</Notice>}
      <FormRow>
        <FormField label="客户机" name="guest" required={isCreate} error={touched ? errors.guest : undefined}>
          {isCreate && fixedGuest === undefined ? (
            <SelectField
              value={form.guest ? String(form.guest) : undefined}
              onValueChange={(v) => setForm((f) => ({ ...f, guest: v ? Number(v) : undefined, target: undefined }))}
              options={guestOptions}
              loading={guests.isPending}
              placeholder={guestOptions.length === 0 && !guests.isPending ? '没有可复制的客户机' : '选择客户机'}
              aria-label="客户机"
            />
          ) : (
            <FieldInput readOnly value={guestRes ? `${guestRes.vmid} · ${guestName(guestRes)}` : String(form.guest ?? '')} className="bg-transparent" />
          )}
        </FormField>
        <FormField label="目标节点" name="target" required={isCreate} error={touched ? errors.target : undefined}>
          {isCreate ? (
            <NodeSelect
              value={form.target}
              onValueChange={(v) => set('target', v)}
              exclude={exclude}
              disabled={!form.guest}
              placeholder={!form.guest ? '先选择客户机' : '选择节点'}
            />
          ) : (
            <FieldInput readOnly value={form.target ?? ''} className="bg-transparent" />
          )}
        </FormField>
      </FormRow>
      <ScheduleField value={form.schedule} onChange={(v) => set('schedule', v)} check={scheduleCheck} />
      <FormRow>
        <FormField label="限速" name="rate" error={touched || form.rate !== undefined ? errors.rate : undefined} hint="留空表示不限速">
          <NumberInput value={form.rate} onChange={(v) => set('rate', v)} min={1} decimal unit="MB/s" placeholder="不限速" />
        </FormField>
        <FormField label="备注" name="comment">
          <FieldInput value={form.comment} onChange={(e) => set('comment', e.target.value)} maxLength={200} />
        </FormField>
      </FormRow>
      <SwitchField
        label="启用"
        description="停用后保留任务和已复制的数据，但不再按计划同步。"
        checked={form.enabled}
        onCheckedChange={(v) => set('enabled', v)}
      />
      {showSkipFreeze && (
        <SwitchField
          label="复制时不冻结文件系统"
          description="默认在每次复制前冻结客户机文件系统、完成后解冻，保证副本一致。跳过后不暂停客户机 IO，但副本只有断电级（崩溃）一致性。"
          checked={form.skipFreezeFs}
          onCheckedChange={(v) => set('skipFreezeFs', v)}
        />
      )}
    </FormDialog>
  )
}

// ----------------------------------------------------------------- delete

const DELETE_MODES: { value: DeleteMode; label: string; description: string }[] = [
  {
    value: 'full',
    label: '删除任务并清理副本',
    description: '删除目标节点上的副本和本地的复制快照。清理在后台进行，可能需要一两分钟。',
  },
  {
    value: 'keep',
    label: '删除任务，保留副本',
    description: '目标节点上已复制的磁盘保留下来，只清理本地的复制快照。',
  },
  {
    value: 'force',
    label: '只删除配置（强制）',
    description: '立即从配置中移除，不做任何清理。复制快照和目标上的副本需要手动处理，仅在正常删除卡住时使用。',
  },
]

export function DeleteJobDialog({
  job,
  open,
  onOpenChange,
}: {
  job: ReplicationJob | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [mode, setMode] = useState<DeleteMode>('full')
  const [typed, setTyped] = useState('')
  const confirmId = useId()
  const radioId = useId()
  useEffect(() => {
    if (open) {
      setMode(job?.remove_job ? 'force' : 'full')
      setTyped('')
    }
    // Reset when the dialog opens.
  }, [open])
  const confirmed = !!job && typed.trim() === job.id

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={`删除复制任务 ${job?.id ?? ''}？`}
      description={job ? `客户机 ${job.guest} → ${job.target}` : undefined}
      submitLabel="删除"
      destructive
      dirty={false}
      submitDisabled={!confirmed}
      onSubmit={async () => {
        if (!job) return
        await runTask(deleteReplicationJob(job.id, deleteOptions(mode)), {
          title: `删除复制任务 ${job.id}`,
          syncSuccessMessage: mode === 'force' ? `已删除复制任务 ${job.id}` : `复制任务 ${job.id} 已标记删除，正在后台清理`,
        })
      }}
    >
      {job?.remove_job && <Notice tone="warning">这个任务已经在等待删除。如果一直没有完成，可以强制删除配置。</Notice>}
      <RadioGroup value={mode} onValueChange={(v) => setMode(v as DeleteMode)} aria-label="删除方式" className="gap-2">
        {DELETE_MODES.map((m) => (
          <Label
            key={m.value}
            htmlFor={`${radioId}-${m.value}`}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-xl border border-input bg-(--field) px-3 py-2.5 font-normal transition-colors hover:bg-accent/60',
              mode === m.value && 'border-brand/60 bg-brand/8 paper:border-foreground/50 paper:bg-secondary',
            )}
          >
            <RadioGroupItem id={`${radioId}-${m.value}`} value={m.value} className="mt-0.5" />
            <span className="grid gap-0.5">
              <span className={cn('text-sm font-medium', m.value === 'force' && 'text-destructive')}>{m.label}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">{m.description}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      <div className="grid gap-2">
        <Label htmlFor={confirmId} className="text-sm font-normal text-muted-foreground">
          输入任务 ID <span className="font-mono font-medium text-foreground">{job?.id}</span> 确认
        </Label>
        <Input
          id={confirmId}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="font-mono"
        />
      </div>
    </FormDialog>
  )
}
