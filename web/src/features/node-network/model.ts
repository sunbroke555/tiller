// Pure logic of the node network tab: type labels, name rules, validation,
// form ⇄ API params and the pending-diff parser. Field rules follow
// Proxmox.node.NetworkEdit (proxmoxlib.js) and PVE/API2/Network.pm.

import type { Params } from '@/api/client'
import type { NetworkIface } from '@/api/node-network'

// ------------------------------------------------------------------ types

/** Interface types the edit dialog handles (create: all but eth / OVSPort). */
export type EditableType = 'bridge' | 'bond' | 'vlan' | 'eth' | 'OVSBridge' | 'OVSBond' | 'OVSPort' | 'OVSIntPort'

export const TYPE_LABEL: Record<string, string> = {
  eth: '网卡',
  bridge: 'Linux 网桥',
  bond: 'Linux Bond',
  vlan: 'Linux VLAN',
  alias: '别名',
  OVSBridge: 'OVS 网桥',
  OVSBond: 'OVS Bond',
  OVSPort: 'OVS 端口',
  OVSIntPort: 'OVS 内部端口',
  fabric: 'SDN Fabric',
  vnet: 'SDN VNet',
  unknown: '未知',
}

export const typeLabel = (type: string) => TYPE_LABEL[type] ?? type

const EDITABLE = new Set<string>(['bridge', 'bond', 'vlan', 'eth', 'OVSBridge', 'OVSBond', 'OVSPort', 'OVSIntPort'])
export const isEditable = (type: string): type is EditableType => EDITABLE.has(type)

/** Types offered by the "创建" menu, in the official order. */
export const CREATE_TYPES = ['bridge', 'bond', 'vlan', 'OVSBridge', 'OVSBond', 'OVSIntPort'] as const satisfies readonly EditableType[]
export type CreateType = (typeof CREATE_TYPES)[number]

/** List groups, in display order. */
export const GROUPS = [
  { id: 'bridge', title: '网桥', types: ['bridge', 'OVSBridge'] },
  { id: 'bond', title: 'Bond', types: ['bond', 'OVSBond'] },
  { id: 'vlan', title: 'VLAN', types: ['vlan'] },
  { id: 'ovs', title: 'OVS 端口', types: ['OVSPort', 'OVSIntPort'] },
  { id: 'eth', title: '物理网卡', types: ['eth'] },
] as const

export function groupOf(type: string): string {
  return GROUPS.find((g) => (g.types as readonly string[]).includes(type))?.id ?? 'other'
}

// ------------------------------------------------------------------ bond

export const BOND_MODES = ['balance-rr', 'active-backup', 'balance-xor', 'broadcast', '802.3ad', 'balance-tlb', 'balance-alb'] as const
export const OVS_BOND_MODES = ['active-backup', 'balance-slb', 'lacp-balance-slb', 'lacp-balance-tcp'] as const
export const HASH_POLICIES = ['layer2', 'layer2+3', 'layer3+4'] as const

export const BOND_MODE_LABEL: Record<string, string> = {
  'balance-rr': 'balance-rr（轮询）',
  'active-backup': 'active-backup（主备）',
  'balance-xor': 'balance-xor',
  broadcast: 'broadcast（广播）',
  '802.3ad': 'LACP（802.3ad）',
  'balance-tlb': 'balance-tlb',
  'balance-alb': 'balance-alb',
  'balance-slb': 'balance-slb',
  'lacp-balance-slb': 'LACP（balance-slb）',
  'lacp-balance-tcp': 'LACP（balance-tcp）',
}

/** Hash policy only applies to balance-xor and 802.3ad. */
export const bondUsesHashPolicy = (mode: string | undefined) => mode === 'balance-xor' || mode === '802.3ad'
/** bond-primary only applies to active-backup (Linux bonds). */
export const bondUsesPrimary = (mode: string | undefined) => mode === 'active-backup'

// ------------------------------------------------------------------ names

