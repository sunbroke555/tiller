import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronLeft } from 'lucide-react'

import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** Small label above the title, e.g. the resource type. */
  eyebrow?: ReactNode
  /** Buttons on the right. */
  actions?: ReactNode
  /** Show a back link (mobile detail pages). */
  backTo?: string
  className?: string
}

export function PageHeader({ title, description, eyebrow, actions, backTo, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-(--section-gap) flex items-start gap-3', className)}>
      {backTo && (
        <Link
          to={backTo}
          aria-label="返回"
          className="-ml-2 inline-flex size-11 shrink-0 lg:hidden items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronLeft className="size-5" />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground">{eyebrow}</div>}
        <h1 className="truncate text-2xl font-semibold text-foreground sm:text-[1.75rem] paper:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Section heading inside a page. */
export function SectionHeader({ title, children, className }: { title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2', className)}>
      <h2 className="text-sm font-medium text-muted-foreground paper:text-base paper:text-foreground">{title}</h2>
      {children}
    </div>
  )
}
