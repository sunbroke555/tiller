// Pure helpers of the cluster page: the encoded join information (same format
// as the official UI, so strings can be pasted between both), corosync links,
// form validation and form → API parameters.

import type { Params } from '@/api/client'
import type { ClusterJoinData, CorosyncNode, Totem } from '@/api/cluster'
import type { ClusterStatusEntry, NodeNetworkInterface } from '@/api/types'

/** corosync supports link0 … link7. */
export const MAX_LINKS = 8
export const CLUSTER_NAME_MAX = 15

// ------------------------------------------------------- join information

/**
 * The object the official UI serialises (PVE.ClusterInfoWindow): JSON of
 * these keys, base64 encoded (UTF-8).
 */
export interface JoinInfo {
  ipAddress: string
  fingerprint: string
  /** Link number → the peer's address on that link. */
  peerLinks: Record<string, string>
  ring_addr: string[]
  totem: Totem
}

/** Join information of `data.preferred_node`, or null when it is not in the nodelist. */
export function buildJoinInfo(data: ClusterJoinData): JoinInfo | null {
  const node = data.nodelist.find((n) => n.name === data.preferred_node)
  if (!node) return null
  const peerLinks: Record<string, string> = {}
  const ring_addr: string[] = []
  for (const l of nodeLinks(node)) {
    peerLinks[l.number] = l.address
    ring_addr.push(l.address)
  }
  return {
    ipAddress: node.pve_addr ?? '',
    fingerprint: node.pve_fp ?? '',
    peerLinks,
    ring_addr,
    totem: data.totem,
  }
}

function utf8ToBase64(text: string): string {
  let bin = ''
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
  return btoa(bin)
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64)
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export function encodeJoinInfo(info: JoinInfo): string {
  return utf8ToBase64(JSON.stringify(info))
}

/**
 * Decode pasted join information. Whitespace and line breaks (from mail or
 * chat clients) are ignored. Returns null unless it is base64 JSON with a
 * totem section, like the official UI requires.
 */
export function decodeJoinInfo(text: string): JoinInfo | null {
  const compact = text.replace(/\s+/g, '')
  if (!compact) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(base64ToUtf8(compact))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const o = parsed as Record<string, unknown>
  if (!o.totem || typeof o.totem !== 'object') return null
  const peerLinks: Record<string, string> = {}
  if (o.peerLinks && typeof o.peerLinks === 'object') {
    for (const [k, v] of Object.entries(o.peerLinks as Record<string, unknown>)) if (typeof v === 'string') peerLinks[k] = v
  }
  return {
    ipAddress: typeof o.ipAddress === 'string' ? o.ipAddress : '',
    fingerprint: typeof o.fingerprint === 'string' ? o.fingerprint : '',
    peerLinks,
    ring_addr: Array.isArray(o.ring_addr) ? o.ring_addr.filter((a): a is string => typeof a === 'string') : [],
    totem: o.totem as Totem,
  }
}

// ----------------------------------------------------------------- links

export interface NodeLink {
  number: number
  address: string
}

const LINK_KEY = /^(?:ring|link)(\d+)_addr$/

/** ring<N>_addr / link<N>_addr of a corosync node entry, by link number. */
export function nodeLinks(node: CorosyncNode): NodeLink[] {
  const out: NodeLink[] = []
  for (const [k, v] of Object.entries(node)) {
    const m = LINK_KEY.exec(k)
    if (m && typeof v === 'string' && v) out.push({ number: Number(m[1]), address: v })
  }
  return out.sort((a, b) => a.number - b.number)
}

/** Link numbers configured in totem.interface (fallback: link 0). */
export function totemLinkNumbers(totem: Totem | null | undefined): number[] {
  const iface = totem?.interface
  if (!iface || typeof iface !== 'object') return [0]
  const nums = Object.entries(iface).map(([k, v]) => {
    const n = Number(v?.linknumber ?? k)
    return Number.isInteger(n) ? n : Number(k)
  })
  const unique = [...new Set(nums.filter((n) => Number.isInteger(n) && n >= 0 && n < MAX_LINKS))].sort((a, b) => a - b)
  return unique.length ? unique : [0]
}

