// Small building blocks of the cluster screens.

import type { ReactNode } from 'react'
import { CircleAlert, Copy, Info, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { copyText } from '@/features/node-summary/clipboard'
import { cn } from '@/lib/utils'

/** Tinted inline notice. */
export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'warning' | 'error'; children: ReactNode; className?: string }) {
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
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  )
}

/** One labelled value. */
export function Fact({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-xl bg-foreground/[0.03] px-3 py-2 ring-1 ring-border/60 ring-inset paper:bg-secondary/50', className)}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 min-w-0 text-[13px] break-words">{children}</div>
    </div>
  )
}

/** Read-only monospace value with a copy button (addresses, fingerprints, commands). */
export function CopyValue({ label, value, copied, className, wrap = false }: { label: string; value: string; copied?: string; className?: string; wrap?: boolean }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1 rounded-xl bg-foreground/[0.03] py-1 pr-1 pl-3 ring-1 ring-border/60 ring-inset paper:bg-secondary/50', className)}>
      <code className={cn('min-w-0 flex-1 font-mono text-[12.5px] text-foreground/90', wrap ? 'py-1 break-all whitespace-pre-wrap' : 'truncate')} title={value}>
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={`复制${label}`}
        title={`复制${label}`}
        onClick={() => void copyText(value, copied ?? `已复制${label}`)}
      >
        <Copy />
      </Button>
    </div>
  )
}

/** Small rounded label. */
export function Chip({ tone = 'muted', children, className }: { tone?: 'ok' | 'bad' | 'warning' | 'muted' | 'brand'; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] leading-none font-medium whitespace-nowrap [&_svg]:size-3',
        tone === 'ok' && 'bg-success/12 text-success-strong',
        tone === 'bad' && 'bg-destructive/12 text-destructive',
        tone === 'warning' && 'bg-warning/14 text-warning-strong',
        tone === 'brand' && 'bg-brand/12 text-brand-strong paper:bg-secondary paper:text-foreground/80',
        tone === 'muted' && 'bg-secondary text-secondary-foreground',
        className,
      )}
    >
      {children}
    </span>
  )
}
