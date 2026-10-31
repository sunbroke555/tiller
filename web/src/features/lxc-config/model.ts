// Pure logic of the container configuration tabs: pending changes, the
// property strings of net[n] / mp[n] / rootfs / dev[n] / features / startup,
// env and idmap lists, and the validators the dialogs use. No React here, so
// everything is unit tested (model.test.ts).
//
// Semantics follow the official UI (pvemanagerlib.js: PVE.lxc.*,
// PVE.Parser.parseLxcNetwork / parseLxcMountPoint, PVE.Utils.forEachLxcMP).

import {
  parseListValue,
  propBool,
  propNumber,
  stringifyPropertyString,
  tryParsePropertyString,
  type PropertyMap,
  type PropertyValue,
} from '@/lib/propstring'
import type { LxcInterface, PendingEntry } from '@/api/lxc-config'
import { formatBytes } from '@/lib/format'
import { parsePveSize } from '@/lib/size'

// ------------------------------------------------------------- pending

export interface PendingChange {
  key: string
  /** Value in effect now (undefined = not set). */
  current: string | undefined
  /** Value after the restart (undefined = removed). */
  next: string | undefined
  /** The key is going to be removed. */
  delete: boolean
}

export interface LxcPendingConfig {
  digest: string | undefined
  /** Running configuration. */
  current: Record<string, string>
  /** Configuration with pending changes applied: what the editors start from. */
  effective: Record<string, string>
  /** Keys with a pending change, in API order. */
  changes: PendingChange[]
}

const str = (v: string | number | undefined): string | undefined =>
  v === undefined || v === null ? undefined : String(v)

/** Split the pending list into current / effective config and the pending changes. */
export function parsePending(entries: readonly PendingEntry[] | null | undefined): LxcPendingConfig {
  const current: Record<string, string> = {}
  const effective: Record<string, string> = {}
  const changes: PendingChange[] = []
  let digest: string | undefined
  for (const e of entries ?? []) {
    if (e.key === 'digest') {
      digest = str(e.value)
      continue
    }
    const value = str(e.value)
    const pending = str(e.pending)
    const del = !!e.delete
    if (value !== undefined) current[e.key] = value
    if (del) {
      changes.push({ key: e.key, current: value, next: undefined, delete: true })
    } else if (pending !== undefined && pending !== value) {
      effective[e.key] = pending
      changes.push({ key: e.key, current: value, next: pending, delete: false })
    } else if (value !== undefined) {
      effective[e.key] = value
    }
  }
  return { digest, current, effective, changes }
}

/** Pending change of one key (undefined when none). */
export function pendingOf(config: LxcPendingConfig | undefined, key: string): PendingChange | undefined {
  return config?.changes.find((c) => c.key === key)
}

// --------------------------------------------------------- keys and slots

export const LXC_MAX = { mp: 256, unused: 256, dev: 256, net: 32 } as const

const KEY_RE = /^(mp|unused|dev|net)(\d+)$/

/** "mp3" → { prefix: 'mp', index: 3 }. */
export function splitKey(key: string): { prefix: string; index: number } | null {
  const m = KEY_RE.exec(key)
  return m ? { prefix: m[1]!, index: Number(m[2]) } : null
}

/** Config keys with this prefix (mp0, mp1, …), numerically sorted. */
export function keysWithPrefix(config: Record<string, unknown>, prefix: keyof typeof LXC_MAX): string[] {
  return Object.keys(config)
    .filter((k) => splitKey(k)?.prefix === prefix)
    .sort((a, b) => splitKey(a)!.index - splitKey(b)!.index)
}

/** First unused index for a prefix (mp/dev/net/unused), or null when all are taken. */
export function nextFreeIndex(
  config: Record<string, unknown>,
  prefix: keyof typeof LXC_MAX,
  also: readonly string[] = [],
): number | null {
  for (let i = 0; i < LXC_MAX[prefix]; i++) {
    const key = `${prefix}${i}`
    if (!(key in config) && !also.includes(key)) return i
  }
  return null
}

// ---------------------------------------------------------- validators

