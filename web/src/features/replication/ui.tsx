// Small building blocks of the replication screens.

import type { ReactNode } from 'react'
import { Ban, CircleAlert, CircleCheck, CircleDashed, CirclePause, Info, Loader2, TriangleAlert } from 'lucide-react'

import { usePermissions } from '@/api/permissions'
import { cn } from '@/lib/utils'

import type { JobState, JobTone } from './logic'

export const TONE_TEXT: Record<JobTone, string> = {
  ok: 'text-success-strong',
  running: 'text-brand-strong paper:text-foreground',
  warning: 'text-warning-strong',
  error: 'text-destructive',
  muted: 'text-muted-foreground',
}

const TONE_CHIP: Record<JobTone, string> = {
  ok: 'bg-success/12 text-success-strong',
  running: 'bg-brand/12 text-brand-strong paper:bg-secondary paper:text-foreground/80',
  warning: 'bg-warning/14 text-warning-strong',
  error: 'bg-destructive/12 text-destructive',
  muted: 'bg-secondary text-secondary-foreground',
}

/** Icon of a job state (spinner while syncing). */
export function StateIcon({ state, className }: { state: JobState; className?: string }) {
  const cls = cn('size-4 shrink-0', TONE_TEXT[state.tone], className)
  switch (state.kind) {
    case 'syncing':
      return <Loader2 className={cn(cls, 'animate-spin')} aria-hidden />
    case 'removing':
      return <Ban className={cls} aria-hidden />
    case 'error':
      return <CircleAlert className={cls} aria-hidden />
    case 'disabled':
      return <CirclePause className={cls} aria-hidden />
    case 'ok':
      return <CircleCheck className={cls} aria-hidden />
    default:
      return <CircleDashed className={cls} aria-hidden />
  }
}

/** State as a small rounded label. */
export function StateChip({ state, className }: { state: JobState; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] leading-none font-medium whitespace-nowrap [&_svg]:size-3',
        TONE_CHIP[state.tone],
        className,
      )}
      data-testid="replication-state"
    >
      <StateIcon state={state} className={TONE_TEXT[state.tone]} />
      {state.label}
    </span>
  )
}

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

/** One labelled value in the job details grid. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-xl bg-foreground/[0.03] px-3 py-2 ring-1 ring-border/60 ring-inset paper:bg-secondary/50', className)}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 min-w-0 text-[13px] break-words">{children}</div>
    </div>
  )
}

/** Whether the user may change replication jobs of this guest (VM.Replicate). */
export function useCanReplicate() {
  const perms = usePermissions()
  return (vmid: number, pool?: string) => perms.can({ privs: 'VM.Replicate' }, { kind: 'guest', vmid, pool })
}

/** Whether the user may create replication jobs for some guest. */
export function useCanReplicateAnywhere() {
  return usePermissions().can({ privs: 'VM.Replicate', path: ['/vms', '/pool'], anywhere: true })
}
