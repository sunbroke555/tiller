// The rule list of any scope: a table with drag and keyboard reordering on
// desktop, cards with a "move" sheet on phones. Enable toggles in place;
// edit, copy and delete go through dialogs. Moves are applied optimistically
// and sent one after another (PUT rules/{pos} moveto=…).

import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Copy,
  GripVertical,
  Layers,
  ListOrdered,
  Loader2,
  Pencil,
  Plus,
  ShieldPlus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { firewallApi, fwKeys, useFirewallRules, type FirewallRule, type FirewallScope } from '@/api/firewall'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { SectionHeader } from '@/components/PageHeader'
import { ErrorCard, LoadingRows } from '@/components/QueryState'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import {
  LOG_LEVEL_LABEL,
  describeRule,
  dropIndex,
  formatAddress,
  formatService,
  moveToParam,
  reorderRules,
  ruleKeys,
  scopeFeatures,
} from './model'
import { GroupRuleDialog, RuleDialog } from './RuleDialog'
import { ActionBadge, Chip, DirectionChip, HeaderButton, RowMenu, useDialog, type RowAction } from './ui'
import { fwWrite } from './write'

// ------------------------------------------------------------------ mover

/**
 * Optimistic, serialized moves. Each move is computed on the list as the
 * user sees it, which equals the server's list once the earlier moves in the
 * queue have been applied; the list is refetched when the queue drains.
 */
function useRuleMover(scope: FirewallScope) {
  const qc = useQueryClient()
  const chain = useRef<Promise<void>>(Promise.resolve())
  const pending = useRef(0)
  const [busy, setBusy] = useState(false)
  const [announce, setAnnounce] = useState('')
  const key = fwKeys.rules(scope)

  function move(from: number, to: number) {
    const list = qc.getQueryData<FirewallRule[]>(key)
    if (!list || from === to || to < 0 || to >= list.length || from < 0 || from >= list.length) return
    void qc.cancelQueries({ queryKey: key })
    qc.setQueryData(key, reorderRules(list, from, to))
    setAnnounce(`规则已移到第 ${to} 条（共 ${list.length} 条）`)
    pending.current += 1
    setBusy(true)
    chain.current = chain.current
      .then(() => firewallApi.moveRule(scope, from, moveToParam(from, to)))
      .then(() => undefined)
      .catch((e: unknown) => {
        toast.error('移动规则失败', { description: errorMessage(e) })
      })
      .finally(() => {
        pending.current -= 1
        if (pending.current === 0) {
          setBusy(false)
          void qc.invalidateQueries({ queryKey: key })
        }
      })
  }

  return { move, busy, announce }
}

// ------------------------------------------------------------------- view

export interface RulesViewProps {
  scope: FirewallScope
  canEdit: boolean
  /** Section title (default "规则"). */
  title?: string
  /** Text of the empty state. */
  emptyHint?: string
}