const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4 = `${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}`
const IPV4_RE = new RegExp(`^${IPV4}$`)

export function isIPv4(v: string): boolean {
  return IPV4_RE.test(v)
}

export function isIPv6(v: string): boolean {
  if (!v.includes(':') || !/^[0-9a-fA-F:.]+$/.test(v)) return false
  let s = v
  // Embedded IPv4 tail ("::ffff:1.2.3.4") counts as two groups.
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    if (!isIPv4(tail)) return false
    s = s.slice(0, lastColon + 1) + '0:0'
  }
  const halves = s.split('::')
  if (halves.length > 2) return false
  const groups = halves.flatMap((h) => (h === '' ? [] : h.split(':')))
  if (!groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false
  return halves.length === 2 ? groups.length < 8 : groups.length === 8
}

function cidr(v: string, max: number, ip: (s: string) => boolean): boolean {
  const i = v.lastIndexOf('/')
  if (i <= 0) return false
  const prefix = v.slice(i + 1)
  if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > max) return false
  return ip(v.slice(0, i))
}

export const isIPv4Cidr = (v: string) => cidr(v, 32, isIPv4)
export const isIPv6Cidr = (v: string) => cidr(v, 128, isIPv6)

export function isMac(v: string): boolean {
  return /^[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}$/.test(v)
}

/** MAC usable for a NIC: unicast (lowest bit of the first octet clear). */
export function isUnicastMac(v: string): boolean {
  return isMac(v) && (parseInt(v.slice(0, 2), 16) & 1) === 0
}

/** Host name / FQDN as PVE's DnsName vtype accepts it. */
export function isDnsName(v: string): boolean {
  if (!v || v.length > 255) return false
  return v
    .split('.')
    .every((label) => /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))
}

/** IPv4/IPv6 with an optional %scope suffix (nameserver entries). */
export function isIPWithSuffix(v: string): boolean {
  const ip = v.replace(/%[^%\s]+$/, '')
  return isIPv4(ip) || isIPv6(ip)
}

// ---------------------------------------------------------------- DNS

/** "1.1.1.1, 8.8.8.8;9.9.9.9" → "1.1.1.1 8.8.8.8 9.9.9.9" (PVE stores a space separated list). */
export function normalizeNameservers(v: string | undefined | null): string {
  return (v ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean)
    .join(' ')
}

/** Error message for an invalid nameserver list, or null. */
export function validateNameservers(v: string): string | null {
  const bad = normalizeNameservers(v)
    .split(' ')
    .filter((s) => s && !isIPWithSuffix(s))
  return bad.length ? `不是有效的 IP 地址：${bad.join('、')}` : null
}

// ------------------------------------------------------------- network

export type Ip4Mode = 'none' | 'static' | 'dhcp' | 'manual'
export type Ip6Mode = 'none' | 'static' | 'dhcp' | 'auto' | 'manual'

export interface NetForm {
  name: string
  hwaddr: string
  bridge: string
  tag: number | undefined
  firewall: boolean
  ip4mode: Ip4Mode
  ip: string
  gw: string
  ip6mode: Ip6Mode
  ip6: string
  gw6: string
  linkDown: boolean
  mtu: number | undefined
  /** MB/s; undefined = unlimited. */
  rate: number | undefined
  /** VLAN ids separated by ";" or spaces. */
  trunks: string
  hostManaged: boolean
}

export interface LxcNet {
  name: string
  hwaddr: string
  bridge: string
  tag: string
  firewall: boolean
  ip: string
  gw: string
  ip6: string
  gw6: string
  mtu: string
  rate: string
  trunks: string[]
  linkDown: boolean
  hostManaged: boolean
  type: string
}

