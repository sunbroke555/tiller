// TanStack Query hooks for the shared, frequently polled API data.
// Feature-specific queries live next to their feature and reuse queryKeys.

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

import { fetchDomains } from './auth'
import { get, isPveApiError, p } from './client'
import type {
  AuthDomain,
  ClusterResource,
  ClusterStatusEntry,
  ClusterTask,
  GuestType,
  NodeListEntry,
  NodeNetworkInterface,
  NodeRrdPoint,
  NodeStorage,
  RrdTimeframe,
  StorageContent,
  VersionInfo,
} from './types'

export const POLL = {
  resources: 5_000,
  status: 10_000,
  tasks: 10_000,
  rrd: 60_000,
} as const

/**
 * Query keys. Everything user-specific lives under ['pve'] (dropped on
 * logout). Area hooks build their keys on the scope prefixes below, so one
 * invalidation refreshes everything about a guest, node or storage:
 *
 *   [...queryKeys.guest(node, 'qemu', 100), 'config']
 *   [...queryKeys.node(node), 'services']
 *   [...queryKeys.storage(node, 'local'), 'content', 'iso']
 */
export const queryKeys = {
  all: ['pve'] as const,
  /** Scope prefix for one node's data. */
  node: (node: string) => ['pve', 'nodes', node] as const,
  /** Scope prefix for one guest's data (config, status, snapshots, …). */
  guest: (node: string, type: GuestType, vmid: number | string) => ['pve', 'nodes', node, type, String(vmid)] as const,
  /** Scope prefix for one storage on one node. */
  storage: (node: string, storage: string) => ['pve', 'nodes', node, 'storage', storage] as const,
  nodeStorages: (node: string, content?: string) => ['pve', 'nodes', node, 'storage-list', content ?? ''] as const,
  nodeNetworks: (node: string, type?: string) => ['pve', 'nodes', node, 'network-list', type ?? ''] as const,
  nextId: () => ['pve', 'cluster', 'nextid'] as const,
  resources: () => ['pve', 'cluster', 'resources'] as const,
  clusterStatus: () => ['pve', 'cluster', 'status'] as const,
  tasks: () => ['pve', 'cluster', 'tasks'] as const,
  nodes: () => ['pve', 'nodes'] as const,
  nodeRrd: (node: string, timeframe: RrdTimeframe, cf: 'AVERAGE' | 'MAX' = 'AVERAGE') => ['pve', 'nodes', node, 'rrddata', timeframe, cf] as const,
  version: () => ['pve', 'version'] as const,
  /** Outside `all`: realms are not user data and survive logout. */
  domains: () => ['access', 'domains'] as const,
}

type QueryOpts<TData, TSelected = TData> = Omit<
  UseQueryOptions<TData, Error, TSelected>,
  'queryKey' | 'queryFn'
>

/** Every node, guest, storage, pool and SDN object of the cluster, polled. */
export function useClusterResources<TSelected = ClusterResource[]>(
  options?: QueryOpts<ClusterResource[], TSelected>,
) {
  return useQuery({
    queryKey: queryKeys.resources(),
    queryFn: ({ signal }) => get<ClusterResource[]>('/cluster/resources', undefined, { signal }),
    refetchInterval: POLL.resources,
    ...options,
  })
}

export function useClusterStatus(options?: QueryOpts<ClusterStatusEntry[]>) {
  return useQuery({
    queryKey: queryKeys.clusterStatus(),
    queryFn: ({ signal }) => get<ClusterStatusEntry[]>('/cluster/status', undefined, { signal }),
    refetchInterval: POLL.status,
    ...options,
  })
}

export function useNodes(options?: QueryOpts<NodeListEntry[]>) {
  return useQuery({
    queryKey: queryKeys.nodes(),
    queryFn: ({ signal }) => get<NodeListEntry[]>('/nodes', undefined, { signal }),
    refetchInterval: POLL.status,
    ...options,
  })
}

export function useVersion(options?: QueryOpts<VersionInfo>) {
  return useQuery({
    queryKey: queryKeys.version(),
    queryFn: ({ signal }) => get<VersionInfo>('/version', undefined, { signal }),
    staleTime: 10 * 60_000,
    ...options,
  })
}

