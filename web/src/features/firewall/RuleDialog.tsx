// Add / edit / copy a firewall rule, and insert / edit a security group rule.

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'

import { get, p } from '@/api/client'
import {
  firewallApi,
  firewallKey,
  useFirewallMacros,
  useFirewallRefs,
  useSecurityGroups,
  type FirewallRule,
  type FirewallScope,
  type LogLevel,
} from '@/api/firewall'
import { useNodeNetworks } from '@/api/queries'
import { FieldInput, FormDialog, FormField, FormRow, SelectField, SwitchField } from '@/components/form'

import {
  ACTION_LABEL,
  DIRECTION_LABEL,
  ICMP_TYPES,
  ICMPV6_TYPES,
  LOG_LEVELS,
  LOG_LEVEL_LABEL,
  PROTOCOLS,
  REF_SCOPE_LABEL,
  actionsFor,
  copyRuleForm,
  createRuleParams,
  emptyRuleForm,
  groupRuleParams,
  isIcmpProto,
  moveToParam,
  refOptions,
  ruleToForm,
  updateGroupRuleParams,
  updateRuleParams,
  validateRuleForm,
  type GroupRuleForm,
  type RuleForm,
  type ScopeFeatures,
} from './model'
import { SearchSelect, SuggestInput, type PickOption } from './pickers'
import { Segmented, ValidationError, useFormState } from './ui'
import { fwWrite } from './write'

export interface RuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: FirewallScope
  features: ScopeFeatures
  /** Edit this rule; otherwise add (from `copyOf` when copying). */
  rule?: FirewallRule | undefined
  copyOf?: FirewallRule | undefined
}

/** Interface suggestions: the guest's netX keys, or the node's bridges. */
function useIfaceOptions(scope: FirewallScope, enabled: boolean): PickOption[] {
  const guest = scope.kind === 'guest' ? scope : null
  const config = useQuery({
    queryKey: [...firewallKey(scope), 'nics'],
    queryFn: ({ signal }) =>
      get<Record<string, string | number>>(p`/nodes/${guest!.node}/${guest!.type}/${guest!.vmid}/config`, undefined, { signal }),
    enabled: enabled && !!guest,
    staleTime: 30_000,
  })
  const bridges = useNodeNetworks(scope.kind === 'node' ? scope.node : null, 'any_bridge', { enabled: enabled && scope.kind === 'node' })
  return useMemo(() => {
    if (guest) {
      return Object.entries(config.data ?? {})
        .filter(([k]) => /^net\d+$/.test(k))
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
        .map(([k, v]) => ({ value: k, label: k, description: String(v).replace(/^[^,]*=/, '').split(',')[0] }))
    }
    return (bridges.data ?? []).map((n) => ({ value: n.iface, label: n.iface, description: n.type }))
  }, [guest, config.data, bridges.data])
}

export function useRefPickOptions(scope: FirewallScope, enabled: boolean, type?: 'alias' | 'ipset'): PickOption[] {
  const refs = useFirewallRefs(scope, enabled)
  return useMemo(
    () =>
      refOptions(refs.data, type).map((r) => ({
        value: r.value,
        label: r.name,
        description: r.comment || REF_SCOPE_LABEL[r.scope] || r.scope,
        group: `${r.type === 'ipset' ? 'IPSet' : '别名'} · ${REF_SCOPE_LABEL[r.scope] ?? r.scope}`,
        keywords: [r.value, r.scope],
      })),
    [refs.data, type],
  )
}

const PROTO_OPTIONS: PickOption[] = PROTOCOLS.map((x) => ({ value: x.p, label: x.p, description: `${x.n} · ${x.d}`, keywords: [String(x.n)] }))
const ICMP_OPTIONS: PickOption[] = ICMP_TYPES.map((x) => ({ value: x.name, label: x.name, description: x.type, keywords: [x.type] }))
const ICMPV6_OPTIONS: PickOption[] = ICMPV6_TYPES.map((x) => ({ value: x.name, label: x.name, description: x.type, keywords: [x.type] }))