/** net[n] → structured, tolerant of malformed input. */
export function parseLxcNet(value: string | null | undefined): LxcNet {
  const p = tryParsePropertyString(value)
  return {
    name: p.name ?? '',
    hwaddr: p.hwaddr ?? '',
    bridge: p.bridge ?? '',
    tag: p.tag ?? '',
    firewall: propBool(p.firewall),
    ip: p.ip ?? '',
    gw: p.gw ?? '',
    ip6: p.ip6 ?? '',
    gw6: p.gw6 ?? '',
    mtu: p.mtu ?? '',
    rate: p.rate ?? '',
    trunks: parseListValue(p.trunks),
    linkDown: propBool(p.link_down),
    hostManaged: propBool(p['host-managed']),
    type: p.type ?? 'veth',
  }
}

/** Defaults of the "add NIC" dialog (firewall on, like the official UI). */
export function newNetForm(name: string): NetForm {
  return {
    name,
    hwaddr: '',
    bridge: '',
    tag: undefined,
    firewall: true,
    ip4mode: 'none',
    ip: '',
    gw: '',
    ip6mode: 'none',
    ip6: '',
    gw6: '',
    linkDown: false,
    mtu: undefined,
    rate: undefined,
    trunks: '',
    hostManaged: false,
  }
}

export function netToForm(value: string): NetForm {
  const n = parseLxcNet(value)
  const ip4mode: Ip4Mode = n.ip === 'dhcp' ? 'dhcp' : n.ip === 'manual' ? 'manual' : n.ip ? 'static' : 'none'
  const ip6mode: Ip6Mode =
    n.ip6 === 'dhcp' ? 'dhcp' : n.ip6 === 'auto' ? 'auto' : n.ip6 === 'manual' ? 'manual' : n.ip6 ? 'static' : 'none'
  return {
    name: n.name,
    hwaddr: n.hwaddr,
    bridge: n.bridge,
    tag: propNumber(n.tag),
    firewall: n.firewall,
    ip4mode,
    ip: ip4mode === 'static' ? n.ip : '',
    gw: ip4mode === 'static' ? n.gw : '',
    ip6mode,
    ip6: ip6mode === 'static' ? n.ip6 : '',
    gw6: ip6mode === 'static' ? n.gw6 : '',
    linkDown: n.linkDown,
    mtu: propNumber(n.mtu),
    rate: propNumber(n.rate),
    trunks: n.trunks.join(';'),
    hostManaged: n.hostManaged,
  }
}

export function parseTrunks(v: string): number[] {
  return v
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number)
}

/**
 * Form → net[n]. Keys the form does not manage (type=veth, future options)
 * are kept from `previous`, as is the key order.
 */
export function formToNet(form: NetForm, previous?: string): string {
  const ip = form.ip4mode === 'static' ? form.ip.trim() : form.ip4mode === 'none' ? '' : form.ip4mode
  const ip6 = form.ip6mode === 'static' ? form.ip6.trim() : form.ip6mode === 'none' ? '' : form.ip6mode
  const trunks = parseTrunks(form.trunks)
  const patch: Record<string, PropertyValue> = {
    name: form.name.trim(),
    bridge: form.bridge,
    hwaddr: form.hwaddr.trim().toUpperCase(),
    ip,
    gw: form.ip4mode === 'static' ? form.gw.trim() : '',
    ip6,
    gw6: form.ip6mode === 'static' ? form.gw6.trim() : '',
    tag: form.tag,
    firewall: form.firewall ? 1 : null,
    link_down: form.linkDown ? 1 : null,
    mtu: form.mtu,
    rate: form.rate,
    trunks: trunks.length ? trunks : null,
    'host-managed': form.hostManaged ? 1 : null,
  }
  const base: Record<string, PropertyValue> = { ...tryParsePropertyString(previous) }
  for (const [k, v] of Object.entries(patch)) base[k] = v
  return stringifyPropertyString(base)
}

