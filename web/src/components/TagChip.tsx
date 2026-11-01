import { useMemo, type CSSProperties, type ComponentProps } from 'react'
import { Check } from 'lucide-react'

import { useClusterOptions } from '@/api/shell'
import { contrastText, orderTags, parseTagStyle, rgbCss, splitTags, tagColors, type TagStyle } from '@/lib/tags'
import { cn } from '@/lib/utils'

/** The datacenter tag style (colour overrides, shape, ordering); defaults until loaded. */
export function useTagStyle(): TagStyle {
  const { data } = useClusterOptions()
  const raw = data?.['tag-style']
  return useMemo(() => parseTagStyle(typeof raw === 'string' ? raw : undefined), [raw])
}

function chipStyle(tag: string, style: TagStyle): { css: CSSProperties; override: boolean; hasFg: boolean; darkText: boolean } {
  const c = tagColors(tag, style)
  const css: Record<string, string> = { '--tag': rgbCss(c.base) }
  if (c.fg) css['--tag-fg'] = rgbCss(c.fg)
  return { css: css as CSSProperties, override: c.override, hasFg: !!c.fg, darkText: contrastText(c.base) === 'dark' }
}

interface TagChipProps extends Omit<ComponentProps<'span'>, 'children'> {
  tag: string
  style?: never
  tagStyle?: TagStyle
  size?: 'sm' | 'md'
  /** Shape override (default: the datacenter tag style). */
  shape?: TagStyle['shape']
}

/**
 * One tag in its colour. Hash colours follow the official UI; in the dark
 * glass theme they render as a tinted glass chip with coloured text, in the
 * light themes as the familiar pastel chip. Datacenter colour overrides are
 * used exactly as configured.
 */
export function TagChip({ tag, tagStyle, size = 'sm', shape, className, ...props }: TagChipProps) {
  const fromDc = useTagStyle()
  const style = tagStyle ?? fromDc
  const s = chipStyle(tag, style)
  const kind = shape ?? style.shape
  const text = size === 'sm' ? 'text-[11px] leading-[18px]' : 'text-xs leading-5'

  if (kind === 'none') {
    return (
      <span className={cn(text, 'text-muted-foreground', className)} {...props}>
        #{tag}
      </span>
    )
  }
  if (kind === 'dense') {
    return <span title={tag} aria-label={`标签 ${tag}`} style={s.css} className={cn('inline-block h-2 w-4 shrink-0 rounded-full bg-(--tag)', className)} {...props} />
  }
  if (kind === 'circle') {
    return (
      <span className={cn('inline-flex max-w-40 shrink-0 items-center gap-1 text-foreground/80', text, className)} style={s.css} {...props}>
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-(--tag)" />
        <span className="truncate">{tag}</span>
      </span>
    )
  }
  return (
    <span
      style={s.css}
      className={cn(
        'inline-flex max-w-40 shrink-0 items-center rounded-full px-2 font-medium',
        text,
        s.override
          ? cn('bg-(--tag)', s.hasFg ? 'text-(--tag-fg)' : s.darkText ? 'text-[#141413]' : 'text-white')
          : cn(
              // light glass / paper: pastel chip with dark text (as in the official UI)
              'bg-(--tag) text-[#1b1d24] ring-1 ring-black/5 ring-inset',
              'paper:bg-[color-mix(in_oklab,var(--tag)_70%,var(--secondary))] paper:ring-black/[0.06]',
              // dark glass: tinted glass with coloured text
              'dark:bg-[color-mix(in_oklab,var(--tag)_16%,transparent)] dark:text-(--tag) dark:ring-[color-mix(in_oklab,var(--tag)_32%,transparent)]',
            ),
        className,
      )}
      {...props}
    >
      <span className="truncate">{tag}</span>
    </span>
  )
}

/** A guest's tags ("a;b;c") in datacenter order, optionally capped with "+n". */
export function TagList({ tags, max, size, className }: { tags: string | undefined; max?: number; size?: 'sm' | 'md'; className?: string }) {
  const style = useTagStyle()
  const list = orderTags(splitTags(tags), style)
  if (list.length === 0) return null
  const shown = max !== undefined ? list.slice(0, max) : list
  const more = list.length - shown.length
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-1', className)}>
      {shown.map((t) => (
        <TagChip key={t} tag={t} tagStyle={style} size={size} />
      ))}
      {more > 0 && (
        <span className="text-[11px] text-muted-foreground tabular" title={list.slice(shown.length).join('、')}>
          +{more}
        </span>
      )}
    </span>
  )
}

/** Toggleable tag for filter rows (44px touch target on phones). */
export function TagFilterChip({
  tag,
  count,
  selected,
  onToggle,
}: {
  tag: string
  count?: number
  selected: boolean
  onToggle: () => void
}) {
  const style = useTagStyle()
  const s = chipStyle(tag, style)
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      style={s.css}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors pointer-coarse:h-11 pointer-coarse:px-3.5',
        selected
          ? 'border-transparent bg-[color-mix(in_oklab,var(--tag)_28%,transparent)] text-foreground ring-1 ring-[color-mix(in_oklab,var(--tag)_60%,transparent)] paper:bg-[color-mix(in_oklab,var(--tag)_45%,var(--card))]'
          : 'border-border bg-(--field) text-foreground/80 hover:text-foreground',
      )}
    >
      {selected ? <Check className="size-3.5" aria-hidden /> : <span aria-hidden className="size-2 rounded-full bg-(--tag)" />}
      <span className="max-w-32 truncate">{tag}</span>
      {count !== undefined && <span className="text-muted-foreground tabular">{count}</span>}
    </button>
  )
}
