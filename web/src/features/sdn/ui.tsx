// Building blocks shared by the SDN screens: list cards, rows, pending
// markers, row menus, notices and the write helper.

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronRight, CircleAlert, Ellipsis, Info, Plus, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react'

import { usePermissions } from '@/api/permissions'
import { sdnKeys, type SdnPendingFields, type SdnState } from '@/api/sdn'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState } from '@/components/QueryState'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { STATE_LABEL, formatValue, pendingChanges } from './pending'

// ---------------------------------------------------------------- access

/** SDN.Allocate on /sdn: create, change, delete, apply, roll back. */
export function useSdnCanEdit(): boolean {
  return usePermissions().can({ privs: 'SDN.Allocate', path: '/sdn' })
}

// ---------------------------------------------------------------- writes

/**
 * Run an SDN config write (synchronous API call) with the shared toast and
 * refresh. The change stays pending until applied.
 */
export function sdnWrite(start: Promise<unknown>, title: string, done?: string) {
  return runTask(start, {
    title,
    syncSuccessMessage: done ?? `${title}：已保存，应用后生效`,
    invalidate: [sdnKeys.all()],
  })
}

// --------------------------------------------------------------- pending

const STATE_CHIP: Record<SdnState, string> = {
  new: 'bg-success/12 text-success-strong',
  changed: 'bg-warning/14 text-warning-strong',
  deleted: 'bg-destructive/12 text-destructive',
}

/** "待新增 / 待修改 / 待删除" with the pending values as tooltip. */
export function PendingChip({ obj, className }: { obj: SdnPendingFields; className?: string }) {
  if (!obj.state) return null
  const changes = pendingChanges(obj)
  const tip = changes.length ? changes.map((c) => `${c.key}: ${formatValue(c.before)} → ${formatValue(c.after)}`).join('\n') : undefined
  return (
    <span
      title={tip}
      data-testid="sdn-pending"
      data-state={obj.state}
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] leading-none font-medium whitespace-nowrap',
        STATE_CHIP[obj.state],
        className,
      )}
    >
      {STATE_LABEL[obj.state]}
    </span>
  )
}

/** List of pending key changes (detail pages). */
export function PendingChanges({ obj }: { obj: SdnPendingFields }) {
  const changes = pendingChanges(obj)
  if (!obj.state) return null
  if (obj.state === 'deleted') return <Notice tone="warning">已标记删除，应用后从所有节点移除。</Notice>
  return (
    <Notice tone="warning">
      <span className="font-medium">{obj.state === 'new' ? '新建，尚未应用' : '有未应用的修改'}</span>
      {obj.state === 'changed' && changes.length > 0 && (
        <ul className="mt-1 grid gap-0.5 font-mono text-xs">
          {changes.map((c) => (
            <li key={c.key} className="break-all">
              {c.key}: <span className="line-through opacity-70">{formatValue(c.before)}</span> → {formatValue(c.after)}
            </li>
          ))}
        </ul>
      )}
    </Notice>
  )
}

// ---------------------------------------------------------------- layout

/** Card with a header (title, summary, refresh, actions) and a flush body. */
export function SdnCard({
  title,
  summary,
  onRefresh,
  refreshing,
  actions,
  children,
  className,
  testId,
}: {
  title: ReactNode
  summary?: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
  actions?: ReactNode
  children: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <GlassCard flush className={cn('overflow-hidden', className)} data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-(--card-p) py-3">
        <div className="min-w-0 flex-1">
          <h2 className="heading text-base font-medium text-foreground">{title}</h2>
          {summary !== undefined && <p className="text-xs text-muted-foreground">{summary}</p>}
        </div>
        {onRefresh && (
          <Button variant="ghost" size="icon" aria-label="刷新" title="刷新" onClick={onRefresh} disabled={refreshing} className="text-muted-foreground">
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
          </Button>
        )}
        {actions}
      </div>
      {children}
    </GlassCard>
  )
}

/** Loading / error / empty / list body of an SdnCard. */
export function ListBody<T>({
  query,
  items,
  empty,
  children,
  label,
}: {
  query: { isPending: boolean; error: unknown; refetch: () => unknown }
  items: readonly T[]
  empty: { icon: LucideIcon; title: string; description?: ReactNode; action?: ReactNode }
  children: (item: T) => ReactNode
  label: string
}) {
  if (query.isPending) {
    return (
      <div className="grid gap-2 p-(--card-p)">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    )
  }
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
  if (items.length === 0) return <EmptyState icon={empty.icon} title={empty.title} description={empty.description} action={empty.action} />
  return (
    <ul className="divide-y divide-border/60" aria-label={label}>
      {items.map(children)}
    </ul>
  )
}

export interface RowAction {
  label: string
  icon?: LucideIcon
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean | string
}