/** Field errors of the NIC form, keyed by NetForm field. */
export function validateNetForm(form: NetForm, otherNames: readonly string[]): Partial<Record<keyof NetForm, string>> {
  const e: Partial<Record<keyof NetForm, string>> = {}
  const name = form.name.trim()
  if (!name) e.name = '请填写名称'
  else if (!/^[a-zA-Z0-9_.-]{1,15}$/.test(name)) e.name = '最多 15 个字符，只能包含字母、数字和 _ . -'
  else if (otherNames.includes(name)) e.name = '这个名称已被其他网卡使用'
  if (form.hwaddr.trim() && !isUnicastMac(form.hwaddr.trim())) e.hwaddr = '不是有效的单播 MAC 地址'
  if (!form.bridge) e.bridge = '请选择网桥'
  if (form.tag !== undefined && (form.tag < 1 || form.tag > 4094)) e.tag = 'VLAN 标签范围 1–4094'
  if (form.ip4mode === 'static') {
    if (!form.ip.trim()) e.ip = '请填写 IPv4 地址（如 192.168.1.10/24）'
    else if (!isIPv4Cidr(form.ip.trim())) e.ip = '格式为 IPv4/前缀长度，如 192.168.1.10/24'
    if (form.gw.trim() && !isIPv4(form.gw.trim())) e.gw = '不是有效的 IPv4 地址'
  }
  if (form.ip6mode === 'static') {
    if (!form.ip6.trim()) e.ip6 = '请填写 IPv6 地址（如 fd00::10/64）'
    else if (!isIPv6Cidr(form.ip6.trim())) e.ip6 = '格式为 IPv6/前缀长度，如 fd00::10/64'
    if (form.gw6.trim() && !isIPv6(form.gw6.trim())) e.gw6 = '不是有效的 IPv6 地址'
  }
  if (form.mtu !== undefined && (form.mtu < 576 || form.mtu > 65535)) e.mtu = 'MTU 范围 576–65535'
  if (form.rate !== undefined && form.rate < 0) e.rate = '不能为负数'
  if (form.trunks.trim()) {
    const ids = parseTrunks(form.trunks)
    if (ids.some((n) => !Number.isInteger(n) || n < 1 || n > 4094)) e.trunks = '用分号分隔的 VLAN ID（1–4094）'
  }
  return e
}

/** Short summary of an address setting: "dhcp", "SLAAC", "192.168.1.5/24". */
export function describeIp(value: string, v6 = false): string {
  if (!value) return '无'
  if (value === 'dhcp') return 'DHCP'
  if (value === 'auto' && v6) return 'SLAAC'
  if (value === 'manual') return '手动'
  return value
}

export interface LiveAddress {
  address: string
  family: 4 | 6
  /** Matches the configured static address. */
  static: boolean
  /** fe80::/10, not interesting for most users. */
  linkLocal: boolean
}

/** Addresses the running container reports for a NIC (matched by MAC). */
export function liveAddresses(net: LxcNet, interfaces: readonly LxcInterface[] | undefined): LiveAddress[] | null {
  if (!interfaces || !net.hwaddr) return null
  const mac = net.hwaddr.toLowerCase()
  const iface = interfaces.find((i) => (i['hardware-address'] ?? i.hwaddr ?? '').toLowerCase() === mac)
  if (!iface) return null
  return (iface['ip-addresses'] ?? []).map((a) => {
    const address = `${a['ip-address']}/${a.prefix}`
    const family = a['ip-address-type'] === 'inet6' ? 6 : 4
    return {
      address,
      family,
      static: address === (family === 4 ? net.ip : net.ip6),
      linkLocal: family === 6 && /^fe[89ab]/i.test(a['ip-address']),
    }
  })
}

// --------------------------------------------------------- mount points

export type MountKind = 'volume' | 'bind' | 'device'

export interface LxcMount extends PropertyMap {
  volume: string
}

/** rootfs / mp[n] / unused[n] → map with `volume` (the bare first value). */
export function parseLxcMount(value: string | null | undefined): LxcMount {
  const p = tryParsePropertyString(value, 'volume')
  return { ...p, volume: p.volume ?? '' }
}

/** Storage volume ("local-lvm:vm-100-disk-0"), bind mount ("/srv/data") or device ("/dev/sdb1"). */
export function mountKind(volume: string): MountKind {
  if (/^[a-z][a-z0-9\-_.]*[a-z0-9]:/i.test(volume)) return 'volume'
  if (volume.startsWith('/dev/')) return 'device'
  return 'bind'
}

