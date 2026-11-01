// Small building blocks shared by the access-control screens.

import type { ReactNode } from 'react'
import { KeyRound, RefreshCw, User, Users } from 'lucide-react'

import type { AclSubjectType } from '@/api/access-control'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** A card with a title row (title, summary, refresh, actions) and a list below. */
export function ListCard({
  title,
  summary,
  onRefresh,
  refreshing,
  actions,
  toolbar,
  children,
  className,
  'aria-label': ariaLabel,
}: {
  title: ReactNode
  summary?: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
  actions?: ReactNode
  /** Row under the title (filters, search). */
  toolbar?: ReactNode
  children: ReactNode
  className?: string
  'aria-label'?: string
}) {
  return (
    <GlassCard flush className={cn('overflow-hidden', className)} aria-label={ariaLabel}>
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
      {toolbar && <div className="border-b border-border/60 px-(--card-p) py-2.5">{toolbar}</div>}
      {children}
    </GlassCard>
  )
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-4 px-(--card-p) py-4" aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-lg" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      ))}
    </div>
  )
}

const SUBJECT_ICON = { user: User, group: Users, token: KeyRound } as const

export function SubjectIcon({ type, className }: { type: AclSubjectType; className?: string }) {
  const Icon = SUBJECT_ICON[type]
  return <Icon className={cn('size-4 shrink-0 text-muted-foreground', className)} aria-hidden />
}

/** Small rounded label. */
export function Pill({ children, tone = 'muted', className, title }: { children: ReactNode; tone?: 'muted' | 'brand' | 'info' | 'warning'; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] leading-none whitespace-nowrap [&_svg]:size-3',
        tone === 'muted' && 'bg-secondary text-secondary-foreground',
        tone === 'brand' && 'bg-brand/12 text-brand-strong paper:bg-secondary paper:text-foreground/80',
        tone === 'info' && 'bg-info/12 text-info paper:bg-secondary paper:text-foreground/70',
        tone === 'warning' && 'bg-warning/14 text-warning-strong',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Read-only note at the top of a view. */
export function ReadOnlyNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}
