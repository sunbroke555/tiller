// Resource tree model: group the cluster resources by node, pool or tag and
// filter them by a search text. Pure functions (tested); the component is
// ResourceTree.tsx.

import { isGuest, isNode, isStorage, type ClusterResource, type GuestResource, type NodeResource, type StorageResource } from '@/api/types'
import { splitTags } from '@/lib/tags'

export type TreeGrouping = 'node' | 'pool' | 'tag'

export interface TreePrefs {
  group: TreeGrouping
  showStorage: boolean
  showTemplates: boolean
  /** Collapsed group keys per grouping ("node:pve", "pool:web", "tag:prod"). */
  collapsed: Record<string, boolean>
}

export const DEFAULT_TREE_PREFS: TreePrefs = { group: 'node', showStorage: true, showTemplates: true, collapsed: {} }

const PREFS_KEY = 'pve-web:resource-tree'

export function loadTreePrefs(): TreePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<TreePrefs> | null
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_TREE_PREFS }
    return {
      group: raw.group === 'pool' || raw.group === 'tag' ? raw.group : 'node',
      showStorage: raw.showStorage !== false,
      showTemplates: raw.showTemplates !== false,
      collapsed: raw.collapsed && typeof raw.collapsed === 'object' ? raw.collapsed : {},
    }
  } catch {
    return { ...DEFAULT_TREE_PREFS }
  }
}

export function saveTreePrefs(prefs: TreePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // ignore
  }
}

export interface TreeGroup {
  /** Stable key, also used for the collapsed state. */
  key: string
  kind: TreeGrouping | 'none'
  label: string
  /** Node groups carry the node resource (status dot, link). */
  node?: NodeResource
  guests: GuestResource[]
  storages: StorageResource[]
}

function guestMatches(g: GuestResource, words: string[]): boolean {
  if (words.length === 0) return true
  const hay = `${g.vmid} ${g.name ?? ''} ${g.node} ${g.pool ?? ''} ${splitTags(g.tags).join(' ')}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}

function storageMatches(s: StorageResource, words: string[]): boolean {
  if (words.length === 0) return true
  const hay = `${s.storage} ${s.node} ${s.plugintype ?? ''}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}

const byVmid = (a: GuestResource, b: GuestResource) => a.vmid - b.vmid
const byStorage = (a: StorageResource, b: StorageResource) => a.storage.localeCompare(b.storage)

/**
 * Build the groups for the sidebar tree. While searching, groups without a
 * match disappear (a node whose own name matches keeps all its children).
 */
export function buildTree(resources: readonly ClusterResource[], prefs: Pick<TreePrefs, 'group' | 'showStorage' | 'showTemplates'>, search = ''): TreeGroup[] {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const searching = words.length > 0
  const guests = resources.filter(isGuest).filter((g) => prefs.showTemplates || g.template !== 1)
  const storages = prefs.showStorage ? resources.filter(isStorage) : []
  const nodes = resources.filter(isNode).sort((a, b) => a.node.localeCompare(b.node))

  if (prefs.group === 'node') {
    const groups: TreeGroup[] = []
    for (const node of nodes) {
      const nodeHit = searching && words.every((w) => node.node.toLowerCase().includes(w))
      const gs = guests.filter((g) => g.node === node.node && (nodeHit || guestMatches(g, words))).sort(byVmid)
      const ss = storages.filter((s) => s.node === node.node && (nodeHit || storageMatches(s, words))).sort(byStorage)
      if (searching && !nodeHit && gs.length === 0 && ss.length === 0) continue
      groups.push({ key: `node:${node.node}`, kind: 'node', label: node.node, node, guests: gs, storages: ss })
    }
    return groups
  }

  const matching = guests.filter((g) => guestMatches(g, words)).sort(byVmid)

  if (prefs.group === 'pool') {
    const pools = new Set<string>()
    for (const r of resources) if (r.type === 'pool') pools.add(r.pool)
    for (const g of guests) if (g.pool) pools.add(g.pool)
    const groups: TreeGroup[] = [...pools]
      .sort((a, b) => a.localeCompare(b))
      .map((pool) => {
        const poolHit = searching && words.every((w) => pool.toLowerCase().includes(w))
        const gs = (poolHit ? guests.filter((g) => g.pool === pool).sort(byVmid) : matching.filter((g) => g.pool === pool))
        const ss = storages.filter((s) => s.pool === pool && (poolHit || storageMatches(s, words))).sort(byStorage)
        return { key: `pool:${pool}`, kind: 'pool' as const, label: pool, guests: gs, storages: ss, hit: poolHit }
      })
      .filter((g) => !searching || g.hit || g.guests.length > 0 || g.storages.length > 0)
      .map(({ hit: _hit, ...g }) => g)
    const loose = matching.filter((g) => !g.pool)
    if (loose.length > 0) groups.push({ key: 'pool:', kind: 'none', label: '不在资源池中', guests: loose, storages: [] })
    return groups
  }

  // tag
  const tags = new Map<string, GuestResource[]>()
  const untagged: GuestResource[] = []
  for (const g of matching) {
    const list = [...new Set(splitTags(g.tags).map((t) => t.toLowerCase()))]
    if (list.length === 0) untagged.push(g)
    for (const t of list) tags.set(t, [...(tags.get(t) ?? []), g])
  }
  // A search that names a tag lists that tag's guests even if their names do not match.
  if (searching) {
    for (const g of guests) {
      for (const t of splitTags(g.tags).map((x) => x.toLowerCase())) {
        if (words.every((w) => t.includes(w)) && !tags.get(t)?.includes(g)) tags.set(t, [...(tags.get(t) ?? []), g].sort(byVmid))
      }
    }
  }
  const groups: TreeGroup[] = [...tags.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, gs]) => ({ key: `tag:${tag}`, kind: 'tag' as const, label: tag, guests: gs, storages: [] }))
  if (untagged.length > 0) groups.push({ key: 'tag:', kind: 'none', label: '没有标签', guests: untagged, storages: [] })
  return groups
}
