// Add / edit an HA node affinity or resource affinity rule.

import { useEffect, useMemo, useState } from 'react'

import { createHaRule, haKeys, updateHaRule, useHaResources, type HaRule, type HaRuleType } from '@/api/ha'
import { useClusterResources } from '@/api/queries'
import { isGuest, isNode } from '@/api/types'
import { FieldInput, FormDialog, FormField, NumberInput, SelectField, SwitchField } from '@/components/form'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { runTask } from '@/components/tasks/tracker'
import { Checkbox } from '@/components/ui/checkbox'
import { guestName } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { AFFINITY_LABEL, newRuleId, parseSid, ruleForm, ruleFormErrors, ruleParams, type RuleForm } from './logic'

const TITLE: Record<HaRuleType, string> = { 'node-affinity': '节点亲和规则', 'resource-affinity': '资源亲和规则' }

export function RuleDialog({
  open,
  onOpenChange,
  type,
  rule,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: HaRuleType
  rule?: HaRule
}) {
  const isCreate = !rule
  const configs = useHaResources()
  const resources = useClusterResources()
  const [form, setForm] = useState<RuleForm>(() => ruleForm(type, rule))
  const set = <K extends keyof RuleForm>(k: K, v: RuleForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!open) return
    setForm({ ...ruleForm(type, rule), rule: rule ? undefined : newRuleId(type) })
  }, [open, type, rule?.digest])

  const guests = useMemo(() => new Map((resources.data ?? []).filter(isGuest).map((g) => [g.vmid, g])), [resources.data])
  const nodes = useMemo(
    () => (resources.data ?? []).filter(isNode).sort((a, b) => a.node.localeCompare(b.node)),
    [resources.data],
  )
  // HA resources to choose from (plus ones the rule references that are gone).
  const sids = useMemo(() => {
    const set = new Set((configs.data ?? []).map((c) => c.sid))
    for (const s of form.resources) set.add(s)
    return [...set].sort((a, b) => (parseSid(a)?.vmid ?? 0) - (parseSid(b)?.vmid ?? 0) || a.localeCompare(b))
  }, [configs.data, form.resources])

  const errors = ruleFormErrors(form, isCreate)
  const invalid = Object.keys(errors).length > 0

  const toggleResource = (sid: string, on: boolean) =>
    set('resources', on ? [...form.resources, sid] : form.resources.filter((s) => s !== sid))
  const nodeEntry = (node: string) => form.nodes.find((n) => n.node === node)
  const toggleNode = (node: string, on: boolean) =>
    set('nodes', on ? [...form.nodes, { node }] : form.nodes.filter((n) => n.node !== node))
  const setPriority = (node: string, priority: number | undefined) =>
    set(
      'nodes',
      form.nodes.map((n) => (n.node === node ? { node, priority } : n)),
    )

  const submit = () =>
    isCreate
      ? runTask(createHaRule(ruleParams(form, null)), {
          title: `添加${TITLE[type]} ${form.rule}`,
          syncSuccessMessage: `已添加规则 ${form.rule}`,
          invalidate: [haKeys.all()],
        })
      : runTask(updateHaRule(rule!.rule, ruleParams(form, rule)), {
          title: `更新规则 ${rule!.rule}`,
          syncSuccessMessage: `规则 ${rule!.rule} 已保存`,
          invalidate: [haKeys.all()],
        })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isCreate ? `添加${TITLE[type]}` : `编辑规则 ${rule!.rule}`}
      description={
        type === 'node-affinity'
          ? '让选中的 HA 资源优先运行在优先级最高的在线节点上。'
          : '让选中的 HA 资源保持在同一节点，或分散到不同节点。'
      }
      size="lg"
      submitLabel={isCreate ? '添加' : '保存'}
      submitDisabled={invalid}
      onSubmit={submit}
    >
      {isCreate && (
        <FormField label="规则 ID" name="rule" required error={form.rule && errors.rule ? errors.rule : undefined}>
          <FieldInput value={form.rule ?? ''} onChange={(e) => set('rule', e.target.value.trim())} autoComplete="off" spellCheck={false} />
        </FormField>
      )}
      <SwitchField label="启用" checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} />

      <FormField
        label="HA 资源"
        name="resources"
        required
        hint={sids.length === 0 ? '还没有 HA 资源，先在「状态与资源」里添加。' : `已选 ${form.resources.length} 个${errors.resources ? ` · ${errors.resources}` : ''}`}
      >
        <ul className="grid max-h-56 gap-0.5 overflow-y-auto rounded-xl p-1 ring-1 ring-border/70 ring-inset" aria-label="HA 资源">
          {sids.map((sid) => {
            const p = parseSid(sid)
            const g = p ? guests.get(p.vmid) : undefined
            const checked = form.resources.includes(sid)
            return (
              <li key={sid}>
                <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-foreground/[0.04] pointer-coarse:min-h-11">
                  <Checkbox checked={checked} onCheckedChange={(v) => toggleResource(sid, v === true)} aria-label={sid} />
                  <ResourceIcon type={p?.kind === 'ct' ? 'lxc' : 'qemu'} />
                  <span className="font-mono text-[13px] text-muted-foreground">{sid}</span>
                  <span className="min-w-0 flex-1 truncate">{g ? guestName(g) : ''}</span>
                  {g && <span className="text-xs text-muted-foreground">{g.node}</span>}
                </label>
              </li>
            )
          })}
        </ul>
      </FormField>

      {type === 'node-affinity' ? (
        <>
          <div className="grid gap-1.5">
            <div className="text-sm font-medium">
              节点 <span className="text-destructive">*</span>
            </div>
            <ul className="grid gap-0.5 rounded-xl p-1 ring-1 ring-border/70 ring-inset" aria-label="节点">
              {nodes.map((n) => {
                const entry = nodeEntry(n.node)
                return (
                  <li key={n.node} className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <Checkbox checked={!!entry} onCheckedChange={(v) => toggleNode(n.node, v === true)} aria-label={n.node} />
                      <StatusDot status={n.status} pulse={false} decorative />
                      <span className="truncate">{n.node}</span>
                    </label>
                    <div className={cn('w-36 shrink-0', !entry && 'invisible')}>
                      <NumberInput
                        value={entry?.priority}
                        onChange={(v) => setPriority(n.node, v)}
                        min={0}
                        max={1000}
                        aria-label={`${n.node} 的优先级`}
                        placeholder="优先级 0"
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="text-xs text-muted-foreground">{errors.nodes ?? '优先级越大越优先，相同优先级的节点之间按负载选择。'}</p>
          </div>
          <SwitchField
            label="严格"
            description="HA 资源只能运行在这些节点上；关闭时节点都不可用会退到其他节点。"
            checked={form.strict}
            onCheckedChange={(v) => set('strict', v)}
          />
        </>
      ) : (
        <FormField label="亲和" name="affinity">
          <SelectField
            value={form.affinity}
            onValueChange={(v) => set('affinity', v ?? 'negative')}
            options={[
              { value: 'positive', label: AFFINITY_LABEL.positive, description: '始终运行在同一节点' },
              { value: 'negative', label: AFFINITY_LABEL.negative, description: '各自运行在不同节点' },
            ]}
          />
        </FormField>
      )}

      <FormField label="备注" name="comment">
        <FieldInput value={form.comment} onChange={(e) => set('comment', e.target.value)} placeholder="可选" />
      </FormField>
    </FormDialog>
  )
}