/** "ens19.100" → raw device ens19, VLAN 100 (Proxmox.Utils.VlanInterface_match, unanchored). */
const VLAN_IFACE_RE = /(\w+)\.(\d+)/
/** "vlan100" → VLAN 100 (Proxmox.Utils.Vlan_match). */
const VLAN_NAME_RE = /^vlan(\d+)/

export type VlanNaming =
  /** "<raw>.<id>": both come from the name. */
  | { kind: 'dotted'; rawDevice: string; id: number }
  /** "vlan<id>": the id comes from the name, the raw device must be set. */
  | { kind: 'vlanN'; id: number }
  /** Any other name: raw device and id must be set. */
  | { kind: 'custom' }

export function vlanNaming(name: string): VlanNaming {
  const dotted = VLAN_IFACE_RE.exec(name)
  if (dotted) return { kind: 'dotted', rawDevice: dotted[1]!, id: Number(dotted[2]) }
  const n = VLAN_NAME_RE.exec(name)
  if (n) return { kind: 'vlanN', id: Number(n[1]) }
  return { kind: 'custom' }
}

/** Validate an interface name for a create dialog; null when fine. */
export function validateName(type: EditableType, name: string, existing: ReadonlySet<string>): string | null {
  const v = name.trim()
  if (!v) return '请输入名称'
  if (existing.has(v)) return `接口 ${v} 已存在`
  switch (type) {
    case 'bridge':
    case 'OVSBridge':
      return /^[a-zA-Z][a-zA-Z0-9_]{0,9}$/.test(v) ? null : '以字母开头，只含字母、数字和 _，最多 10 个字符'
    case 'bond':
    case 'OVSBond':
      return /^bond\d{1,4}$/.test(v) ? null : '格式：bondN（N 为 0–9999）'
    case 'OVSIntPort':
    case 'OVSPort':
    case 'eth':
      if (v.length > 15) return '最多 15 个字符'
      return /^[a-z][a-z0-9_]{1,20}$/.test(v) ? null : '以小写字母开头，只含 a-z、0-9 和 _，至少 2 个字符'
    case 'vlan':
      if (v.length > 15) return '最多 15 个字符'
      return /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(v) ? null : '名称含有不允许的字符'
  }
}

/** First free "<prefix>N" (the official "Create" menu pre-fills it). */
export function nextFreeName(prefix: string, existing: ReadonlySet<string>): string {
  for (let i = 0; i <= 9999; i++) {
    const id = `${prefix}${i}`
    if (!existing.has(id)) return id
  }
  return ''
}

export const DEFAULT_NAME_PREFIX: Record<CreateType, string | null> = {
  bridge: 'vmbr',
  bond: 'bond',
  vlan: 'vlan',
  OVSBridge: 'vmbr',
  OVSBond: 'bond',
  OVSIntPort: null,
}

// ------------------------------------------------------------------ addresses

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

export function isIPv4(v: string): boolean {
  return IPV4_RE.test(v)
}

export function isIPv6(v: string): boolean {
  if (!v.includes(':') || !/^[0-9a-fA-F:.]+$/.test(v)) return false
  try {
    new URL(`http://[${v}]/`)
    return true
  } catch {
    return false
  }
}

/** IPv4/CIDR with a prefix length of 8–32 (the official vtype). */
export function validateCidr4(v: string): string | null {
  const m = /^([^/]+)\/(\d{1,2})$/.exec(v.trim())
  if (!m || !isIPv4(m[1]!)) return '格式示例：192.168.1.10/24'
  const len = Number(m[2])
  return len >= 8 && len <= 32 ? null : '前缀长度应在 8–32 之间'
}

/** IPv6/CIDR with a prefix length of 8–128. */
export function validateCidr6(v: string): string | null {
  const m = /^([^/]+)\/(\d{1,3})$/.exec(v.trim())
  if (!m || !isIPv6(m[1]!)) return '格式示例：2001:db8::10/64'
  const len = Number(m[2])
  return len >= 8 && len <= 128 ? null : '前缀长度应在 8–128 之间'
}

