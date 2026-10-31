import { cn } from '@/lib/utils'
import { formatPercent } from '@/lib/format'

interface UsageBarProps {
  /** 0..1, or null when unknown. */
  value: number | null | undefined
  label?: string
  /** Right-aligned detail, e.g. "3.1 / 16 GiB". Defaults to the percentage. */
  detail?: string
  /** Show the percentage next to the detail. */
  showPercent?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export function usageTone(value: number): 'normal' | 'high' | 'critical' {
  if (value >= 0.9) return 'critical'
  if (value >= 0.75) return 'high'
  return 'normal'
}

const FILL: Record<ReturnType<typeof usageTone>, string> = {
  normal: 'bg-linear-to-r from-brand to-brand-2 paper:from-brand paper:to-brand',
  high: 'bg-warning',
  critical: 'bg-destructive',
}

export function UsageBar({ value, label, detail, showPercent = true, size = 'md', className }: UsageBarProps) {
  const known = typeof value === 'number' && Number.isFinite(value)
  const v = known ? Math.min(Math.max(value, 0), 1) : 0
  const pct = formatPercent(known ? v : null)
  return (
    <div className={cn('min-w-0', className)}>
      {(label || detail || showPercent) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
          {label && <span className="text-muted-foreground">{label}</span>}
          <span className="ml-auto truncate text-foreground/90 tabular">
            {detail}
            {detail && showPercent && <span className="text-muted-foreground"> · </span>}
            {showPercent && pct}
          </span>
        </div>
      )}
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? Math.round(v * 100) : undefined}
        aria-valuetext={known ? pct : '未知'}
        className={cn(
          'relative overflow-hidden rounded-full bg-foreground/[0.07] paper:bg-secondary',
          size === 'sm' ? 'h-1' : 'h-1.5',
        )}
      >
        {known && (
          <div
            className={cn('h-full rounded-full transition-[width] duration-700 ease-out', FILL[usageTone(v)])}
            style={{ width: `${Math.max(v * 100, v > 0 ? 1.5 : 0)}%` }}
          />
        )}
      </div>
    </div>
  )
}
