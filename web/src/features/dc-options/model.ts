// Datacenter options (/cluster/options): value normalisation, the per-option
// form ⇄ property-string conversions, validation, display text and the
// "send only what changed" diff.
//
// GET returns property-string options parsed into objects (except bwlimit and
// location) and lists as arrays; PUT takes the property strings. Everything is
// normalised to strings here so a form compares against what it loaded.

import type { Params } from '@/api/client'
import type { DcOptions } from '@/api/dc-options'
import { hexToRgb, type Rgb } from '@/lib/tags'
import { parseListValue, stringifyPropertyString, tryParsePropertyString, type PropertyMap } from '@/lib/propstring'

export type OptionKey =
  | 'keyboard'
  | 'language'
  | 'console'
  | 'http_proxy'
  | 'email_from'
  | 'mac_prefix'
  | 'consent-text'
  | 'description'
  | 'migration'
  | 'replication'
  | 'bwlimit'
  | 'max_workers'
  | 'next-id'
  | 'ha'
  | 'crs'
  | 'fencing'
  | 'u2f'
  | 'webauthn'
  | 'tag-style'
  | 'user-tag-access'
  | 'registered-tags'
  | 'location'
  | 'notify'

/** Options that are property strings (with their default key, if any). */
const PROPERTY_KEYS: Partial<Record<OptionKey, { defaultKey?: string }>> = {
  migration: { defaultKey: 'type' },
  replication: { defaultKey: 'type' },
  bwlimit: {},
  'next-id': {},
  ha: {},
  crs: {},
  u2f: {},
  webauthn: {},
  'tag-style': {},
  'user-tag-access': {},
  location: {},
  notify: {},
}

// ------------------------------------------------------------ normalising

function scalar(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (Array.isArray(v)) {
    const items = v.map((x) => String(x)).filter((x) => x !== '')
    return items.length ? items.join(';') : undefined
  }
  if (typeof v === 'object') return undefined
  const s = String(v)
  return s === '' ? undefined : s
}

/** A GET value as a property map (objects as they are, strings parsed). */
export function optionMap(value: unknown, defaultKey?: string): PropertyMap {
  if (value === undefined || value === null || value === '') return {}
  if (typeof value === 'string') return tryParsePropertyString(value, defaultKey)
  if (typeof value !== 'object' || Array.isArray(value)) return {}
  const out: PropertyMap = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const s = scalar(v)
    if (s !== undefined) out[k] = s
  }
  return out
}

/** A GET value as the string PUT would take ("" and missing → undefined). */
export function optionText(value: unknown): string | undefined {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const m = optionMap(value)
    const s = Object.entries(m)
      .map(([k, v]) => `${k}=${v}`)
      .join(',')
    return s || undefined
  }
  return scalar(value)
}

/** Order-independent form of an option value, to tell real changes from re-serialising. */
export function canonicalOption(key: string, value: unknown): string | undefined {
  const prop = PROPERTY_KEYS[key as OptionKey]
  if (!prop) return optionText(value)
  const m = optionMap(value, prop.defaultKey)
  const keys = Object.keys(m).sort()
  return keys.length ? keys.map((k) => `${k}=${m[k]}`).join(',') : undefined
}

/**
 * PUT parameters for the edited options, or null when nothing changed:
 * changed keys are sent, cleared ones go to `delete`, untouched ones are left out.
 */
export function optionParams(options: DcOptions | null | undefined, changes: Partial<Record<OptionKey, string | undefined>>): Params | null {
  const params: Params = {}
  const del: string[] = []
  for (const [key, next] of Object.entries(changes) as [OptionKey, string | undefined][]) {
    const before = canonicalOption(key, options?.[key])
    const after = canonicalOption(key, next === undefined || next.trim() === '' ? undefined : next)
    if (after === undefined) {
      if (before !== undefined) del.push(key)
    } else if (after !== before) {
      params[key] = next!.trim()
    }
  }
  if (del.length) params.delete = del.join(',')
  return Object.keys(params).length ? params : null
}

