// Inline notices used by the lifecycle dialogs.

import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'

type Tone = 'info' | 'ok' | 'warn' | 'error'

const ICON = { info: Info, ok: CircleCheck, warn: TriangleAlert, error: CircleAlert }

const TONE: Record<Tone, string> = {
  info: 'bg-info/10 text-foreground/85 [&>svg]:text-info paper:bg-secondary',
  ok: 'bg-success/10 text-foreground/85 [&>svg]:text-success',
  warn: 'bg-warning/12 text-foreground/90 [&>svg]:text-warning',
  error: 'bg-destructive/10 text-destructive [&>svg]:text-destructive',
}

export function Notice({ tone = 'info', title, children, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string }) {
  const Icon = ICON[tone]
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className={cn('flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-sm', TONE[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="grid min-w-0 flex-1 gap-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn('text-xs leading-relaxed break-words', tone !== 'error' && 'text-muted-foreground')}>{children}</div>}
      </div>
    </div>
  )
}
