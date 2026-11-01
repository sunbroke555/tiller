// Firewall options of a scope: booleans toggle in place, everything else
// opens a small editor. "恢复默认" deletes the key. Turning the datacenter or
// node firewall on asks first and checks whether 8006/22 stay reachable.

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2, RotateCcw, Settings2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  firewallApi,
  useFirewallOptions,
  useFirewallRules,
  type FirewallOptions,
  type FirewallScope,
  type LogLevel,
  type Policy,
} from '@/api/firewall'
import { CheckboxField, FormDialog, FormField, FormRow, NumberInput, SelectField, SwitchField } from '@/components/form'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { GlassCard } from '@/components/GlassCard'
import { ErrorCard, LoadingRows } from '@/components/QueryState'
import { Switch } from '@/components/ui/switch'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import {
  ACTION_LABEL,
  LOG_LEVELS,
  LOG_LEVEL_LABEL,
  NF_CONNTRACK_HELPERS,
  RATE_UNIT_LABEL,
  formatOption,
  managementAccess,
  optionDefs,
  optionParams,
  optionValue,
  parseLogRatelimit,
  stringifyLogRatelimit,
  type LogRatelimit,
  type OptionDef,
  type RateUnit,
} from './model'
import { ListSection, RowMenu, useDialog, useFormState } from './ui'
import { fwWrite } from './write'

