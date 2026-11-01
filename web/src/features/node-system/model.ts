// Pure logic of the node system tab: DNS form ↔ params, /etc/hosts checks,
// time display and time zone search, and the node option property strings
// (wakeonlan, location). No React here; see model.test.ts.
//
// Field rules follow the official UI (proxmoxlib.js Proxmox.node.DNSEdit,
// HostsView, TimeView, NodeOptionsView, Proxmox.window.LocationEdit) and the
// API schema (`pvesh usage /nodes/{node}/config -v`).

import type { Params } from '@/api/client'
import type { NodeDns, NodeOptionsConfig } from '@/api/node-system'
import { isIPv4, isIPv6, isMac } from '@/features/lxc-config/model'
import { configUpdateParams, parsePropertyString, tryParsePropertyString, updatePropertyString, type ConfigValues } from '@/lib/propstring'

import { TIMEZONES } from './timezones'

// -------------------------------------------------------------------- DNS

export interface DnsForm {
  search: string
  /** DNS server 1–3 (empty = not set). */
  servers: [string, string, string]
}

export function dnsToForm(dns: NodeDns | undefined): DnsForm {
  return { search: dns?.search ?? '', servers: [dns?.dns1 ?? '', dns?.dns2 ?? '', dns?.dns3 ?? ''] }
}

export type DnsErrors = Partial<Record<'search' | 'dns1' | 'dns2' | 'dns3', string>>

/** Search domain is required (one name); servers must be IPv4/IPv6. */
export function validateDnsForm(form: DnsForm): DnsErrors {
  const errors: DnsErrors = {}
  const search = form.search.trim()
  // PVE reads back only the first word of the resolv.conf search line: one domain.
  if (!search) errors.search = '必填'
  else if (/\s/.test(search)) errors.search = '只能填一个域名'
  else if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.?$/.test(search)) errors.search = '不是有效的域名'
  form.servers.forEach((raw, i) => {
    const v = raw.trim()
    if (v && !isIPv4(v) && !isIPv6(v)) errors[`dns${i + 1}` as 'dns1'] = '不是有效的 IPv4 / IPv6 地址'
  })
  return errors
}

/**
 * PUT params, or null when nothing changed. The API rewrites resolv.conf with
 * exactly the servers it gets, so cleared ones are just left out; the rest
 * move up (dns1 never stays empty while dns2 is set).
 */
export function dnsParams(before: NodeDns | undefined, form: DnsForm): Params | null {
  const servers = form.servers.map((s) => s.trim()).filter(Boolean)
  const next: Params = { search: form.search.trim() }
  servers.forEach((s, i) => (next[`dns${i + 1}`] = s))
  const prev = before ?? {}
  const same =
    (prev.search ?? '') === next.search &&
    [1, 2, 3].every((i) => (prev[`dns${i}` as 'dns1'] ?? '') === (next[`dns${i}`] ?? ''))
  return same ? null : next
}

// ------------------------------------------------------------------ hosts

export interface HostsEntry {
  /** 1-based line number. */
  line: number
  address: string
  names: string[]
}

export interface HostsCheck {
  entries: HostsEntry[]
  /** Lines whose first field is not an IP address (1-based). */
  invalidLines: number[]
  /** No entry names this node: corosync / pveproxy may break. */
  missingNode: boolean
}

/** Parse /etc/hosts and check what could break the node. */
export function checkHosts(text: string, node: string): HostsCheck {
  const entries: HostsEntry[] = []
  const invalidLines: number[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) return
    const [address = '', ...names] = line.split(/\s+/)
    const ip = address.replace(/%[^%\s]+$/, '')
    if ((!isIPv4(ip) && !isIPv6(ip)) || names.length === 0) {
      invalidLines.push(i + 1)
      return
    }
    entries.push({ line: i + 1, address, names })
  })
  const lower = node.toLowerCase()
  const missingNode = !entries.some((e) =>
    e.names.some((n) => {
      const name = n.toLowerCase()
      return name === lower || name.startsWith(`${lower}.`)
    }),
  )
  return { entries, invalidLines, missingNode }
}