export function RulesView({ scope, canEdit, title = '规则', emptyHint }: RulesViewProps) {
  const features = scopeFeatures(scope)
  const query = useFirewallRules(scope)
  const desktop = useIsDesktop()
  const mover = useRuleMover(scope)
  const edit = useDialog<{ rule?: FirewallRule; copyOf?: FirewallRule }>()
  const groupEdit = useDialog<FirewallRule | undefined>()
  const remove = useDialog<FirewallRule>()
  const moveSheet = useDialog<string>()
  const [toggling, setToggling] = useState<string | null>(null)

  const rules = query.data ?? []
  const keys = ruleKeys(rules)

  const openEditor = (rule: FirewallRule) => (rule.type === 'group' ? groupEdit.show(rule) : edit.show({ rule }))

  async function toggle(rule: FirewallRule, key: string, enable: boolean) {
    setToggling(key)
    try {
      await fwWrite(firewallApi.updateRule(scope, rule.pos, { enable: enable ? 1 : 0, digest: rule.digest }), `规则 #${rule.pos}`, scope, { quiet: true })
    } catch (e) {
      toast.error(`${enable ? '启用' : '停用'}规则 #${rule.pos} 失败`, { description: errorMessage(e) })
    } finally {
      setToggling(null)
    }
  }

  function actionsFor(rule: FirewallRule): RowAction[] {
    if (!canEdit) return []
    const last = rules.length - 1
    const list: RowAction[] = [{ id: 'edit', label: '编辑', icon: Pencil, onSelect: () => openEditor(rule) }]
    if (rule.type !== 'group') list.push({ id: 'copy', label: '复制', icon: Copy, onSelect: () => edit.show({ copyOf: rule }) })
    if (desktop) {
      list.push(
        { id: 'up', label: '上移', icon: ArrowUp, disabled: rule.pos === 0 && '已在最前', separated: true, onSelect: () => mover.move(rule.pos, rule.pos - 1) },
        { id: 'down', label: '下移', icon: ArrowDown, disabled: rule.pos === last && '已在最后', onSelect: () => mover.move(rule.pos, rule.pos + 1) },
      )
    } else {
      list.push({ id: 'move', label: '移动…', icon: ListOrdered, disabled: rules.length < 2 && '只有一条规则', onSelect: () => moveSheet.show(keys[rule.pos]!) })
    }
    list.push({ id: 'delete', label: '删除', icon: Trash2, destructive: true, separated: true, onSelect: () => remove.show(rule) })
    return list
  }

  const header = (
    <SectionHeader
      title={
        <span>
          {title}
          {query.data && <span className="ml-1.5 text-muted-foreground/70 tabular">{rules.length}</span>}
          {mover.busy && <Loader2 className="ml-2 inline size-3.5 animate-spin align-[-2px]" aria-label="正在保存顺序" />}
        </span>
      }
      className="mb-2.5 min-h-9"
    >
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {features.groups && (
            <HeaderButton icon={Layers} onClick={() => groupEdit.show(undefined)}>
              插入安全组
            </HeaderButton>
          )}
          <HeaderButton icon={Plus} variant="default" onClick={() => edit.show({})}>
            添加规则
          </HeaderButton>
        </div>
      )}
    </SectionHeader>
  )

  let body
  if (query.isPending) {
    body = (
      <GlassCard flush>
        <LoadingRows rows={3} />
      </GlassCard>
    )
  } else if (query.isError) {
    body = <ErrorCard error={query.error} onRetry={() => void query.refetch()} />
  } else if (rules.length === 0) {
    body = (
      <GlassCard>
        <EmptyState
          icon={ShieldPlus}
          title="没有规则"
          description={emptyHint ?? '没有规则时由默认策略决定放行或丢弃。'}
          action={
            canEdit ? (
              <Button onClick={() => edit.show({})}>
                <Plus /> 添加规则
              </Button>
            ) : undefined
          }
        />
      </GlassCard>
    )
  } else if (desktop) {
    body = (
      <RulesTable
        rules={rules}
        keys={keys}
        features={features}
        canEdit={canEdit}
        toggling={toggling}
        onToggle={toggle}
        onEdit={openEditor}
        onMove={mover.move}
        actionsFor={actionsFor}
      />
    )
  } else {
    body = (
      <GlassCard flush className="overflow-hidden">
        <ol className="divide-y divide-border/70" aria-label={`${title}列表`}>
          {rules.map((rule, i) => (
            <RuleCard
              key={keys[i]}
              rule={rule}
              canEdit={canEdit}
              busy={toggling === keys[i]}
              onToggle={(v) => void toggle(rule, keys[i]!, v)}
              onEdit={() => openEditor(rule)}
              actions={actionsFor(rule)}
            />
          ))}
        </ol>
      </GlassCard>
    )
  }

  return (
    <section aria-label={title} className="min-w-0">
      {header}
      {body}
      <p className="sr-only" aria-live="polite">
        {mover.announce}
      </p>

      <RuleDialog {...edit.props} scope={scope} features={features} rule={edit.data?.rule} copyOf={edit.data?.copyOf} />
      <GroupRuleDialog {...groupEdit.props} scope={scope} features={features} rule={groupEdit.data} />
      <MoveDialog {...moveSheet.props} rules={rules} keys={keys} ruleKey={moveSheet.data} onMove={mover.move} busy={mover.busy} />
      <ConfirmDialog
        {...remove.props}
        title={`删除规则 #${remove.data?.pos ?? ''}？`}
        description={remove.data ? `${describeRule(remove.data)}${remove.data.comment ? `（${remove.data.comment}）` : ''}` : undefined}
        confirmLabel="删除"
        destructive
        onConfirm={async () => {
          const r = remove.data
          if (r) await fwWrite(firewallApi.deleteRule(scope, r.pos, r.digest), `删除规则 #${r.pos}`, scope)
        }}
      />
    </section>
  )
}