export function OptionsView({ scope, canEdit }: { scope: FirewallScope; canEdit: boolean }) {
  const query = useFirewallOptions(scope)
  const edit = useDialog<OptionDef>()
  const enable = useDialog<true>()
  const [busy, setBusy] = useState<string | null>(null)
  const defs = optionDefs(scope)
  const options = query.data

  if (query.isPending) {
    return (
      <GlassCard flush>
        <LoadingRows rows={5} />
      </GlassCard>
    )
  }
  if (query.isError) return <ErrorCard error={query.error} onRetry={() => void query.refetch()} />

  async function save(def: OptionDef, value: string | boolean | undefined, digest = options?.digest) {
    await fwWrite(firewallApi.setOptions(scope, optionParams(def.key, value, digest)), def.label, scope, { quiet: def.kind === 'bool' })
  }

  async function toggle(def: OptionDef, checked: boolean) {
    // Turning on the datacenter/node firewall can lock everyone out: confirm first.
    if (def.key === 'enable' && checked && (scope.kind === 'dc' || scope.kind === 'node')) {
      enable.show(true)
      return
    }
    setBusy(def.key)
    try {
      await save(def, checked)
    } catch (e) {
      toast.error(`${def.label}：保存失败`, { description: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const sections = [...new Set(defs.map((d) => d.section))]
  const enableDef = defs.find((d) => d.key === 'enable')

  return (
    <div className="grid gap-(--section-gap)">
      {sections.map((section) => (
        <ListSection key={section} title={section}>
          {defs
            .filter((d) => d.section === section)
            .map((def) => (
              <OptionRow
                key={def.key}
                def={def}
                value={optionValue(options, def.key)}
                canEdit={canEdit}
                busy={busy === def.key}
                onToggle={(v) => void toggle(def, v)}
                onEdit={() => edit.show(def)}
                onReset={() =>
                  void save(def, undefined).catch((e: unknown) => toast.error(`${def.label}：恢复默认失败`, { description: errorMessage(e) }))
                }
              />
            ))}
        </ListSection>
      ))}

      <OptionDialog {...edit.props} def={edit.data} options={options} onSave={save} />
      {enableDef && (scope.kind === 'dc' || scope.kind === 'node') && (
        <EnableFirewallDialog {...enable.props} scope={scope} options={options} onConfirm={() => save(enableDef, true)} />
      )}
    </div>
  )
}

function OptionRow({
  def,
  value,
  canEdit,
  busy,
  onToggle,
  onEdit,
  onReset,
}: {
  def: OptionDef
  value: string | undefined
  canEdit: boolean
  busy: boolean
  onToggle: (checked: boolean) => void
  onEdit: () => void
  onReset: () => void
}) {
  const isDefault = value === undefined
  const text = formatOption(def, value)
  const menu = canEdit && !isDefault ? [{ id: 'reset', label: '恢复默认', icon: RotateCcw, onSelect: onReset }] : []
  const body = (
    <span className="grid min-w-0 flex-1 gap-0.5">
      <span className="font-medium">{def.label}</span>
      {def.kind !== 'bool' && (
        <span className={cn('truncate text-[13px] text-muted-foreground tabular', isDefault && 'text-faint')}>
          {text}
          {isDefault && '（默认）'}
        </span>
      )}
      {def.hint && <span className="text-xs leading-relaxed text-muted-foreground">{def.hint}</span>}
    </span>
  )
  const rowCls = 'flex min-h-14 min-w-0 flex-1 items-center gap-3 px-(--card-p) py-(--row-py) text-left compact:min-h-11'

  if (def.kind === 'bool') {
    return (
      <div className="flex min-w-0 items-stretch" data-option={def.key}>
        <label className={cn(rowCls, canEdit && 'cursor-pointer')}>
          {body}
          {isDefault && <span className="hidden text-xs text-faint sm:inline">默认</span>}
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
          <Switch checked={(value ?? def.default) === '1'} disabled={!canEdit || busy} onCheckedChange={onToggle} aria-label={def.label} />
        </label>
        {menu.length > 0 && <RowMenu label={def.label} actions={menu} className="mr-1 self-center" />}
      </div>
    )
  }
  return (
    <div className="flex min-w-0 items-stretch" data-option={def.key}>
      {canEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className={cn(rowCls, 'outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] active:bg-foreground/[0.05]')}
          aria-label={`${def.label}：${text}${isDefault ? '（默认）' : ''}，编辑`}
        >
          {body}
          {menu.length === 0 && <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />}
        </button>
      ) : (
        <div className={rowCls}>{body}</div>
      )}
      {menu.length > 0 && <RowMenu label={def.label} actions={menu} className="mr-1 self-center" />}
    </div>
  )
}

// ---------------------------------------------------------------- editor

interface OptionForm {
  /** Digest of the options as the dialog opened (a concurrent change is rejected). */
  digest: string | undefined
  value: string | undefined
  num: number | undefined
  rate: LogRatelimit
  helpers: string[]
}

function OptionDialog({
  open,
  onOpenChange,
  def,
  options,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  def: OptionDef | undefined
  options: FirewallOptions | undefined
  onSave: (def: OptionDef, value: string | undefined, digest?: string) => Promise<void>
}) {
  const [form, setForm] = useFormState<OptionForm>(open, () => {
    const v = def ? optionValue(options, def.key) : undefined
    return {
      digest: options?.digest,
      value: v,
      num: v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined,
      rate: parseLogRatelimit(v ?? def?.default),
      helpers: v ? v.split(',').filter(Boolean) : [],
    }
  })
  if (!def) return null

  async function submit() {
    if (!def) return
    let value: string | undefined
    switch (def.kind) {
      case 'policy':
      case 'log':
        value = form.value
        break
      case 'int':
        value = form.num === undefined ? undefined : String(form.num)
        break
      case 'ratelimit':
        value = stringifyLogRatelimit(form.rate)
        break
      case 'helpers':
        value = form.helpers.length ? NF_CONNTRACK_HELPERS.filter((h) => form.helpers.includes(h)).join(',') : undefined
        break
      default:
        return
    }
    if (value === optionValue(options, def.key)) return
    await onSave(def, value, form.digest)
  }

  const setRate = (patch: Partial<LogRatelimit>) => setForm((f) => ({ ...f, rate: { ...f.rate, ...patch } }))

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={def.label} description={def.hint} size="sm" onSubmit={submit}>
      {def.kind === 'policy' && (
        <FormField label={def.label} name={def.key}>
          <SelectField<Policy>
            value={form.value as Policy | undefined}
            onValueChange={(v) => setForm((f) => ({ ...f, value: v }))}
            emptyOption={`默认（${def.default}）`}
            options={(def.policies ?? []).map((p) => ({ value: p, label: `${p}（${ACTION_LABEL[p]}）` }))}
          />
        </FormField>
      )}
      {def.kind === 'log' && (
        <FormField label={def.label} name={def.key}>
          <SelectField<LogLevel>
            value={form.value as LogLevel | undefined}
            onValueChange={(v) => setForm((f) => ({ ...f, value: v }))}
            emptyOption="默认（不记录）"
            options={LOG_LEVELS.map((l) => ({ value: l, label: LOG_LEVEL_LABEL[l] }))}
          />
        </FormField>
      )}
      {def.kind === 'int' && (
        <FormField label={def.label} name={def.key} hint={`留空使用默认值 ${def.default}${def.min !== undefined ? `；最小 ${def.min}` : ''}${def.max !== undefined ? `，最大 ${def.max}` : ''}`}>
          <NumberInput value={form.num} onChange={(v) => setForm((f) => ({ ...f, num: v }))} min={def.min} max={def.max} placeholder={def.default} />
        </FormField>
      )}
      {def.kind === 'ratelimit' && (
        <>
          <SwitchField label="启用日志限速" checked={form.rate.enable} onCheckedChange={(v) => setRate({ enable: v })} />
          <FormRow>
            <FormField label="速率" name="rate" disabled={!form.rate.enable}>
              <NumberInput value={form.rate.rate} onChange={(v) => setRate({ rate: v ?? 1 })} min={1} max={99} />
            </FormField>
            <FormField label="每" disabled={!form.rate.enable}>
              <SelectField<RateUnit>
                value={form.rate.unit}
                onValueChange={(v) => setRate({ unit: v ?? 'second' })}
                options={(Object.keys(RATE_UNIT_LABEL) as RateUnit[]).map((u) => ({ value: u, label: RATE_UNIT_LABEL[u] }))}
              />
            </FormField>
          </FormRow>
          <FormField label="突发" name="burst" hint="1–99 条" disabled={!form.rate.enable}>
            <NumberInput value={form.rate.burst} onChange={(v) => setRate({ burst: v ?? 5 })} min={1} max={99} />
          </FormField>
        </>
      )}
      {def.kind === 'helpers' && (
        <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-3">
          {NF_CONNTRACK_HELPERS.map((h) => (
            <CheckboxField
              key={h}
              label={h}
              checked={form.helpers.includes(h)}
              onCheckedChange={(c) => setForm((f) => ({ ...f, helpers: c ? [...f.helpers, h] : f.helpers.filter((x) => x !== h) }))}
            />
          ))}
        </div>
      )}
    </FormDialog>
  )
}

// ------------------------------------------------------------ enable check

function EnableFirewallDialog({
  open,
  onOpenChange,
  scope,
  options,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: Extract<FirewallScope, { kind: 'dc' } | { kind: 'node' }>
  options: FirewallOptions | undefined
  onConfirm: () => Promise<void>
}) {
  const dcRules = useFirewallRules({ kind: 'dc' }, open)
  const nodeRules = useFirewallRules(scope, open && scope.kind === 'node')
  const loading = dcRules.isPending || (scope.kind === 'node' && nodeRules.isPending)
  const access = managementAccess([...(dcRules.data ?? []), ...(scope.kind === 'node' ? (nodeRules.data ?? []) : [])])
  const policy = scope.kind === 'dc' ? String(options?.policy_in ?? 'DROP') : null

  const Check = ({ ok, children }: { ok: boolean; children: string }) => (
    <span className={cn('flex items-start gap-2', ok ? 'text-success-strong' : 'text-warning-strong')}>
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <span>{children}</span>
    </span>
  )

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={scope.kind === 'dc' ? '启用数据中心防火墙？' : '启用节点防火墙？'}
      confirmLabel="启用"
      destructive
      description={
        <span className="grid gap-3 text-left">
          <span>
            {policy
              ? `启用后入站默认策略 ${policy} 立即对所有节点生效，没有被规则放行的连接会被${policy === 'ACCEPT' ? '放行' : '阻断'}。`
              : '节点规则在数据中心防火墙启用后才会生效。'}
            确认管理端口仍可访问：
          </span>
          {loading ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> 正在检查规则…
            </span>
          ) : (
            <span className="grid gap-1.5 text-sm">
              <Check ok={access.web}>{access.web ? '有放行 8006（Web 界面）的入站规则' : '没有找到放行 8006（Web 界面）的入站规则'}</Check>
              <Check ok={access.ssh}>{access.ssh ? '有放行 22（SSH）的入站规则' : '没有找到放行 22（SSH）的入站规则'}</Check>
            </span>
          )}
          <span className="flex items-start gap-2 text-xs text-muted-foreground">
            <Settings2 className="mt-px size-3.5 shrink-0" aria-hidden />
            集群网络（localnet）对 8006 和 22 的访问默认放行；从其他网段管理时需要规则。安全组里的规则不在检查范围内。
          </span>
        </span>
      }
      onConfirm={onConfirm}
    />
  )
}
