// Small building blocks of the Ceph screens.

import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, CircleHelp, Info, RefreshCw, TriangleAlert } from 'lucide-react'

import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { useSession } from '@/api/useSession'
import { usePermissions } from '@/api/permissions'
import { cn } from '@/lib/utils'

export type Tone = 'ok' | 'warn' | 'err' | 'unknown' | 'old' | 'info'

export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-success-strong',
  warn: 'text-warning-strong',
  err: 'text-destructive',
  unknown: 'text-muted-foreground',
  old: 'text-warning-strong',
  info: 'text-brand-strong paper:text-foreground',
}

const TONE_CHIP: Record<Tone, string> = {
  ok: 'bg-success/12 text-success-strong',
  warn: 'bg-warning/14 text-warning-strong',
  err: 'bg-destructive/12 text-destructive',
  unknown: 'bg-secondary text-secondary-foreground',
  old: 'bg-warning/14 text-warning-strong',
  info: 'bg-brand/12 text-brand-strong paper:bg-secondary paper:text-foreground/80',
}

const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  err: 'bg-destructive',
  unknown: 'bg-muted-foreground/50',
  old: 'bg-warning',
  info: 'bg-brand',
}

export function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
  const cls = cn('size-4 shrink-0', TONE_TEXT[tone], className)
  if (tone === 'ok') return <CircleCheck className={cls} aria-hidden />
  if (tone === 'err') return <CircleAlert className={cls} aria-hidden />
  if (tone === 'warn' || tone === 'old') return <TriangleAlert className={cls} aria-hidden />
  if (tone === 'info') return <Info className={cls} aria-hidden />
  return <CircleHelp className={cls} aria-hidden />
}

export function ToneDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', TONE_DOT[tone], className)} />
}

/** Rounded label in a tone colour. */
export function Chip({
  tone,
  children,
  className,
  ...rest
}: {
  tone: Tone
  children: ReactNode
  className?: string
  title?: string | undefined
  'data-testid'?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] leading-none font-medium whitespace-nowrap',
        TONE_CHIP[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}

/** Tinted inline notice. */
export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'warn' | 'err'; children: ReactNode; className?: string }) {
  return (
    <div
      role={tone === 'err' ? 'alert' : 'note'}
      className={cn(
        'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm leading-relaxed',
        tone === 'info' && 'border-info/25 bg-info/10 text-foreground/85 paper:border-border paper:bg-secondary/60',
        tone === 'warn' && 'border-warning/30 bg-warning/10 text-foreground/90',
        tone === 'err' && 'border-destructive/30 bg-destructive/10 text-destructive',
        className,
      )}
    >
      <ToneIcon tone={tone === 'info' ? 'info' : tone} className={cn('mt-0.5', tone === 'info' && 'text-info paper:text-foreground/60')} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** Card with a small heading row (title, optional count and actions). */
export function Section({
  title,
  count,
  actions,
  children,
  className,
  flush,
  ...rest
}: {
  title: ReactNode
  count?: number | undefined
  actions?: ReactNode
  children: ReactNode
  className?: string
  flush?: boolean
  'data-testid'?: string
}) {
  return (
    <GlassCard flush className={cn('min-w-0 overflow-hidden', className)} {...rest}>
      <section aria-label={typeof title === 'string' ? title : undefined}>
        <div className="flex min-h-12 items-center gap-2 border-b border-border/60 px-4 py-1.5">
          <h2 className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
            <span className="min-w-0 truncate">{title}</span>
            {count !== undefined && <span className="shrink-0 text-muted-foreground tabular">{count}</span>}
          </h2>
          {actions}
        </div>
        <div className={cn(!flush && 'p-4')}>{children}</div>
      </section>
    </GlassCard>
  )
}

export function RefreshButton({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  return (
    <Button variant="ghost" size="icon" onClick={onClick} aria-label="刷新" title="刷新" className="pointer-coarse:size-11">
      <RefreshCw className={cn(busy && 'animate-spin')} />
    </Button>
  )
}

/** Small labelled value tile. */
export function Fact({ label, children, className, mono }: { label: string; children: ReactNode; className?: string; mono?: boolean }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('min-w-0 rounded-xl bg-foreground/[0.03] px-3 py-2 ring-1 ring-border/60 ring-inset paper:bg-secondary/50', className)}
    >
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-[13px] break-words', mono && 'font-mono text-xs break-all')}>{children}</div>
    </div>
  )
}

/** Preformatted text block (ceph.conf, CRUSH map). */
export function CodeBlock({ children, className, ...rest }: { children: ReactNode; className?: string; 'aria-label'?: string }) {
  return (
    <pre
      tabIndex={0}
      className={cn(
        'max-h-[70vh] overflow-auto rounded-xl bg-foreground/[0.04] p-3 font-mono text-xs leading-relaxed whitespace-pre ring-1 ring-border/60 ring-inset paper:bg-secondary/50',
        className,
      )}
      {...rest}
    >
      {children}
    </pre>
  )
}

export interface CephAccess {
  /** Sys.Modify on / : create, destroy, start/stop, flags, pools. */
  canModify: boolean
  /** root@pam: the install shell (termproxy cmd=ceph_install). */
  isRoot: boolean
  /** Datastore.Allocate on /storage: "add as storage". */
  canAddStorage: boolean
}

export function useCephAccess(): CephAccess {
  const perms = usePermissions()
  const session = useSession()
  return {
    canModify: perms.can({ privs: 'Sys.Modify', path: '/' }),
    isRoot: session?.username === 'root@pam',
    canAddStorage: perms.can({ privs: 'Datastore.Allocate', path: '/storage' }),
  }
}
