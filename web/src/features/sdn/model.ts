// Form ↔ API parameter mapping for every SDN object (pure, unit-tested).
// Field sets follow the official editors (pvemanagerlib.js PVE.sdn.*) and the
// API schema of PVE 9.2 (`pvesh usage /cluster/sdn/... -v`).

import type { Params } from '@/api/client'
import type {
  ControllerType,
  DhcpRange,
  FabricProtocol,
  IpamEntry,
  IpamType,
  PrefixListEntry,
  RouteMapEntry,
  SdnController,
  SdnDns,
  SdnFabric,
  SdnFabricNode,
  SdnIpam,
  SdnSubnet,
  SdnVnet,
  SdnZone,
  ZoneType,
} from '@/api/sdn'
import { configUpdateParams, tryParsePropertyString, type ConfigValues } from '@/lib/propstring'

// ------------------------------------------------------------------ helpers

export type FormValues = Record<string, string | boolean>

/** Text of a config value for a form field. */
export function str(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (Array.isArray(v)) return v.join(',')
  return String(v)
}

/** PVE boolean (1/"1"/true) → checkbox. */
export function flag(v: unknown): boolean {
  return v === 1 || v === '1' || v === true
}

/** Form values → config values: trimmed strings, booleans as 1 or '' (= unset). */
function toConfig(form: FormValues, keys: readonly string[]): ConfigValues {
  const out: ConfigValues = {}
  for (const k of keys) {
    const v = form[k]
    out[k] = typeof v === 'boolean' ? (v ? 1 : '') : (v ?? '').trim()
  }
  return out
}

/** Create: drop empty values. */
function nonEmpty(values: ConfigValues): Params {
  const out: Params = {}
  for (const [k, v] of Object.entries(values)) if (v !== '' && v !== undefined && v !== null) out[k] = v
  return out
}

/** "a, b  c" → "a,b,c" (PVE lists of nodes / peers). */
export function normalizeList(v: string): string {
  return v
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',')
}

export function splitList(v: unknown): string[] {
  return normalizeList(str(v)).split(',').filter(Boolean)
}

/** IDs: letter first, letters/digits, max 8 (zones, vnets, ipams, dns). */
export function validateSdnId(id: string, max = 8): string | null {
  if (!id) return '必填'
  if (id.length < 2) return '至少 2 个字符'
  if (id.length > max) return `最多 ${max} 个字符`
  if (!/^[a-zA-Z][a-zA-Z0-9]*[a-zA-Z0-9]$/.test(id)) return '以字母开头，只能包含字母和数字'
  return null
}

/** Fabric IDs: letters, digits and "-", 2–8 characters. */
export function validateFabricId(id: string): string | null {
  if (!id) return '必填'
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,6}[a-zA-Z0-9]$/.test(id)) return '2–8 个字符：字母、数字和 -（不能以 - 开头或结尾）'
  return null
}

// --------------------------------------------------------------------- zones

export const ZONE_TYPES: readonly { type: ZoneType; label: string; hint: string }[] = [
  { type: 'simple', label: 'Simple', hint: '隔离的三层网桥，可做 SNAT 和自动 DHCP' },
  { type: 'vlan', label: 'VLAN', hint: '在已有网桥上按 VLAN 标签隔离' },
  { type: 'qinq', label: 'QinQ', hint: '外层服务 VLAN 套内层 VLAN' },
  { type: 'vxlan', label: 'VXLAN', hint: '节点之间的二层 VXLAN 隧道' },
  { type: 'evpn', label: 'EVPN', hint: 'BGP EVPN 控制面的 VXLAN 三层网络' },
]

export function zoneTypeLabel(t: string | undefined): string {
  return ZONE_TYPES.find((z) => z.type === t)?.label ?? (t === 'faucet' ? 'Faucet' : (t ?? '—'))
}

const ZONE_COMMON = ['mtu', 'nodes', 'ipam', 'dns', 'reversedns', 'dnszone'] as const

/** Type-specific keys of each zone type. */
export const ZONE_FIELDS: Record<ZoneType, readonly string[]> = {
  simple: ['dhcp'],
  vlan: ['bridge'],
  qinq: ['bridge', 'tag', 'vlan-protocol'],
  vxlan: ['peers', 'fabric', 'vxlan-port'],
  evpn: [
    'controller',
    'vrf-vxlan',
    'mac',
    'exitnodes',
    'exitnodes-primary',
    'exitnodes-local-routing',
    'advertise-subnets',
    'disable-arp-nd-suppression',
    'rt-import',
    'secondary-controllers',
  ],
  faucet: [],
}

const ZONE_BOOLS = new Set(['exitnodes-local-routing', 'advertise-subnets', 'disable-arp-nd-suppression'])

export function zoneForm(zone: Partial<SdnZone> | undefined, type: ZoneType): FormValues {
  const f: FormValues = { zone: str(zone?.zone), ipam: zone ? str(zone.ipam) : 'pve' }
  for (const k of [...ZONE_COMMON, ...ZONE_FIELDS[type]]) {
    if (k === 'ipam') continue
    f[k] = ZONE_BOOLS.has(k) ? flag(zone?.[k]) : k === 'dhcp' ? zone?.dhcp === 'dnsmasq' : str(zone?.[k])
  }
  if (type === 'qinq' && !f['vlan-protocol']) f['vlan-protocol'] = ''
  return f
}

function zoneValues(type: ZoneType, form: FormValues): ConfigValues {
  const keys = [...ZONE_COMMON, ...ZONE_FIELDS[type]]
  const v = toConfig(form, keys)
  if ('dhcp' in v) v.dhcp = v.dhcp ? 'dnsmasq' : ''
  for (const k of ['nodes', 'exitnodes', 'peers', 'secondary-controllers']) if (typeof v[k] === 'string') v[k] = normalizeList(v[k] as string)
  return v
}

