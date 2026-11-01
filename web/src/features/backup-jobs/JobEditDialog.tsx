import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Power, Zap } from 'lucide-react'

import { backupJobKeys, createBackupJob, updateBackupJob, useBackupJob } from '@/api/backup-jobs'
import { useClusterResources } from '@/api/queries'
import { usePools } from '@/api/shell'
import { isGuest } from '@/api/types'
import {
  FieldInput,
  FieldTextarea,
  FormDialog,
  FormField,
  FormRow,
  FormSection,
  NodeSelect,
  NumberInput,
  SelectField,
  SwitchField,
} from '@/components/form'
import { ErrorState } from '@/components/QueryState'
import { Skeleton } from '@/components/ui/skeleton'
import { runTask } from '@/components/tasks/tracker'
import { NOTES_TEMPLATE_VARS, type BackupCompress, type PbsChangeDetection } from '@/features/guest-backup/logic'
import { ChoiceCards, Notice } from '@/features/guest-backup/ui'

import { GuestPicker } from './GuestPicker'
import { JobStorageSelect, useClusterStorages } from './JobStorageSelect'
import {
  RETENTION_KEYS,
  SELECTION_LABEL,
  defaultJobForm,
  jobFormFromJob,
  jobParams,
  retentionString,
  validateJobForm,
  type JobForm,
  type KeepKey,
  type MailNotification,
  type SelectionMode,
} from './logic'
import { ScheduleInput } from './ScheduleField'

export interface JobEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Job to edit; null/undefined creates a new one. */
  jobId?: string | null | undefined
}

const VAR_LABEL: Record<(typeof NOTES_TEMPLATE_VARS)[number], string> = {
  guestname: '客户机名称',
  vmid: 'VMID',
  node: '节点',
  cluster: '集群',
}

