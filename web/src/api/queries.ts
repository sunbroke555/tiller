// TanStack Query hooks for the shared, frequently polled API data.
// Feature-specific queries live next to their feature and reuse queryKeys.

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

import { fetchDomains } from './auth'
import { get, p } from './client'
import type {
  AuthDomain,
  ClusterResource,
  ClusterStatusEntry,
  ClusterTask,
  NodeListEntry,
  NodeRrdPoint,
  RrdTimeframe,
  VersionInfo,
} from './types'

export const POLL = {
  resources: 5_000,
  status: 10_000,
  tasks: 10_000,
  rrd: 60_000,
} as const

export const queryKeys = {
  all: ['pve'] as const,
  resources: () => ['pve', 'cluster', 'resources'] as const,
  clusterStatus: () => ['pve', 'cluster', 'status'] as const,
  tasks: () => ['pve', 'cluster', 'tasks'] as const,
  nodes: () => ['pve', 'nodes'] as const,
  nodeRrd: (node: string, timeframe: RrdTimeframe) => ['pve', 'nodes', node, 'rrddata', timeframe] as const,
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