/** Validation errors by field (empty = valid). */
export function validateZone(type: ZoneType, form: FormValues, create: boolean): Record<string, string> {
  const e: Record<string, string> = {}
  if (create) {
    const idErr = validateSdnId(str(form.zone))
    if (idErr) e.zone = idErr
  }
  const num = (k: string, min: number, max: number) => {
    const v = str(form[k]).trim()
    if (v && (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max)) e[k] = `${min}–${max}`
  }
  num('mtu', 100, 65000)
  if ((type === 'vlan' || type === 'qinq') && !str(form.bridge).trim()) e.bridge = '必填'
  if (type === 'qinq') {
    if (!str(form.tag).trim()) e.tag = '必填'
    num('tag', 0, 4096)
  }
  if (type === 'vxlan') num('vxlan-port', 1, 65536)
  if (type === 'evpn') {
    if (!str(form.controller)) e.controller = '必填'
    if (!str(form['vrf-vxlan']).trim()) e['vrf-vxlan'] = '必填'
    num('vrf-vxlan', 1, 16777215)
    const mac = str(form.mac).trim()
    if (mac && !/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(mac)) e.mac = 'MAC 地址格式：XX:XX:XX:XX:XX:XX'
  }
  if (!str(form.ipam)) e.ipam = '必填'
  return e
}

export function zoneCreateParams(type: ZoneType, form: FormValues): Params {
  return { type, zone: str(form.zone).trim(), ...nonEmpty(zoneValues(type, form)) }
}

/** PUT parameters (only changes; null = nothing changed). */
export function zoneUpdateParams(before: SdnZone, form: FormValues): Params | null {
  return configUpdateParams(before as ConfigValues, zoneValues(before.type, form), { digest: before.digest })
}

// --------------------------------------------------------------------- vnets

/** Whether a VNet in a zone of this type has (and needs) a tag. */
export function vnetTagMode(zoneType: string | undefined): 'none' | 'optional' | 'required' {
  if (!zoneType || zoneType === 'simple') return 'none'
  return zoneType === 'qinq' || zoneType === 'faucet' ? 'optional' : 'required'
}

export function vnetTagLabel(zoneType: string | undefined): string {
  return zoneType === 'vxlan' || zoneType === 'evpn' ? 'VXLAN VNI' : 'VLAN 标签'
}

export function vnetForm(v: Partial<SdnVnet> | undefined): FormValues {
  return {
    vnet: str(v?.vnet),
    alias: str(v?.alias),
    zone: str(v?.zone),
    tag: str(v?.tag),
    vlanaware: flag(v?.vlanaware),
    'isolate-ports': flag(v?.['isolate-ports']),
  }
}

function vnetValues(form: FormValues, zoneType: string | undefined): ConfigValues {
  const v = toConfig(form, ['alias', 'zone', 'tag', 'vlanaware', 'isolate-ports'])
  if (vnetTagMode(zoneType) === 'none') v.tag = ''
  if (!zoneType || zoneType === 'evpn') v.vlanaware = ''
  return v
}

export function validateVnet(form: FormValues, zoneType: string | undefined, create: boolean): Record<string, string> {
  const e: Record<string, string> = {}
  if (create) {
    const idErr = validateSdnId(str(form.vnet))
    if (idErr) e.vnet = idErr
  }
  if (!str(form.zone)) e.zone = '必填'
  const tag = str(form.tag).trim()
  const mode = vnetTagMode(zoneType)
  if (mode === 'required' && !tag) e.tag = '必填'
  if (mode !== 'none' && tag && (!/^\d+$/.test(tag) || Number(tag) < 1 || Number(tag) > 16777215)) e.tag = '1–16777215'
  if (str(form.alias).length > 256) e.alias = '最多 256 个字符'
  return e
}

export function vnetCreateParams(form: FormValues, zoneType: string | undefined): Params {
  return { type: 'vnet', vnet: str(form.vnet).trim(), ...nonEmpty(vnetValues(form, zoneType)) }
}

export function vnetUpdateParams(before: SdnVnet, form: FormValues, zoneType: string | undefined): Params | null {
  return configUpdateParams(before as ConfigValues, vnetValues(form, zoneType), { digest: before.digest })
}

// -------------------------------------------------------------------- subnets

/** DHCP ranges come as objects (GET one subnet) or property strings (pending lists). */
export function parseDhcpRanges(v: unknown): DhcpRange[] {
  if (!Array.isArray(v)) return []
  return v
    .map((r): DhcpRange => {
      if (typeof r === 'string') {
        const m = tryParsePropertyString(r)
        return { 'start-address': m['start-address'] ?? '', 'end-address': m['end-address'] ?? '' }
      }
      const o = r as Partial<DhcpRange>
      return { 'start-address': o['start-address'] ?? '', 'end-address': o['end-address'] ?? '' }
    })
    .filter((r) => r['start-address'] || r['end-address'])
}

export function formatDhcpRange(r: DhcpRange): string {
  return `start-address=${r['start-address'].trim()},end-address=${r['end-address'].trim()}`
}

export interface SubnetForm {
  cidr: string
  gateway: string
  snat: boolean
  dnszoneprefix: string
  'dhcp-dns-server': string
  ranges: DhcpRange[]
}

