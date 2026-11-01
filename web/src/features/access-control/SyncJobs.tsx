// Scheduled realm sync jobs (PVE.dc.RealmSyncJobView / RealmSyncJobEdit).

import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, CirclePause, Ellipsis, Pencil, Play, Plus, Trash2 } from 'lucide-react'

import {
  accessKeys,
  createSyncJob,
  deleteSyncJob,
  realmInvalidate,
  syncRealm,
  updateSyncJob,
  useRealmConfig,
  useRealms,
  useSyncJob,
  useSyncJobs,
  type SyncJob,
} from '@/api/access-control'
import { usePermissions } from '@/api/permissions'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { FieldInput, FormDialog, FormField, FormRow, SelectField, SwitchField, type SelectOption } from '@/components/form'
import { ErrorState } from '@/components/QueryState'
import { fireTask, runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { describeSchedule } from '@/features/backup-jobs/logic'
import { ScheduleInput } from '@/features/backup-jobs/ScheduleField'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  SYNC_SCOPE_LABEL,
  emptySyncJobForm,
  parseRemoveVanished,
  realmSupportsSync,
  syncFormFromDefaults,
  syncJobCreateParams,
  syncJobRunParams,
  syncJobToForm,
  syncJobUpdateParams,
  validateSyncJobForm,
  type SyncJobForm,
  type SyncScope,
} from './logic'
import { RemoveVanishedFields } from './RealmDialog'
import { ListCard, ListSkeleton, Pill } from './ui'

type Dialog = { kind: 'create' } | { kind: 'edit' | 'delete'; job: SyncJob } | null

/** Realm.AllocateUser on the realm and User.Modify on /access/groups (the API's check). */
export function useCanSyncRealm() {
  const perms = usePermissions()
  return (realm: string) =>
    perms.can({ privs: 'Realm.AllocateUser', path: `/access/realm/${realm}` }) && perms.can({ privs: 'User.Modify', path: '/access/groups' })
}