// ------------------------------------------------------------ choices

export const KEYBOARD_LAYOUTS: Record<string, string> = {
  da: '丹麦语',
  de: '德语',
  'de-ch': '德语（瑞士）',
  'en-gb': '英语（英国）',
  'en-us': '英语（美国）',
  es: '西班牙语',
  fi: '芬兰语',
  fr: '法语',
  'fr-be': '法语（比利时）',
  'fr-ca': '法语（加拿大）',
  'fr-ch': '法语（瑞士）',
  hu: '匈牙利语',
  is: '冰岛语',
  it: '意大利语',
  ja: '日语',
  lt: '立陶宛语',
  mk: '马其顿语',
  nl: '荷兰语',
  no: '挪威语',
  pl: '波兰语',
  pt: '葡萄牙语',
  'pt-br': '葡萄牙语（巴西）',
  sl: '斯洛文尼亚语',
  sv: '瑞典语',
  tr: '土耳其语',
}

export const LANGUAGES: Record<string, string> = {
  ar: 'العربية',
  ca: 'Català',
  da: 'Dansk',
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  eu: 'Euskera',
  fa: 'فارسی',
  fr: 'Français',
  he: 'עברית',
  hr: 'Hrvatski',
  it: 'Italiano',
  ja: '日本語',
  ka: 'ქართული',
  kr: '한국어',
  nb: 'Norsk (bokmål)',
  nl: 'Nederlands',
  nn: 'Norsk (nynorsk)',
  pl: 'Polski',
  pt_BR: 'Português (Brasil)',
  ru: 'Русский',
  sl: 'Slovenščina',
  sv: 'Svenska',
  tr: 'Türkçe',
  ukr: 'Українська',
  zh_CN: '简体中文',
  zh_TW: '繁體中文',
}

export const CONSOLE_VIEWERS: Record<string, string> = {
  html5: 'noVNC（HTML5）',
  xtermjs: 'xterm.js',
  vv: 'SPICE（remote-viewer）',
  applet: 'Java 小程序（已弃用，按 noVNC 打开）',
}

export const HA_SHUTDOWN_POLICIES: Record<string, { label: string; hint: string }> = {
  conditional: { label: 'conditional', hint: '关机时冻结，重启时迁移' },
  freeze: { label: 'freeze', hint: '节点关机或重启时冻结服务，不迁移' },
  failover: { label: 'failover', hint: '节点离线后在其他节点恢复服务' },
  migrate: { label: 'migrate', hint: '关机或重启前先把服务迁走（节点维护）' },
}

export const CRS_MODES: Record<string, string> = {
  basic: '基础（按资源数量）',
  static: '静态负载',
  dynamic: '动态负载',
}

export const CRS_METHODS: Record<string, string> = { bruteforce: 'Bruteforce', topsis: 'TOPSIS' }

export const FENCING_MODES: Record<string, string> = {
  watchdog: 'watchdog（看门狗）',
  hardware: 'hardware（硬件隔离，实验性）',
  both: 'both（两者，实验性）',
}

/** Official defaults: circle shape, alphabetical order. */
export const TAG_SHAPES: Record<string, string> = { full: '完整', circle: '圆点', dense: '紧凑', none: '不显示' }
export const TAG_ORDERINGS: Record<string, string> = { config: '按配置顺序', alphabetical: '按字母顺序' }

export const USER_TAG_MODES: Record<string, { label: string; hint: string }> = {
  free: { label: 'free', hint: '可以设置任意标签' },
  existing: { label: 'existing', hint: '只能用预定义标签或已在使用的标签' },
  list: { label: 'list', hint: '只能用预定义列表里的标签' },
  none: { label: 'none', hint: '不能设置标签' },
}

export const BWLIMIT_KEYS = ['default', 'restore', 'migration', 'clone', 'move'] as const
export type BwlimitKey = (typeof BWLIMIT_KEYS)[number]
export const BWLIMIT_LABEL: Record<BwlimitKey, string> = {
  default: '默认',
  restore: '备份恢复',
  migration: '迁移',
  clone: '克隆',
  move: '移动磁盘',
}

