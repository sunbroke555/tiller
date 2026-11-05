import { useMemo, type CSSProperties, type ComponentProps } from 'react'
import { Check } from 'lucide-react'

import { useClusterOptions } from '@/api/shell'
import type { InstanceScope } from '@/api/instance-scope'
import { contrastText, orderTags, parseTagStyle, rgbCss, splitTags, tagColors, type TagStyle } from '@/lib/tags'
import { cn } from '@/lib/utils'

/** The datacenter tag style (colour overrides, shape, ordering); defaults until loaded. */
export function useTagStyle(instance?: InstanceScope): TagStyle {
  const { data } = useClusterOptions(instance)
  const raw: unknown = data?.['tag-style']
  return useMemo(() => parseTagStyle(tagStyleString(raw)), [raw])
}

/** GET /cluster/options returns `tag-style` parsed ({ 'color-map': …, shape, … }); older hosts send the string. */
function tagStyleString(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw
  if (!raw || typeof raw !== 'object') return undefined
  return Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(',')
}

function chipStyle(tag: string, style: TagStyle): { css: CSSProperties; override: boolean; hasFg: boolean; darkText: boolean } {
  const c = tagColors(tag, style)
  const css: Record<string, string> = { '--tag': rgbCss(c.base) }
  if (c.override) css['--tag-tone'] = rgbCss(c.base)
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
 * One tag with a subtle theme-aware tint of the official hashed hue.
 * Datacenter colour overrides are used exactly as configured.
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
    return <span title={tag} aria-label={`标签 ${tag}`} style={s.css} className={cn('tag-palette inline-block h-2 w-4 shrink-0 rounded-full bg-(--tag-tone)', className)} {...props} />
  }
  if (kind === 'circle') {
    return (
      <span className={cn('tag-palette inline-flex max-w-40 shrink-0 items-center gap-1 text-foreground/80', text, className)} style={s.css} {...props}>
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-(--tag-tone)" />
        <span className="truncate">{tag}</span>
      </span>
    )
  }
  return (
    <span
      style={s.css}
      className={cn(
        'tag-palette inline-flex max-w-40 shrink-0 items-center rounded-full px-2 font-medium',
        text,
        s.override
          ? cn('bg-(--tag)', s.hasFg ? 'text-(--tag-fg)' : s.darkText ? 'text-[#141413]' : 'text-white')
          : 'tag-tint',
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

/** Compact filter pill inside a 44px touch target on phones. */
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
      title={tag}
      onClick={onToggle}
      style={s.css}
      className="tag-palette group inline-flex h-8 min-w-11 shrink-0 items-center justify-center rounded-full text-xs font-medium pointer-coarse:h-11"
    >
      <span
        className={cn(
          'inline-flex h-7 w-full items-center justify-center gap-1 rounded-full border px-2 text-xs transition-colors lg:h-8 lg:gap-1.5 lg:px-3',
          selected
            ? 'border-[color-mix(in_oklab,var(--tag-tone)_40%,var(--border))] bg-[color-mix(in_oklab,var(--tag-tone)_18%,var(--field))] text-foreground'
            : 'border-border bg-(--field) text-foreground/80 group-hover:text-foreground',
        )}
      >
        {selected ? <Check className="size-3 shrink-0 lg:size-3.5" aria-hidden /> : <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-(--tag-tone) lg:size-2" />}
        <span className="max-w-24 truncate lg:max-w-32">{tag}</span>
        {count !== undefined && <span className="shrink-0 text-muted-foreground tabular">{count}</span>}
      </span>
    </button>
  )
}
