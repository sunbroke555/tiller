import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      {Icon && (
        <span className="mb-1 inline-flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-brand ring-1 ring-brand/15 ring-inset paper:bg-secondary paper:text-foreground/70 paper:ring-border">
          <Icon className="size-6" aria-hidden />
        </span>
      )}
      <h3 className="text-base font-medium text-foreground">{title}</h3>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