export const MOUNT_OPTIONS = ['discard', 'lazytime', 'noatime', 'nodev', 'noexec', 'nosuid'] as const
/** rootfs cannot use nodev/noexec. */
export const ROOTFS_MOUNT_OPTIONS = ['discard', 'lazytime', 'noatime', 'nosuid'] as const

export interface MountForm {
  /** Only for a new mount point: allocate a volume or bind a host path. */
  kind: 'volume' | 'bind'
  storage: string
  /** New volume size in GiB. */
  sizeGiB: number | undefined
  hostPath: string
  /** Path inside the container (mp=). */
  mp: string
  backup: boolean
  ro: boolean
  quota: boolean
  /** '' = default, '1' / '0'. */
  acl: '' | '1' | '0'
  mountoptions: string[]
  skipReplication: boolean
  keepattrs: boolean
  shared: boolean
  idmap: string
}

export function newMountForm(): MountForm {
  return {
    kind: 'volume',
    storage: '',
    sizeGiB: 8,
    hostPath: '',
    mp: '',
    backup: true,
    ro: false,
    quota: false,
    acl: '',
    mountoptions: [],
    skipReplication: false,
    keepattrs: false,
    shared: false,
    idmap: '',
  }
}

export function mountToForm(value: string): MountForm {
  const m = parseLxcMount(value)
  const kind = mountKind(m.volume)
  return {
    kind: kind === 'volume' ? 'volume' : 'bind',
    storage: kind === 'volume' ? m.volume.slice(0, m.volume.indexOf(':')) : '',
    sizeGiB: undefined,
    hostPath: kind === 'volume' ? '' : m.volume,
    mp: m.mp ?? '',
    backup: propBool(m.backup),
    ro: propBool(m.ro),
    quota: propBool(m.quota),
    acl: m.acl === '1' || m.acl === '0' ? m.acl : '',
    mountoptions: parseListValue(m.mountoptions),
    skipReplication: m.replicate === '0',
    keepattrs: propBool(m.keepattrs),
    shared: propBool(m.shared),
    idmap: m.idmap ?? '',
  }
}

export interface MountTarget {
  /** 'rootfs', 'mp3' … */
  key: string
  /** Existing value being edited (rootfs / mp[n]); keeps unknown keys and size. */
  previous?: string
  /** Attach an unused volume: its volume id. */
  volume?: string
}

/**
 * Form → rootfs / mp[n] value. New volumes are "<storage>:<GiB>", bind
 * mounts the host path; edits keep the volume and size of `previous`.
 */
export function formToMount(form: MountForm, target: MountTarget): string {
  const isRoot = target.key === 'rootfs'
  const prev = target.previous ? parseLxcMount(target.previous) : null
  let volume: string
  if (prev) volume = prev.volume
  else if (target.volume) volume = target.volume
  else if (form.kind === 'bind') volume = form.hostPath.trim()
  else volume = `${form.storage}:${form.sizeGiB ?? ''}`
  const kind = mountKind(volume)
  const allowed: readonly string[] = isRoot ? ROOTFS_MOUNT_OPTIONS : MOUNT_OPTIONS
  const opts = form.mountoptions.filter((o) => allowed.includes(o))
  const quotaAllowed = kind === 'volume'
  const patch: Record<string, PropertyValue> = {
    volume,
    mp: isRoot ? null : form.mp.trim(),
    backup: isRoot || kind !== 'volume' ? (prev?.backup ?? null) : form.backup ? 1 : null,
    ro: isRoot ? (prev?.ro ?? null) : form.ro ? 1 : null,
    quota: quotaAllowed && form.quota ? 1 : null,
    acl: kind === 'bind' ? null : form.acl || null,
    mountoptions: opts,
    replicate: form.skipReplication ? 0 : null,
    keepattrs: isRoot ? null : form.keepattrs ? 1 : null,
    shared: kind === 'volume' ? (prev?.shared ?? null) : form.shared ? 1 : null,
    idmap: form.idmap.trim() || null,
  }
  const base: Record<string, PropertyValue> = prev ? { ...prev } : {}
  for (const [k, v] of Object.entries(patch)) base[k] = v
  return stringifyPropertyString(base, 'volume')
}