export function SyncJobsSection() {
  const jobs = useSyncJobs()
  const realms = useRealms()
  const perms = usePermissions()
  const canSync = useCanSyncRealm()
  const canDelete = perms.can({ privs: 'Sys.Modify', path: '/' })
  const syncRealms = (realms.data ?? []).filter((r) => realmSupportsSync(r.type))
  const canCreate = syncRealms.some((r) => canSync(r.realm))
  const [dialog, setDialog] = useState<Dialog>(null)
  const [last, setLast] = useState<Dialog>(null)
  if (dialog && dialog !== last) setLast(dialog)
  const close = (o: boolean) => {
    if (!o) setDialog((d) => (d === last ? null : d))
  }
  const list = useMemo(() => [...(jobs.data ?? [])].sort((a, b) => a.realm.localeCompare(b.realm) || a.id.localeCompare(b.id)), [jobs.data])

  const runNow = (j: SyncJob) =>
    fireTask(syncRealm(j.realm, syncJobRunParams(j)), { title: `同步认证域 ${j.realm}`, invalidate: [...realmInvalidate, accessKeys.all()] })

  return (
    <>
      <ListCard
        title="同步任务"
        summary={jobs.isPending ? '正在读取…' : list.length ? `${list.length} 个任务` : '按计划从 LDAP / AD 同步用户和组'}
        onRefresh={() => void jobs.refetch()}
        refreshing={jobs.isFetching}
        actions={
          <Button
            variant="outline"
            onClick={() => setDialog({ kind: 'create' })}
            disabled={!canCreate}
            title={syncRealms.length === 0 ? '先添加 LDAP 或 AD 认证域' : canCreate ? undefined : '没有同步权限'}
          >
            <Plus />
            添加
          </Button>
        }
      >
        {jobs.isPending ? (
          <ListSkeleton rows={1} />
        ) : jobs.isError ? (
          <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} compact />
        ) : list.length === 0 ? (
          <EmptyState icon={CalendarClock} title="没有同步任务" description={syncRealms.length === 0 ? '同步任务需要 LDAP 或 AD 认证域。' : undefined} />
        ) : (
          <ul className="divide-y divide-border/60" aria-label="同步任务">
            {list.map((j) => {
              const allowed = canSync(j.realm)
              const enabled = j.enabled === undefined || String(j.enabled) === '1'
              const schedule = describeSchedule(j.schedule)
              const rv = parseRemoveVanished(j['remove-vanished'])
              return (
                <li key={j.id} className="flex items-center gap-1 pr-2 lg:pr-(--card-p)" data-testid="sync-job-row" data-job={j.id}>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-(--card-p) text-left disabled:cursor-default"
                    onClick={() => setDialog({ kind: 'edit', job: j })}
                    disabled={!allowed}
                    aria-label={`编辑同步任务 ${j.id}`}
                  >
                    {enabled ? <CalendarClock className="size-4 shrink-0 text-brand-strong paper:text-foreground/70" aria-hidden /> : <CirclePause className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className={cn('truncate font-medium', !enabled && 'text-muted-foreground')}>{j.realm}</span>
                        <span className="font-mono text-xs text-muted-foreground">{j.schedule}</span>
                        {!enabled && <Pill>已停用</Pill>}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[
                          schedule,
                          j.scope ? `同步${SYNC_SCOPE_LABEL[j.scope]}` : null,
                          enabled && j['next-run'] ? `下次 ${formatDateTime(j['next-run'])}` : null,
                          rv.entry || rv.acl || rv.properties ? '移除已消失' : null,
                          j.comment,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </button>
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`${j.id} 的操作`} className="shrink-0 text-muted-foreground pointer-coarse:size-11">
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-40">
                      <DropdownMenuItem disabled={!allowed} onSelect={() => runNow(j)}>
                        <Play />
                        立即运行
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={!allowed} onSelect={() => setDialog({ kind: 'edit', job: j })}>
                        <Pencil />
                        编辑
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" disabled={!canDelete} onSelect={() => setDialog({ kind: 'delete', job: j })}>
                        <Trash2 />
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              )
            })}
          </ul>
        )}
      </ListCard>

      {last?.kind === 'create' && <SyncJobDialog open={dialog === last} onOpenChange={close} />}
      {last?.kind === 'edit' && <SyncJobDialog open={dialog === last} onOpenChange={close} job={last.job} />}
      {last?.kind === 'delete' && (
        <ConfirmDialog
          open={dialog === last}
          onOpenChange={close}
          destructive
          title={`删除同步任务 ${last.job.id}？`}
          description={`不再按计划同步认证域 ${last.job.realm}。已同步的用户和组保留。`}
          confirmLabel="删除"
          typeToConfirm={last.job.id}
          onConfirm={() =>
            runTask(deleteSyncJob(last.job.id), {
              title: `删除同步任务 ${last.job.id}`,
              syncSuccessMessage: `已删除同步任务 ${last.job.id}`,
              invalidate: [accessKeys.syncJobs()],
            })
          }
        />
      )}
    </>
  )
}

const SCOPE_OPTIONS: SelectOption<Exclude<SyncScope, ''>>[] = [
  { value: 'users', label: '用户' },
  { value: 'groups', label: '组' },
  { value: 'both', label: '用户和组' },
]

const YES_NO: SelectOption<'1' | '0'>[] = [
  { value: '1', label: '是' },
  { value: '0', label: '否' },
]