export function RuleDialog({ open, onOpenChange, scope, features, rule, copyOf }: RuleDialogProps) {
  const editing = !!rule
  const [form, setForm] = useFormState<RuleForm>(open, () =>
    rule ? ruleToForm(rule) : copyOf ? copyRuleForm(copyOf) : emptyRuleForm(features),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const macros = useFirewallMacros(open)
  const refOpts = useRefPickOptions(scope, open)
  const ifaceOpts = useIfaceOptions(scope, open && features.iface)
  const set = <K extends keyof RuleForm>(k: K, v: RuleForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    const field = k === 'icmpType' ? 'icmp-type' : (k as string)
    if (errors[field])
      setErrors((e) => {
        const next = { ...e }
        delete next[field]
        return next
      })
  }

  const macroOptions = useMemo<PickOption[]>(
    () =>
      [...(macros.data ?? [])]
        .sort((a, b) => a.macro.localeCompare(b.macro))
        .map((m) => ({ value: m.macro, label: m.macro, description: m.descr })),
    [macros.data],
  )
  const icmp = isIcmpProto(form.proto)
  const hasMacro = !!form.macro
  const opts = { iface: features.iface }
  const title = editing ? `编辑规则 #${rule.pos}` : copyOf ? `复制规则 #${copyOf.pos}` : '添加规则'

  async function submit() {
    const found = validateRuleForm(form, { ...opts, guest: scope.kind === 'guest' })
    setErrors(found)
    if (Object.keys(found).length) throw new ValidationError()
    if (rule) {
      const params = updateRuleParams(rule, form, opts)
      if (!params) return
      await fwWrite(firewallApi.updateRule(scope, rule.pos, params), `规则 #${rule.pos}`, scope)
      return
    }
    await fwWrite(firewallApi.createRule(scope, createRuleParams(form, opts)), copyOf ? '复制规则' : '添加规则', scope, { quiet: !!copyOf })
    if (copyOf) {
      // New rules land on top; put the copy right below its original.
      const to = copyOf.pos + 1
      await fwWrite(firewallApi.moveRule(scope, 0, moveToParam(0, to)), '复制规则', scope)
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={editing ? undefined : copyOf ? '副本放在原规则下方，默认不启用。' : '新规则添加到列表顶部（第 0 条），之后可以拖动调整顺序。'}
      size="lg"
      onSubmit={submit}
      submitLabel={editing ? '保存' : '添加'}
    >
      <FormRow>
        <FormField label="方向" name="type">
          <Segmented
            aria-label="方向"
            value={form.type}
            onChange={(v) => {
              set('type', v)
              if (!actionsFor(v).includes(form.action)) set('action', 'ACCEPT')
            }}
            options={features.directions.map((d) => ({ value: d, label: DIRECTION_LABEL[d] }))}
          />
        </FormField>
        <FormField label="动作" name="action">
          <Segmented
            aria-label="动作"
            value={form.action}
            onChange={(v) => set('action', v)}
            options={actionsFor(form.type).map((a) => ({ value: a, label: `${ACTION_LABEL[a]} ${a}` }))}
          />
        </FormField>
      </FormRow>
      {form.type === 'forward' && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          转发规则只在节点选项启用 nftables 后端后生效。
        </p>
      )}

      <SwitchField label="启用" description="不启用的规则保存在配置里，但不生效" checked={form.enable} onCheckedChange={(v) => set('enable', v)} />

      <FormRow>
        <FormField label="宏" name="macro" hint={hasMacro ? '宏决定协议和端口' : '预定义的服务（HTTPS、SSH…）'}>
          <SearchSelect
            value={form.macro || undefined}
            onValueChange={(v) => setForm((f) => ({ ...f, macro: v ?? '', ...(v ? { proto: '', sport: '', dport: '', icmpType: '' } : {}) }))}
            options={macroOptions}
            loading={macros.isPending}
            emptyOption="无"
            searchPlaceholder="搜索宏…"
          />
        </FormField>
        {features.iface ? (
          <FormField label="接口" name="iface" error={errors.iface} hint={scope.kind === 'guest' ? '网卡键名，如 net0；留空为全部' : '留空为全部接口'}>
            <SuggestInput
              value={form.iface}
              onChange={(v) => set('iface', v)}
              options={ifaceOpts}
              placeholder={scope.kind === 'guest' ? 'net0' : '全部'}
              pickLabel="选择接口"
              emptyText="没有可选的接口"
            />
          </FormField>
        ) : (
          <div className="hidden sm:block" />
        )}
      </FormRow>

      <FormRow>
        <FormField label="协议" name="proto" error={errors.proto} disabled={hasMacro}>
          <SuggestInput
            value={form.proto}
            onChange={(v) => set('proto', v)}
            options={PROTO_OPTIONS}
            placeholder={hasMacro ? '由宏决定' : '全部'}
            pickLabel="选择协议"
            searchPlaceholder="搜索协议…"
          />
        </FormField>
        {icmp ? (
          <FormField label="ICMP 类型" name="icmp-type">
            <SuggestInput
              value={form.icmpType}
              onChange={(v) => set('icmpType', v)}
              options={icmp === 'v4' ? ICMP_OPTIONS : ICMPV6_OPTIONS}
              placeholder="全部"
              pickLabel="选择 ICMP 类型"
              searchPlaceholder="搜索类型…"
            />
          </FormField>
        ) : (
          <div className="hidden sm:block" />
        )}
      </FormRow>

      <FormRow>
        <FormField label="源地址" name="source" error={errors.source} hint="IP、CIDR、范围、别名或 +IPSet；多个用逗号分隔">
          <SuggestInput
            value={form.source}
            onChange={(v) => set('source', v)}
            options={refOpts}
            placeholder="任意"
            pickLabel="选择源别名或 IPSet"
            emptyText="没有别名或 IPSet"
          />
        </FormField>
        <FormField label="源端口" name="sport" error={errors.sport} disabled={hasMacro}>
          <FieldInput value={form.sport} onChange={(e) => set('sport', e.target.value)} placeholder={hasMacro ? '由宏决定' : '任意'} spellCheck={false} />
        </FormField>
      </FormRow>

      <FormRow>
        <FormField label="目的地址" name="dest" error={errors.dest}>
          <SuggestInput
            value={form.dest}
            onChange={(v) => set('dest', v)}
            options={refOpts}
            placeholder="任意"
            pickLabel="选择目的别名或 IPSet"
            emptyText="没有别名或 IPSet"
          />
        </FormField>
        {!icmp && (
          <FormField label="目的端口" name="dport" error={errors.dport} disabled={hasMacro} hint={hasMacro ? undefined : '如 22、80:85、https；逗号分隔'}>
            <FieldInput value={form.dport} onChange={(e) => set('dport', e.target.value)} placeholder={hasMacro ? '由宏决定' : '任意'} spellCheck={false} />
          </FormField>
        )}
      </FormRow>

      <FormRow>
        <FormField label="日志级别" name="log">
          <SelectField<LogLevel> value={form.log} onValueChange={(v) => set('log', v ?? 'nolog')} options={LOG_LEVELS.map((l) => ({ value: l, label: LOG_LEVEL_LABEL[l] }))} />
        </FormField>
        <FormField label="注释" name="comment">
          <FieldInput value={form.comment} onChange={(e) => set('comment', e.target.value)} placeholder="可选" />
        </FormField>
      </FormRow>
    </FormDialog>
  )
}

// ------------------------------------------------------- security group rule

export interface GroupRuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: FirewallScope
  features: ScopeFeatures
  rule?: FirewallRule | undefined
}