/** Unix line endings and a final newline, as the file is usually written. */
export function normalizeHostsText(text: string): string {
  const unix = text.replace(/\r\n?/g, '\n')
  return unix === '' || unix.endsWith('\n') ? unix : `${unix}\n`
}

// ------------------------------------------------------------------- time

const pad = (n: number) => String(n).padStart(2, '0')

/** "2026-11-01 08:30:05" from Unix seconds, read as UTC (node `localtime` is pre-shifted). */
export function formatClock(epochSeconds: number): string {
  const d = new Date(Math.floor(epochSeconds) * 1000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

/** 28800 → "UTC+08:00", -12600 → "UTC-03:30", 0 → "UTC". */
export function formatUtcOffset(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes === 0) return 'UTC'
  const abs = Math.abs(minutes)
  return `UTC${minutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** Current UTC offset of an IANA zone per the browser's tz data, or null. */
export function zoneOffset(zone: string, at: Date = new Date()): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(at)
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    if (name === 'GMT') return 'UTC'
    const m = /^GMT([+-]\d{2}:\d{2})$/.exec(name)
    if (!m) return null
    return /^[+-]00:00$/.test(m[1]!) ? 'UTC' : `UTC${m[1]}`
  } catch {
    return null
  }
}

/**
 * Seconds the node clock is ahead of this device (negative: behind), or null
 * when the difference is within `tolerance` (network delay, polling).
 */
export function clockSkew(time: number, fetchedAt: number, tolerance = 5): number | null {
  const skew = Math.round(time - fetchedAt / 1000)
  return Math.abs(skew) <= tolerance ? null : skew
}

/** Chinese names people search for, matched in addition to the zone id. */
export const TZ_ALIASES: Readonly<Record<string, string>> = {
  'Asia/Shanghai': '中国 北京 上海 北京时间 CST',
  'Asia/Hong_Kong': '香港 HKT',
  'Asia/Macau': '澳门',
  'Asia/Taipei': '台北 台湾',
  'Asia/Tokyo': '东京 日本 JST',
  'Asia/Seoul': '首尔 韩国 KST',
  'Asia/Singapore': '新加坡 SGT',
  'Asia/Kolkata': '印度 孟买 新德里 IST',
  'Asia/Dubai': '迪拜 阿联酋',
  'Asia/Bangkok': '曼谷 泰国',
  'Europe/London': '伦敦 英国 GMT BST',
  'Europe/Berlin': '柏林 德国 CET',
  'Europe/Paris': '巴黎 法国',
  'Europe/Moscow': '莫斯科 俄罗斯 MSK',
  'Europe/Vienna': '维也纳 奥地利',
  'America/New_York': '纽约 美国东部 EST EDT',
  'America/Chicago': '芝加哥 美国中部 CST',
  'America/Denver': '丹佛 美国山地 MST',
  'America/Los_Angeles': '洛杉矶 旧金山 美国西部 PST PDT',
  'America/Sao_Paulo': '圣保罗 巴西',
  'Australia/Sydney': '悉尼 澳大利亚 AEST',
  UTC: '协调世界时 GMT 格林尼治',
}

/** Time zones matching `query` (zone id, city with spaces, or a Chinese alias). */
export function searchTimezones(query: string, zones: readonly string[] = TIMEZONES): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...zones]
  const terms = q.split(/\s+/)
  return zones.filter((z) => {
    const hay = `${z} ${z.replace(/_/g, ' ')} ${TZ_ALIASES[z] ?? ''}`.toLowerCase()
    return terms.every((t) => hay.includes(t))
  })
}

/** "Asia/Shanghai" → { region: "Asia", city: "Shanghai" }; "America/Argentina/Salta" → city "Argentina / Salta". */
export function splitZone(zone: string): { region: string; city: string } {
  const i = zone.indexOf('/')
  if (i === -1) return { region: '', city: zone }
  return { region: zone.slice(0, i), city: zone.slice(i + 1).replace(/_/g, ' ').replace(/\//g, ' / ') }
}

// ---------------------------------------------------------- node options

export const START_DELAY_MAX = 300
export const BALLOON_TARGET_DEFAULT = 80

/** Only the keys in `after` are compared; cleared ones go to `delete`. */
export function optionsParams(before: NodeOptionsConfig | undefined, after: ConfigValues, digest?: string): Params | null {
  return configUpdateParams(before as ConfigValues | undefined, after, { digest: digest ?? before?.digest })
}

/** `value` when it parses as a property string, else '' (start over). */
function parseable(value: string | undefined, defaultKey?: string): string {
  if (!value) return ''
  try {
    parsePropertyString(value, defaultKey)
    return value
  } catch {
    return ''
  }
}

export interface WolForm {
  mac: string
  bindInterface: string
  broadcast: string
}

export function parseWakeOnLan(value: string | undefined): WolForm {
  const m = tryParsePropertyString(value, 'mac')
  return { mac: m.mac ?? '', bindInterface: m['bind-interface'] ?? '', broadcast: m['broadcast-address'] ?? '' }
}

export type WolErrors = Partial<Record<keyof WolForm, string>>

export function validateWol(form: WolForm): WolErrors {
  const errors: WolErrors = {}
  const mac = form.mac.trim()
  if (mac && !isMac(mac)) errors.mac = '格式：01:23:45:67:89:ab'
  if (!mac && (form.bindInterface || form.broadcast.trim())) errors.mac = '设置接口或广播地址时必须填写 MAC'
  const bc = form.broadcast.trim()
  if (bc && !isIPv4(bc)) errors.broadcast = '不是有效的 IPv4 地址'
  if (/[,=\s]/.test(form.bindInterface)) errors.bindInterface = '接口名不能包含逗号、等号或空格'
  return errors
}

/** New `wakeonlan` value ('' = delete), keeping keys this form does not know. */
export function wakeOnLanValue(previous: string | undefined, form: WolForm): string {
  const mac = form.mac.trim()
  if (!mac) return ''
  return updatePropertyString(
    parseable(previous, 'mac'),
    { mac, 'bind-interface': form.bindInterface.trim(), 'broadcast-address': form.broadcast.trim() },
    'mac',
  )
}

export interface LocationForm {
  name: string
  latitude: number | undefined
  longitude: number | undefined
}

export function parseLocation(value: string | undefined): LocationForm {
  const m = tryParsePropertyString(value)
  const num = (s: string | undefined) => (s === undefined || s === '' || !Number.isFinite(Number(s)) ? undefined : Number(s))
  return { name: m.name ?? '', latitude: num(m.latitude), longitude: num(m.longitude) }
}

export type LocationErrors = Partial<Record<keyof LocationForm, string>>

export function validateLocation(form: LocationForm): LocationErrors {
  const errors: LocationErrors = {}
  const name = form.name.trim()
  if (name && /[,=]/.test(name)) errors.name = '不能包含逗号和等号'
  // PVE 9.2 writes the node config as UTF-8 but reads it back as Latin-1, so
  // non-ASCII names come back garbled (and get worse with every save).
  else if (/[^\x20-\x7e]/.test(name)) errors.name = '只能使用英文字母、数字和常见符号（PVE 无法正确保存中文等字符）'
  const any = !!name || form.latitude !== undefined || form.longitude !== undefined
  if (any) {
    if (form.latitude === undefined) errors.latitude = '必填'
    else if (form.latitude < -90 || form.latitude > 90) errors.latitude = '范围 -90 ~ 90'
    if (form.longitude === undefined) errors.longitude = '必填'
    else if (form.longitude < -180 || form.longitude > 180) errors.longitude = '范围 -180 ~ 180'
  }
  return errors
}

/** 6 decimals at most, no trailing zeros. */
const coord = (v: number) => String(Number(v.toFixed(6)))

/** New `location` value ('' = delete, back to the datacenter default). */
export function locationValue(previous: string | undefined, form: LocationForm): string {
  if (form.latitude === undefined || form.longitude === undefined) return ''
  return updatePropertyString(parseable(previous), {
    latitude: coord(form.latitude),
    longitude: coord(form.longitude),
    name: form.name.trim(),
  })
}

/** OpenStreetMap link of a location, as the official UI renders it. */
export function locationMapUrl(form: LocationForm): string | null {
  if (form.latitude === undefined || form.longitude === undefined) return null
  const lat = coord(form.latitude)
  const lon = coord(form.longitude)
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`
}
