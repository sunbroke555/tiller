import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { splitZone, zoneOffset } from './model'

const ROW_HEIGHT = 56
const MAX_HEIGHT = 352
const OVERSCAN = 3

/** Only mount the visible rows and calculate their UTC offsets. Creating
 * 400 Intl formatters and radio buttons on open blocks the entrance animation. */
export function TimezoneList({ zones, value, onValueChange }: {
  zones: readonly string[]
  value: string
  onValueChange: (zone: string) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  const focusIndex = useRef<number | null>(null)
  const [scrollTop, setScrollTop] = useState(() => Math.max(0, zones.indexOf(value) * ROW_HEIGHT - MAX_HEIGHT / 2))
  const [offsets] = useState(() => ({ at: new Date(), values: new Map<string, string | null>() }))
  const selectedIndex = zones.indexOf(value)
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(zones.length, start + Math.ceil(MAX_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2)
  const tabbable = selectedIndex >= start && selectedIndex < end ? selectedIndex : start

  // Search resets the scroll position; selecting a visible row does not.
  // The ref preserves the latest choice without rerunning this effect on
  // every arrow-key selection.
  const choice = useRef(value)
  choice.current = value
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    const index = Math.max(0, zones.indexOf(choice.current))
    el.scrollTop = Math.max(0, index * ROW_HEIGHT - (el.clientHeight - ROW_HEIGHT) / 2)
    setScrollTop(el.scrollTop)
  }, [zones])

  useLayoutEffect(() => {
    if (focusIndex.current === null) return
    const el = list.current?.querySelector<HTMLElement>(`[data-zone-index="${focusIndex.current}"]`)
    if (el) { el.focus({ preventScroll: true }); focusIndex.current = null }
  })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-zone-index]')
    if (!target || !zones.length) return
    const index = Number(target.dataset.zoneIndex)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? zones.length - 1
      : ['ArrowDown', 'ArrowRight'].includes(event.key) ? (index + 1) % zones.length
        : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? (index - 1 + zones.length) % zones.length : null
    if (next === null) return
    event.preventDefault()
    focusIndex.current = next
    const el = list.current!
    const top = next * ROW_HEIGHT
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight
    setScrollTop(el.scrollTop)
    onValueChange(zones[next]!)
  }

  return (
    <div
      ref={list}
      role="radiogroup"
      aria-label="时区"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
      className="max-h-[50dvh] overflow-y-auto overscroll-contain rounded-xl border border-border/70"
      style={{ height: zones.length ? Math.min(MAX_HEIGHT, zones.length * ROW_HEIGHT + 2) : 80 }}
    >
      {zones.length === 0 ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">没有匹配的时区</p> : (
        <div style={{ height: zones.length * ROW_HEIGHT }}>
          <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
            {zones.slice(start, end).map((zone, i) => {
              const index = start + i
              const { region, city } = splitZone(zone)
              const selected = zone === value
              if (!offsets.values.has(zone)) offsets.values.set(zone, zoneOffset(zone, offsets.at))
              return (
                <button
                  key={zone}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={zone}
                  aria-posinset={index + 1}
                  aria-setsize={zones.length}
                  data-zone-index={index}
                  tabIndex={index === tabbable ? 0 : -1}
                  onClick={() => onValueChange(zone)}
                  className={cn(
                    'flex h-14 w-full items-center gap-3 border-b border-border/50 px-3 py-2 text-left text-sm',
                    'outline-none hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.06]',
                    selected && 'bg-brand/10 paper:bg-secondary',
                  )}
                >
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">{city}</span>
                    {region && <span className="truncate text-xs text-muted-foreground">{region}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular">{offsets.values.get(zone) ?? ''}</span>
                  <Check className={cn('size-4 shrink-0 text-brand-strong', !selected && 'invisible')} aria-hidden />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