export function validateMountForm(
  form: MountForm,
  opts: { isRoot: boolean; isCreate: boolean; otherPaths: readonly string[] },
): Partial<Record<keyof MountForm, string>> {
  const e: Partial<Record<keyof MountForm, string>> = {}
  if (opts.isCreate) {
    if (form.kind === 'volume') {
      if (!form.storage) e.storage = '请选择存储'
      if (form.sizeGiB === undefined || !(form.sizeGiB > 0)) e.sizeGiB = '请填写大于 0 的大小'
    } else if (!form.hostPath.trim().startsWith('/')) {
      e.hostPath = '请填写主机上的绝对路径'
    }
  }
  if (!opts.isRoot) {
    const mp = form.mp.trim()
    if (!mp) e.mp = '请填写容器内的挂载路径'
    else if (!mp.startsWith('/')) e.mp = '必须是绝对路径，如 /data'
    else if (mp === '/') e.mp = '不能挂载到根目录'
    else if (/[,=]/.test(mp)) e.mp = '路径不能包含逗号或等号'
    else if (opts.otherPaths.includes(mp.replace(/\/+$/, ''))) e.mp = '这个路径已被其他挂载点使用'
  }
  if (form.idmap.trim() && form.idmap.trim() !== 'passthrough' && !parseIdMap(form.idmap)) {
    e.idmap = 'ID 映射格式无效'
  }
  return e
}

/** Size of a mount (from size=…), formatted; '' when unknown. */
export function mountSize(m: PropertyMap): string {
  const bytes = parsePveSize(m.size)
  return bytes === null ? '' : formatBytes(bytes)
}

/** "local-lvm:vm-200-disk-0" → { storage: 'local-lvm', name: 'vm-200-disk-0' }. */
export function splitVolume(volume: string): { storage: string | null; name: string } {
  if (mountKind(volume) !== 'volume') return { storage: null, name: volume }
  const i = volume.indexOf(':')
  return { storage: volume.slice(0, i), name: volume.slice(i + 1) }
}

/** Flags worth showing next to a mount: 备份, 只读, ACL… */
export function mountFlags(m: PropertyMap, isRoot: boolean): string[] {
  const out: string[] = []
  const kind = mountKind(m.volume ?? '')
  if (!isRoot && kind === 'volume') out.push(propBool(m.backup) ? '备份' : '不备份')
  if (propBool(m.ro)) out.push('只读')
  if (m.acl === '1') out.push('ACL')
  if (m.acl === '0') out.push('ACL 关')
  if (propBool(m.quota)) out.push('配额')
  if (m.replicate === '0') out.push('跳过复制')
  if (propBool(m.shared)) out.push('共享')
  if (m.idmap) out.push(m.idmap === 'passthrough' ? 'ID 直通' : 'ID 映射')
  out.push(...parseListValue(m.mountoptions))
  return out
}

// --------------------------------------------------------------- idmap

export interface IdMapEntry {
  type: 'u' | 'g'
  ct: number
  host: number
  length: number
}

/** "u:0:100000:65536;g:0:100000:65536" → entries; null when malformed; [] for empty. */
export function parseIdMap(value: string | null | undefined): IdMapEntry[] | null {
  if (!value || !value.trim()) return []
  const out: IdMapEntry[] = []
  for (const part of value.split(';')) {
    const m = /^([ug]):(\d+):(\d+):(\d+)$/.exec(part.trim())
    if (!m) return null
    out.push({ type: m[1] as 'u' | 'g', ct: Number(m[2]), host: Number(m[3]), length: Number(m[4]) })
  }
  return out
}

export function stringifyIdMap(entries: readonly IdMapEntry[]): string {
  return entries.map((e) => `${e.type}:${e.ct}:${e.host}:${e.length}`).join(';')
}

// -------------------------------------------------------------- devices

export interface DeviceForm {
  path: string
  uid: number | undefined
  gid: number | undefined
  mode: string
  denyWrite: boolean
}