/** Recent tasks of all nodes (GET /cluster/tasks), newest first. */
export function useTasks(options?: QueryOpts<ClusterTask[]>) {
  return useQuery({
    queryKey: queryKeys.tasks(),
    queryFn: async ({ signal }) => {
      const tasks = await get<ClusterTask[]>('/cluster/tasks', undefined, { signal })
      return [...tasks].sort((a, b) => b.starttime - a.starttime)
    },
    refetchInterval: POLL.tasks,
    ...options,
  })
}

export function useNodeRrd(node: string, timeframe: RrdTimeframe = 'hour', options?: QueryOpts<NodeRrdPoint[]>) {
  return useQuery({
    queryKey: queryKeys.nodeRrd(node, timeframe),
    queryFn: ({ signal }) =>
      get<NodeRrdPoint[]>(p`/nodes/${node}/rrddata`, { timeframe, cf: 'AVERAGE' }, { signal }),
    refetchInterval: POLL.rrd,
    staleTime: 30_000,
    ...options,
  })
}

/** Login realms; the endpoint works without a ticket. */
export function useDomains(options?: QueryOpts<AuthDomain[]>) {
  return useQuery({
    queryKey: queryKeys.domains(),
    queryFn: ({ signal }) => fetchDomains(signal),
    staleTime: 5 * 60_000,
    retry: 1,
    ...options,
  })
}

/**
 * Storages usable on a node, optionally only those holding `content`
 * (GET /nodes/{node}/storage?content=…&enabled=1). Used by StorageSelect.
 */
export function useNodeStorages(
  node: string | null | undefined,
  content?: StorageContent | readonly StorageContent[],
  options?: QueryOpts<NodeStorage[]>,
) {
  const c = Array.isArray(content) ? content.join(',') : (content as string | undefined)
  return useQuery({
    queryKey: queryKeys.nodeStorages(node ?? '', c),
    queryFn: ({ signal }) => get<NodeStorage[]>(p`/nodes/${node!}/storage`, { content: c, enabled: 1 }, { signal }),
    enabled: !!node,
    staleTime: 15_000,
    ...options,
  })
}

/**
 * Network interfaces of a node; type "any_bridge" (default) lists Linux/OVS
 * bridges and SDN VNets for guest NICs. Used by BridgeSelect.
 */
export function useNodeNetworks(
  node: string | null | undefined,
  type: string = 'any_bridge',
  options?: QueryOpts<NodeNetworkInterface[]>,
) {
  return useQuery({
    queryKey: queryKeys.nodeNetworks(node ?? '', type),
    queryFn: async ({ signal }) => {
      const list = await get<NodeNetworkInterface[]>(p`/nodes/${node!}/network`, { type }, { signal })
      return [...list].sort((a, b) => a.iface.localeCompare(b.iface, undefined, { numeric: true }))
    },
    enabled: !!node,
    staleTime: 30_000,
    ...options,
  })
}

/** Next free VMID (GET /cluster/nextid returns it as a string). */
export async function fetchNextId(signal?: AbortSignal): Promise<number> {
  return Number(await get<string | number>('/cluster/nextid', undefined, { signal }))
}

/** Next free VMID. Not cached: always ask fresh. */
export function useNextId(options?: QueryOpts<number>) {
  return useQuery({
    queryKey: queryKeys.nextId(),
    queryFn: ({ signal }) => fetchNextId(signal),
    staleTime: 0,
    gcTime: 0,
    ...options,
  })
}

/**
 * Check that a VMID is free: GET /cluster/nextid?vmid=X succeeds for a free
 * id and fails with "VM X already exists" otherwise. Resolves to null when
 * free, or to the error message.
 */
export async function checkVmidFree(vmid: number, signal?: AbortSignal): Promise<string | null> {
  try {
    await get('/cluster/nextid', { vmid }, { signal })
    return null
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    if (isPveApiError(e) && e.status >= 400 && e.status < 500) return e.errors?.vmid?.trim() || e.message
    throw e
  }
}