/** "2 4 100-200" (VLAN-aware bridge VIDs): each entry 2–4094, ranges low→high. */
export function validateVids(v: string): string | null {
  for (const vid of v.trim().split(/[\s,;]+/)) {
    if (!vid) continue
    const m = /^(\d+)(?:-(\d+))?$/.exec(vid)
    if (!m) return `无效的 VLAN ID：${vid}`
    const start = Number(m[1])
    const end = Number(m[2] ?? m[1])
    if (start > end) return `范围应从小到大：${vid}`
    if (start < 2 || end > 4094) return `超出 2–4094：${vid}`
  }
  return null
}

/** Space-separated interface list ("ens19 ens20") → array. */
export function splitList(v: string | undefined | null): string[] {
  return (v ?? '').split(/[\s,;]+/).filter(Boolean)
}

/** Toggle one name in a space-separated list, keeping the order. */
export function toggleInList(list: string, name: string): string {
  const items = splitList(list)
  return (items.includes(name) ? items.filter((x) => x !== name) : [...items, name]).join(' ')
}

// ------------------------------------------------------------------ members

/** Ports / slaves an interface uses (bridge ports, bond slaves, OVS ports and bonds). */
export function membersOf(i: Pick<NetworkIface, 'type' | 'bridge_ports' | 'slaves' | 'ovs_ports' | 'ovs_bonds'>): string[] {
  switch (i.type) {
    case 'bridge':
      return splitList(i.bridge_ports)
    case 'bond':
      return splitList(i.slaves)
    case 'OVSBridge':
      return splitList(i.ovs_ports)
    case 'OVSBond':
      return splitList(i.ovs_bonds)
    default:
      return []
  }
}

/** Which interface uses each port / slave ("ens18" → "vmbr0"). */
export function portOwners(ifaces: readonly NetworkIface[]): Map<string, string> {
  const owners = new Map<string, string>()
  for (const i of ifaces) {
    // OVS bridges list their IntPorts / Bonds as ports; those are not physical members.
    if (i.type === 'OVSBridge') continue
    for (const m of membersOf(i)) owners.set(m, i.iface)
  }
  for (const i of ifaces) {
    if (i.type !== 'OVSBridge') continue
    for (const m of membersOf(i)) if (!owners.has(m)) owners.set(m, i.iface)
  }
  return owners
}

// ------------------------------------------------------------------ form

export interface IfaceForm {
  type: EditableType
  iface: string
  autostart: boolean
  comments: string
  mtu: number | undefined
  cidr: string
  gateway: string
  cidr6: string
  gateway6: string
  bridge_ports: string
  bridge_vlan_aware: boolean
  bridge_vids: string
  slaves: string
  bond_mode: string
  bond_xmit_hash_policy: string
  bond_primary: string
  vlan_raw_device: string
  vlan_id: number | undefined
  ovs_ports: string
  ovs_bonds: string
  ovs_bridge: string
  ovs_options: string
  ovs_tag: number | undefined
}

const flag = (v: unknown) => v === 1 || v === '1' || v === true
const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))

/** Types without an autostart flag (official: OVSIntPort, OVSPort, OVSBond). */
export const hasAutostart = (type: EditableType) => type !== 'OVSIntPort' && type !== 'OVSPort' && type !== 'OVSBond'
/** OVSBond has no addresses; everything else does. */
export const hasAddresses = (type: EditableType) => type !== 'OVSBond'
/** Types attached to an OVS bridge. */
export const onOvsBridge = (type: EditableType) => type === 'OVSPort' || type === 'OVSIntPort' || type === 'OVSBond'