/** One object in a list: title line, detail line, pending chip, menu; opens a link or a callback. */
export function ObjectRow({
  icon: Icon,
  title,
  badge,
  detail,
  obj,
  to,
  onOpen,
  actions,
  testId,
  rowKey,
}: {
  icon?: LucideIcon
  title: ReactNode
  badge?: ReactNode
  detail?: ReactNode
  obj?: SdnPendingFields
  to?: string
  onOpen?: () => void
  actions?: RowAction[]
  testId?: string
  rowKey?: string
}) {
  const deleted = obj?.state === 'deleted'
  const body = (
    <>
      {Icon && <Icon className={cn('size-4 shrink-0 text-muted-foreground', deleted && 'opacity-50')} aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('truncate font-medium', deleted && 'text-muted-foreground line-through')}>{title}</span>
          {badge}
          {obj && <PendingChip obj={obj} />}
        </div>
        {detail && <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">{detail}</div>}
      </div>
    </>
  )
  const rowCls =
    'group flex min-h-14 items-center gap-3 px-(--card-p) py-(--row-py) transition-colors outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.04] paper:hover:bg-secondary/50'
  return (
    <li data-testid={testId} data-key={rowKey} className="flex items-center">
      {to ? (
        <Link to={to} className={cn(rowCls, 'min-w-0 flex-1')}>
          {body}
          <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      ) : onOpen ? (
        <button type="button" onClick={onOpen} className={cn(rowCls, 'min-w-0 flex-1 text-left')}>
          {body}
        </button>
      ) : (
        <div className={cn(rowCls, 'min-w-0 flex-1')}>{body}</div>
      )}
      {actions && actions.length > 0 && (
        <div className="shrink-0 pr-[calc(var(--card-p)-0.5rem)]">
          <RowMenu label={typeof title === 'string' ? title : '对象'} actions={actions} />
        </div>
      )}
    </li>
  )
}

export function RowMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`${label} 的操作`} className="text-muted-foreground">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {actions.map((a, i) => {
          const Icon = a.icon
          return (
            <span key={a.label}>
              {a.destructive && i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                variant={a.destructive ? 'destructive' : 'default'}
                disabled={!!a.disabled}
                title={typeof a.disabled === 'string' ? a.disabled : undefined}
                onSelect={a.onSelect}
              >
                {Icon && <Icon />}
                {a.label}
              </DropdownMenuItem>
            </span>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** "添加" button, or a menu of types when there are several. */
export function AddButton<T extends string>({
  label = '添加',
  types,
  onAdd,
  disabled,
}: {
  label?: string
  types?: readonly { value: T; label: string; hint?: string }[]
  onAdd: (type?: T) => void
  disabled?: boolean | string
}) {
  const title = typeof disabled === 'string' ? disabled : undefined
  if (!types) {
    return (
      <Button onClick={() => onAdd()} disabled={!!disabled} title={title}>
        <Plus />
        {label}
      </Button>
    )
  }
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button disabled={!!disabled} title={title}>
          <Plus />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">选择类型</DropdownMenuLabel>
        {types.map((t) => (
          <DropdownMenuItem key={t.value} onSelect={() => onAdd(t.value)} className="flex-col items-start gap-0">
            <span className="font-medium">{t.label}</span>
            {t.hint && <span className="text-xs text-muted-foreground">{t.hint}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Small rounded label (type, tag, …). */
export function Chip({ children, className, mono }: { children: ReactNode; className?: string; mono?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full bg-secondary px-2 text-[11px] leading-none whitespace-nowrap text-secondary-foreground',
        mono && 'font-mono',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** One labelled value in a details grid. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-xl bg-foreground/[0.03] px-3 py-2 ring-1 ring-border/60 ring-inset paper:bg-secondary/50', className)}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 min-w-0 text-[13px] break-words">{children ?? <span className="text-muted-foreground">—</span>}</div>
    </div>
  )
}

export function FactGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 p-(--card-p) sm:grid-cols-3 lg:grid-cols-4">{children}</div>
}

/** Tinted inline notice. */
export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'warning' | 'error'; children: ReactNode; className?: string }) {
  const Icon = tone === 'error' ? CircleAlert : tone === 'warning' ? TriangleAlert : Info
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm leading-relaxed',
        tone === 'info' && 'border-info/25 bg-info/10 text-foreground/85 paper:border-border paper:bg-secondary/60',
        tone === 'warning' && 'border-warning/30 bg-warning/10 text-foreground/90',
        tone === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
        className,
      )}
    >
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', tone === 'info' && 'text-info paper:text-foreground/60', tone === 'warning' && 'text-warning-strong')}
        aria-hidden
      />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------- dialogs

/**
 * Dialog state that stays mounted while it animates out:
 *   const d = useDialog<{ kind: 'edit'; id: string }>()
 *   d.open({ kind: 'edit', id })   …   {d.shown?.kind === 'edit' && <X open={d.isOpen} onOpenChange={d.onOpenChange} />}
 */
export function useDialog<T>() {
  const [current, setCurrent] = useState<T | null>(null)
  const [shown, setShown] = useState<T | null>(null)
  if (current && current !== shown) setShown(current)
  return {
    shown,
    isOpen: current !== null && current === shown,
    open: (d: T) => setCurrent(d),
    close: () => setCurrent(null),
    onOpenChange: (o: boolean) => {
      if (!o) setCurrent(null)
    },
  }
}

/** Delete confirmation for an SDN object (pending until applied). */
export function DeleteDialog({
  open,
  onOpenChange,
  what,
  name,
  run,
  isNew,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  what: string
  name: string
  run: () => Promise<unknown>
  isNew?: boolean
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      destructive
      title={`删除${what} ${name}？`}
      description={isNew ? '删除后立即生效，不需要应用。' : '删除会先记为待应用的改动，应用 SDN 配置后才会从节点上移除。'}
      confirmLabel="删除"
      onConfirm={() => sdnWrite(run(), `删除${what} ${name}`, `已删除${what} ${name}${isNew ? '' : '（应用后生效）'}`)}
    />
  )
}

/** Monospace value. */
export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[12px]">{children}</span>
}
