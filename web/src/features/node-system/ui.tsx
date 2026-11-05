// Aligned settings cards for the node system tab. Labels and values share
// a row when the card is wide enough; narrow cards stack without truncation.

import type { ReactNode } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'

import { GlassCard } from '@/components/GlassCard'
import { ErrorState } from '@/components/QueryState'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function Section({
  id,
  title,
  action,
  description,
  children,
  className,
}: {
  id: string
  title: ReactNode
  /** Header buttons. */
  action?: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <GlassCard asChild flush>
      <section aria-labelledby={`${id}-heading`} className={cn('@container flex min-w-0 flex-col overflow-hidden', className)}>
        <header className="flex min-h-16 items-center justify-between gap-3 border-b border-border/60 px-(--card-p) py-3">
          <div className="min-w-0">
            <h2 id={`${id}-heading`} className="text-sm font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
        <div className="min-w-0 flex-1 divide-y divide-border/60">{children}</div>
      </section>
    </GlassCard>
  )
}

/** Loading / error placeholder inside a Section card. */
export function SectionState({
  query,
  rows = 2,
  title,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }
  rows?: number
  title: string
}) {
  if (query.isPending) {
    return (
      <div aria-busy="true" aria-label="加载中">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-(--card-p) py-4">
            <Skeleton className="size-4 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-36" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  return <ErrorState compact title={title} error={query.error} onRetry={() => void query.refetch()} className="p-(--card-p)" />
}

export function Row({
  icon: Icon,
  label,
  value,
  detail,
  muted,
  onEdit,
  trailing,
}: {
  icon: LucideIcon
  label: ReactNode
  value: ReactNode
  /** Supporting text below the label/value pair. */
  detail?: ReactNode
  /** Value is a default ("默认", "使用数据中心设置"). */
  muted?: boolean
  /** Tap opens the editor; omitted = read-only row. */
  onEdit?: () => void
  /** Content at the right (instead of the chevron). */
  trailing?: ReactNode
}) {
  const body = (
    <>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="grid min-w-0 flex-1 items-baseline gap-x-4 gap-y-1 @min-[26rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <span className="min-w-0 text-sm font-medium break-words">{label}</span>
        <span className={cn('min-w-0 text-[13px] leading-relaxed break-words @min-[26rem]:text-right', muted ? 'text-muted-foreground' : 'text-foreground')}>{value}</span>
        {detail && <span className="col-span-full min-w-0 text-xs leading-relaxed break-words text-muted-foreground">{detail}</span>}
      </span>
      {trailing}
      {onEdit && !trailing && (
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />
      )}
      {!onEdit && !trailing && <span className="size-4 shrink-0" aria-hidden />}
    </>
  )
  const cls = 'flex min-h-18 w-full min-w-0 items-start gap-3 px-(--card-p) py-4 text-left compact:min-h-14 compact:py-3'
  if (!onEdit) {
    return (
      <div data-slot="config-row" className={cls}>
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      data-slot="config-row"
      onClick={onEdit}
      className={cn(
        cls,
        'transition-colors outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] active:bg-foreground/[0.05] paper:hover:bg-secondary/50',
      )}
    >
      {body}
    </button>
  )
}