/** Initial form: from an existing interface, or the defaults of a new one. */
export function formFromIface(type: EditableType, i?: NetworkIface, name = ''): IfaceForm {
  const create = !i
  return {
    type,
    iface: i?.iface ?? name,
    autostart: create ? true : flag(i?.autostart),
    comments: str(i?.comments).replace(/\n+$/, ''),
    mtu: num(i?.mtu),
    cidr: str(i?.cidr),
    gateway: str(i?.gateway),
    cidr6: str(i?.cidr6),
    gateway6: str(i?.gateway6),
    bridge_ports: str(i?.bridge_ports),
    bridge_vlan_aware: flag(i?.bridge_vlan_aware),
    bridge_vids: str(i?.bridge_vids),
    slaves: str(i?.slaves),
    bond_mode: str(i?.bond_mode) || (create ? (type === 'OVSBond' ? 'active-backup' : 'balance-rr') : ''),
    bond_xmit_hash_policy: str(i?.bond_xmit_hash_policy),
    bond_primary: str(i?.['bond-primary']),
    vlan_raw_device: str(i?.['vlan-raw-device']),
    vlan_id: num(i?.['vlan-id']),
    ovs_ports: str(i?.ovs_ports),
    ovs_bonds: str(i?.ovs_bonds),
    ovs_bridge: str(i?.ovs_bridge),
    ovs_options: str(i?.ovs_options),
    ovs_tag: num(i?.ovs_tag),
  }
}

/** Which VLAN fields the dialog shows as editable for this name. */
export function vlanFieldState(name: string): { rawDevice: 'name' | 'input'; id: 'name' | 'input'; naming: VlanNaming } {
  const naming = vlanNaming(name)
  return {
    naming,
    rawDevice: naming.kind === 'dotted' ? 'name' : 'input',
    id: naming.kind === 'custom' ? 'input' : 'name',
  }
}

export type FormErrors = Partial<Record<keyof IfaceForm | 'vlan-id' | 'vlan-raw-device' | 'bond-primary', string>>

/** Client-side checks; the API checks again (duplicate ports and gateways, IPv6 types). */
export function validateForm(f: IfaceForm, opts: { create: boolean; existing: ReadonlySet<string> }): FormErrors {
  const e: FormErrors = {}
  if (opts.create) {
    const n = validateName(f.type, f.iface, opts.existing)
    if (n) e.iface = n
  }
  if (hasAddresses(f.type)) {
    if (f.cidr.trim()) {
      const c = validateCidr4(f.cidr)
      if (c) e.cidr = c
    }
    if (f.gateway.trim() && !isIPv4(f.gateway.trim())) e.gateway = '格式示例：192.168.1.1'
    if (f.cidr6.trim()) {
      const c = validateCidr6(f.cidr6)
      if (c) e.cidr6 = c
    }
    if (f.gateway6.trim() && !isIPv6(f.gateway6.trim())) e.gateway6 = '格式示例：2001:db8::1'
  }
  if (f.mtu !== undefined && (f.mtu < 1280 || f.mtu > 65520)) e.mtu = 'MTU 应在 1280–65520 之间'
  if (f.type === 'bridge' && f.bridge_vlan_aware && f.bridge_vids.trim()) {
    const v = validateVids(f.bridge_vids)
    if (v) e.bridge_vids = v
  }
  if (f.type === 'vlan') {
    const st = vlanFieldState(f.iface)
    if (st.rawDevice === 'input' && !f.vlan_raw_device.trim()) e.vlan_raw_device = '请填写 VLAN 的父接口'
    if (st.id === 'input' && f.vlan_id === undefined) e.vlan_id = '请填写 VLAN ID'
    if (f.vlan_id !== undefined && (f.vlan_id < 1 || f.vlan_id > 4094)) e.vlan_id = 'VLAN ID 应在 1–4094 之间'
  }
  if ((f.type === 'bond' || f.type === 'OVSBond') && !f.bond_mode) e.bond_mode = '请选择模式'
  if (onOvsBridge(f.type)) {
    if (opts.create && !f.ovs_bridge) e.ovs_bridge = '请选择 OVS 网桥'
    if (f.ovs_tag !== undefined && (f.ovs_tag < 1 || f.ovs_tag > 4094)) e.ovs_tag = 'VLAN 标签应在 1–4094 之间'
  }
  return e
}

