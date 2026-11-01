// /datacenter/ha/rules: node affinity and resource affinity rules (PVE 9
// replaced HA groups with these).

import { useMemo, useState } from 'react'
import { CheckCircle2, Ellipsis, Link2, MapPin, Pause, Pencil, Play, Plus, Trash2, TriangleAlert } from 'lucide-react'

import { deleteHaRule, haKeys, updateHaRule, useHaRules, type HaRule, type HaRuleType } from '@/api/ha'
import { useClusterResources } from '@/api/queries'
import { isGuest, type GuestResource } from '@/api/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { fireTask, runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/errors'
import { guestName } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { AFFINITY_LABEL, parseResourceList, parseRuleNodes, parseSid, ruleErrors } from './logic'
import { RuleDialog } from './RuleDialog'
import { CardHeader, Chip, Notice, useHaAccess } from './ui'

type Dialog = { kind: 'add'; type: HaRuleType } | { kind: 'edit' | 'delete' | 'errors'; rule: string } | null

const TYPES: { type: HaRuleType; title: string; icon: typeof MapPin; empty: string }[] = [
  {
    type: 'node-affinity',
    title: '节点亲和规则',
    icon: MapPin,
    empty: '让 HA 资源优先（或只能）运行在指定节点上，节点可以设优先级。取代了旧版的 HA 组。',
  },
  {
    type: 'resource-affinity',
    title: '资源亲和规则',
    icon: Link2,
    empty: '让几个 HA 资源保持在同一节点（例如应用和它的缓存），或保持在不同节点（例如主备两台）。',
  },
]

