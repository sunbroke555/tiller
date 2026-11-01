// Small building blocks of the firewall screens: dialog state, list
// sections, row menus, action/direction badges and a segmented control.

import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Ellipsis, Layers, type LucideIcon } from 'lucide-react'

import { GlassCard } from '@/components/GlassCard'
import { SectionHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { FirewallRule, Policy, RuleType } from '@/api/firewall'
import { cn } from '@/lib/utils'

import { ACTION_LABEL, DIRECTION_LABEL, actionTone, type ActionTone } from './model'

// ------------------------------------------------------------ dialog state

/** Dialog state that keeps its data while the close animation runs. */
export function useDialog<T = true>() {
  const [state, setState] = useState<{ data: T; open: boolean } | null>(null)
  return {
    data: state?.data,
    open: !!state?.open,
    show: (data: T) => setState({ data, open: true }),
    props: {
      open: !!state?.open,
      onOpenChange: (open: boolean) => setState((s) => (s ? { ...s, open } : s)),
    },
  }
}

/** Form state re-initialised from `init` each time the dialog opens. */
export function useFormState<T>(open: boolean, init: () => T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(init)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setState(init())
  }
  return [state, setState]
}

/** Thrown by onSubmit when client-side validation fails (FormDialog shows the message). */
export class ValidationError extends Error {
  constructor(message = '请先修正标出的问题') {
    super(message)
    this.name = 'ValidationError'
  }
}

// ---------------------------------------------------------------- section

export function ListSection({
  title,
  action,
  children,
  className,
  flush = true,
}: {
  title: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  flush?: boolean
}) {
  return (
    <section aria-label={typeof title === 'string' ? title : undefined} className={cn('min-w-0', className)}>
      <SectionHeader title={title} className="mb-2.5 min-h-9">
        {action}
      </SectionHeader>
      <GlassCard flush={flush} className="overflow-hidden">
        <div className="divide-y divide-border/70">{children}</div>
      </GlassCard>
    </section>
  )
}

/** Header button (44px tall on touch). */
export function HeaderButton({
  icon: Icon,
  children,
  onClick,
  disabled,
  title,
  variant = 'outline',
}: {
  icon: LucideIcon
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
  variant?: 'outline' | 'default'
}) {
  return (
    <Button variant={variant} size="sm" onClick={onClick} disabled={disabled} title={title} className="pointer-coarse:h-10">
      <Icon /> {children}
    </Button>
  )
}

// --------------------------------------------------------------- row menu

export interface RowAction {
  id: string
  label: string
  icon: LucideIcon
  onSelect: () => void
  destructive?: boolean
  disabled?: string | false
  separated?: boolean
}

export function RowMenu({ label, actions, className }: { label: string; actions: RowAction[]; className?: string }) {
  if (actions.length === 0) return null
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`更多操作：${label}`} className={cn('size-11 shrink-0 text-muted-foreground lg:size-9', className)}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel className="max-w-64 truncate text-xs text-muted-foreground">{label}</DropdownMenuLabel>
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
        onSelect={() => a.onSelect()}
        className="pointer-coarse:py-2.5"
      >
        <a.icon />
        <span className="grid">
          <span>{a.label}</span>
          {a.disabled && <span className="text-xs text-muted-foreground">{a.disabled}</span>}
        </span>
      </DropdownMenuItem>
    </>
  )
}

// ----------------------------------------------------------------- badges

const TONE_CLASS: Record<ActionTone, string> = {
  accept: 'bg-success/12 text-success-strong ring-success/25',
  reject: 'bg-warning/12 text-warning-strong ring-warning/25',
  drop: 'bg-destructive/12 text-destructive ring-destructive/25',
  group: 'bg-brand/12 text-brand-strong ring-brand/25 paper:bg-secondary paper:text-foreground paper:ring-border',
}

/** ACCEPT / REJECT / DROP pill (or the security group name). */
export function ActionBadge({ rule, className }: { rule: Pick<FirewallRule, 'type' | 'action'>; className?: string }) {
  const tone = actionTone(rule)
  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold tracking-wide ring-1 ring-inset',
        TONE_CLASS[tone],
        className,
      )}
    >
      {tone === 'group' && <Layers className="size-3 shrink-0" aria-hidden />}
      <span className="truncate">{rule.action}</span>
      {tone !== 'group' && <span className="sr-only">（{ACTION_LABEL[rule.action as Policy]}）</span>}
    </span>
  )
}

export const DIRECTION_ICON: Record<RuleType, LucideIcon> = {
  in: ArrowDownToLine,
  out: ArrowUpFromLine,
  forward: ArrowLeftRight,
  group: Layers,
}

export function DirectionChip({ type, className }: { type: RuleType; className?: string }) {
  const Icon = DIRECTION_ICON[type]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground', className)}>
      <Icon className="size-3.5" aria-hidden />
      {DIRECTION_LABEL[type]}
    </span>
  )
}

export function Chip({ children, tone, className }: { children: ReactNode; tone?: 'warning' | 'muted'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground',
        tone === 'warning' && 'bg-warning/12 text-warning-strong',
        className,
      )}
    >
      {children}
    </span>
  )
}

// -------------------------------------------------------------- segmented

export function Segmented<V extends string>({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
  disabled,
  className,
}: {
  value: V
  onChange: (v: V) => void
  options: readonly { value: V; label: ReactNode }[]
  'aria-label': string
  disabled?: boolean
  className?: string
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={value}
      onValueChange={(v) => v && onChange(v as V)}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn('grid w-full auto-cols-fr grid-flow-col', className)}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="min-w-0 px-1.5 text-xs sm:text-sm pointer-coarse:h-10">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** Muted hint line inside a list section. */
export function SectionNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('px-(--card-p) py-3 text-xs leading-relaxed text-muted-foreground', className)}>{children}</p>
}
