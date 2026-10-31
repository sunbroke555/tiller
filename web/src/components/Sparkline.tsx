import { useId, useMemo } from 'react'

import { cn } from '@/lib/utils'

interface SparklineProps {
  /** Samples in time order; null/undefined leave a gap. */
  values: readonly (number | null | undefined)[]
  /** Fixed scale; default 0..max(values). */
  min?: number
  max?: number
  className?: string
  /** CSS colour; default the theme brand colour. */
  color?: string
  'aria-label'?: string
}

const W = 100
const H = 32

/** Tiny dependency-free SVG line + area chart for usage history. */
export function Sparkline({ values, min = 0, max, className, color = 'var(--brand)', ...rest }: SparklineProps) {
  const id = useId()
  const { line, area } = useMemo(() => buildPaths(values, min, max), [values, min, max])
  if (!line) return <div className={cn('h-8', className)} aria-hidden />
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn('h-8 w-full overflow-visible', className)}
      role="img"
      aria-label={rest['aria-label'] ?? '趋势图'}
    >
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id}-fill)`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export function buildPaths(values: readonly (number | null | undefined)[], min: number, max?: number) {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (nums.length < 2) return { line: '', area: '' }
  const hi = max ?? Math.max(...nums)
  const span = hi - min || 1
  const step = W / (values.length - 1)
  const y = (v: number) => H - ((Math.min(Math.max(v, min), hi) - min) / span) * (H - 2) - 1

  let line = ''
  let area = ''
  let segStart: number | null = null
  let lastX = 0
  values.forEach((v, i) => {
    const x = i * step
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      if (segStart !== null) area += `L${lastX.toFixed(2)},${H}L${segStart.toFixed(2)},${H}Z`
      segStart = null
      return
    }
    const pt = `${x.toFixed(2)},${y(v).toFixed(2)}`
    if (segStart === null) {
      line += `M${pt}`
      area += `M${pt}`
      segStart = x
    } else {
      line += `L${pt}`
      area += `L${pt}`
    }
    lastX = x
  })
  if (segStart !== null) area += `L${lastX.toFixed(2)},${H}L${(segStart as number).toFixed(2)},${H}Z`
  return { line, area }
}