/** Insert a security group into a scope's rules (type=group), or edit such a rule. */
export function GroupRuleDialog({ open, onOpenChange, scope, features, rule }: GroupRuleDialogProps) {
  const groups = useSecurityGroups(open)
  const ifaceOpts = useIfaceOptions(scope, open && features.iface)
  const [form, setForm] = useFormState<GroupRuleForm>(open, () => ({
    group: rule?.action ?? '',
    iface: rule?.iface ?? '',
    enable: rule ? !!rule.enable : false,
    comment: rule?.comment ?? '',
  }))
  const [error, setError] = useState<string>()
  const opts = { iface: features.iface }

  async function submit() {
    if (!form.group) {
      setError('请选择安全组')
      throw new ValidationError()
    }
    if (scope.kind === 'guest' && form.iface.trim() && !/^net\d+$/.test(form.iface.trim())) throw new ValidationError('客户机的接口要写网卡键名，例如 net0')
    if (rule) {
      const params = updateGroupRuleParams(rule, form, opts)
      if (!params) return
      await fwWrite(firewallApi.updateRule(scope, rule.pos, params), `规则 #${rule.pos}`, scope)
    } else {
      await fwWrite(firewallApi.createRule(scope, groupRuleParams(form, opts)), `插入安全组 ${form.group}`, scope)
    }
  }

  const options = (groups.data ?? []).map((g) => ({ value: g.group, label: g.group, description: g.comment }))

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={rule ? `编辑规则 #${rule.pos}` : '插入安全组'}
      description={rule ? undefined : '安全组的规则按组内顺序在这个位置生效；插入到列表顶部。'}
      onSubmit={submit}
      submitLabel={rule ? '保存' : '插入'}
    >
      <FormField label="安全组" name="action" required error={error}>
        <SelectField
          value={form.group || undefined}
          onValueChange={(v) => {
            setForm((f) => ({ ...f, group: v ?? '' }))
            setError(undefined)
          }}
          options={options}
          loading={groups.isPending}
          placeholder={groups.data && groups.data.length === 0 ? '还没有安全组' : '选择安全组'}
        />
      </FormField>
      {features.iface && (
        <FormField label="接口" name="iface" hint={scope.kind === 'guest' ? '网卡键名，如 net0；留空为全部' : '留空为全部接口'}>
          <SuggestInput
            value={form.iface}
            onChange={(v) => setForm((f) => ({ ...f, iface: v }))}
            options={ifaceOpts}
            placeholder={scope.kind === 'guest' ? 'net0' : '全部'}
            pickLabel="选择接口"
            emptyText="没有可选的接口"
          />
        </FormField>
      )}
      <SwitchField label="启用" checked={form.enable} onCheckedChange={(v) => setForm((f) => ({ ...f, enable: v }))} />
      <FormField label="注释" name="comment">
        <FieldInput value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} placeholder="可选" />
      </FormField>
    </FormDialog>
  )
}