export function subnetForm(s: Partial<SdnSubnet> | undefined): SubnetForm {
  return {
    cidr: str(s?.cidr),
    gateway: str(s?.gateway),
    snat: flag(s?.snat),
    dnszoneprefix: str(s?.dnszoneprefix),
    'dhcp-dns-server': str(s?.['dhcp-dns-server']),
    ranges: parseDhcpRanges(s?.['dhcp-range']),
  }
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
const IPV6 = /^[0-9a-fA-F:]+(:[0-9a-fA-F.]+)?$/

export function isIp(v: string): boolean {
  return IPV4.test(v) || (v.includes(':') && IPV6.test(v))
}

export function isCidr(v: string): boolean {
  const [ip, mask, extra] = v.split('/')
  if (extra !== undefined || !ip || !mask || !/^\d+$/.test(mask)) return false
  return IPV4.test(ip) ? Number(mask) <= 32 : isIp(ip) && Number(mask) <= 128
}

export function validateSubnet(f: SubnetForm, create: boolean): Record<string, string> {
  const e: Record<string, string> = {}
  if (create && !isCidr(f.cidr.trim())) e.subnet = 'CIDR，例如 10.0.0.0/24'
  if (f.gateway.trim() && !isIp(f.gateway.trim())) e.gateway = 'IP 地址'
  if (f['dhcp-dns-server'].trim() && !isIp(f['dhcp-dns-server'].trim())) e['dhcp-dns-server'] = 'IP 地址'
  f.ranges.forEach((r, i) => {
    if (!isIp(r['start-address'].trim()) || !isIp(r['end-address'].trim())) e[`range-${i}`] = '起止都要填 IP 地址'
  })
  return e
}

function subnetValues(f: SubnetForm): ConfigValues {
  return toConfig({ gateway: f.gateway, snat: f.snat, dnszoneprefix: f.dnszoneprefix, 'dhcp-dns-server': f['dhcp-dns-server'] }, [
    'gateway',
    'snat',
    'dnszoneprefix',
    'dhcp-dns-server',
  ])
}

export function subnetCreateParams(f: SubnetForm): Params {
  const ranges = f.ranges.map(formatDhcpRange)
  return {
    type: 'subnet',
    subnet: f.cidr.trim(),
    ...nonEmpty(subnetValues(f)),
    ...(ranges.length ? { 'dhcp-range': ranges } : {}),
  }
}

export function subnetUpdateParams(before: SdnSubnet, f: SubnetForm): Params | null {
  const params = configUpdateParams(before as ConfigValues, subnetValues(f), { digest: before.digest }) ?? {}
  const old = parseDhcpRanges(before['dhcp-range']).map(formatDhcpRange)
  const next = f.ranges.map(formatDhcpRange)
  if (old.join('|') !== next.join('|')) {
    if (next.length) params['dhcp-range'] = next
    else params.delete = [params.delete, 'dhcp-range'].filter(Boolean).join(',')
  }
  const keys = Object.keys(params).filter((k) => k !== 'digest')
  if (!keys.length) return null
  return before.digest ? { ...params, digest: before.digest } : params
}

// ---------------------------------------------------------------- controllers

export const CONTROLLER_TYPES: readonly { type: ControllerType; label: string; hint: string }[] = [
  { type: 'evpn', label: 'EVPN', hint: 'EVPN Zone 的 BGP EVPN 控制面' },
  { type: 'bgp', label: 'BGP', hint: '节点到外部路由器的 BGP 对等' },
  { type: 'isis', label: 'IS-IS', hint: '节点的 IS-IS 底层路由' },
]

export const CONTROLLER_FIELDS: Record<ControllerType, readonly string[]> = {
  evpn: ['asn', 'peers', 'fabric', 'nodes', 'route-map-in', 'route-map-out', 'peer-group-name', 'bgp-mode', 'ebgp-multihop'],
  bgp: ['node', 'asn', 'peers', 'ebgp', 'loopback', 'ebgp-multihop', 'bgp-multipath-as-path-relax', 'route-map-in', 'route-map-out'],
  isis: ['node', 'isis-domain', 'isis-net', 'isis-ifaces', 'loopback'],
  faucet: [],
}

const CONTROLLER_BOOLS = new Set(['ebgp', 'bgp-multipath-as-path-relax'])

export function controllerForm(c: Partial<SdnController> | undefined, type: ControllerType): FormValues {
  const f: FormValues = { controller: str(c?.controller) }
  for (const k of CONTROLLER_FIELDS[type]) f[k] = CONTROLLER_BOOLS.has(k) ? flag(c?.[k]) : str(c?.[k])
  if (!c && (type === 'evpn' || type === 'bgp')) f.asn = '65000'
  return f
}

/** BGP and IS-IS controllers are per node; their ID is derived (official UI: "bgp<node>"). */
export function controllerId(type: ControllerType, form: FormValues): string {
  return type === 'bgp' || type === 'isis' ? `${type}${str(form.node)}` : str(form.controller).trim()
}

function controllerValues(type: ControllerType, form: FormValues): ConfigValues {
  const v = toConfig(form, CONTROLLER_FIELDS[type])
  for (const k of ['peers', 'nodes', 'isis-ifaces']) if (typeof v[k] === 'string') v[k] = normalizeList(v[k] as string)
  return v
}

export function validateController(type: ControllerType, form: FormValues, create: boolean): Record<string, string> {
  const e: Record<string, string> = {}
  if (create && type === 'evpn') {
    const id = str(form.controller)
    if (!id) e.controller = '必填'
    else if (!/^[a-zA-Z][a-zA-Z0-9_-]*[a-zA-Z0-9]$/.test(id) || id.length > 64) e.controller = '以字母开头，字母、数字、_ 和 -'
  }
  if ((type === 'bgp' || type === 'isis') && !str(form.node)) e.node = '必填'
  if (type !== 'isis') {
    const asn = str(form.asn).trim()
    if (!asn) e.asn = '必填'
    else if (!/^\d+$/.test(asn) || Number(asn) < 1 || Number(asn) > 4294967295) e.asn = '1–4294967295'
  }
  if (type === 'bgp' && !str(form.peers).trim()) e.peers = '必填'
  if (type === 'isis') {
    if (!str(form['isis-domain']).trim()) e['isis-domain'] = '必填'
    const net = str(form['isis-net']).trim()
    if (!net) e['isis-net'] = '必填'
    else if (!/^[a-fA-F0-9]{2}(\.[a-fA-F0-9]{4}){3,9}\.[a-fA-F0-9]{2}$/.test(net)) e['isis-net'] = '例如 49.0001.1921.6800.1001.00'
    if (!str(form['isis-ifaces']).trim()) e['isis-ifaces'] = '必填'
  }
  const hops = str(form['ebgp-multihop']).trim()
  if (hops && (!/^\d+$/.test(hops) || Number(hops) < 1 || Number(hops) > 100)) e['ebgp-multihop'] = '1–100'
  return e
}

export function controllerCreateParams(type: ControllerType, form: FormValues): Params {
  return { type, controller: controllerId(type, form), ...nonEmpty(controllerValues(type, form)) }
}

export function controllerUpdateParams(before: SdnController, form: FormValues): Params | null {
  const values = controllerValues(before.type, form)
  delete values.node // part of the ID
  return configUpdateParams(before as ConfigValues, values, { digest: before.digest })
}

// ------------------------------------------------------------- IPAM and DNS

export const IPAM_TYPES: readonly { type: IpamType; label: string }[] = [
  { type: 'pve', label: 'PVE' },
  { type: 'netbox', label: 'NetBox' },
  { type: 'phpipam', label: 'phpIPAM' },
]

export const IPAM_FIELDS: Record<IpamType, readonly string[]> = {
  pve: [],
  netbox: ['url', 'token', 'fingerprint'],
  phpipam: ['url', 'token', 'section', 'fingerprint'],
}

export function ipamForm(i: Partial<SdnIpam> | undefined, type: IpamType): FormValues {
  const f: FormValues = { ipam: str(i?.ipam) }
  for (const k of IPAM_FIELDS[type]) f[k] = str(i?.[k])
  return f
}

const FINGERPRINT = /^([A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/

export function validateIpam(type: IpamType, form: FormValues, create: boolean): Record<string, string> {
  const e: Record<string, string> = {}
  if (create) {
    const idErr = validateSdnId(str(form.ipam), 64)
    if (idErr) e.ipam = idErr
  }
  if (type !== 'pve') {
    if (!str(form.url).trim()) e.url = '必填'
    if (!str(form.token).trim()) e.token = '必填'
  }
  if (type === 'phpipam' && !/^\d+$/.test(str(form.section).trim())) e.section = '必填，数字'
  const fp = str(form.fingerprint).trim()
  if (fp && !FINGERPRINT.test(fp)) e.fingerprint = 'SHA-256 指纹（32 组冒号分隔的十六进制）'
  return e
}

export function ipamCreateParams(type: IpamType, form: FormValues): Params {
  return { type, ipam: str(form.ipam).trim(), ...nonEmpty(toConfig(form, IPAM_FIELDS[type])) }
}

export function ipamUpdateParams(before: SdnIpam, form: FormValues): Params | null {
  return configUpdateParams(before as ConfigValues, toConfig(form, IPAM_FIELDS[before.type]), { digest: before.digest })
}

const DNS_FIELDS = ['url', 'key', 'ttl', 'reversemaskv6', 'fingerprint'] as const

export function dnsForm(d: Partial<SdnDns> | undefined): FormValues {
  const f: FormValues = { dns: str(d?.dns) }
  for (const k of DNS_FIELDS) f[k] = str(d?.[k])
  return f
}

export function validateDns(form: FormValues, create: boolean): Record<string, string> {
  const e: Record<string, string> = {}
  if (create) {
    const idErr = validateSdnId(str(form.dns), 64)
    if (idErr) e.dns = idErr
  }
  if (!str(form.url).trim()) e.url = '必填'
  if (!str(form.key).trim()) e.key = '必填'
  for (const k of ['ttl', 'reversemaskv6']) {
    const v = str(form[k]).trim()
    if (v && !/^\d+$/.test(v)) e[k] = '整数'
  }
  const fp = str(form.fingerprint).trim()
  if (fp && !FINGERPRINT.test(fp)) e.fingerprint = 'SHA-256 指纹（32 组冒号分隔的十六进制）'
  return e
}

export function dnsCreateParams(form: FormValues): Params {
  return { type: 'powerdns', dns: str(form.dns).trim(), ...nonEmpty(toConfig(form, DNS_FIELDS)) }
}

export function dnsUpdateParams(before: SdnDns, form: FormValues): Params | null {
  return configUpdateParams(before as ConfigValues, toConfig(form, DNS_FIELDS), { digest: before.digest })
}

// ------------------------------------------------------------------- IPAM view

export interface IpamSubnetGroup {
  subnet: string
  entries: IpamEntry[]
}
export interface IpamVnetGroup {
  vnet: string
  zone: string
  subnets: IpamSubnetGroup[]
}
export interface IpamZoneGroup {
  zone: string
  vnets: IpamVnetGroup[]
}

function ipKey(ip: string): string {
  return ip.includes(':') ? ip : ip.split('.').map((x) => x.padStart(3, '0')).join('.')
}

/** PVE IPAM entries → zone / vnet / subnet tree (gateways first, then by IP). */
export function groupIpam(entries: readonly IpamEntry[]): IpamZoneGroup[] {
  const zones = new Map<string, Map<string, Map<string, IpamEntry[]>>>()
  for (const e of entries) {
    const vnets = zones.get(e.zone) ?? new Map<string, Map<string, IpamEntry[]>>()
    zones.set(e.zone, vnets)
    const subnets = vnets.get(e.vnet) ?? new Map<string, IpamEntry[]>()
    vnets.set(e.vnet, subnets)
    const list = subnets.get(e.subnet) ?? []
    subnets.set(e.subnet, list)
    list.push(e)
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
  return [...zones.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([zone, vnets]) => ({
      zone,
      vnets: [...vnets.entries()]
        .sort(([a], [b]) => cmp(a, b))
        .map(([vnet, subnets]) => ({
          vnet,
          zone,
          subnets: [...subnets.entries()]
            .sort(([a], [b]) => cmp(a, b))
            .map(([subnet, list]) => ({
              subnet,
              entries: [...list].sort((a, b) => Number(!!b.gateway) - Number(!!a.gateway) || ipKey(a.ip).localeCompare(ipKey(b.ip))),
            })),
        })),
    }))
}

export const MAC_RE = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/

// -------------------------------------------------------------------- fabrics

export const FABRIC_PROTOCOLS: readonly { protocol: FabricProtocol; label: string; hint: string }[] = [
  { protocol: 'openfabric', label: 'OpenFabric', hint: '基于 IS-IS 的全互联底层网络，适合节点直连' },
  { protocol: 'ospf', label: 'OSPF', hint: 'OSPFv2 底层路由（仅 IPv4）' },
  { protocol: 'bgp', label: 'BGP', hint: '无编号 BGP 底层（eBGP，每节点一个 ASN）' },
  { protocol: 'wireguard', label: 'WireGuard', hint: '节点之间的加密隧道' },
]

export function protocolLabel(p: string | undefined): string {
  return FABRIC_PROTOCOLS.find((x) => x.protocol === p)?.label ?? p ?? '—'
}

export function fabricHasIpv6(p: FabricProtocol): boolean {
  return p !== 'ospf'
}

export const FABRIC_FIELDS: Record<FabricProtocol, readonly string[]> = {
  openfabric: ['ip_prefix', 'ip6_prefix', 'hello_interval', 'csnp_interval', 'route_filter'],
  ospf: ['ip_prefix', 'area', 'route_filter'],
  bgp: ['ip_prefix', 'ip6_prefix'],
  wireguard: ['ip_prefix', 'ip6_prefix', 'persistent_keepalive'],
}

export const REDISTRIBUTE_SOURCES: Record<FabricProtocol, readonly string[]> = {
  openfabric: [],
  ospf: ['bgp', 'connected', 'kernel', 'static'],
  bgp: ['connected', 'kernel', 'ospf', 'static'],
  wireguard: [],
}

export interface Redistribution {
  source: string
  'route-map'?: string
}

export function parseRedistribute(v: unknown): Redistribution[] {
  if (!Array.isArray(v)) return []
  return v.map((s) => {
    const m = tryParsePropertyString(String(s))
    return m['route-map'] ? { source: m.source ?? '', 'route-map': m['route-map'] } : { source: m.source ?? '' }
  })
}

export function formatRedistribute(r: Redistribution): string {
  return r['route-map'] ? `source=${r.source},route-map=${r['route-map']}` : `source=${r.source}`
}

export interface FabricForm {
  id: string
  values: FormValues
  redistribute: Redistribution[]
}

export function fabricForm(f: Partial<SdnFabric> | undefined, protocol: FabricProtocol): FabricForm {
  const values: FormValues = {}
  for (const k of FABRIC_FIELDS[protocol]) values[k] = str(f?.[k])
  if (!f && protocol === 'ospf') values.area = '0'
  return { id: str(f?.id), values, redistribute: parseRedistribute(f?.redistribute) }
}

export function validateFabric(protocol: FabricProtocol, form: FabricForm, create: boolean): Record<string, string> {
  const e: Record<string, string> = {}
  if (create) {
    const idErr = validateFabricId(form.id.trim())
    if (idErr) e.id = idErr
  }
  const v4 = str(form.values.ip_prefix).trim()
  const v6 = str(form.values.ip6_prefix).trim()
  if (v4 && (!isCidr(v4) || v4.includes(':'))) e.ip_prefix = 'IPv4 CIDR，例如 10.10.0.0/24'
  if (v6 && (!isCidr(v6) || !v6.includes(':'))) e.ip6_prefix = 'IPv6 CIDR，例如 fd00:10::/64'
  if (!v4 && !v6) e.ip_prefix = fabricHasIpv6(protocol) ? '至少填写 IPv4 或 IPv6 前缀' : '必填'
  const range = (k: string, min: number, max: number) => {
    const s = str(form.values[k]).trim()
    if (s && (!/^\d+$/.test(s) || Number(s) < min || Number(s) > max)) e[k] = `${min}–${max}`
  }
  range('hello_interval', 1, 600)
  range('csnp_interval', 1, 600)
  range('persistent_keepalive', 0, 65535)
  if (protocol === 'ospf') {
    const area = str(form.values.area).trim()
    if (!area) e.area = '必填'
    else if (!/^\d+$/.test(area) && !IPV4.test(area)) e.area = '数字或 IPv4 形式（如 0 或 0.0.0.0）'
  }
  if (form.redistribute.some((r) => !r.source)) e.redistribute = '每一行都要选来源'
  return e
}

export function fabricCreateParams(protocol: FabricProtocol, form: FabricForm): Params {
  const params: Params = { id: form.id.trim(), protocol, ...nonEmpty(toConfig(form.values, FABRIC_FIELDS[protocol])) }
  if (REDISTRIBUTE_SOURCES[protocol].length && form.redistribute.length) params.redistribute = form.redistribute.map(formatRedistribute)
  return params
}

/** Fabric PUT: changed keys, `delete` as an array, always the protocol. */
export function fabricUpdateParams(before: SdnFabric, form: FabricForm): Params | null {
  const protocol = before.protocol
  const changed = configUpdateParams(before as ConfigValues, toConfig(form.values, FABRIC_FIELDS[protocol]))
  const params: Params = { ...(changed ?? {}) }
  const del = typeof params.delete === 'string' ? params.delete.split(',') : []
  delete params.delete
  if (REDISTRIBUTE_SOURCES[protocol].length) {
    const old = parseRedistribute(before.redistribute).map(formatRedistribute)
    const next = form.redistribute.map(formatRedistribute)
    if (old.join('|') !== next.join('|')) {
      if (next.length) params.redistribute = next
      else del.push('redistribute')
    }
  }
  if (del.length) params.delete = del
  if (Object.keys(params).length === 0) return null
  return { ...params, protocol, ...(before.digest ? { digest: before.digest } : {}) }
}

// ---------------------------------------------------------------- fabric nodes

export interface FabricInterfaceForm {
  name: string
  ip: string
  ip6: string
  /** OpenFabric only. */
  hello_multiplier: string
  /** WireGuard only. */
  listen_port: string
  /** Other keys of the property string, kept as they are (WireGuard public_key …). */
  extra: Record<string, string>
}

const IFACE_KNOWN = ['name', 'ip', 'ip6', 'hello_multiplier', 'listen_port'] as const

export function parseFabricInterface(s: string): FabricInterfaceForm {
  const m = tryParsePropertyString(s)
  const extra: Record<string, string> = {}
  for (const [k, v] of Object.entries(m)) if (!(IFACE_KNOWN as readonly string[]).includes(k)) extra[k] = v
  return {
    name: m.name ?? '',
    ip: m.ip ?? '',
    ip6: m.ip6 ?? '',
    hello_multiplier: m.hello_multiplier ?? '',
    listen_port: m.listen_port ?? '',
    extra,
  }
}

/** Interface property string with only the keys the protocol knows. */
export function formatFabricInterface(protocol: FabricProtocol, i: FabricInterfaceForm): string {
  const parts = [`name=${i.name.trim()}`]
  const add = (k: string, v: string) => {
    if (v.trim()) parts.push(`${k}=${v.trim()}`)
  }
  if (protocol === 'openfabric' || protocol === 'ospf' || protocol === 'wireguard') add('ip', i.ip)
  if (protocol === 'openfabric' || protocol === 'wireguard') add('ip6', i.ip6)
  if (protocol === 'openfabric') add('hello_multiplier', i.hello_multiplier)
  if (protocol === 'wireguard') {
    add('listen_port', i.listen_port)
    for (const [k, v] of Object.entries(i.extra)) add(k, v)
  }
  return parts.join(',')
}

export function nodeInterfaces(n: Partial<SdnFabricNode> | undefined): string[] {
  const v = n?.interfaces
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

export interface FabricNodeForm {
  node_id: string
  ip: string
  ip6: string
  interfaces: FabricInterfaceForm[]
  /** WireGuard. */
  role: 'internal' | 'external'
  endpoint: string
  public_key: string
  allowed_ips: string
  /** WireGuard peers ("iface=wg0,node=…,type=internal,node_iface=wg0"), kept per interface. */
  peers: string[]
}

export function fabricNodeForm(n: Partial<SdnFabricNode> | undefined): FabricNodeForm {
  return {
    node_id: str(n?.node_id),
    ip: str(n?.ip),
    ip6: str(n?.ip6),
    interfaces: nodeInterfaces(n).map(parseFabricInterface),
    role: n?.role ?? 'internal',
    endpoint: str(n?.endpoint),
    public_key: str(n?.public_key),
    allowed_ips: Array.isArray(n?.allowed_ips) ? n.allowed_ips.join(', ') : str(n?.allowed_ips),
    peers: Array.isArray(n?.peers) ? [...n.peers] : [],
  }
}

export function validateFabricNode(protocol: FabricProtocol, f: FabricNodeForm, create: boolean): Record<string, string> {
  const e: Record<string, string> = {}
  if (create && !f.node_id.trim()) e.node_id = '必填'
  const external = protocol === 'wireguard' && f.role === 'external'
  if (external) {
    if (!f.public_key.trim()) e.public_key = '必填'
    if (!f.endpoint.trim()) e.endpoint = '必填'
    for (const c of splitList(f.allowed_ips)) if (!isCidr(c)) e.allowed_ips = `不是 CIDR：${c}`
    return e
  }
  if (f.ip.trim() && !IPV4.test(f.ip.trim())) e.ip = 'IPv4 地址'
  if (f.ip6.trim() && !(f.ip6.includes(':') && isIp(f.ip6.trim()))) e.ip6 = 'IPv6 地址'
  if (protocol !== 'wireguard' && !f.ip.trim() && !f.ip6.trim()) e.ip = fabricHasIpv6(protocol) ? '至少填写 IPv4 或 IPv6 地址' : '必填'
  const names = new Set<string>()
  f.interfaces.forEach((i, idx) => {
    if (!i.name.trim()) e[`iface-${idx}`] = '接口名必填'
    else if (names.has(i.name.trim())) e[`iface-${idx}`] = '接口重复'
    names.add(i.name.trim())
    if (i.ip.trim() && !isCidr(i.ip.trim())) e[`iface-${idx}`] = 'IP 要带前缀长度，例如 10.0.0.1/31'
    if (i.ip6.trim() && !isCidr(i.ip6.trim())) e[`iface-${idx}`] = 'IPv6 要带前缀长度'
    const hm = i.hello_multiplier.trim()
    if (hm && (!/^\d+$/.test(hm) || Number(hm) < 2 || Number(hm) > 100)) e[`iface-${idx}`] = 'Hello 倍数 2–100'
  })
  return e
}

function nodeValues(protocol: FabricProtocol, f: FabricNodeForm): { values: ConfigValues; arrays: Record<string, string[]> } {
  if (protocol === 'wireguard' && f.role === 'external') {
    return {
      values: { endpoint: f.endpoint.trim(), public_key: f.public_key.trim(), role: 'external' },
      arrays: { allowed_ips: splitList(f.allowed_ips) },
    }
  }
  const values: ConfigValues = { ip: f.ip.trim(), ip6: fabricHasIpv6(protocol) ? f.ip6.trim() : '' }
  if (protocol === 'wireguard') {
    values.role = 'internal'
    values.endpoint = f.endpoint.trim()
  }
  const arrays: Record<string, string[]> = { interfaces: f.interfaces.map((i) => formatFabricInterface(protocol, i)) }
  if (protocol === 'wireguard') arrays.peers = f.peers.filter((p) => f.interfaces.some((i) => tryParsePropertyString(p).iface === i.name.trim()))
  return { values, arrays }
}

export function fabricNodeCreateParams(protocol: FabricProtocol, f: FabricNodeForm): Params {
  const { values, arrays } = nodeValues(protocol, f)
  const params: Params = { node_id: f.node_id.trim(), protocol, ...nonEmpty(values) }
  for (const [k, v] of Object.entries(arrays)) if (v.length) params[k] = v
  return params
}

export function fabricNodeUpdateParams(before: SdnFabricNode, f: FabricNodeForm): Params | null {
  const protocol = before.protocol
  const { values, arrays } = nodeValues(protocol, f)
  delete values.role // not editable
  const changed = configUpdateParams(before as ConfigValues, values)
  const params: Params = { ...(changed ?? {}) }
  const del = typeof params.delete === 'string' ? params.delete.split(',') : []
  delete params.delete
  for (const [k, next] of Object.entries(arrays)) {
    const old = k === 'interfaces' ? nodeInterfaces(before) : ((before[k] as string[] | undefined) ?? [])
    if (old.join('|') === next.join('|')) continue
    if (next.length) params[k] = next
    else if (old.length) del.push(k)
  }
  if (del.length) params.delete = del
  if (Object.keys(params).length === 0) return null
  return { ...params, protocol, ...(before.digest ? { digest: before.digest } : {}) }
}

// ----------------------------------------------------------------- route maps

export const MATCH_KEYS: readonly { key: string; label: string; value: 'route-type' | 'int' | 'prefix-list' | 'ip' | 'text' }[] = [
  { key: 'route-type', label: '路由类型（EVPN）', value: 'route-type' },
  { key: 'vni', label: 'VNI', value: 'int' },
  { key: 'ip-address-prefix-list', label: 'IPv4 前缀列表', value: 'prefix-list' },
  { key: 'ip6-address-prefix-list', label: 'IPv6 前缀列表', value: 'prefix-list' },
  { key: 'ip-next-hop-prefix-list', label: 'IPv4 下一跳前缀列表', value: 'prefix-list' },
  { key: 'ip6-next-hop-prefix-list', label: 'IPv6 下一跳前缀列表', value: 'prefix-list' },
  { key: 'ip-next-hop-address', label: 'IPv4 下一跳', value: 'ip' },
  { key: 'ip6-next-hop-address', label: 'IPv6 下一跳', value: 'ip' },
  { key: 'metric', label: 'Metric', value: 'int' },
  { key: 'local-preference', label: 'Local Preference', value: 'int' },
  { key: 'peer', label: '对等体', value: 'text' },
  { key: 'tag', label: '标签', value: 'text' },
]

export const ROUTE_TYPES = [
  { value: 'ead', label: '以太网自动发现（Type 1）' },
  { value: 'macip', label: 'MAC/IP 通告（Type 2）' },
  { value: 'multicast', label: '组播（Type 3）' },
  { value: 'es', label: '以太网段（Type 4）' },
  { value: 'prefix', label: 'IP 前缀（Type 5）' },
] as const

export const SET_KEYS: readonly { key: string; label: string; value: 'none' | 'ip' | 'int' | 'text' }[] = [
  { key: 'ip-next-hop', label: 'IPv4 下一跳', value: 'ip' },
  { key: 'ip-next-hop-peer-address', label: 'IPv4 下一跳设为对等体地址', value: 'none' },
  { key: 'ip-next-hop-unchanged', label: 'IPv4 下一跳不变', value: 'none' },
  { key: 'ip6-next-hop', label: 'IPv6 下一跳', value: 'ip' },
  { key: 'ip6-next-hop-peer-address', label: 'IPv6 下一跳设为对等体地址', value: 'none' },
  { key: 'ip6-next-hop-prefer-global', label: 'IPv6 下一跳优先全局地址', value: 'none' },
  { key: 'local-preference', label: 'Local Preference', value: 'text' },
  { key: 'tag', label: '标签', value: 'text' },
  { key: 'weight', label: '权重', value: 'int' },
  { key: 'metric', label: 'Metric', value: 'text' },
  { key: 'src', label: '源地址', value: 'ip' },
]

export interface KeyValue {
  key: string
  value: string
}

export function parseKeyValues(v: unknown): KeyValue[] {
  if (!Array.isArray(v)) return []
  return v.map((s) => {
    const m = tryParsePropertyString(String(s))
    return { key: m.key ?? '', value: m.value ?? '' }
  })
}

export function formatKeyValue(kv: KeyValue): string {
  return kv.value.trim() ? `key=${kv.key},value=${kv.value.trim()}` : `key=${kv.key}`
}

export function keyLabel(list: readonly { key: string; label: string }[], key: string): string {
  return list.find((k) => k.key === key)?.label ?? key
}

export interface RouteMapForm {
  id: string
  order: string
  action: 'permit' | 'deny'
  match: KeyValue[]
  set: KeyValue[]
  call: string
  exitKey: '' | 'on-match-goto' | 'on-match-next' | 'continue'
  exitValue: string
}

export function routeMapForm(e: Partial<RouteMapEntry> | undefined, id = ''): RouteMapForm {
  const exit = tryParsePropertyString(e?.['exit-action'])
  return {
    id: str(e?.['route-map-id'] ?? id),
    order: str(e?.order),
    action: e?.action ?? 'permit',
    match: parseKeyValues(e?.match),
    set: parseKeyValues(e?.set),
    call: str(e?.call),
    exitKey: (exit.key as RouteMapForm['exitKey']) ?? '',
    exitValue: exit.value ?? '',
  }
}

export function validateRouteMap(f: RouteMapForm, create: boolean): Record<string, string> {
  const e: Record<string, string> = {}
  if (create) {
    if (!f.id.trim()) e['route-map-id'] = '必填'
    else if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(f.id.trim()) || f.id.trim().length > 32) e['route-map-id'] = '字母、数字、_ 和 -（最多 32 个）'
    if (!/^\d+$/.test(f.order.trim()) || Number(f.order) > 65535) e.order = '0–65535'
  }
  if (f.match.some((m) => !m.key)) e.match = '每个匹配条件都要选属性'
  else if (f.match.some((m) => !m.value.trim())) e.match = '匹配条件的值不能为空'
  const noValue = new Set(SET_KEYS.filter((k) => k.value === 'none').map((k) => k.key))
  if (f.set.some((s) => !s.key)) e.set = '每个设置项都要选属性'
  else if (f.set.some((s) => !noValue.has(s.key) && !s.value.trim())) e.set = '设置项的值不能为空'
  if (f.exitKey === 'on-match-goto' && !/^\d+$/.test(f.exitValue.trim())) e['exit-action'] = '跳转到的序号（0–65535）'
  return e
}

function routeMapValues(f: RouteMapForm) {
  const noValue = new Set(SET_KEYS.filter((k) => k.value === 'none').map((k) => k.key))
  return {
    action: f.action,
    match: f.match.map(formatKeyValue),
    set: f.set.map((s) => (noValue.has(s.key) ? `key=${s.key}` : formatKeyValue(s))),
    call: f.call.trim(),
    exit: f.exitKey ? (f.exitKey === 'on-match-goto' ? `key=${f.exitKey},value=${f.exitValue.trim()}` : `key=${f.exitKey}`) : '',
  }
}

export function routeMapCreateParams(f: RouteMapForm): Params {
  const v = routeMapValues(f)
  const params: Params = { 'route-map-id': f.id.trim(), order: Number(f.order), action: v.action }
  if (v.match.length) params.match = v.match
  if (v.set.length) params.set = v.set
  if (v.call) params.call = v.call
  if (v.exit) params['exit-action'] = v.exit
  return params
}

export function routeMapUpdateParams(before: RouteMapEntry, f: RouteMapForm): Params | null {
  const v = routeMapValues(f)
  const params: Params = {}
  const del: string[] = []
  if (v.action !== before.action) params.action = v.action
  for (const k of ['match', 'set'] as const) {
    const old = (before[k] ?? []).join('|')
    if (old === v[k].join('|')) continue
    if (v[k].length) params[k] = v[k]
    else del.push(k)
  }
  const scalar = (key: string, next: string, old: unknown) => {
    if (next === str(old)) return
    if (next) params[key] = next
    else del.push(key)
  }
  scalar('call', v.call, before.call)
  scalar('exit-action', v.exit, before['exit-action'])
  if (del.length) params.delete = del
  if (Object.keys(params).length === 0) return null
  return before.digest ? { ...params, digest: before.digest } : params
}

/** "permit 10: match … set …" summary of an entry. */
export function describeRouteMapEntry(e: RouteMapEntry): string {
  const parts: string[] = []
  for (const m of parseKeyValues(e.match)) parts.push(`匹配 ${keyLabel(MATCH_KEYS, m.key)}${m.value ? ` = ${m.value}` : ''}`)
  for (const s of parseKeyValues(e.set)) parts.push(`设置 ${keyLabel(SET_KEYS, s.key)}${s.value ? ` = ${s.value}` : ''}`)
  if (e.call) parts.push(`调用 ${e.call}`)
  const exit = tryParsePropertyString(e['exit-action'])
  if (exit.key) parts.push(exit.key === 'on-match-goto' ? `匹配后跳到 ${exit.value}` : exit.key === 'on-match-next' ? '匹配后继续下一条' : '继续')
  return parts.join(' · ') || '匹配全部'
}

// --------------------------------------------------------------- prefix lists

export function parsePrefixListEntries(v: unknown): PrefixListEntry[] {
  if (!Array.isArray(v)) return []
  return v
    .map((s) => {
      const m = tryParsePropertyString(String(s))
      const out: PrefixListEntry = { seq: Number(m.seq ?? 0), action: m.action === 'deny' ? 'deny' : 'permit', prefix: m.prefix ?? '' }
      if (m.ge !== undefined) out.ge = Number(m.ge)
      if (m.le !== undefined) out.le = Number(m.le)
      return out
    })
    .sort((a, b) => a.seq - b.seq)
}

export interface PrefixEntryForm {
  seq: string
  action: 'permit' | 'deny'
  prefix: string
  ge: string
  le: string
}

export function prefixEntryForm(e: PrefixListEntry | undefined, nextSeq = 10): PrefixEntryForm {
  return { seq: e ? String(e.seq) : String(nextSeq), action: e?.action ?? 'permit', prefix: e?.prefix ?? '', ge: str(e?.ge), le: str(e?.le) }
}

/** Next free sequence number (steps of 5 like FRR). */
export function nextPrefixSeq(entries: readonly PrefixListEntry[]): number {
  const max = entries.reduce((m, e) => Math.max(m, e.seq), 0)
  return max + 5
}

export function validatePrefixEntry(f: PrefixEntryForm): Record<string, string> {
  const e: Record<string, string> = {}
  if (f.seq.trim() && (!/^\d+$/.test(f.seq.trim()) || Number(f.seq) < 1)) e.seq = '正整数'
  if (!isCidr(f.prefix.trim())) e.prefix = 'CIDR，例如 10.0.0.0/8'
  const len = Number(f.prefix.split('/')[1] ?? 0)
  const max = f.prefix.includes(':') ? 128 : 32
  for (const k of ['ge', 'le'] as const) {
    const v = f[k].trim()
    if (!v) continue
    if (!/^\d+$/.test(v) || Number(v) > max) e[k] = `0–${max}`
    else if (Number(v) < len) e[k] = `不能小于前缀长度 ${len}`
  }
  if (!e.ge && !e.le && f.ge.trim() && f.le.trim() && Number(f.ge) > Number(f.le)) e.le = '不能小于 ge'
  return e
}

export function prefixEntryParams(f: PrefixEntryForm): Params {
  const params: Params = { action: f.action, prefix: f.prefix.trim() }
  if (f.seq.trim()) params.seq = Number(f.seq)
  if (f.ge.trim()) params.ge = Number(f.ge)
  if (f.le.trim()) params.le = Number(f.le)
  return params
}

export function prefixEntryUpdateParams(before: PrefixListEntry, f: PrefixEntryForm): Params | null {
  const params: Params = {}
  const del: string[] = []
  if (f.action !== before.action) params.action = f.action
  if (f.prefix.trim() !== before.prefix) params.prefix = f.prefix.trim()
  if (f.seq.trim() && Number(f.seq) !== before.seq) params.seq = Number(f.seq)
  for (const k of ['ge', 'le'] as const) {
    const next = f[k].trim()
    if (next === str(before[k])) continue
    if (next) params[k] = Number(next)
    else del.push(k)
  }
  if (del.length) params.delete = del
  return Object.keys(params).length ? params : null
}

export function describePrefixEntry(e: PrefixListEntry): string {
  return [e.prefix, e.ge !== undefined ? `ge ${e.ge}` : '', e.le !== undefined ? `le ${e.le}` : ''].filter(Boolean).join(' ')
}