/**
 * Form → POST / PUT parameters, the way NetworkEdit submits them: every
 * field of the type that has a value is sent (an update without `cidr`
 * would turn the interface into "manual"), cleared fields that were set go
 * into `delete`, fields that no longer apply (hash policy outside
 * balance-xor/802.3ad, VIDs without VLAN awareness …) are dropped.
 */
export function formToParams(f: IfaceForm, original?: NetworkIface): Params {
  const create = !original
  const out: Params = { type: f.type }
  const del: string[] = []
  if (create) out.iface = f.iface.trim()

  /** Value when set; otherwise delete it on update if the interface had it. */
  const set = (key: string, value: string | number | undefined, had?: unknown) => {
    const empty = value === undefined || value === ''
    if (!empty) out[key] = typeof value === 'string' ? value.trim() : value
    else if (!create && had !== undefined && had !== null && had !== '') del.push(key)
  }
  const o = (original ?? {}) as Record<string, unknown>

  if (hasAutostart(f.type)) out.autostart = f.autostart ? 1 : 0

  if (hasAddresses(f.type)) {
    set('cidr', f.cidr.trim(), o.cidr ?? o.address)
    set('gateway', f.gateway.trim(), o.gateway)
    set('cidr6', f.cidr6.trim(), o.cidr6 ?? o.address6)
    set('gateway6', f.gateway6.trim(), o.gateway6)
  }

  switch (f.type) {
    case 'bridge':
      set('bridge_ports', normalizeList(f.bridge_ports), o.bridge_ports)
      if (f.bridge_vlan_aware) {
        out.bridge_vlan_aware = 1
        set('bridge_vids', normalizeList(f.bridge_vids), o.bridge_vids)
      } else {
        if (!create && flag(o.bridge_vlan_aware)) del.push('bridge_vlan_aware')
        if (!create && o.bridge_vids) del.push('bridge_vids')
      }
      break
    case 'OVSBridge':
      set('ovs_ports', normalizeList(f.ovs_ports), o.ovs_ports)
      set('ovs_options', f.ovs_options.trim(), o.ovs_options)
      break
    case 'OVSPort':
    case 'OVSIntPort':
      if (create) out.ovs_bridge = f.ovs_bridge
      set('ovs_tag', f.ovs_tag, o.ovs_tag)
      set('ovs_options', f.ovs_options.trim(), o.ovs_options)
      break
    case 'OVSBond':
      if (create) out.ovs_bridge = f.ovs_bridge
      out.bond_mode = f.bond_mode
      set('ovs_bonds', normalizeList(f.ovs_bonds), o.ovs_bonds)
      set('ovs_tag', f.ovs_tag, o.ovs_tag)
      set('ovs_options', f.ovs_options.trim(), o.ovs_options)
      break
    case 'bond':
      set('slaves', normalizeList(f.slaves), o.slaves)
      out.bond_mode = f.bond_mode
      if (bondUsesHashPolicy(f.bond_mode)) set('bond_xmit_hash_policy', f.bond_xmit_hash_policy, o.bond_xmit_hash_policy)
      else if (!create && o.bond_xmit_hash_policy) del.push('bond_xmit_hash_policy')
      if (bondUsesPrimary(f.bond_mode)) set('bond-primary', f.bond_primary.trim(), o['bond-primary'])
      else if (!create && o['bond-primary']) del.push('bond-primary')
      break
    case 'vlan': {
      const st = vlanFieldState(f.iface.trim())
      if (st.rawDevice === 'input') set('vlan-raw-device', f.vlan_raw_device.trim(), o['vlan-raw-device'])
      if (st.id === 'input') set('vlan-id', f.vlan_id, o['vlan-id'])
      break
    }
    case 'eth':
      break
  }

  set('mtu', f.mtu, o.mtu)
  set('comments', f.comments.trim(), typeof o.comments === 'string' ? o.comments.trim() : o.comments)

  if (del.length) out.delete = del.join(',')
  return out
}