function SyncJobDialog({ open, onOpenChange, job }: { open: boolean; onOpenChange: (o: boolean) => void; job?: SyncJob }) {
  const isCreate = !job
  const realms = useRealms(open)
  const canSync = useCanSyncRealm()
  const fresh = useSyncJob(open && job ? job.id : null)
  const current = fresh.data ?? job ?? null
  const [form, setForm] = useState<SyncJobForm>(emptySyncJobForm)
  const [touched, setTouched] = useState(false)
  // Create: the chosen realm's default sync options fill the form once.
  const [defaultsFor, setDefaultsFor] = useState('')
  const realmCfg = useRealmConfig(open && isCreate && form.realm ? form.realm : null)

  useEffect(() => {
    if (!open) return
    setForm(job ? syncJobToForm(job) : emptySyncJobForm())
    setTouched(false)
    setDefaultsFor('')
    // Reset when the dialog opens.
  }, [open])
  useEffect(() => {
    if (isCreate && form.realm && realmCfg.data && defaultsFor !== form.realm) {
      setForm((f) => ({ ...f, ...syncFormFromDefaults(realmCfg.data) }))
      setDefaultsFor(form.realm)
    }
  }, [isCreate, form.realm, realmCfg.data, defaultsFor])

  const set = <K extends keyof SyncJobForm>(key: K, value: SyncJobForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const realmOptions: SelectOption[] = (realms.data ?? [])
    .filter((r) => realmSupportsSync(r.type) && canSync(r.realm))
    .map((r) => ({ value: r.realm, label: r.realm, description: r.type === 'ad' ? 'Active Directory' : 'LDAP' }))
  const errors = validateSyncJobForm(form, isCreate)
  const invalid = Object.keys(errors).length > 0
  const changes = !isCreate && current ? syncJobUpdateParams(current, form) : null

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={isCreate ? '添加同步任务' : `编辑同步任务 ${job.id}`}
      description={isCreate ? '按计划从 LDAP / AD 认证域同步用户和组。' : `认证域 ${job.realm}`}
      submitLabel={isCreate ? '添加' : '保存'}
      submitDisabled={(touched && invalid) || (!isCreate && !changes)}
      onSubmit={async () => {
        setTouched(true)
        if (invalid) throw new Error(Object.values(errors)[0] ?? '请检查表单')
        if (isCreate) {
          const { id, params } = syncJobCreateParams(form)
          await runTask(createSyncJob(id, params), { title: `添加同步任务 ${id}`, syncSuccessMessage: `已添加同步任务 ${id}`, invalidate: [accessKeys.syncJobs()] })
        } else if (current && changes) {
          await runTask(updateSyncJob(current.id, changes), { title: `修改同步任务 ${current.id}`, syncSuccessMessage: `已保存同步任务 ${current.id}`, invalidate: [accessKeys.syncJobs()] })
        }
      }}
    >
      <FormRow>
        <FormField label="认证域" name="realm" required={isCreate} error={touched ? errors.realm : undefined}>
          {isCreate ? (
            <SelectField
              value={form.realm || undefined}
              onValueChange={(v) => set('realm', v ?? '')}
              options={realmOptions}
              loading={realms.isPending}
              placeholder={realmOptions.length ? '选择认证域' : '没有 LDAP / AD 认证域'}
              aria-label="认证域"
            />
          ) : (
            <FieldInput readOnly value={form.realm} className="bg-transparent" />
          )}
        </FormField>
        <FormField label="任务 ID" name="id" error={touched || form.id ? errors.id : undefined} hint={isCreate ? '留空自动生成' : undefined}>
          <FieldInput
            value={form.id}
            onChange={(e) => set('id', e.target.value)}
            readOnly={!isCreate}
            className={!isCreate ? 'bg-transparent' : undefined}
            placeholder="自动生成"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </FormField>
      </FormRow>
      <FormField label="计划" name="schedule" required error={touched ? errors.schedule : undefined}>
        <ScheduleInput value={form.schedule} onChange={(v) => set('schedule', v)} />
      </FormField>
      <FormRow>
        <FormField label="范围" name="scope" required error={touched ? errors.scope : undefined}>
          <SelectField value={form.scope || undefined} onValueChange={(v) => set('scope', v ?? '')} options={SCOPE_OPTIONS} placeholder="选择范围" aria-label="同步范围" />
        </FormField>
        <FormField label="启用新用户" name="enable-new">
          <SelectField value={form.enableNew} onValueChange={(v) => set('enableNew', v ?? '1')} options={YES_NO} aria-label="启用新用户" />
        </FormField>
      </FormRow>
      <RemoveVanishedFields value={form.removeVanished} onChange={(k, v) => setForm((f) => ({ ...f, removeVanished: { ...f.removeVanished, [k]: v } }))} />
      <FormField label="备注" name="comment">
        <FieldInput value={form.comment} onChange={(e) => set('comment', e.target.value)} />
      </FormField>
      <SwitchField label="启用" checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} />
    </FormDialog>
  )
}
