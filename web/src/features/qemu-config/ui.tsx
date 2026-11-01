// List building blocks shared by the hardware, options and cloud-init tabs:
// grouped glass cards with tappable rows, pending markers and a "more" menu.

import type { ReactNode } from 'react'
import { ArrowRight, ChevronRight, CircleAlert, Clock, MoreHorizontal, RotateCcw, type LucideIcon } from 'lucide-react'

import { GlassCard } from '@/components/GlassCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import type { HwRowStatus } from './model'

export function ConfigSection({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('grid gap-2', className)}>
      {(title || action) && (
        <div className="flex min-h-8 items-center justify-between gap-3">
          {title && (
            <h2 className="text-sm font-medium text-muted-foreground paper:text-base paper:text-foreground">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      <GlassCard flush className="overflow-hidden">
        <ul className="divide-y divide-border/70">{children}</ul>
      </GlassCard>
    </section>
  )
}

export interface RowAction {
  id: string
  label: string
  icon?: LucideIcon
  onSelect: () => void
  destructive?: boolean
  /** Disabled with this reason (shown as the item's hint). */
  disabled?: string | false
  /** Separator before this item. */
  separated?: boolean
}

export interface ConfigRowProps {
  icon: LucideIcon
  title: ReactNode
  summary: ReactNode
  /** Value after the pending change. */
  pendingSummary?: ReactNode
  status?: HwRowStatus
  /** Tap on the row (usually "edit"); without it the row opens the menu. */
  onOpen?: () => void
  openLabel?: string
  actions?: RowAction[]
  /** Muted row (e.g. a default value). */
  muted?: boolean
  /** Monospace summary (volume ids, MAC addresses, raw strings). */
  mono?: boolean
  testId?: string
}

const STATUS_BADGE: Record<Exclude<HwRowStatus, 'unchanged'>, string> = {
  changed: '待生效',
  added: '待添加',
  removed: '待移除',
}

/**
 * One config row: icon, title, current value and, when a change is pending,
 * the new value in the warning colour. The row itself is a button for the
 * main action; "more" holds the rest.
 */
export function ConfigRow({
  icon: Icon,
  title,
  summary,
  pendingSummary,
  status = 'unchanged',
  onOpen,
  openLabel,
  actions = [],
  muted,
  mono,
  testId,
}: ConfigRowProps) {
  const pending = status !== 'unchanged'
  const removed = status === 'removed'
  const added = status === 'added'
  const visibleActions = actions
  const hasMenu = visibleActions.length > 0
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          'mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset',
          pending
            ? 'bg-warning/10 text-warning ring-warning/20'
            : 'bg-brand/10 text-brand ring-brand/15 paper:bg-secondary paper:text-foreground/75 paper:ring-border',
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{title}</span>
          {pending && (
            <Badge variant="outline" className="shrink-0 gap-1 border-warning/40 px-1.5 text-[11px] font-normal text-warning">
              <Clock aria-hidden />
              {STATUS_BADGE[status]}
            </Badge>
          )}
        </span>
        {!added && (
          <span
            className={cn(
              'line-clamp-2 text-[13px] leading-snug [overflow-wrap:anywhere] text-muted-foreground',
              mono && 'font-mono text-xs',
              removed && 'line-through decoration-warning/70',
              muted && 'text-faint',
            )}
          >
            {summary || '—'}
          </span>
        )}
        {pendingSummary && !removed && (
          <span
            className={cn(
              'flex min-w-0 items-start gap-1 text-[13px] leading-snug [overflow-wrap:anywhere] text-warning',
              mono && 'font-mono text-xs',
            )}
          >
            {!added && <ArrowRight className="mt-0.5 size-3.5 shrink-0" aria-label="改为" />}
            <span className="line-clamp-2">{pendingSummary}</span>
          </span>
        )}
      </span>
    </>
  )

  const rowClass =
    'flex min-h-16 compact:min-h-13 min-w-0 flex-1 items-start gap-3 px-(--card-p) py-(--row-py) text-left transition-colors outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] active:bg-foreground/[0.05] paper:hover:bg-secondary/50'

  const menu = hasMenu ? (
    <RowMenu actions={visibleActions} label={typeof title === 'string' ? `${title} 的更多操作` : '更多操作'} />
  ) : null

  return (
    <li className="flex items-stretch" data-testid={testId}>
      {onOpen ? (
        <button type="button" className={cn(rowClass, 'group')} onClick={onOpen} aria-label={openLabel}>
          {body}
          {!hasMenu && <ChevronRight className="mt-2.5 size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />}
        </button>
      ) : (
        <div className={cn(rowClass, 'hover:bg-transparent active:bg-transparent paper:hover:bg-transparent')}>{body}</div>
      )}
      {menu && <div className="flex shrink-0 items-start pt-2 pr-2 sm:pr-3">{menu}</div>}
    </li>
  )
}

export function RowMenu({ actions, label }: { actions: RowAction[]; label: string }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} className="text-muted-foreground">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {actions.map((a) => (
          <MenuItem key={a.id} action={a} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MenuItem({ action: a }: { action: RowAction }) {
  return (
    <>
      {a.separated && <DropdownMenuSeparator />}
      <DropdownMenuItem
        variant={a.destructive ? 'destructive' : 'default'}
        disabled={!!a.disabled}
        onSelect={a.onSelect}
        className="min-h-9 pointer-coarse:min-h-11"
      >
        {a.icon && <a.icon />}
        <span className="grid">
          <span>{a.label}</span>
          {a.disabled && <span className="text-[11px] text-muted-foreground">{a.disabled}</span>}
        </span>
      </DropdownMenuItem>
    </>
  )
}


/** Banner on top of a tab when changes wait for a reboot. */
export function PendingBanner({
  count,
  running,
  onRevertAll,
}: {
  count: number
  running: boolean
  onRevertAll?: () => void
}) {
  if (count === 0) return null
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm"
    >
      <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 flex-1 text-foreground">
        <span className="font-medium">{count} 项更改尚未生效</span>
        <span className="text-muted-foreground">
          {running ? '，需要关机后重新启动（或热插拔）才会应用。' : '，下次启动时应用。'}
        </span>
      </p>
      {onRevertAll && (
        <Button type="button" variant="outline" size="sm" onClick={onRevertAll} className="pointer-coarse:h-10">
          <RotateCcw />
          全部撤销
        </Button>
      )}
    </div>
  )
}

/** Small "label: value" lines inside dialogs. */
export function InfoLine({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-mono text-xs break-all">{children}</span>
    </div>
  )
}

/** Hint box inside forms. */
export function Hint({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' }) {
  return (
    <p
      className={cn(
        'rounded-xl px-3 py-2.5 text-xs leading-relaxed',
        tone === 'warning'
          ? 'border border-warning/30 bg-warning/10 text-foreground'
          : 'bg-secondary/60 text-muted-foreground paper:bg-secondary',
      )}
    >
      {children}
    </p>
  )
}

export interface SegmentOption<V extends string> {
  value: V
  label: ReactNode
  disabled?: boolean
}

/** Pill-style single choice (radio semantics), full width on phones. */
export function Segmented<V extends string>({
  value,
  onValueChange,
  options,
  'aria-label': ariaLabel,
  className,
  size = 'md',
}: {
  value: V
  onValueChange: (v: V) => void
  options: readonly SegmentOption<V>[]
  'aria-label': string
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('flex w-full gap-1 rounded-xl bg-secondary/70 p-1 ring-1 ring-border/60 ring-inset paper:bg-secondary', className)}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onValueChange(o.value)}
            className={cn(
              'min-w-0 flex-1 truncate rounded-lg px-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
              size === 'sm' ? 'h-7 text-xs pointer-coarse:h-9' : 'h-8 pointer-coarse:h-10',
              active
                ? 'bg-background font-medium text-foreground shadow-sm ring-1 ring-border/70 dark:bg-white/10 paper:bg-card'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function ConfigSkeleton() {
  return (
    <div className="grid gap-5" aria-busy="true" aria-label="加载中">
      <Skeleton className="h-10 w-40 rounded-xl" />
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-40 rounded-2xl" />
    </div>
  )
}