// ---------------------------------------------------------------- desktop

function RulesTable({
  rules,
  keys,
  features,
  canEdit,
  toggling,
  onToggle,
  onEdit,
  onMove,
  actionsFor,
}: {
  rules: FirewallRule[]
  keys: string[]
  features: ReturnType<typeof scopeFeatures>
  canEdit: boolean
  toggling: string | null
  onToggle: (rule: FirewallRule, key: string, enable: boolean) => Promise<void>
  onEdit: (rule: FirewallRule) => void
  onMove: (from: number, to: number) => void
  actionsFor: (rule: FirewallRule) => RowAction[]
}) {
  const [drag, setDrag] = useState<number | null>(null)
  const [drop, setDrop] = useState<{ index: number; after: boolean } | null>(null)
  const last = rules.length - 1

  function onDragOver(e: DragEvent<HTMLTableRowElement>, index: number) {
    if (drag === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > rect.top + rect.height / 2
    if (drop?.index !== index || drop.after !== after) setDrop({ index, after })
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    if (drag !== null && drop) onMove(drag, dropIndex(drag, drop.index, drop.after))
    setDrag(null)
    setDrop(null)
  }

  function onHandleKey(e: KeyboardEvent<HTMLButtonElement>, pos: number) {
    const targets: Record<string, number> = { ArrowUp: pos - 1, ArrowDown: pos + 1, Home: 0, End: last }
    const to = targets[e.key]
    if (to === undefined) return
    e.preventDefault()
    onMove(pos, Math.max(0, Math.min(last, to)))
  }

  const th = 'px-2 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap'
  const td = 'px-2 py-2 align-middle'

  return (
    <GlassCard flush className="overflow-x-auto">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <thead className="border-b border-border/70">
          <tr>
            <th className={cn(th, 'w-16 pl-3')}>#</th>
            <th className={cn(th, 'w-14')}>启用</th>
            <th className={th}>方向</th>
            <th className={th}>动作</th>
            <th className={th}>宏 / 协议</th>
            {features.iface && <th className={th}>接口</th>}
            <th className={th}>源</th>
            <th className={th}>目的</th>
            <th className={cn(th, 'hidden xl:table-cell')}>日志</th>
            <th className={th}>注释</th>
            <th className={cn(th, 'w-12')}>
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rules.map((rule, i) => {
            const key = keys[i]!
            const errors = rule.errors && Object.entries(rule.errors)
            return (
              <tr
                key={key}
                data-rule-pos={rule.pos}
                onDragOver={(e) => onDragOver(e, i)}
                onDrop={onDrop}
                onDoubleClick={() => canEdit && onEdit(rule)}
                className={cn(
                  'transition-colors hover:bg-foreground/[0.025]',
                  !rule.enable && 'text-muted-foreground',
                  drag === i && 'opacity-40',
                  drop?.index === i && (drop.after ? 'shadow-[inset_0_-2px_0_var(--color-brand)]' : 'shadow-[inset_0_2px_0_var(--color-brand)]'),
                )}
              >
                <td className={cn(td, 'pl-1.5')}>
                  <span className="flex items-center gap-0.5">
                    {canEdit ? (
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          setDrag(i)
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', String(rule.pos))
                          const row = e.currentTarget.closest('tr')
                          if (row) e.dataTransfer.setDragImage(row, 16, 16)
                        }}
                        onDragEnd={() => {
                          setDrag(null)
                          setDrop(null)
                        }}
                        onKeyDown={(e) => onHandleKey(e, rule.pos)}
                        aria-label={`移动规则 #${rule.pos}`}
                        title="拖动排序；聚焦后用 ↑ ↓ 移动"
                        className="inline-flex size-7 cursor-grab items-center justify-center rounded-md text-faint outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                      >
                        <GripVertical className="size-4" />
                      </button>
                    ) : (
                      <span className="w-2" />
                    )}
                    <span className="tabular text-muted-foreground">{rule.pos}</span>
                  </span>
                </td>
                <td className={td}>
                  <Switch
                    checked={!!rule.enable}
                    disabled={!canEdit || toggling === key}
                    onCheckedChange={(v) => void onToggle(rule, key, v)}
                    aria-label={`启用规则 #${rule.pos}`}
                  />
                </td>
                <td className={td}>
                  <DirectionChip type={rule.type} />
                </td>
                <td className={td}>
                  <span className="flex items-center gap-1.5">
                    <ActionBadge rule={rule} />
                    {errors && errors.length > 0 && (
                      <AlertTriangle className="size-4 text-warning-strong" aria-label={`规则有错误：${errors.map(([k, v]) => `${k} ${v}`).join('；')}`} />
                    )}
                  </span>
                </td>
                <td className={cn(td, 'max-w-48')}>
                  {rule.type === 'group' ? <span className="text-faint">—</span> : <span className="block truncate font-mono text-[13px]">{formatService(rule)}</span>}
                </td>
                {features.iface && <td className={cn(td, 'font-mono text-[13px]')}>{rule.iface || <span className="text-faint">—</span>}</td>}
                <td className={cn(td, 'max-w-44')}>
                  <Address value={rule.source} group={rule.type === 'group'} />
                </td>
                <td className={cn(td, 'max-w-44')}>
                  <Address value={rule.dest} group={rule.type === 'group'} />
                </td>
                <td className={cn(td, 'hidden text-xs xl:table-cell')}>{rule.log && rule.log !== 'nolog' ? LOG_LEVEL_LABEL[rule.log] : <span className="text-faint">—</span>}</td>
                <td className={cn(td, 'max-w-56')}>
                  <span className="block truncate text-muted-foreground" title={rule.comment}>
                    {rule.comment}
                  </span>
                </td>
                <td className={cn(td, 'pr-2 text-right')}>
                  <RowMenu label={`规则 #${rule.pos}`} actions={actionsFor(rule)} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </GlassCard>
  )
}

function Address({ value, group }: { value: string | undefined; group: boolean }) {
  if (group) return <span className="text-faint">—</span>
  return (
    <span className={cn('block truncate font-mono text-[13px]', !value && 'font-sans text-faint')} title={value}>
      {formatAddress(value)}
    </span>
  )
}

// ------------------------------------------------------------------ phone

function RuleCard({
  rule,
  canEdit,
  busy,
  onToggle,
  onEdit,
  actions,
}: {
  rule: FirewallRule
  canEdit: boolean
  busy: boolean
  onToggle: (enable: boolean) => void
  onEdit: () => void
  actions: RowAction[]
}) {
  const group = rule.type === 'group'
  const hasErrors = !!rule.errors && Object.keys(rule.errors).length > 0
  return (
    <li data-rule-pos={rule.pos} className="flex min-w-0 items-stretch" aria-label={`规则 #${rule.pos}：${describeRule(rule)}`}>
      <button
        type="button"
        onClick={canEdit ? onEdit : undefined}
        disabled={!canEdit}
        className="flex min-h-16 min-w-0 flex-1 items-start gap-3 py-(--row-py) pl-(--card-p) text-left outline-none focus-visible:bg-foreground/[0.05] active:bg-foreground/[0.05] disabled:cursor-default"
      >
        <span className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md bg-secondary px-1 text-xs text-muted-foreground tabular">
          {rule.pos}
        </span>
        <span className={cn('grid min-w-0 flex-1 gap-1', !rule.enable && 'opacity-60')}>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <ActionBadge rule={rule} />
            <DirectionChip type={rule.type} />
            {!group && <span className="min-w-0 truncate font-mono text-[13px] font-medium">{formatService(rule)}</span>}
          </span>
          {!group && (
            <span className="min-w-0 text-[13px] leading-snug break-words text-muted-foreground">
              <span className="text-faint">源 </span>
              <span className="font-mono">{formatAddress(rule.source)}</span>
              <span className="text-faint"> → 目的 </span>
              <span className="font-mono">{formatAddress(rule.dest)}</span>
            </span>
          )}
          {(rule.iface || rule.comment || (rule.log && rule.log !== 'nolog') || !rule.enable || hasErrors) && (
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              {!rule.enable && <Chip>未启用</Chip>}
              {hasErrors && (
                <Chip tone="warning">
                  <AlertTriangle className="size-3" aria-hidden /> 有错误
                </Chip>
              )}
              {rule.iface && <Chip>接口 {rule.iface}</Chip>}
              {rule.log && rule.log !== 'nolog' && <Chip>日志 {rule.log}</Chip>}
              {rule.comment && <span className="min-w-0 truncate text-xs text-muted-foreground">{rule.comment}</span>}
            </span>
          )}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 pr-1.5">
        <Switch checked={!!rule.enable} disabled={!canEdit || busy} onCheckedChange={onToggle} aria-label={`启用规则 #${rule.pos}`} />
        {actions.length > 0 ? <RowMenu label={`规则 #${rule.pos}`} actions={actions} /> : <span className="w-2" />}
      </div>
    </li>
  )
}

/** Phones: move one rule up/down/to the ends; stays open between moves. */
function MoveDialog({
  open,
  onOpenChange,
  rules,
  keys,
  ruleKey,
  onMove,
  busy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rules: FirewallRule[]
  keys: string[]
  ruleKey: string | undefined
  onMove: (from: number, to: number) => void
  busy: boolean
}) {
  const index = ruleKey ? keys.indexOf(ruleKey) : -1
  const rule = index >= 0 ? rules[index] : undefined
  const last = rules.length - 1
  const lo = Math.max(0, index - 2)
  const hi = Math.min(rules.length, index + 3)
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="移动规则"
      description={rule ? describeRule(rule) : undefined}
      size="sm"
      footer={
        <Button type="button" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>
          {busy && <Loader2 className="animate-spin" />}完成
        </Button>
      }
    >
      {rule && (
        <div className="grid gap-4 pb-2">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            第 <span className="font-medium text-foreground tabular">{index}</span> 条，共 {rules.length} 条
          </p>
          <ol className="grid gap-1 rounded-xl border border-border/70 p-1.5 text-sm" aria-label="附近的规则">
            {rules.slice(lo, hi).map((r, j) => {
              const i = lo + j
              return (
                <li
                  key={keys[i]}
                  aria-current={i === index ? 'true' : undefined}
                  className={cn(
                    'flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5',
                    i === index ? 'bg-brand/12 ring-1 ring-brand/30 ring-inset' : 'text-muted-foreground',
                  )}
                >
                  <span className="w-5 shrink-0 text-xs tabular">{i}</span>
                  <ActionBadge rule={r} />
                  <span className="min-w-0 truncate font-mono text-xs">{r.type === 'group' ? '安全组' : formatService(r)}</span>
                </li>
              )
            })}
          </ol>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-12" disabled={index === 0} onClick={() => onMove(index, 0)}>
              <ArrowUpToLine /> 移到最前
            </Button>
            <Button type="button" variant="outline" className="h-12" disabled={index === last} onClick={() => onMove(index, last)}>
              <ArrowDownToLine /> 移到最后
            </Button>
            <Button type="button" variant="outline" className="h-12" disabled={index === 0} onClick={() => onMove(index, index - 1)}>
              <ArrowUp /> 上移
            </Button>
            <Button type="button" variant="outline" className="h-12" disabled={index === last} onClick={() => onMove(index, index + 1)}>
              <ArrowDown /> 下移
            </Button>
          </div>
        </div>
      )}
    </ResponsiveDialog>
  )
}
