// Small layout pieces shared by the summary cards.

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Card heading with an optional icon button on the right (≥44px on touch). */
export function CardTitle({
  title,
  icon: Icon,
  action,
  className,
}: {
  title: ReactNode
  icon?: LucideIcon
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-3 flex min-h-8 items-center justify-between gap-3', className)}>
      <h2 className="flex items-center gap-2 text-sm font-medium text-foreground paper:font-heading paper:text-base">
        {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden />}
        {title}
      </h2>
      {action}
    </div>
  )
}

/** Ghost icon button used for "编辑" in card headers. */
export function CardAction({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="-mr-2 h-8 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground pointer-coarse:h-11 pointer-coarse:px-3"
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </Button>
  )
}

/** Definition list rows: label left, value right; wraps on narrow screens. */
export function InfoList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('divide-y divide-border/60 text-sm', className)}>{children}</dl>
}

export function InfoRow({ label, children, mono }: { label: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 text-right text-foreground', mono && 'font-mono text-[13px] tabular')}>{children}</dd>
    </div>
  )
}

/** Muted inline message inside a card (empty / unavailable states). */
export function CardNote({ icon: Icon, title, children }: { icon?: LucideIcon; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-foreground/[0.03] px-3 py-3 paper:bg-secondary/60">
      {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
      <div className="grid min-w-0 gap-0.5">
        <p className="text-sm text-foreground/85">{title}</p>
        {children && <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>}
      </div>
    </div>
  )
}
