import { useMemo, type CSSProperties, type ReactNode } from 'react'

import { useClusterOptions } from '@/api/guest-core'
import { cn } from '@/lib/utils'

import { contrastText, orderTags, parseTagStyle, rgbCss, stringToRgb, tagOverride, type TagStyle } from './tags'

/** Datacenter tag style (colours, ordering); default style while loading. */
export function useTagStyle(): TagStyle {
  const { data } = useClusterOptions()
  return useMemo(() => parseTagStyle(data), [data])
}

interface TagBadgeProps {
  tag: string
  style: TagStyle
  size?: 'sm' | 'md'
  className?: string
  /** Extra content after the name (a remove button). */
  children?: ReactNode
}

/**
 * One tag chip. A colour from the datacenter colour map is shown as set
 * (solid, like the official UI); other tags get the official hashed hue as a
 * theme-aware tint so they read on dark glass, light glass and paper.
 */
export function TagBadge({ tag, style, size = 'sm', className, children }: TagBadgeProps) {
  const override = tagOverride(tag, style)
  const base = cn(
    'inline-flex max-w-full items-center gap-1 rounded-full font-medium whitespace-nowrap',
    size === 'sm' ? 'h-5 px-2 text-[11px]' : 'h-7 px-2.5 text-xs',
    className,
  )
  if (override) {
    const fg = override.fg ? rgbCss(override.fg) : contrastText(override.bg) === 'light' ? '#fff' : '#111'
    return (
      <span className={base} style={{ background: rgbCss(override.bg), color: fg }}>
        <span className="truncate">{tag}</span>
        {children}
      </span>
    )
  }
  const tint = { '--tag': rgbCss(stringToRgb(tag)) } as CSSProperties
  if (style.shape === 'circle' || style.shape === 'dense') {
    return (
      <span className={cn(base, 'px-0 text-foreground/80')} style={tint}>
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-(--tag)" />
        <span className="truncate">{tag}</span>
        {children}
      </span>
    )
  }
  return (
    <span
      className={cn(
        base,
        'bg-[color-mix(in_oklab,var(--tag)_18%,transparent)] text-[color-mix(in_oklab,var(--tag)_50%,var(--foreground))] ring-1 ring-[color-mix(in_oklab,var(--tag)_30%,transparent)] ring-inset',
      )}
      style={tint}
    >
      <span className="truncate">{tag}</span>
      {children}
    </span>
  )
}

/** Tags of a guest in datacenter order and colours. */
export function TagList({ tags, size, className }: { tags: readonly string[]; size?: 'sm' | 'md'; className?: string }) {
  const style = useTagStyle()
  if (tags.length === 0) return null
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      {orderTags(tags, style).map((t) => (
        <TagBadge key={t} tag={t} style={style} size={size} />
      ))}
    </span>
  )
}
