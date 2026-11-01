// Guest tags: datacenter tag style (colour overrides, ordering), the official
// UI's colour hash for tags without an override, validation and editing.

import type { ClusterOptions } from '@/api/guest-core'

export type Rgb = [number, number, number]

export interface TagColor {
  bg: Rgb
  /** Explicit text colour from the colour map. */
  fg?: Rgb
}

export interface TagStyle {
  colors: Record<string, TagColor>
  shape: 'full' | 'circle' | 'dense' | 'none'
  ordering: 'config' | 'alphabetical'
  caseSensitive: boolean
}

export const DEFAULT_TAG_STYLE: TagStyle = { colors: {}, shape: 'full', ordering: 'config', caseSensitive: false }

/** Same characters the official UI accepts (PVE.Utils.tagCharRegex). */
export const TAG_RE = /^[a-z0-9+_.-]+$/i

function hex(h: string | undefined): Rgb | undefined {
  if (!h || !/^[0-9a-f]{6}$/i.test(h)) return undefined
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** "prod:FF0000:FFFFFF;dev:00FF00" → { prod: {bg, fg}, dev: {bg} } */
export function parseColorMap(map: string | undefined | null): Record<string, TagColor> {
  const out: Record<string, TagColor> = {}
  for (const entry of (map ?? '').split(';')) {
    const [tag, bg, fg] = entry.split(':')
    const bgRgb = hex(bg)
    if (!tag || !bgRgb) continue
    const fgRgb = hex(fg)
    out[tag] = fgRgb ? { bg: bgRgb, fg: fgRgb } : { bg: bgRgb }
  }
  return out
}

/**
 * Tag style from GET /cluster/options. `tag-style` comes back parsed
 * ({ 'color-map': …, shape, ordering, 'case-sensitive' }) or, from older
 * hosts, as the raw property string.
 */
export function parseTagStyle(options: ClusterOptions | null | undefined): TagStyle {
  const raw = options?.['tag-style']
  if (!raw) return DEFAULT_TAG_STYLE
  let obj: Record<string, string> = {}
  if (typeof raw === 'string') {
    for (const part of raw.split(',')) {
      const i = part.indexOf('=')
      if (i > 0) obj[part.slice(0, i)] = part.slice(i + 1)
    }
  } else {
    obj = raw
  }
  const shape = obj.shape
  return {
    colors: parseColorMap(obj['color-map']),
    shape: shape === 'circle' || shape === 'dense' || shape === 'none' ? shape : 'full',
    ordering: obj.ordering === 'alphabetical' ? 'alphabetical' : 'config',
    caseSensitive: obj['case-sensitive'] === '1' || (obj['case-sensitive'] as unknown) === 1,
  }
}

/** The official colour hash (Proxmox.Utils.stringToRGB): a pastel per tag name. */
export function stringToRgb(s: string): Rgb {
  let hash = 0
  const str = `${s}prox`
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
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

/** Text colour that reads on `bg` (official SAPC-based contrast pick). */
export function contrastText(rgb: Rgb): 'light' | 'dark' {
  const lin = (c: number) => (c / 255) ** 2.4
  let y = lin(rgb[0]) * 0.2126729 + lin(rgb[1]) * 0.7151522 + lin(rgb[2]) * 0.072175
  y = y > 0.022 ? y : y + (0.022 - y) ** 1.414
  const light = y ** 0.65 - 1
  const dark = y ** 0.56 - 0.046134502
  return Math.abs(light) >= Math.abs(dark) ? 'light' : 'dark'
}

export function rgbCss([r, g, b]: Rgb): string {
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`
}

/** Override for a tag, honouring case sensitivity. */
export function tagOverride(tag: string, style: TagStyle): TagColor | undefined {
  if (style.colors[tag]) return style.colors[tag]
  if (style.caseSensitive) return undefined
  const lower = tag.toLowerCase()
  const key = Object.keys(style.colors).find((k) => k.toLowerCase() === lower)
  return key ? style.colors[key] : undefined
}

/** Tags in display order (config order or alphabetical). */
export function orderTags(tags: readonly string[], style: TagStyle): string[] {
  if (style.ordering !== 'alphabetical') return [...tags]
  return [...tags].sort((a, b) => (style.caseSensitive ? a.localeCompare(b) : a.toLowerCase().localeCompare(b.toLowerCase())))
}

/** Split a tag string (";", "," or spaces) and drop duplicates. */
export function splitTags(value: string | undefined | null): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of (value ?? '').split(/[;,\s]+/)) {
    const tag = t.trim()
    if (tag && !seen.has(tag)) {
      seen.add(tag)
      out.push(tag)
    }
  }
  return out
}

/** Config value for a tag list: "a;b", or "" (delete) when empty. */
export function joinTags(tags: readonly string[]): string {
  return tags.join(';')
}

/** Why a new tag cannot be added, or null. */
export function tagError(tag: string, existing: readonly string[], caseSensitive = false): string | null {
  const t = tag.trim()
  if (!t) return '请输入标签'
  if (!TAG_RE.test(t)) return '只能包含字母、数字和 + _ . -'
  const same = caseSensitive ? existing.includes(t) : existing.some((e) => e.toLowerCase() === t.toLowerCase())
  if (same) return '标签已存在'
  return null
}

export type UserTagAccess = 'none' | 'list' | 'existing' | 'free'

/** user-tag-access from /cluster/options (default: free). */
export function parseUserTagAccess(options: ClusterOptions | null | undefined): { mode: UserTagAccess; list: string[] } {
  const raw = options?.['user-tag-access']
  let mode: string | undefined
  let list: string[] = []
  if (typeof raw === 'string') {
    for (const part of raw.split(',')) {
      const [k, v] = part.split('=')
      if (k === 'user-allow') mode = v
      if (k === 'user-allow-list' && v) list = v.split(';').filter(Boolean)
    }
  } else if (raw && typeof raw === 'object') {
    mode = raw['user-allow'] as string | undefined
    const l = raw['user-allow-list']
    list = Array.isArray(l) ? l : typeof l === 'string' ? l.split(';').filter(Boolean) : []
  }
  return { mode: mode === 'none' || mode === 'list' || mode === 'existing' ? mode : 'free', list }
}