// ------------------------------------------------------------ validation

export const MAC_PREFIX_RE = /^[a-f0-9][02468ace](?::[a-f0-9]{2}){0,2}:?$/i
export const HTTP_PROXY_RE = /^http:\/\/.+$/
const EMAIL_RE = /^[\w+.-]+@[\w.-]+$/
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i
/** Same characters the official UI accepts in tags (PVE.Utils.tagCharRegex). */
export const TAG_RE = /^[a-z0-9_][a-z0-9_+.-]*$/i

export function validateMacPrefix(v: string): string | undefined {
  if (!v.trim()) return undefined
  return MAC_PREFIX_RE.test(v.trim()) ? undefined : '格式如 02:8f，只能是单播地址（第一个字节为偶数）'
}

export function validateHttpProxy(v: string): string | undefined {
  if (!v.trim()) return undefined
  return HTTP_PROXY_RE.test(v.trim()) ? undefined : '以 http:// 开头，例如 http://user:pass@host:3128/'
}

export function validateEmail(v: string): string | undefined {
  if (!v.trim()) return undefined
  return EMAIL_RE.test(v.trim()) ? undefined : '不是有效的邮件地址'
}

function validCidr(v: string): boolean {
  const [addr, len, ...rest] = v.split('/')
  if (rest.length || !addr || len === undefined || !/^\d{1,3}$/.test(len)) return false
  const n = Number(len)
  if (addr.includes(':')) return n <= 128 && /^[0-9a-f:.]+$/i.test(addr) && addr.split('::').length <= 2
  const parts = addr.split('.')
  return n <= 32 && parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

export function validateCidr(v: string): string | undefined {
  if (!v.trim()) return undefined
  return validCidr(v.trim()) ? undefined : '格式如 10.0.0.0/24 或 fd00::/64'
}

// ------------------------------------------------------------ simple options

/** Plain values: an empty form value means "use the default" (delete). */
export function scalarValue(v: string | number | undefined | null): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

// ------------------------------------------------------------ migration / replication

export interface NetworkForm {
  type: 'secure' | 'insecure' | undefined
  network: string
}

export function parseNetworkSetting(value: unknown): NetworkForm {
  const m = optionMap(value, 'type')
  return { type: m.type === 'insecure' ? 'insecure' : m.type === 'secure' ? 'secure' : undefined, network: m.network ?? '' }
}

export function networkSettingValue(form: NetworkForm): string | undefined {
  return stringifyPropertyString({ type: form.type, network: form.network.trim() }) || undefined
}

// ------------------------------------------------------------ bandwidth

export type BwlimitForm = Partial<Record<BwlimitKey, number>>

/** bwlimit values are KiB/s. */
export function parseBwlimit(value: unknown): BwlimitForm {
  const m = optionMap(value)
  const out: BwlimitForm = {}
  for (const k of BWLIMIT_KEYS) {
    const n = m[k] === undefined ? NaN : Number(m[k])
    if (Number.isFinite(n)) out[k] = n
  }
  return out
}

export function bwlimitValue(form: BwlimitForm): string | undefined {
  const props: Record<string, number | undefined> = {}
  for (const k of BWLIMIT_KEYS) {
    const v = form[k]
    if (v !== undefined && Number.isFinite(v) && v >= 0) props[k] = Math.round(v)
  }
  return stringifyPropertyString(props) || undefined
}

const RATE_FACTOR = { KiB: 1, MiB: 1024, GiB: 1024 * 1024 } as const

/** 2048 KiB/s → "2 MiB/s"; 0 → "不限速". */
export function formatRate(kib: number): string {
  if (kib === 0) return '不限速'
  const unit = kib >= RATE_FACTOR.GiB ? 'GiB' : kib >= RATE_FACTOR.MiB ? 'MiB' : 'KiB'
  const v = kib / RATE_FACTOR[unit]
  return `${Number.isInteger(v) ? v : v.toFixed(2).replace(/\.?0+$/, '')} ${unit}/s`
}

// ------------------------------------------------------------ next-id

export interface NextIdForm {
  lower: number | undefined
  upper: number | undefined
}

export const NEXT_ID_MIN = 100
export const NEXT_ID_MAX = 999_999_999

export function parseNextId(value: unknown): NextIdForm {
  const m = optionMap(value)
  const num = (s: string | undefined) => (s === undefined || !/^\d+$/.test(s) ? undefined : Number(s))
  return { lower: num(m.lower), upper: num(m.upper) }
}

export function validateNextId(f: NextIdForm): { lower?: string; upper?: string } {
  const e: { lower?: string; upper?: string } = {}
  for (const k of ['lower', 'upper'] as const) {
    const v = f[k]
    if (v !== undefined && (v < NEXT_ID_MIN || v > NEXT_ID_MAX)) e[k] = `范围 ${NEXT_ID_MIN}–${NEXT_ID_MAX}`
  }
  const lower = f.lower ?? NEXT_ID_MIN
  const upper = f.upper ?? 1_000_000
  if (!e.lower && !e.upper && lower >= upper) e.upper = '必须大于下限'
  return e
}

export function nextIdValue(f: NextIdForm): string | undefined {
  return stringifyPropertyString({ lower: f.lower, upper: f.upper }) || undefined
}

// ------------------------------------------------------------ HA / CRS

export function parseHaPolicy(value: unknown): string | undefined {
  return optionMap(value).shutdown_policy
}

export function haValue(policy: string | undefined): string | undefined {
  return policy ? `shutdown_policy=${policy}` : undefined
}

export interface CrsForm {
  ha: string | undefined
  rebalanceOnStart: boolean
  autoRebalance: boolean
  threshold: number | undefined
  method: string | undefined
  holdDuration: number | undefined
  margin: number | undefined
}

export function parseCrs(value: unknown): CrsForm {
  const m = optionMap(value)
  const num = (s: string | undefined) => (s === undefined || s === '' || !Number.isFinite(Number(s)) ? undefined : Number(s))
  return {
    ha: m.ha,
    rebalanceOnStart: m['ha-rebalance-on-start'] === '1',
    autoRebalance: m['ha-auto-rebalance'] === '1',
    threshold: num(m['ha-auto-rebalance-threshold']),
    method: m['ha-auto-rebalance-method'],
    holdDuration: num(m['ha-auto-rebalance-hold-duration']),
    margin: num(m['ha-auto-rebalance-margin']),
  }
}

/** Automatic rebalancing needs the static or dynamic scheduler. */
export function crsCanAutoRebalance(mode: string | undefined): boolean {
  return mode === 'static' || mode === 'dynamic'
}

export function crsValue(f: CrsForm): string | undefined {
  const auto = f.autoRebalance && crsCanAutoRebalance(f.ha)
  return (
    stringifyPropertyString({
      ha: f.ha,
      'ha-rebalance-on-start': f.rebalanceOnStart ? 1 : undefined,
      'ha-auto-rebalance': auto ? 1 : undefined,
      'ha-auto-rebalance-threshold': auto ? f.threshold : undefined,
      'ha-auto-rebalance-method': auto ? f.method : undefined,
      'ha-auto-rebalance-hold-duration': auto ? f.holdDuration : undefined,
      'ha-auto-rebalance-margin': auto ? f.margin : undefined,
    }) || undefined
  )
}

// ------------------------------------------------------------ U2F / WebAuthn

export interface U2fForm {
  appid: string
  origin: string
}

export function parseU2f(value: unknown): U2fForm {
  const m = optionMap(value)
  return { appid: m.appid ?? '', origin: m.origin ?? '' }
}

export function u2fValue(f: U2fForm): string | undefined {
  return stringifyPropertyString({ appid: f.appid.trim(), origin: f.origin.trim() }) || undefined
}

export interface WebauthnForm {
  rp: string
  origin: string
  id: string
  allowSubdomains: boolean
}

export function parseWebauthn(value: unknown): WebauthnForm {
  const m = optionMap(value)
  return { rp: m.rp ?? '', origin: m.origin ?? '', id: m.id ?? '', allowSubdomains: m['allow-subdomains'] === '1' }
}

export function validateWebauthn(f: WebauthnForm): { rp?: string; origin?: string; id?: string } {
  const e: { rp?: string; origin?: string; id?: string } = {}
  const any = !!(f.rp.trim() || f.origin.trim() || f.id.trim())
  if (!any) return e
  if (!f.rp.trim()) e.rp = '必填'
  if (!f.id.trim()) e.id = '必填'
  else if (!DOMAIN_RE.test(f.id.trim())) e.id = '填写域名，例如 pve.example.com'
  if (f.origin.trim() && !/^https?:\/\/[^\s/]+$/i.test(f.origin.trim())) e.origin = '格式如 https://pve.example.com:8006（不带路径）'
  return e
}

export function webauthnValue(f: WebauthnForm): string | undefined {
  return (
    stringifyPropertyString({
      rp: f.rp.trim(),
      origin: f.origin.trim(),
      id: f.id.trim(),
      'allow-subdomains': f.allowSubdomains ? 1 : undefined,
    }) || undefined
  )
}

// ------------------------------------------------------------ tags

export interface ColorOverride {
  tag: string
  /** Background "RRGGBB" (upper case, no "#"). */
  bg: string
  /** Text colour, or "" for automatic contrast. */
  fg: string
}

export interface TagStyleForm {
  shape: string | undefined
  ordering: string | undefined
  caseSensitive: boolean
  colors: ColorOverride[]
}

const hex6 = (s: string | undefined) => (s && /^[0-9a-f]{6}$/i.test(s) ? s.toUpperCase() : '')

export function parseColorOverrides(map: string | undefined): ColorOverride[] {
  const out: ColorOverride[] = []
  for (const entry of parseListValue(map)) {
    const [tag, bg, fg] = entry.split(':')
    if (!tag) continue
    out.push({ tag, bg: hex6(bg) || 'FFFFFF', fg: hex6(fg) })
  }
  return out
}

export function parseTagStyleForm(value: unknown): TagStyleForm {
  const m = optionMap(value)
  return {
    shape: m.shape,
    ordering: m.ordering,
    caseSensitive: m['case-sensitive'] === '1',
    colors: parseColorOverrides(m['color-map']),
  }
}

export function colorMapValue(colors: readonly ColorOverride[]): string {
  return colors
    .filter((c) => c.tag.trim())
    .map((c) => [c.tag.trim(), hex6(c.bg) || 'FFFFFF', hex6(c.fg)].filter(Boolean).join(':'))
    .join(';')
}

export function tagStyleValue(f: TagStyleForm): string | undefined {
  return (
    stringifyPropertyString({
      'color-map': colorMapValue(f.colors),
      shape: f.shape,
      ordering: f.ordering,
      'case-sensitive': f.caseSensitive ? 1 : undefined,
    }) || undefined
  )
}

/** Per-row problems of the colour overrides (empty / invalid / duplicate tag). */
export function validateColorOverrides(colors: readonly ColorOverride[], caseSensitive: boolean): (string | undefined)[] {
  const seen = new Set<string>()
  return colors.map((c) => {
    const tag = c.tag.trim()
    if (!tag) return '请输入标签'
    if (!TAG_RE.test(tag)) return '只能包含字母、数字和 + _ . -'
    const k = caseSensitive ? tag : tag.toLowerCase()
    if (seen.has(k)) return '标签重复'
    seen.add(k)
    return undefined
  })
}

export function rgbOf(hex: string): Rgb {
  return hexToRgb(hex) ?? [255, 255, 255]
}

export function rgbToHex([r, g, b]: Rgb): string {
  return [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
}

export interface UserTagAccessForm {
  mode: string | undefined
  list: string[]
}

export function parseUserTagAccessForm(value: unknown): UserTagAccessForm {
  const m = optionMap(value)
  return { mode: m['user-allow'], list: parseListValue(m['user-allow-list']) }
}

export function userTagAccessValue(f: UserTagAccessForm): string | undefined {
  return stringifyPropertyString({ 'user-allow': f.mode, 'user-allow-list': f.list }) || undefined
}

export function parseTagList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  return typeof value === 'string' ? parseListValue(value) : []
}

export function tagListValue(tags: readonly string[]): string | undefined {
  return tags.length ? tags.join(';') : undefined
}

/** Why a tag cannot be added to a list, or undefined. */
export function tagListError(tag: string, list: readonly string[]): string | undefined {
  const t = tag.trim()
  if (!t) return '请输入标签'
  if (!TAG_RE.test(t)) return '只能包含字母、数字和 + _ . -'
  if (list.some((x) => x.toLowerCase() === t.toLowerCase())) return '已在列表中'
  return undefined
}

/** Tags of `a` that are also in `b` (case-insensitive). */
export function overlap(a: readonly string[], b: readonly string[]): string[] {
  const set = new Set(b.map((t) => t.toLowerCase()))
  return a.filter((t) => set.has(t.toLowerCase()))
}

// ------------------------------------------------------------ location

export interface LocationForm {
  name: string
  latitude: number | undefined
  longitude: number | undefined
}

export function parseLocationForm(value: unknown): LocationForm {
  const m = optionMap(value)
  const num = (s: string | undefined) => (s === undefined || s === '' || !Number.isFinite(Number(s)) ? undefined : Number(s))
  return { name: m.name ?? '', latitude: num(m.latitude), longitude: num(m.longitude) }
}

export function validateLocationForm(f: LocationForm): { name?: string; latitude?: string; longitude?: string } {
  const e: { name?: string; latitude?: string; longitude?: string } = {}
  const name = f.name.trim()
  if (name && /[,=;]/.test(name)) e.name = '不能包含逗号、等号和分号'
  const any = !!name || f.latitude !== undefined || f.longitude !== undefined
  if (!any) return e
  if (f.latitude === undefined) e.latitude = '必填'
  else if (f.latitude < -90 || f.latitude > 90) e.latitude = '范围 -90 ~ 90'
  if (f.longitude === undefined) e.longitude = '必填'
  else if (f.longitude < -180 || f.longitude > 180) e.longitude = '范围 -180 ~ 180'
  return e
}

const coord = (n: number | undefined) => (n === undefined ? undefined : Number(n.toFixed(6)))

export function locationValue(f: LocationForm): string | undefined {
  return stringifyPropertyString({ latitude: coord(f.latitude), longitude: coord(f.longitude), name: f.name.trim() }) || undefined
}

// ------------------------------------------------------------ consent text

/** The consent text is stored base64 encoded (UTF-8). */
export function decodeBase64Utf8(value: string | undefined): string {
  if (!value) return ''
  try {
    const bin = atob(value.replace(/\s+/g, ''))
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch {
    return value
  }
}

export function encodeBase64Utf8(text: string): string {
  let bin = ''
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
  return btoa(bin)
}

export const CONSENT_MAX = 64 * 1024

// ------------------------------------------------------------ display text

/** One-line summary of an option's current value; undefined = default. */
export function describeOption(key: OptionKey, options: DcOptions | null | undefined): string | undefined {
  const v = options?.[key]
  switch (key) {
    case 'keyboard': {
      const s = scalar(v)
      return s && (KEYBOARD_LAYOUTS[s] ? `${KEYBOARD_LAYOUTS[s]}（${s}）` : s)
    }
    case 'language': {
      const s = scalar(v)
      return s && (LANGUAGES[s] ? `${LANGUAGES[s]}（${s}）` : s)
    }
    case 'console': {
      const s = scalar(v)
      return s && (CONSOLE_VIEWERS[s] ?? s)
    }
    case 'mac_prefix': {
      const s = scalar(v)
      return s && s.toUpperCase() !== 'BC:24:11' ? s : undefined
    }
    case 'consent-text': {
      const text = decodeBase64Utf8(scalar(v)).trim()
      return text ? text.split('\n')[0]!.slice(0, 80) : undefined
    }
    case 'description': {
      const text = scalar(v)?.trim()
      return text ? text.split('\n')[0]!.slice(0, 80) : undefined
    }
    case 'migration':
    case 'replication': {
      const f = parseNetworkSetting(v)
      if (!f.type && !f.network) return undefined
      return [f.type === 'insecure' ? '不加密（insecure）' : '加密（secure）', f.network ? `网络 ${f.network}` : '默认网络'].join(' · ')
    }
    case 'bwlimit': {
      const f = parseBwlimit(v)
      const parts = BWLIMIT_KEYS.filter((k) => f[k] !== undefined).map((k) => `${BWLIMIT_LABEL[k]} ${formatRate(f[k]!)}`)
      return parts.length ? parts.join('，') : undefined
    }
    case 'next-id': {
      const f = parseNextId(v)
      if (f.lower === undefined && f.upper === undefined) return undefined
      return `从 ${f.lower ?? NEXT_ID_MIN} 到 ${f.upper ?? 1_000_000}（不含）`
    }
    case 'ha': {
      const p = parseHaPolicy(v)
      return p && `${p}（${HA_SHUTDOWN_POLICIES[p]?.hint ?? ''}）`
    }
    case 'crs': {
      const f = parseCrs(v)
      if (!f.ha && !f.rebalanceOnStart && !f.autoRebalance) return undefined
      return [
        CRS_MODES[f.ha ?? 'basic'] ?? f.ha,
        f.rebalanceOnStart && '启动时重新平衡',
        f.autoRebalance && crsCanAutoRebalance(f.ha) && `自动重新平衡${f.method ? `（${CRS_METHODS[f.method] ?? f.method}）` : ''}`,
      ]
        .filter(Boolean)
        .join(' · ')
    }
    case 'fencing': {
      const s = scalar(v)
      return s && (FENCING_MODES[s] ?? s)
    }
    case 'u2f': {
      const f = parseU2f(v)
      return [f.appid && `AppID ${f.appid}`, f.origin && `来源 ${f.origin}`].filter(Boolean).join(' · ') || undefined
    }
    case 'webauthn': {
      const f = parseWebauthn(v)
      return [f.rp && `名称 ${f.rp}`, f.id && `ID ${f.id}`, f.origin && `来源 ${f.origin}`].filter(Boolean).join(' · ') || undefined
    }
    case 'user-tag-access': {
      const f = parseUserTagAccessForm(v)
      if (!f.mode && f.list.length === 0) return undefined
      return `模式 ${f.mode ?? 'free'}${f.list.length ? ` · 预定义 ${f.list.length} 个` : ''}`
    }
    case 'registered-tags': {
      const list = parseTagList(v)
      return list.length ? list.join('、') : undefined
    }
    case 'tag-style': {
      const f = parseTagStyleForm(v)
      if (!f.shape && !f.ordering && !f.caseSensitive && f.colors.length === 0) return undefined
      return [
        `形状 ${TAG_SHAPES[f.shape ?? 'circle'] ?? f.shape}`,
        TAG_ORDERINGS[f.ordering ?? 'alphabetical'] ?? f.ordering,
        f.caseSensitive && '区分大小写',
        f.colors.length > 0 && `${f.colors.length} 个颜色覆盖`,
      ]
        .filter(Boolean)
        .join(' · ')
    }
    case 'location': {
      const f = parseLocationForm(v)
      if (f.latitude === undefined || f.longitude === undefined) return undefined
      return `${f.name ? `${f.name} · ` : ''}${f.latitude}, ${f.longitude}`
    }
    case 'notify':
      return optionText(v)
    default:
      return scalar(v)
  }
}