export function RulesView() {
  const rules = useHaRules()
  const resources = useClusterResources()
  const access = useHaAccess()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [shown, setShown] = useState<Dialog>(null)
  if (dialog && dialog !== shown) setShown(dialog)
  const isOpen = dialog !== null && dialog === shown
  const close = (o: boolean) => {
    if (!o) setDialog(null)
  }
  const guests = useMemo(() => new Map((resources.data ?? []).filter(isGuest).map((g) => [g.vmid, g])), [resources.data])
  const active = shown && 'rule' in shown ? rules.data?.find((r) => r.rule === shown.rule) : undefined

  const toggle = (r: HaRule) => {
    const enable = !!r.disable
    fireTask(updateHaRule(r.rule, { type: r.type, ...(enable ? { delete: 'disable' } : { disable: 1 }), ...(r.digest ? { digest: r.digest } : {}) }), {
      title: `${enable ? '启用' : '停用'}规则 ${r.rule}`,
      syncSuccessMessage: `已${enable ? '启用' : '停用'}规则 ${r.rule}`,
      invalidate: [haKeys.all()],
    })
  }

  const withErrors = (rules.data ?? []).filter((r) => ruleErrors(r).length > 0)

  return (
    <div className="grid gap-(--section-gap)">
      {withErrors.length > 0 && (
        <Notice tone="warning" title={`${withErrors.length} 条规则有冲突或错误`}>
          有问题的规则不会生效。点规则旁的 <TriangleAlert className="inline size-3.5 align-[-2px]" aria-label="警告" /> 查看原因。
        </Notice>
      )}
      {rules.error && <Notice tone="error">无法读取 HA 规则：{errorMessage(rules.error)}</Notice>}
      {TYPES.map((t) => {
        const list = (rules.data ?? []).filter((r) => r.type === t.type).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.rule.localeCompare(b.rule))
        return (
          <GlassCard key={t.type} flush className="overflow-hidden" data-testid={`ha-rules-${t.type}`}>
            <CardHeader title={t.title} summary={rules.isPending ? '正在读取…' : list.length ? `${list.length} 条规则` : '还没有规则'}>
              <Button
                variant="outline"
                onClick={() => setDialog({ kind: 'add', type: t.type })}
                disabled={!access.canEdit}
                aria-label={`添加${t.title}`}
                title={access.canEdit ? undefined : '没有 Sys.Console 权限'}
              >
                <Plus />
                添加
              </Button>
            </CardHeader>
            {rules.isPending ? (
              <div className="grid gap-3 p-(--card-p)">
                <Skeleton className="h-10 w-full" />
              </div>
            ) : list.length === 0 ? (
              <EmptyState icon={t.icon} title={`没有${t.title}`} description={t.empty} className="py-8" />
            ) : (
              <ul className="divide-y divide-border/60" aria-label={t.title}>
                {list.map((r) => (
                  <RuleRow
                    key={r.rule}
                    rule={r}
                    guests={guests}
                    canEdit={access.canEdit}
                    onEdit={() => setDialog({ kind: 'edit', rule: r.rule })}
                    onDelete={() => setDialog({ kind: 'delete', rule: r.rule })}
                    onErrors={() => setDialog({ kind: 'errors', rule: r.rule })}
                    onToggle={() => toggle(r)}
                  />
                ))}
              </ul>
            )}
          </GlassCard>
        )
      })}

      {shown?.kind === 'add' && <RuleDialog open={isOpen} onOpenChange={close} type={shown.type} />}
      {shown?.kind === 'edit' && active && <RuleDialog open={isOpen} onOpenChange={close} type={active.type} rule={active} />}
      {shown?.kind === 'delete' && (
        <ConfirmDialog
          open={isOpen}
          onOpenChange={close}
          destructive
          title={`删除规则 ${shown.rule}？`}
          description="规则里的 HA 资源保持不变，只是不再受这条规则约束。"
          confirmLabel="删除"
          onConfirm={() =>
            runTask(deleteHaRule(shown.rule), { title: `删除规则 ${shown.rule}`, syncSuccessMessage: `已删除规则 ${shown.rule}`, invalidate: [haKeys.all()] })
          }
        />
      )}
      {shown?.kind === 'errors' && (
        <ResponsiveDialog open={isOpen} onOpenChange={close} title={`规则 ${shown.rule} 的问题`} size="md">
          {active && ruleErrors(active).length ? (
            <ul className="grid gap-2 text-sm" data-testid="ha-rule-errors">
              {ruleErrors(active).map((e) => (
                <li key={e} className="rounded-lg bg-warning/10 px-3 py-2 break-words">
                  {e}
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">这条规则没有问题。</p>
          )}
        </ResponsiveDialog>
      )}
    </div>
  )
}

function ResourceChips({ value, guests }: { value: string; guests: Map<number, GuestResource> }) {
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {parseResourceList(value).map((sid) => {
        const p = parseSid(sid)
        const g = p ? guests.get(p.vmid) : undefined
        return (
          <span key={sid} className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-secondary px-1.5 text-xs">
            <span className="font-mono text-muted-foreground">{sid}</span>
            {g && <span className="truncate">{guestName(g)}</span>}
          </span>
        )
      })}
    </span>
  )
}

function RuleRow({
  rule,
  guests,
  canEdit,
  onEdit,
  onDelete,
  onErrors,
  onToggle,
}: {
  rule: HaRule
  guests: Map<number, GuestResource>
  canEdit: boolean
  onEdit: () => void
  onDelete: () => void
  onErrors: () => void
  onToggle: () => void
}) {
  const errors = ruleErrors(rule)
  const disabled = !!rule.disable
  return (
    <li data-testid="ha-rule" data-rule={rule.rule} className="flex items-start gap-3 px-(--card-p) py-(--row-py)">
      {errors.length ? (
        <button
          type="button"
          onClick={onErrors}
          className="-m-1.5 mt-0 rounded-md p-1.5 text-warning-strong hover:bg-warning/10 pointer-coarse:-m-2.5 pointer-coarse:p-2.5"
          aria-label={`规则 ${rule.rule} 有 ${errors.length} 个问题`}
          title="规则有冲突或错误"
        >
          <TriangleAlert className="size-4" />
        </button>
      ) : (
        <CheckCircle2 className={cn('mt-0.5 size-4 shrink-0', disabled ? 'text-faint' : 'text-success-strong')} aria-label="规则正常" />
      )}
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-medium">{rule.rule}</span>
          {disabled && <Chip tone="muted">已停用</Chip>}
          {rule.type === 'node-affinity' ? (
            rule.strict ? (
              <Chip tone="warning">严格</Chip>
            ) : null
          ) : (
            <Chip tone={rule.affinity === 'positive' ? 'ok' : 'running'}>{AFFINITY_LABEL[rule.affinity ?? 'negative']}</Chip>
          )}
        </div>
        <ResourceChips value={rule.resources} guests={guests} />
        {rule.type === 'node-affinity' && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <MapPin className="size-3.5" aria-hidden />
            {parseRuleNodes(rule.nodes).map((n) => (
              <span key={n.node}>
                <span className="text-foreground/85">{n.node}</span>
                {n.priority ? <span className="ml-0.5 tabular">（优先级 {n.priority}）</span> : null}
              </span>
            ))}
          </div>
        )}
        {rule.comment && <p className="text-xs break-words text-foreground/70">{rule.comment}</p>}
      </div>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`规则 ${rule.rule} 的操作`} className="-my-1 text-muted-foreground">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem disabled={!canEdit} onSelect={onEdit}>
            <Pencil />
            编辑
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canEdit} onSelect={onToggle}>
            {disabled ? <Play /> : <Pause />}
            {disabled ? '启用' : '停用'}
          </DropdownMenuItem>
          {errors.length > 0 && (
            <DropdownMenuItem onSelect={onErrors}>
              <TriangleAlert />
              查看问题
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={!canEdit} onSelect={onDelete}>
            <Trash2 />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
