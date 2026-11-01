// Small building blocks of the resource mapping screens: dialog state, row
// menus, chips and the status line of a map entry.

import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { CircleAlert, CircleCheck, CircleHelp, Ellipsis, LoaderCircle, type LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import type { EntryStatus } from './logic'

/** Dialog state that keeps its data while the close animation runs. */
export function useDialog<T = true>() {
  const [state, setState] = useState<{ data: T; open: boolean } | null>(null)
  return {
    data: state?.data,
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
          <div key={a.id}>
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
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Chip({ children, tone, className }: { children: ReactNode; tone?: 'warning' | 'brand'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] whitespace-nowrap text-muted-foreground',
        tone === 'warning' && 'bg-warning/12 text-warning-strong',
        tone === 'brand' && 'bg-brand/12 text-brand-strong paper:bg-secondary paper:text-foreground',
        className,
      )}
    >
      {children}
    </span>
  )
}

const STATE_META = {
  ok: { icon: CircleCheck, cls: 'text-success-strong', label: '与主机一致' },
  error: { icon: CircleAlert, cls: 'text-destructive', label: '不匹配' },
  loading: { icon: LoaderCircle, cls: 'text-muted-foreground animate-spin', label: '检查中…' },
  unknown: { icon: CircleHelp, cls: 'text-muted-foreground', label: '未知' },
} as const

/** "与主机一致" / the mismatch messages of one entry. */
export function EntryStatusLine({ status, className }: { status: EntryStatus; className?: string }) {
  const meta = STATE_META[status.state]
  const Icon = meta.icon
  const text = status.messages.length ? status.messages.join('；') : meta.label
  return (
    <span className={cn('flex min-w-0 items-start gap-1.5 text-xs', status.state === 'error' ? 'text-destructive' : 'text-muted-foreground', className)} data-state={status.state}>
      <Icon className={cn('mt-px size-3.5 shrink-0', meta.cls)} aria-hidden />
      <span className="min-w-0 break-words">{text}</span>
    </span>
  )
}

/** Muted hint / warning paragraph inside forms. */
export function Note({ children, tone, className }: { children: ReactNode; tone?: 'warning'; className?: string }) {
  return (
    <p
      role={tone === 'warning' ? 'alert' : 'note'}
      className={cn(
        'rounded-xl border border-border/70 bg-secondary/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground',
        tone === 'warning' && 'border-warning/30 bg-warning/10 text-warning-strong',
        className,
      )}
    >
      {children}
    </p>
  )
}