export function deviceToForm(value: string | undefined): DeviceForm {
  const d = tryParsePropertyString(value, 'path')
  return {
    path: d.path ?? '',
    uid: propNumber(d.uid),
    gid: propNumber(d.gid),
    mode: d.mode ?? '',
    denyWrite: propBool(d['deny-write']),
  }
}

export function formToDevice(form: DeviceForm): string {
  return stringifyPropertyString(
    {
      path: form.path.trim(),
      'deny-write': form.denyWrite ? 1 : null,
      gid: form.gid,
      mode: form.mode.trim(),
      uid: form.uid,
    },
    'path',
  )
}

export function validateDeviceForm(form: DeviceForm): Partial<Record<keyof DeviceForm, string>> {
  const e: Partial<Record<keyof DeviceForm, string>> = {}
  const path = form.path.trim()
  if (!path.startsWith('/dev/') || path.length <= 5) e.path = '路径必须以 /dev/ 开头'
  else if (/[,=\s]/.test(path)) e.path = '路径不能包含逗号、等号或空格'
  if (form.mode.trim() && !/^0[0-7]{3}$/.test(form.mode.trim())) e.mode = '八进制权限，如 0660'
  if (form.uid !== undefined && form.uid < 0) e.uid = '不能为负数'
  if (form.gid !== undefined && form.gid < 0) e.gid = '不能为负数'
  return e
}

// ------------------------------------------------------------- startup

export interface Startup {
  order: number | undefined
  up: number | undefined
  down: number | undefined
}

/** "order=2,up=30" or "2,up=30" → { order: 2, up: 30 }. */
export function parseStartup(value: string | null | undefined): Startup {
  const p = tryParsePropertyString(value, 'order')
  return { order: propNumber(p.order), up: propNumber(p.up), down: propNumber(p.down) }
}

export function stringifyStartup(s: Startup): string {
  return stringifyPropertyString({ order: s.order, up: s.up, down: s.down })
}

export function describeStartup(value: string | undefined): string {
  if (!value) return '默认（顺序不限）'
  const s = parseStartup(value)
  const parts = [`顺序 ${s.order ?? '不限'}`]
  if (s.up !== undefined) parts.push(`启动后等待 ${s.up} 秒`)
  if (s.down !== undefined) parts.push(`关机超时 ${s.down} 秒`)
  return parts.join(' · ')
}

// ------------------------------------------------------------ features

export interface Features {
  nesting: boolean
  keyctl: boolean
  fuse: boolean
  mknod: boolean
  forceRwSys: boolean
  nfs: boolean
  cifs: boolean
  /** Other mount fs types (kept as they are). */
  otherMounts: string[]
}

export function parseFeatures(value: string | null | undefined): Features {
  const p = tryParsePropertyString(value)
  const mounts = (p.mount ?? '').split(/[;\s]+/).filter(Boolean)
  return {
    nesting: propBool(p.nesting),
    keyctl: propBool(p.keyctl),
    fuse: propBool(p.fuse),
    mknod: propBool(p.mknod),
    forceRwSys: propBool(p.force_rw_sys),
    nfs: mounts.includes('nfs'),
    cifs: mounts.includes('cifs'),
    otherMounts: mounts.filter((m) => m !== 'nfs' && m !== 'cifs'),
  }
}

/** '' when nothing is enabled (the caller deletes `features`). */
export function stringifyFeatures(f: Features): string {
  const mounts = [...f.otherMounts, ...(f.nfs ? ['nfs'] : []), ...(f.cifs ? ['cifs'] : [])]
  return stringifyPropertyString({
    force_rw_sys: f.forceRwSys ? 1 : null,
    fuse: f.fuse ? 1 : null,
    keyctl: f.keyctl ? 1 : null,
    mknod: f.mknod ? 1 : null,
    mount: mounts,
    nesting: f.nesting ? 1 : null,
  })
}

