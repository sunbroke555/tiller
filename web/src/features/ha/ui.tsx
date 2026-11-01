// Small building blocks of the HA screens.

import type { ReactNode } from 'react'
import { CircleAlert, Info, TriangleAlert } from 'lucide-react'

import { usePermissions } from '@/api/permissions'
import { cn } from '@/lib/utils'

import type { Tone } from './logic'

export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-success-strong',
  running: 'text-brand-strong paper:text-foreground',
  warning: 'text-warning-strong',
  error: 'text-destructive',
  muted: 'text-muted-foreground',
}

const TONE_CHIP: Record<Tone, string> = {
  ok: 'bg-success/12 text-success-strong',
  running: 'bg-brand/12 text-brand-strong paper:bg-secondary paper:text-foreground/80',
  warning: 'bg-warning/14 text-warning-strong',
  error: 'bg-destructive/12 text-destructive',
  muted: 'bg-secondary text-secondary-foreground',
}

const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-success',
  running: 'bg-brand animate-pulse',
  warning: 'bg-warning',
  error: 'bg-destructive',
  muted: 'bg-muted-foreground/50',
}

/** Rounded state label with a dot. */
export function Chip({ tone, children, className, testId }: { tone: Tone; children: ReactNode; className?: string; testId?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-[11px] leading-none font-medium whitespace-nowrap',
        TONE_CHIP[tone],
        className,
      )}
      data-testid={testId}
    >
      <span className={cn('size-1.5 rounded-full', TONE_DOT[tone])} aria-hidden />
      {children}
    </span>
  )
}

/** Tinted inline notice. */
export function Notice({
  tone = 'info',
  title,
  children,
  className,
  action,
}: {
  tone?: 'info' | 'warning' | 'error'
  title?: ReactNode
  children?: ReactNode
  className?: string
  action?: ReactNode
}) {
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
      <div className="min-w-0 flex-1 break-words">
        {title && <div className="font-medium">{title}</div>}
        {children}
      </div>
      {action}
    </div>
  )
}

/** One labelled value in a details grid. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-xl bg-foreground/[0.03] px-3 py-2 ring-1 ring-border/60 ring-inset paper:bg-secondary/50', className)}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 min-w-0 text-[13px] break-words">{children}</div>
    </div>
  )
}

/** Card header: title, one-line summary, actions on the right. */
export function CardHeader({ title, summary, children }: { title: ReactNode; summary?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-(--card-p) py-3">
      <div className="min-w-0 flex-1">
        <h2 className="heading text-base font-medium text-foreground">{title}</h2>
        {summary !== undefined && <p className="text-xs text-muted-foreground">{summary}</p>}
      </div>
      {children}
    </div>
  )
}

/** HA resources and rules need Sys.Console on / (like the official UI); CRS needs Sys.Modify. */
export function useHaAccess() {
  const perms = usePermissions()
  return {
    canEdit: perms.can({ privs: 'Sys.Console' }),
    canCrs: perms.can({ privs: 'Sys.Modify' }),
  }
}
