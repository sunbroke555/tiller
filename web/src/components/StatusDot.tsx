import { cn } from '@/lib/utils'
import { statusLabel } from '@/lib/resources'

export type StatusTone = 'ok' | 'off' | 'warn' | 'bad' | 'unknown'

export function statusTone(status: string | undefined): StatusTone {
  switch (status) {
    case 'running':
    case 'online':
    case 'available':
    case 'active':
    case 'ok':
      return 'ok'
    case 'stopped':
      return 'off'
    case 'paused':
    case 'suspended':
    case 'prelaunch':
      return 'warn'
    case 'offline':
    case 'error':
    case 'inactive':
      return 'bad'
    default:
      return 'unknown'
  }
}

const TONE_CLASS: Record<StatusTone, string> = {
  ok: 'text-success',
  off: 'text-faint',
  warn: 'text-warning',
  bad: 'text-destructive',
  unknown: 'text-muted-foreground',
}

interface StatusDotProps {
  status: string | undefined
  /** Animated ring for live states (default: on for running/online). */
  pulse?: boolean
  size?: 'sm' | 'md'
  className?: string
  /** Hide the screen-reader label when the status is spelled out next to it. */
  decorative?: boolean
}

export function StatusDot({ status, pulse, size = 'md', className, decorative }: StatusDotProps) {
  const tone = statusTone(status)
  const animate = pulse ?? tone === 'ok'
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', TONE_CLASS[tone], className)}
      title={statusLabel(status)}
    >
      <span
        aria-hidden
        className={cn(
          'block rounded-full bg-current',
          size === 'sm' ? 'size-1.5' : 'size-2',
          tone === 'ok' && 'shadow-[0_0_8px_currentColor] paper:shadow-none',
          animate && 'animate-[status-pulse_2.4s_ease-out_infinite] motion-reduce:animate-none',
        )}
      />
      {!decorative && <span className="sr-only">{statusLabel(status)}</span>}
    </span>
  )
}
