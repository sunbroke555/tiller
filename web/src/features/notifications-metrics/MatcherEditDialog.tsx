// Add / edit one matcher: general settings, the rule tree (root "match if"
// mode — all / any / not all / none — over field, severity and calendar
// rules) and the targets to notify.

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, Plus, SlidersHorizontal, Tag, Trash2, TriangleAlert } from 'lucide-react'

import {
  createMatcher,
  fetchMatcher,
  notificationKeys,
  updateMatcher,
  useMatcherFieldValues,
  useMatcherFields,
  useNotificationTargets,
  type TargetType,
} from '@/api/notifications-metrics'
import { FieldInput, FormDialog, FormField, FormRow, FormSection, SelectField, SwitchField } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ChipSelect, Notice } from '@/features/storage-config/fields'
import { useOpenSnapshot } from '@/hooks/useOpenSnapshot'
import { cn } from '@/lib/utils'

import {
  CALENDAR_EXAMPLES,
  FIELD_VALUE_LABEL,
  MATCH_MODES,
  RULE_KIND_LABEL,
  SEVERITIES,
  SEVERITY_LABEL,
  TARGET_INFO,
  fieldLabel,
  initialMatcherForm,
  isBuiltin,
  matcherParams,
  newRule,
  ruleError,
  switchFieldMode,
  validateMatcher,
  type MatchMode,
  type MatchRule,
  type MatcherForm,
  type RuleKind,
} from './model'

export interface MatcherEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  name?: string | undefined
  canEdit: boolean
}

const KIND_ICON = { field: Tag, severity: TriangleAlert, calendar: CalendarClock } as const

export function MatcherEditDialog({ open, onOpenChange, name, canEdit }: MatcherEditDialogProps) {
  const create = !name
  const q = useQuery({
    queryKey: notificationKeys.matcher(name ?? ''),
    queryFn: ({ signal }) => fetchMatcher(name!, signal),
    enabled: open && !create,
    staleTime: 0,
  })
  const snap = useOpenSnapshot(open, q.data)

  const [form, setForm] = useState<MatcherForm | null>(null)
  const [seeded, setSeeded] = useState<unknown>(null)
  const [tried, setTried] = useState(false)
  const source: unknown = create ? 'new' : snap
  if (open && source && seeded !== source) {
    setSeeded(source)
    setForm(initialMatcherForm(create ? undefined : snap))
    setTried(false)
  } else if (!open && seeded !== null) {
    setSeeded(null)
  }
  const set = <K extends keyof MatcherForm>(k: K, v: MatcherForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))

  const errors = useMemo(() => (form ? validateMatcher(form, create) : {}), [form, create])
  const err = (k: string) => (tried ? errors[k] : undefined)

  async function submit() {
    if (!form) return
    setTried(true)
    if (Object.keys(validateMatcher(form, create)).length) throw new Error('请先修正标出的问题')
    if (create) {
      const n = form.name.trim()
      await runTask(createMatcher(matcherParams(form, true)), { title: `添加匹配规则 ${n}`, syncSuccessMessage: `已添加匹配规则 ${n}` })
    } else {
      await runTask(updateMatcher(name, matcherParams(form, false, snap?.digest)), {
        title: `保存匹配规则 ${name}`,
        syncSuccessMessage: `已保存匹配规则 ${name}`,
      })
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={create ? '添加匹配规则' : `${canEdit ? '编辑' : '查看'}匹配规则 ${name}`}
      description="选出哪些通知，发给哪些目标"
      onSubmit={submit}
      submitLabel={create ? '添加' : '保存'}
      submitDisabled={!form || !canEdit}
    >
      {q.isError && !create ? (
        <Notice tone="error">读取规则失败：{q.error.message}</Notice>
      ) : !form ? (
        <div className="grid gap-3">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
        </div>
      ) : (
        <>
          {snap && isBuiltin(snap.origin) && <Notice>这是内置规则。修改后列表里显示“内置（已修改）”，随时可以重置回默认设置。</Notice>}
          <FormRow>
            <FormField label="名称" name="name" required={create} error={err('name')} hint={create ? '创建后不能修改' : undefined}>
              <FieldInput value={form.name} onChange={(e) => set('name', e.target.value)} readOnly={!create} placeholder="例如 backup-failures" className="font-mono" autoComplete="off" />
            </FormField>
            <div className="flex items-end pb-1">
              <SwitchField label="启用" checked={form.enable} onCheckedChange={(v) => set('enable', v)} />
            </div>
          </FormRow>
          <FormField label="备注" name="comment">
            <FieldInput value={form.comment} onChange={(e) => set('comment', e.target.value)} />
          </FormField>

          <FormSection title="匹配条件" description={form.rules.length ? undefined : '没有条件时匹配所有通知（取反时不匹配任何通知）'}>
            <RuleTree form={form} set={set} tried={tried} />
            {err('rules') && <p className="text-sm text-destructive">{err('rules')}</p>}
          </FormSection>

          <FormSection title="通知目标" description="匹配的通知发给这些目标">
            <TargetPicker value={form.targets} onChange={(v) => set('targets', v)} error={err('target')} />
          </FormSection>
        </>
      )}
    </FormDialog>
  )
}

