// Guest tags: colours, the datacenter tag style and tag filtering.
//
// Colours follow the official UI so a tag looks the same in both: a hash of
// the name gives a pastel RGB (Proxmox.Utils.stringToRGB), and the datacenter
// option `tag-style` can override colours per tag:
//
//   tag-style: color-map=prod:FF0000:FFFFFF;test:00AA00,shape=circle,ordering=config,case-sensitive=0

export type Rgb = readonly [number, number, number]

export type TagShape = 'full' | 'circle' | 'dense' | 'none'

export interface TagStyle {
  /** Overrides by tag name (lower case unless caseSensitive): background and optional text colour. */
  colorMap: Record<string, { bg: Rgb; fg?: Rgb }>
  shape: TagShape
  /** 'config': as written in the guest config; 'alphabetical': sorted. */
  ordering: 'config' | 'alphabetical'
  caseSensitive: boolean
}

export const DEFAULT_TAG_STYLE: TagStyle = { colorMap: {}, shape: 'full', ordering: 'config', caseSensitive: false }

/** Same hash as Proxmox.Utils.stringToRGB (pastel, blended 70 % onto white). */
export function stringToRgb(tag: string): Rgb {
  if (!tag) return [255, 255, 255]
  let hash = 0
  const s = tag + 'prox' // give short strings more variance
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash)
    hash = hash & hash
  }
  const alpha = 0.7
  const bg = 255
  return [
    (hash & 255) * alpha + bg * (1 - alpha),
    ((hash >> 8) & 255) * alpha + bg * (1 - alpha),
    ((hash >> 16) & 255) * alpha + bg * (1 - alpha),
  ]
}

export function hexToRgb(hex: string): Rgb | undefined {
  const h = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(h)) return undefined
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function rgbCss(rgb: Rgb, alpha?: number): string {
  const [r, g, b] = rgb.map((v) => Math.round(v))
  return alpha === undefined ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`
}

/** Simplified SAPC (as Proxmox.Utils.getTextContrastClass): text colour for a background. */
export function contrastText(rgb: Rgb): 'light' | 'dark' {
  const lin = (v: number) => (v / 255) ** 2.4
  let y = lin(rgb[0]) * 0.2126729 + lin(rgb[1]) * 0.7151522 + lin(rgb[2]) * 0.072175
  const blkThrs = 0.022
  y = y > blkThrs ? y : y + (blkThrs - y) ** 1.414
  const light = y ** 0.65 - 1
  const dark = y ** 0.56 - 0.046134502
  return Math.abs(light) >= Math.abs(dark) ? 'light' : 'dark'
}

/** Parse the datacenter `tag-style` property string. */
export function parseTagStyle(value: string | undefined | null): TagStyle {
  const style: TagStyle = { ...DEFAULT_TAG_STYLE, colorMap: {} }
  if (!value) return style
  // Values never contain "," except as the separator; color-map uses ";".
  for (const part of value.split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    const val = part.slice(eq + 1).trim()
    if (key === 'shape' && ['full', 'circle', 'dense', 'none'].includes(val)) style.shape = val as TagShape
    else if (key === 'ordering' && (val === 'config' || val === 'alphabetical')) style.ordering = val
    else if (key === 'case-sensitive') style.caseSensitive = val === '1' || val === 'true'
    else if (key === 'color-map') {
      for (const entry of val.split(';')) {
        const [tag, bg, fg] = entry.split(':')
        const bgRgb = bg ? hexToRgb(bg) : undefined
        if (!tag || !bgRgb) continue
        const fgRgb = fg ? hexToRgb(fg) : undefined
        style.colorMap[tag] = fgRgb ? { bg: bgRgb, fg: fgRgb } : { bg: bgRgb }
      }
    }
  }
  if (!style.caseSensitive) {
    style.colorMap = Object.fromEntries(Object.entries(style.colorMap).map(([k, v]) => [k.toLowerCase(), v]))
  }
  return style
}

export interface TagColors {
  /** Base colour of the tag (background in the official UI). */
  base: Rgb
  /** Explicit text colour from the color-map, if any. */
  fg?: Rgb
  /** From the datacenter color-map rather than the hash. */
  override: boolean
}

export function tagColors(tag: string, style: TagStyle = DEFAULT_TAG_STYLE): TagColors {
  const key = style.caseSensitive ? tag : tag.toLowerCase()
  const o = style.colorMap[key]
  if (o) return o.fg ? { base: o.bg, fg: o.fg, override: true } : { base: o.bg, override: true }
  return { base: stringToRgb(tag), override: false }
}

/** PVE tags are separated by ";" (also "," or spaces in older configs). */
export function splitTags(tags: string | undefined | null): string[] {
  if (!tags) return []
  return tags
    .split(/[;,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/** Tags in display order (dedupes case-insensitively unless case sensitive). */
export function orderTags(tags: readonly string[], style: TagStyle = DEFAULT_TAG_STYLE): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const k = style.caseSensitive ? t : t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return style.ordering === 'alphabetical' ? out.sort((a, b) => a.localeCompare(b)) : out
}

/** Every tag used by these resources, with how many use it, sorted by name. */
export function collectTags(items: readonly { tags?: string | undefined }[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>()
  for (const item of items) {
    for (const t of new Set(splitTags(item.tags).map((x) => x.toLowerCase()))) {
      const entry = counts.get(t)
      if (entry) entry.count++
      else counts.set(t, { tag: t, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => a.tag.localeCompare(b.tag))
}

/** True when the item carries every one of `wanted` (case-insensitive). */
export function hasAllTags(item: { tags?: string | undefined }, wanted: readonly string[]): boolean {
  if (wanted.length === 0) return true
  const have = new Set(splitTags(item.tags).map((t) => t.toLowerCase()))
  return wanted.every((t) => have.has(t.toLowerCase()))
}