/** knet_link_priority of a link (undefined = default 0). */
export function linkPriority(totem: Totem | null | undefined, number: number): number | undefined {
  const iface = totem?.interface
  if (!iface) return undefined
  const entry = Object.entries(iface).find(([k, v]) => Number(v?.linknumber ?? k) === number)?.[1]
  const raw = entry?.knet_link_priority
  if (raw === undefined || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

/** Addresses of the node's interfaces, in interface order (IPv4 then IPv6 per interface). */
export function addressCandidates(ifaces: readonly NodeNetworkInterface[]): { address: string; iface: string }[] {
  const out: { address: string; iface: string }[] = []
  for (const n of ifaces) {
    if (n.address) out.push({ address: n.address, iface: n.iface })
    if (n.address6) out.push({ address: n.address6, iface: n.iface })
  }
  return out
}

// ------------------------------------------------------------ link editor

/** One row of the link editor. */
export interface LinkRow {
  number: number
  address: string
  /** Create only: knet_link_priority ('' = default). */
  priority: string
  /** Join: the peer's address on this link, shown as a hint. */
  peer?: string
  /** Join with a single link: may stay empty (PVE resolves the node's hostname). */
  optional?: boolean
}

export function nextFreeLinkNumber(rows: readonly LinkRow[]): number | null {
  for (let i = 0; i < MAX_LINKS; i++) if (!rows.some((r) => r.number === i)) return i
  return null
}

export function nextFreeAddress(rows: readonly LinkRow[], candidates: readonly string[]): string {
  return candidates.find((a) => !rows.some((r) => r.address.trim() === a)) ?? ''
}

/** Rows for a join: one per link of the cluster, with the peer's address as hint. */
export function joinLinkRows(info: JoinInfo): LinkRow[] {
  const numbers = totemLinkNumbers(info.totem)
  const rows: LinkRow[] = numbers.map((number) => {
    const peer = info.peerLinks[number]
    return { number, address: '', priority: '', ...(peer ? { peer } : {}) }
  })
  // Same rule as the official UI: a single link whose address is the peer's
  // API address can be left empty (resolved from this node's hostname).
  if (rows.length === 1 && info.ring_addr[0] !== undefined && info.ring_addr[0] === info.ipAddress) rows[0]!.optional = true
  return rows
}

const ADDRESS_RE = /^[^\s,=;]+$/

/** Per-row error text (index → message), empty when valid. */
export function linkErrors(rows: readonly LinkRow[], { priority = false } = {}): Record<number, string> {
  const errors: Record<number, string> = {}
  rows.forEach((r, i) => {
    const addr = r.address.trim()
    if (rows.some((o, j) => j !== i && o.number === r.number)) errors[i] = `链路号 ${r.number} 重复`
    else if (!addr && !r.optional) errors[i] = '请输入本节点在这条链路上的地址'
    else if (addr && !ADDRESS_RE.test(addr)) errors[i] = '地址格式不正确'
    else if (addr && rows.some((o, j) => j !== i && o.address.trim() === addr)) errors[i] = '地址重复'
    else if (priority && r.priority.trim() !== '') {
      const n = Number(r.priority)
      if (!Number.isInteger(n) || n < 0 || n > 255) errors[i] = '优先级是 0–255 的整数'
    }
  })
  return errors
}

/** link<N> parameters: plain address, or `address=…,priority=…` when a priority is set. */
export function linkParams(rows: readonly LinkRow[], { priority = false } = {}): Params {
  const out: Params = {}
  for (const r of rows) {
    const address = r.address.trim()
    if (!address) continue
    const prio = priority ? r.priority.trim() : ''
    out[`link${r.number}`] = prio ? `address=${address},priority=${Number(prio)}` : address
  }
  return out
}

// ------------------------------------------------------------- validation

export function validateClusterName(name: string): string | null {
  const v = name.trim()
  if (!v) return '请输入集群名称'
  if (v.length > CLUSTER_NAME_MAX) return `最多 ${CLUSTER_NAME_MAX} 个字符`
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(v)) return '只能包含字母、数字和 -，且不能以 - 开头或结尾'
  return null
}

const FINGERPRINT_RE = /^([A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/

export function validateFingerprint(fp: string): string | null {
  const v = fp.trim()
  if (!v) return '请输入对端证书指纹'
  if (!FINGERPRINT_RE.test(v)) return 'SHA-256 指纹格式：32 组两位十六进制数，用冒号分隔'
  return null
}

/** Optional positive integer field ('' = unset). */
function optionalInt(v: string, min: number): string | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= min ? null : `请输入不小于 ${min} 的整数`
}

export const validateNodeId = (v: string) => optionalInt(v, 1)
export const validateVotes = (v: string, min = 1) => optionalInt(v, min)

// ------------------------------------------------------------ form params

export interface CreateForm {
  clustername: string
  links: LinkRow[]
  nodeid: string
  votes: string
}

export function createParams(f: CreateForm): Params {
  return {
    clustername: f.clustername.trim(),
    ...linkParams(f.links, { priority: true }),
    nodeid: f.nodeid.trim() ? Number(f.nodeid) : undefined,
    votes: f.votes.trim() ? Number(f.votes) : undefined,
  }
}

export interface JoinForm {
  hostname: string
  fingerprint: string
  password: string
  links: LinkRow[]
  nodeid: string
  votes: string
  force: boolean
}

export function joinParams(f: JoinForm): Params {
  return {
    hostname: f.hostname.trim(),
    fingerprint: f.fingerprint.trim().toUpperCase(),
    password: f.password,
    ...linkParams(f.links),
    nodeid: f.nodeid.trim() ? Number(f.nodeid) : undefined,
    votes: f.votes.trim() ? Number(f.votes) : undefined,
    force: f.force ? 1 : undefined,
  }
}

// --------------------------------------------------------------- overview

export interface ClusterNodeRow {
  name: string
  nodeid: number | undefined
  votes: number
  links: NodeLink[]
  /** API address (join nodelist) or the address /cluster/status reports. */
  address: string | undefined
  online: boolean | undefined
  local: boolean
}

/**
 * Corosync nodes merged with their state from /cluster/status, sorted by
 * node id like the official grid.
 */
export function clusterNodeRows(
  nodes: readonly CorosyncNode[],
  status: readonly ClusterStatusEntry[] | undefined,
  joinNodes?: readonly CorosyncNode[],
): ClusterNodeRow[] {
  const st = new Map((status ?? []).filter((e) => e.type === 'node').map((e) => [e.name, e]))
  const pve = new Map((joinNodes ?? []).map((n) => [n.name, n.pve_addr]))
  return nodes
    .map((n) => {
      const name = n.name || n.node || ''
      const s = st.get(name)
      const id = n.nodeid === undefined || n.nodeid === '' ? undefined : Number(n.nodeid)
      return {
        name,
        nodeid: Number.isFinite(id) ? id : undefined,
        votes: n.quorum_votes === undefined || n.quorum_votes === '' ? 1 : Number(n.quorum_votes),
        links: nodeLinks(n),
        address: pve.get(name) || (s && s.type === 'node' ? s.ip : undefined),
        online: s && s.type === 'node' ? !!s.online : undefined,
        local: !!(s && s.type === 'node' && s.local),
      }
    })
    .sort((a, b) => (a.nodeid ?? Infinity) - (b.nodeid ?? Infinity) || a.name.localeCompare(b.name))
}

/** Votes present, total and the quorum (more than half of all votes). */
export function voteSummary(rows: readonly ClusterNodeRow[]): { present: number; total: number; quorum: number } {
  const total = rows.reduce((s, r) => s + r.votes, 0)
  const present = rows.reduce((s, r) => s + (r.online ? r.votes : 0), 0)
  return { present, total, quorum: Math.floor(total / 2) + 1 }
}

/** Link numbers used by any node, sorted. */
export function usedLinkNumbers(rows: readonly ClusterNodeRow[]): number[] {
  return [...new Set(rows.flatMap((r) => r.links.map((l) => l.number)))].sort((a, b) => a - b)
}

const TOTEM_LABEL: Record<string, string> = {
  cluster_name: '集群名称',
  config_version: '配置版本',
  version: '协议版本',
  link_mode: '链路模式',
  ip_version: 'IP 版本',
  secauth: '认证加密',
  token_coefficient: 'token 系数',
  token: 'token 超时（毫秒）',
  transport: '传输',
  crypto_cipher: '加密算法',
  crypto_hash: '哈希算法',
}

const LINK_MODE: Record<string, string> = {
  passive: '被动（按优先级用一条）',
  active: '主动（同时使用全部）',
  rr: '轮询',
}

/** Totem settings worth showing (everything but the per-link interface sections). */
export function totemFacts(totem: Totem | null | undefined): { key: string; label: string; value: string }[] {
  if (!totem) return []
  const order = Object.keys(TOTEM_LABEL)
  return Object.entries(totem)
    .filter(([k, v]) => k !== 'interface' && k !== 'cluster_name' && (typeof v === 'string' || typeof v === 'number'))
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b))
    .map(([k, v]) => ({
      key: k,
      label: TOTEM_LABEL[k] ?? k,
      value: k === 'link_mode' ? (LINK_MODE[String(v)] ?? String(v)) : String(v),
    }))
}