/** Create / edit a scheduled backup job (PVE.dc.BackupEdit). */
export function JobEditDialog({ open, onOpenChange, jobId }: JobEditDialogProps) {
  const create = !jobId
  const job = useBackupJob(open && !create ? jobId : null)
  const [form, setForm] = useState<JobForm>(defaultJobForm)
  const [attempted, setAttempted] = useState(false)
  const loadedFor = useRef<string | null>(null)
  const notesRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) {
      loadedFor.current = null
      return
    }
    if (create && loadedFor.current !== '') {
      loadedFor.current = ''
      setForm(defaultJobForm())
      setAttempted(false)
    } else if (!create && job.data && loadedFor.current !== jobId) {
      loadedFor.current = jobId
      setForm(jobFormFromJob(job.data))
      setAttempted(false)
    }
  }, [open, create, jobId, job.data])

  const set = useCallback(<K extends keyof JobForm>(key: K, value: JobForm[K]) => setForm((f) => ({ ...f, [key]: value })), [])

  const guests = useClusterResources({ select: (all) => all.filter(isGuest) })
  const pools = usePools()
  const { storages } = useClusterStorages('backup', form.node)
  const pbs = storages.find((s) => s.storage === form.storage)?.type === 'pbs'

  const errors = useMemo(() => validateJobForm(form, { create }), [form, create])
  const shownErrors = attempted ? errors : {}
  const loading = !create && !job.data
  const retention = retentionString(form.retention)

  const setNode = (node: string | undefined) => {
    const n = node ?? ''
    setForm((f) => {
      // Like the official nodeChange: guests of other nodes leave the selection.
      const onNode = new Set((guests.data ?? []).filter((g) => !n || g.node === n).map((g) => g.vmid))
      return { ...f, node: n, vmids: n ? f.vmids.filter((id) => onNode.has(id)) : f.vmids }
    })
  }

  const setKeep = (key: KeepKey, value: number | undefined) =>
    setForm((f) => ({ ...f, retention: { ...f.retention, keeps: { ...f.retention.keeps, [key]: value } } }))

  const insertVar = (v: string) => {
    const token = `{{${v}}}`
    const el = notesRef.current
    const notes = form.notesTemplate
    if (!el) return set('notesTemplate', notes + token)
    const start = el.selectionStart ?? notes.length
    const end = el.selectionEnd ?? notes.length
    set('notesTemplate', notes.slice(0, start) + token + notes.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={create ? '新建备份计划' : '编辑备份计划'}
      description={create ? '按计划自动备份选中的客户机。' : jobId}
      submitLabel={create ? '创建' : '保存'}
      submitDisabled={loading}
      onSubmit={async () => {
        setAttempted(true)
        if (Object.keys(errors).length) throw new Error('请检查标红的字段')
        const params = jobParams(form, { original: create ? null : (job.data ?? null), pbs })
        const name = form.comment.trim() || form.id.trim() || jobId || '备份计划'
        await runTask(create ? createBackupJob(params) : updateBackupJob(jobId!, params), {
          title: create ? `创建备份计划 ${name}` : `保存备份计划 ${name}`,
          invalidate: [backupJobKeys.all()],
        })
      }}
    >
      {loading ? (
        job.isError ? (
          <ErrorState error={job.error} onRetry={() => void job.refetch()} compact />
        ) : (
          <div className="grid gap-4" aria-busy="true" aria-label="加载中">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-40" />
          </div>
        )
      ) : (
        <>
          <FormRow>
            <FormField label="节点" name="node" hint="只在这个节点上运行；全部节点时各节点备份自己的客户机">
              <NodeSelect value={form.node || undefined} onValueChange={setNode} emptyOption="全部节点" autoSelect={false} onlineOnly={false} />
            </FormField>
            <FormField label="存储" name="storage" required error={shownErrors.storage}>
              <JobStorageSelect content="backup" node={form.node} value={form.storage} onValueChange={(v) => set('storage', v)} autoSelect={create} />
            </FormField>
          </FormRow>

          <FormField label="计划" name="schedule" required error={shownErrors.schedule}>
            <ScheduleInput value={form.schedule} onChange={(v) => set('schedule', v)} />
          </FormField>

          <FormRow>
            <FormField label="说明" name="comment">
              <FieldInput value={form.comment} onChange={(e) => set('comment', e.target.value)} placeholder="例如 每晚备份" maxLength={512} />
            </FormField>
            <div className="flex items-end">
              <SwitchField label="启用" description="停用后不会按计划运行" checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} className="w-full" />
            </div>
          </FormRow>

          <FormSection title="客户机">
            <FormRow>
              <FormField label="选择方式" name="selMode">
                <SelectField<SelectionMode>
                  value={form.selMode}
                  onValueChange={(v) => setForm((f) => ({ ...f, selMode: v ?? 'include', vmids: v === 'include' || v === 'exclude' ? (f.selMode === 'all' || f.selMode === 'pool' ? [] : f.vmids) : [] }))}
                  options={[
                    { value: 'include', label: SELECTION_LABEL.include, description: '只备份勾选的客户机' },
                    { value: 'all', label: SELECTION_LABEL.all, description: '所有客户机，包括以后新建的' },
                    { value: 'exclude', label: SELECTION_LABEL.exclude, description: '除勾选的以外全部' },
                    { value: 'pool', label: SELECTION_LABEL.pool, description: '资源池里的客户机' },
                  ]}
                />
              </FormField>
              {form.selMode === 'pool' && (
                <FormField label="资源池" name="pool" required error={shownErrors.pool}>
                  <SelectField
                    value={form.pool || undefined}
                    onValueChange={(v) => set('pool', v ?? '')}
                    loading={pools.isPending}
                    placeholder={pools.data?.length === 0 ? '没有资源池' : '选择资源池'}
                    options={(pools.data ?? []).map((p) => ({ value: p.poolid, label: p.poolid, description: p.comment }))}
                  />
                </FormField>
              )}
            </FormRow>
            <FormField name="vmid" error={shownErrors.vmid}>
              <GuestPicker
                guests={guests.data ?? []}
                node={form.node}
                mode={form.selMode}
                pool={form.pool}
                value={form.vmids}
                onChange={(v) => set('vmids', v)}
                invalid={!!shownErrors.vmid}
              />
            </FormField>
          </FormSection>

          <FormSection title="备份方式">
            <FormField label="模式" name="mode">
              <ChoiceCards
                aria-label="备份模式"
                value={form.mode}
                onValueChange={(v) => set('mode', v)}
                columns={3}
                dense
                options={[
                  { value: 'snapshot', label: '快照', icon: <Zap />, description: '不停机，大多数情况的首选' },
                  { value: 'suspend', label: '挂起', icon: <Pause />, description: '短暂暂停或冻结，一致性更好' },
                  { value: 'stop', label: '停止', icon: <Power />, description: '备份期间关机，一致性最好' },
                ]}
              />
            </FormField>
            <FormField label="压缩" name="compress" hint={pbs ? 'Proxmox Backup Server 固定使用 ZSTD' : undefined}>
              <SelectField<BackupCompress>
                value={pbs ? 'zstd' : form.compress}
                onValueChange={(v) => set('compress', v ?? 'zstd')}
                disabled={pbs}
                options={[
                  { value: 'zstd', label: 'ZSTD', description: '又快又好' },
                  { value: 'lzo', label: 'LZO', description: '最快' },
                  { value: 'gzip', label: 'GZIP', description: '压缩率高' },
                  { value: '0', label: '不压缩' },
                ]}
              />
            </FormField>
          </FormSection>

          <FormSection
            collapsible
            defaultOpen={!create && (!!retention || form.protected)}
            title="保留策略"
            description={form.retention.keepAll ? '保留全部' : retention ? '自定义' : '按存储配置'}
          >
            {pbs && <Notice>建议直接在 Proxmox Backup Server 上配置保留策略。</Notice>}
            <SwitchField
              label="保留全部备份"
              description="不清理旧备份"
              checked={form.retention.keepAll}
              onCheckedChange={(v) => setForm((f) => ({ ...f, retention: { ...f.retention, keepAll: v } }))}
            />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {RETENTION_KEYS.map(([key, label]) => (
                <FormField key={key} label={`保留${label}`} name={key} disabled={form.retention.keepAll}>
                  <NumberInput
                    value={form.retention.keepAll ? undefined : form.retention.keeps[key]}
                    onChange={(v) => setKeep(key, v)}
                    min={1}
                    placeholder="—"
                  />
                </FormField>
              ))}
            </div>
            {!form.retention.keepAll && !retention && (
              <p className="text-xs leading-relaxed text-muted-foreground">没有设置任何保留数量时，使用存储的配置或节点的 vzdump.conf。</p>
            )}
            <SwitchField label="受保护" description="把这个计划产生的备份标记为受保护，不会被清理或误删" checked={form.protected} onCheckedChange={(v) => set('protected', v)} />
          </FormSection>

          <FormSection collapsible defaultOpen title="备注模板" description={form.notesTemplate ? undefined : '不写备注'}>
            <FormField
              label="备份备注"
              name="notes-template"
              hint={
                <span className="flex flex-wrap items-center gap-1.5">
                  <span>添加到这个计划产生的每个备份上。插入变量：</span>
                  {NOTES_TEMPLATE_VARS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => insertVar(v)}
                      className="inline-flex h-7 items-center rounded-md border border-border bg-secondary px-2 font-mono text-[11px] text-secondary-foreground transition-colors hover:bg-accent pointer-coarse:h-9"
                      title={VAR_LABEL[v]}
                    >
                      {`{{${v}}}`}
                    </button>
                  ))}
                </span>
              }
            >
              <FieldTextarea
                ref={notesRef}
                value={form.notesTemplate}
                onChange={(e) => set('notesTemplate', e.target.value)}
                maxLength={512}
                className="min-h-16 font-mono text-base md:text-sm"
              />
            </FormField>
          </FormSection>

          <FormSection collapsible title="通知" description={form.notificationMode === 'legacy-sendmail' ? 'sendmail' : '全局通知设置'}>
            <ChoiceCards
              aria-label="通知方式"
              value={form.notificationMode}
              onValueChange={(v) => set('notificationMode', v)}
              columns={2}
              options={[
                { value: 'notification-system', label: '使用全局通知设置', description: '按数据中心的通知目标和匹配规则发送' },
                { value: 'legacy-sendmail', label: '使用 sendmail 发邮件（旧版）', description: '直接发邮件到下面的地址' },
              ]}
            />
            {form.notificationMode === 'legacy-sendmail' && (
              <FormRow>
                <FormField label="收件人" name="mailto" hint="多个地址用逗号分隔">
                  <FieldInput value={form.mailto} onChange={(e) => set('mailto', e.target.value)} type="email" inputMode="email" placeholder="admin@example.com" />
                </FormField>
                <FormField label="发送时机" name="mailnotification">
                  <SelectField<MailNotification>
                    value={form.mailnotification}
                    onValueChange={(v) => set('mailnotification', v ?? 'always')}
                    options={[
                      { value: 'always', label: '总是' },
                      { value: 'failure', label: '仅失败时' },
                    ]}
                  />
                </FormField>
              </FormRow>
            )}
          </FormSection>

          <FormSection collapsible title="高级选项" defaultOpen={!!errors.fleecing && attempted}>
            <Notice>留空的项使用节点 vzdump.conf 的设置，没有时用默认值。</Notice>
            <FormRow>
              <FormField
                label="任务 ID"
                name="id"
                error={shownErrors.id}
                hint={create ? '留空自动生成；可在通知匹配规则里用来匹配这个计划' : '创建后不能修改'}
              >
                <FieldInput
                  value={form.id}
                  onChange={(e) => set('id', e.target.value)}
                  readOnly={!create}
                  placeholder="自动生成"
                  className="font-mono"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              </FormField>
              <FormField label="带宽限制" name="bwlimit" hint="0 表示不限速">
                <NumberInput
                  value={form.bwlimit === undefined ? undefined : Math.round((form.bwlimit / 1024) * 100) / 100}
                  onChange={(v) => set('bwlimit', v === undefined ? undefined : Math.round(v * 1024))}
                  min={0}
                  decimal
                  unit="MiB/s"
                  placeholder="默认"
                />
              </FormField>
            </FormRow>
            <FormRow cols={3}>
              <FormField label="Zstd 线程" name="zstd" disabled={pbs || form.compress !== 'zstd'} hint="0 = 一半的 CPU 核心；默认 1">
                <NumberInput value={form.zstd} onChange={(v) => set('zstd', v)} min={0} placeholder="默认" />
              </FormField>
              <FormField label="IO 工作线程" name="max-workers" hint="仅虚拟机；默认 16">
                <NumberInput value={form.maxWorkers} onChange={(v) => set('maxWorkers', v)} min={1} max={256} placeholder="默认" />
              </FormField>
              <FormField label="IO 优先级" name="ionice" hint="0–8，8 为空闲；默认 7">
                <NumberInput value={form.ionice} onChange={(v) => set('ionice', v)} min={0} max={8} placeholder="默认" />
              </FormField>
            </FormRow>
            <FormRow>
              <div className="flex items-end">
                <SwitchField
                  label="Fleecing"
                  description="备份写缓存，减轻客户机内的 IO 压力（仅虚拟机）"
                  checked={form.fleecing}
                  onCheckedChange={(v) => set('fleecing', v)}
                  className="w-full"
                />
              </div>
              <FormField label="Fleecing 存储" name="fleecing" disabled={!form.fleecing} error={shownErrors.fleecing} hint="最好是快速的本地存储，支持精简置备">
                <JobStorageSelect content="images" node={form.node} value={form.fleecingStorage} onValueChange={(v) => set('fleecingStorage', v)} disabled={!form.fleecing} />
              </FormField>
            </FormRow>
            <FormRow>
              <div className="flex items-end">
                <SwitchField
                  label="补跑错过的备份"
                  description="没能按时开始时（例如节点离线），尽快补跑"
                  checked={form.repeatMissed}
                  onCheckedChange={(v) => set('repeatMissed', v)}
                  className="w-full"
                />
              </div>
              <FormField label="PBS 变更检测" name="pbs-change-detection-mode" hint="容器备份到 PBS 时检测文件变化的方式">
                <SelectField<PbsChangeDetection>
                  value={form.pbsChangeDetection}
                  onValueChange={(v) => set('pbsChangeDetection', v)}
                  emptyOption="默认"
                  options={[
                    { value: 'data', label: 'Data', description: '新格式，读取全部数据' },
                    { value: 'metadata', label: 'Metadata', description: '只读元数据，最快' },
                    { value: 'legacy', label: 'Legacy', description: '旧格式' },
                  ]}
                />
              </FormField>
            </FormRow>
            <FormField label="排除路径" name="exclude-path" hint="每行一个（shell 通配符）。以 / 开头的相对容器根目录，其余匹配任意子目录。仅容器。">
              <FieldTextarea
                value={form.excludePaths}
                onChange={(e) => set('excludePaths', e.target.value)}
                placeholder={'/tmp/*\n*.log'}
                className="min-h-16 font-mono text-base md:text-sm"
                spellCheck={false}
              />
            </FormField>
          </FormSection>
        </>
      )}
    </FormDialog>
  )
}

export default JobEditDialog