function normalizeList(v: string): string {
  return splitList(v).join(' ')
}

// ------------------------------------------------------------------ pending diff

export type PendingKind = 'added' | 'modified' | 'removed'

export interface PendingDiff {
  /** Interfaces touched by the pending changes. */
  ifaces: Map<string, PendingKind>
  /** Lines added / removed (for the summary). */
  added: number
  removed: number
}

const STANZA_RE = /^(?:auto|iface|allow-[\w-]+)\s+(\S+)/
const BARE_IFACE_RE = /^iface\s+\S+\s+inet6?\s+manual\s*$/

/**
 * Which interfaces the diff of interfaces → interfaces.new touches. Lines
 * are attributed to the stanza they are in (`auto X` / `iface X` … up to the
 * next blank line); hunks that start inside a stanza whose header is out of
 * context are counted but not attributed. For physical NICs (`physical`),
 * a new bare "iface ens19 inet manual" stanza is not a change (PVE writes
 * every NIC out) and a new stanza with settings counts as modified.
 */
export function parsePendingDiff(diff: string | undefined | null, physical: ReadonlySet<string> = new Set()): PendingDiff {
  const result: PendingDiff = { ifaces: new Map(), added: 0, removed: 0 }
  if (!diff) return result

  interface Stanza {
    plus: string[]
    minus: string[]
    headerPlus: boolean
    headerMinus: boolean
    headerContext: boolean
  }
  const stanzas = new Map<string, Stanza>()
  const get = (name: string) => {
    let s = stanzas.get(name)
    if (!s) stanzas.set(name, (s = { plus: [], minus: [], headerPlus: false, headerMinus: false, headerContext: false }))
    return s
  }

  let current: string | null = null
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('\\')) continue
    if (raw.startsWith('@@')) {
      current = null
      continue
    }
    if (raw === '') {
      // A blank context line whose leading space got lost.
      current = null
      continue
    }
    const mark = raw[0]
    if (mark !== '+' && mark !== '-' && mark !== ' ') continue
    const line = raw.slice(1)
    if (mark === '+') result.added++
    if (mark === '-') result.removed++

    if (line.trim() === '') {
      current = null
      continue
    }
    const header = STANZA_RE.exec(line)
    if (header) {
      current = header[1]!
      const s = get(current)
      if (line.startsWith('iface')) {
        if (mark === '+') s.headerPlus = true
        else if (mark === '-') s.headerMinus = true
        else s.headerContext = true
      }
    }
    if (current === null || mark === ' ') continue
    const s = get(current)
    ;(mark === '+' ? s.plus : s.minus).push(line)
  }

  for (const [name, s] of stanzas) {
    if (name === 'lo') continue
    if (s.plus.length === 0 && s.minus.length === 0) continue
    let kind: PendingKind
    if (s.headerPlus && !s.headerMinus && !s.headerContext) {
      if (physical.has(name)) {
        // A physical NIC that PVE now writes out, with or without settings.
        if (s.minus.length === 0 && s.plus.every((l) => BARE_IFACE_RE.test(l.trim()))) continue
        kind = 'modified'
      } else {
        kind = 'added'
      }
    } else if (s.headerMinus && !s.headerPlus && !s.headerContext) {
      kind = 'removed'
    } else {
      kind = 'modified'
    }
    result.ifaces.set(name, kind)
  }
  return result
}

export const PENDING_LABEL: Record<PendingKind, string> = {
  added: '待新增',
  modified: '待修改',
  removed: '待删除',
}

/** Short summary of an interface for its list row ("ens19 ens20 · 10.0.0.1/24"). */
export function addressLines(i: NetworkIface): string[] {
  return [i.cidr, i.cidr6].filter((x): x is string => !!x)
}