export function describeFeatures(value: string | undefined): string {
  if (!value) return '无'
  const f = parseFeatures(value)
  const out: string[] = []
  if (f.nesting) out.push('嵌套')
  if (f.keyctl) out.push('keyctl')
  if (f.fuse) out.push('FUSE')
  if (f.mknod) out.push('mknod')
  if (f.forceRwSys) out.push('force_rw_sys')
  const mounts = [...(f.nfs ? ['NFS'] : []), ...(f.cifs ? ['CIFS'] : []), ...f.otherMounts]
  if (mounts.length) out.push(`挂载 ${mounts.join('/')}`)
  return out.length ? out.join('、') : '无'
}

// ------------------------------------------------------------------ env

export interface EnvVar {
  name: string
  value: string
}

/** NUL separated "KEY=value" list → pairs (empty entries skipped). */
export function parseEnv(value: string | null | undefined): EnvVar[] {
  if (!value) return []
  return value
    .split(/\0+/)
    .filter(Boolean)
    .map((item) => {
      const i = item.indexOf('=')
      return i === -1 ? { name: item, value: '' } : { name: item.slice(0, i), value: item.slice(i + 1) }
    })
}

/** Pairs → NUL separated list; rows without a name are dropped. */
export function stringifyEnv(vars: readonly EnvVar[]): string {
  return vars
    .filter((v) => v.name.trim())
    .map((v) => `${v.name.trim()}=${v.value}`)
    .join('\0')
}

/** Per-row error (index → message). */
export function validateEnv(vars: readonly EnvVar[]): Record<number, string> {
  const errors: Record<number, string> = {}
  const seen = new Set<string>()
  vars.forEach((v, i) => {
    const name = v.name.trim()
    if (!name) {
      if (v.value) errors[i] = '请填写变量名'
      return
    }
    if (!/^\w+$/.test(name)) errors[i] = '变量名只能包含字母、数字和下划线'
    else if (/[\x00-\x08\x0a-\x1f\x7f]/.test(v.value)) errors[i] = '值不能包含控制字符'
    else if (seen.has(name)) errors[i] = '变量名重复'
    seen.add(name)
  })
  return errors
}

// ------------------------------------------------------- misc display

export const OSTYPES = [
  'alpine',
  'archlinux',
  'centos',
  'debian',
  'devuan',
  'fedora',
  'gentoo',
  'nixos',
  'opensuse',
  'ubuntu',
  'unmanaged',
] as const

export const ARCHES = ['amd64', 'arm64', 'armhf', 'i386', 'riscv32', 'riscv64'] as const

export const CMODE_LABEL: Record<string, string> = {
  tty: '/dev/tty[X]',
  console: '/dev/console',
  shell: 'shell（不登录）',
}

/** CPU weight default and maximum by the node's cgroup version. */
export function cpuUnitsRange(cgroupMode: number | undefined): { def: number; max: number } {
  return cgroupMode === 1 ? { def: 1024, max: 500000 } : { def: 100, max: 10000 }
}

/** Parameters for a config PUT built from a single changed key (used by the inline switches). */
export function boolParam(value: boolean, def: boolean): string | null {
  return value === def ? null : value ? '1' : '0'
}

/** Keys of the config that are disks (rootfs, mp[n], unused[n]) in display order. */
export function diskKeys(config: Record<string, unknown>): string[] {
  return [
    ...('rootfs' in config ? ['rootfs'] : []),
    ...keysWithPrefix(config, 'mp'),
    ...keysWithPrefix(config, 'unused'),
  ]
}

/** Paths (mp=) used by other mount points, without trailing "/". */
export function mountPaths(config: Record<string, string>, except?: string): string[] {
  return keysWithPrefix(config, 'mp')
    .filter((k) => k !== except)
    .map((k) => parseLxcMount(config[k]).mp?.replace(/\/+$/, '') ?? '')
    .filter(Boolean)
}

/** NIC names used by other net[n]. */
export function netNames(config: Record<string, string>, except?: string): string[] {
  return keysWithPrefix(config, 'net')
    .filter((k) => k !== except)
    .map((k) => parseLxcNet(config[k]).name)
    .filter(Boolean)
}

