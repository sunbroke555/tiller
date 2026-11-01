// Datacenter summary numbers, computed from /cluster/resources and
// /cluster/status the way the official Datacenter → Summary does.

import {
  isGuest,
  isNode,
  isStorage,
  type ClusterResource,
  type ClusterStatusEntry,
  type ClusterStatusNode,
  type GuestType,
} from '@/api/types'

export interface GuestCounts {
  running: number
  stopped: number
  templates: number
  total: number
}

export function guestCounts(resources: readonly ClusterResource[]): Record<GuestType, GuestCounts> {
  const out: Record<GuestType, GuestCounts> = {
    qemu: { running: 0, stopped: 0, templates: 0, total: 0 },
    lxc: { running: 0, stopped: 0, templates: 0, total: 0 },
  }
  for (const r of resources) {
    if (!isGuest(r)) continue
    const c = out[r.type]
    c.total++
    if (r.template === 1) c.templates++
    else if (r.status === 'running') c.running++
    else c.stopped++
  }
  return out
}

export interface ClusterUsage {
  cpu: { used: number; total: number }
  mem: { used: number; total: number }
  /** `filtered`: only the storages picked in the settings count. */
  storage: { used: number; total: number; count: number; filtered: boolean }
}

/**
 * CPU and memory of online nodes; storage of available storages with shared
 * storages (NFS, Ceph, …) counted once — they appear once per node.
 * `counted` (resource ids, from the "which storages count" setting) limits
 * the storage total; empty, or naming no existing storage, counts all.
 */
export function clusterUsage(resources: readonly ClusterResource[], counted: readonly string[] = []): ClusterUsage {
  let cpuUsed = 0
  let cpuTotal = 0
  let memUsed = 0
  let memTotal = 0
  for (const r of resources) {
    if (!isNode(r) || r.status !== 'online') continue
    cpuUsed += (r.cpu ?? 0) * (r.maxcpu ?? 0)
    cpuTotal += r.maxcpu ?? 0
    memUsed += r.mem ?? 0
    memTotal += r.maxmem ?? 0
  }
  const pick = new Set(counted)
  const filtered = pick.size > 0 && resources.some((r) => isStorage(r) && pick.has(r.id))
  const seen = new Set<string>()
  let used = 0
  let total = 0
  for (const r of resources) {
    if (!isStorage(r) || r.status !== 'available' || !r.maxdisk) continue
    if (filtered && !pick.has(r.id)) continue
    const key = r.shared === 1 ? `shared:${r.storage}` : `${r.node}:${r.storage}`
    if (seen.has(key)) continue
    seen.add(key)
    used += r.disk ?? 0
    total += r.maxdisk
  }
  return { cpu: { used: cpuUsed, total: cpuTotal }, mem: { used: memUsed, total: memTotal }, storage: { used, total, count: seen.size, filtered } }
}

export type SubscriptionLevel = 'none' | 'c' | 'b' | 's' | 'p'

export const SUBSCRIPTION_LABEL: Record<SubscriptionLevel, string> = {
  none: '无订阅',
  c: 'Community',
  b: 'Basic',
  s: 'Standard',
  p: 'Premium',
}

export function subscriptionLevel(level: string | undefined | null): SubscriptionLevel {
  const l = (level ?? '').trim().toLowerCase()
  return l === 'c' || l === 'b' || l === 's' || l === 'p' ? l : 'none'
}

/** Nodes per subscription level (from /cluster/status type=node `level`). */
export function subscriptionSummary(status: readonly ClusterStatusEntry[]): { level: SubscriptionLevel; nodes: string[] }[] {
  const by = new Map<SubscriptionLevel, string[]>()
  for (const e of status) {
    if (e.type !== 'node') continue
    const lvl = subscriptionLevel(e.level)
    by.set(lvl, [...(by.get(lvl) ?? []), e.name])
  }
  const order: SubscriptionLevel[] = ['p', 's', 'b', 'c', 'none']
  return order.filter((l) => by.has(l)).map((level) => ({ level, nodes: by.get(level)!.sort() }))
}

export type Health = 'ok' | 'warning' | 'critical'

export interface HealthReport {
  health: Health
  /** Cluster name; null for a single node without a cluster. */
  cluster: string | null
  quorate: boolean | null
  nodesOnline: number
  nodesTotal: number
  /** "HEALTH_OK" / "HEALTH_WARN" / "HEALTH_ERR", or null without Ceph. */
  ceph: string | null
}

export function healthReport(status: readonly ClusterStatusEntry[], cephHealth: string | null | undefined): HealthReport {
  const cluster = status.find((e) => e.type === 'cluster')
  const nodes = status.filter((e): e is ClusterStatusNode => e.type === 'node')
  const online = nodes.filter((n) => n.online === 1).length
  const quorate = cluster ? cluster.quorate === 1 : null
  const ceph = cephHealth ?? null
  let health: Health = 'ok'
  if (online < nodes.length || ceph === 'HEALTH_WARN') health = 'warning'
  if (quorate === false || ceph === 'HEALTH_ERR' || (nodes.length > 0 && online === 0)) health = 'critical'
  return { health, cluster: cluster?.name ?? null, quorate, nodesOnline: online, nodesTotal: nodes.length, ceph }
}
