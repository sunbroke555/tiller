// Section cards and rows of the node system tab (same look as the guest
// config tabs: icon tile, label, value; the whole row opens its editor).

import type { ReactNode } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'

import { GlassCard } from '@/components/GlassCard'
import { SectionHeader } from '@/components/PageHeader'
import { ErrorState } from '@/components/QueryState'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function Section({
  id,
  title,
  action,
  children,
  className,
}: {
  id: string
  title: ReactNode
  /** Header buttons. */
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className={cn('min-w-0', className)}>
      <SectionHeader title={<span id={`${id}-heading`}>{title}</span>} className="mb-2.5 min-h-9">
        {action}
      </SectionHeader>
      <GlassCard flush className="overflow-hidden">
        <div className="divide-y divide-border/70">{children}</div>
      </GlassCard>
    </section>
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
            <Skeleton className="size-9 rounded-xl" />
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
  /** Second line under the value. */
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
      <span
        aria-hidden
        className={cn(
          'mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand-strong ring-1 ring-brand/15 ring-inset sm:mt-0',
          'paper:bg-secondary paper:text-foreground/70 paper:ring-border',
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate font-medium">{label}</span>
        <span className={cn('min-w-0 text-[13px] leading-snug break-words text-muted-foreground', muted && 'text-faint')}>{value}</span>
        {detail && <span className="min-w-0 text-xs leading-relaxed break-words text-muted-foreground">{detail}</span>}
      </span>
      {trailing}
      {onEdit && !trailing && (
        <ChevronRight className="mt-2.5 size-4 shrink-0 self-start text-faint sm:mt-0 sm:self-center" aria-hidden />
      )}
    </>
  )
  const cls = 'flex min-h-16 w-full min-w-0 items-start gap-3 px-(--card-p) py-(--row-py) text-left sm:items-center compact:min-h-12'
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