// ------------------------------------------------------------------ rules

function RuleTree({ form, set, tried }: { form: MatcherForm; set: <K extends keyof MatcherForm>(k: K, v: MatcherForm[K]) => void; tried: boolean }) {
  const update = (i: number, r: MatchRule) => set('rules', form.rules.map((x, j) => (j === i ? r : x)))
  const add = (kind: RuleKind) => set('rules', [...form.rules, newRule(kind)])
  return (
    <div className="grid gap-3">
      <FormField label="何时匹配" name="mode">
        <SelectField<MatchMode> value={form.mode} onValueChange={(v) => set('mode', v ?? 'all')} options={MATCH_MODES.map((m) => ({ value: m.value, label: m.label }))} />
      </FormField>
      {form.rules.length > 0 && (
        <ol aria-label="规则" className="grid gap-2 border-l-2 border-border/70 pl-3">
          {form.rules.map((r, i) => (
            <RuleCard
              key={i}
              index={i}
              rule={r}
              error={tried ? ruleError(r) : undefined}
              onChange={(nr) => update(i, nr)}
              onRemove={() => set('rules', form.rules.filter((_, j) => j !== i))}
            />
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-2">
        {(['severity', 'field', 'calendar'] as const).map((k) => {
          const Icon = KIND_ICON[k]
          return (
            <Button key={k} type="button" variant="outline" size="sm" onClick={() => add(k)}>
              <Plus />
              <Icon />
              {RULE_KIND_LABEL[k]}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

function RuleCard({ index, rule: r, error, onChange, onRemove }: { index: number; rule: MatchRule; error: string | undefined; onChange: (r: MatchRule) => void; onRemove: () => void }) {
  const Icon = KIND_ICON[r.kind]
  return (
    <li
      aria-label={`规则 ${index + 1}：${RULE_KIND_LABEL[r.kind]}`}
      className={cn('grid gap-3 rounded-xl border border-border/70 bg-background/30 p-3 paper:bg-card', error && 'border-destructive/50')}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <SelectField<RuleKind>
          aria-label={`规则 ${index + 1} 类型`}
          value={r.kind}
          onValueChange={(v) => v && v !== r.kind && onChange(newRule(v))}
          options={(['field', 'severity', 'calendar'] as const).map((k) => ({ value: k, label: RULE_KIND_LABEL[k] }))}
          className="h-9 w-auto min-w-36"
        />
        <span className="flex-1" />
        <Button type="button" variant="ghost" size="icon" aria-label={`删除规则 ${index + 1}`} onClick={onRemove} className="text-muted-foreground pointer-coarse:size-11">
          <Trash2 />
        </Button>
      </div>
      {r.kind === 'field' && <FieldRule rule={r} onChange={onChange} />}
      {r.kind === 'severity' && (
        <ChipSelect
          label="严重级别"
          options={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))}
          value={r.severities}
          onChange={(v) => onChange({ ...r, severities: v })}
        />
      )}
      {r.kind === 'calendar' && (
        <div className="grid gap-2">
          <Input
            aria-label="时间范围"
            value={r.calendar}
            onChange={(e) => onChange({ ...r, calendar: e.target.value })}
            placeholder="mon..fri 8-17"
            className="font-mono"
            autoComplete="off"
          />
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>例子：</span>
            {CALENDAR_EXAMPLES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange({ ...r, calendar: c })}
                className="rounded-full border border-border/70 px-2 py-0.5 font-mono hover:bg-accent hover:text-foreground pointer-coarse:py-1.5"
              >
                {c}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">通知发出的时间落在这个范围内才匹配（星期 小时[:分钟]-小时[:分钟]）。</p>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </li>
  )
}

function FieldRule({ rule: r, onChange }: { rule: MatchRule; onChange: (r: MatchRule) => void }) {
  const fields = useMatcherFields()
  const values = useMatcherFieldValues()
  const [custom, setCustom] = useState('')
  const fieldOptions = useMemo(() => {
    const names = (fields.data ?? []).map((f) => f.name)
    if (r.field && !names.includes(r.field)) names.push(r.field)
    return names.map((n) => ({ value: n, label: `${fieldLabel(n)}${fieldLabel(n) !== n ? `（${n}）` : ''}` }))
  }, [fields.data, r.field])
  const valueOptions = useMemo(() => {
    const known = (values.data ?? []).filter((v) => v.field === r.field).map((v) => v.value)
    const all = [...new Set([...known, ...r.values])]
    return all.map((v) => ({ value: v, label: FIELD_VALUE_LABEL[v] ? `${FIELD_VALUE_LABEL[v]}（${v}）` : v }))
  }, [values.data, r.field, r.values])

  return (
    <div className="grid gap-2">
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
        <SelectField<'exact' | 'regex'>
          aria-label="匹配方式"
          value={r.fieldMode}
          onValueChange={(v) => v && onChange(switchFieldMode(r, v))}
          options={[
            { value: 'exact', label: '等于' },
            { value: 'regex', label: '正则' },
          ]}
        />
        <SelectField
          aria-label="字段"
          value={r.field || undefined}
          onValueChange={(v) => onChange({ ...r, field: v ?? '', values: [] })}
          options={fieldOptions}
          placeholder="选择字段"
          loading={fields.isPending}
        />
      </div>
      {r.fieldMode === 'regex' ? (
        <Input aria-label="正则表达式" value={r.regex} onChange={(e) => onChange({ ...r, regex: e.target.value })} placeholder="^(vzdump|replication)$" className="font-mono" autoComplete="off" />
      ) : r.field ? (
        <div className="grid gap-2">
          {valueOptions.length > 0 && <ChipSelect label="值" options={valueOptions} value={r.values} onChange={(v) => onChange({ ...r, values: v })} />}
          <div className="flex gap-2">
            <Input
              aria-label="其他值"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const v = custom.trim()
                  if (v && !r.values.includes(v)) onChange({ ...r, values: [...r.values, v] })
                  setCustom('')
                }
              }}
              placeholder="其他值，回车添加"
              className="font-mono text-sm"
              autoComplete="off"
            />
            <Button
              type="button"
              variant="outline"
              disabled={!custom.trim() || custom.includes(',')}
              onClick={() => {
                const v = custom.trim()
                if (v && !r.values.includes(v)) onChange({ ...r, values: [...r.values, v] })
                setCustom('')
              }}
            >
              添加值
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------------ targets

function TargetPicker({ value, onChange, error }: { value: string[]; onChange: (v: string[]) => void; error: string | undefined }) {
  const targets = useNotificationTargets()
  const rows = useMemo(() => {
    const list = (targets.data ?? []).map((t) => ({ name: t.name, type: t.type, comment: t.comment, missing: false }))
    for (const n of value) if (!list.some((t) => t.name === n)) list.push({ name: n, type: '-', comment: undefined, missing: true })
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [targets.data, value])
  const toggle = (n: string, on: boolean) => onChange(on ? [...value, n] : value.filter((x) => x !== n))

  if (targets.isPending) return <Skeleton className="h-20 rounded-xl" />
  return (
    <div className="grid gap-1.5">
      <ul aria-label="通知目标" className="grid divide-y divide-border/60 rounded-xl border border-border/70">
        {rows.map((t) => {
          const id = `nm-target-${t.name}`
          return (
            <li key={t.name}>
              <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2">
                <Checkbox id={id} checked={value.includes(t.name)} onCheckedChange={(c) => toggle(t.name, c === true)} />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium text-foreground">{t.name}</span>
                  <span className={cn('truncate text-xs text-muted-foreground', t.missing && 'text-destructive')}>
                    {t.missing ? '这个目标不存在' : [TARGET_INFO[t.type as TargetType]?.label ?? t.type, t.comment].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
        {rows.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">还没有通知目标</li>}
      </ul>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <SlidersHorizontal className="size-3" aria-hidden />
        已选 {value.length} 个
      </p>
    </div>
  )
}
