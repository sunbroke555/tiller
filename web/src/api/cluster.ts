// Cluster administration (area cluster).
//
// Endpoints (see docs/feature-map.md §2.2):
//   GET  /cluster/config/join      (node)  join information; 424 "node is not in a cluster" when standalone
//   GET  /cluster/config/nodes             corosync node list ([] when standalone)
//   GET  /cluster/config/totem             totem section of corosync.conf (null when standalone)
//   GET  /cluster/config/qdevice           QDevice status ({} when not configured)
//   POST /cluster/config                   create a cluster on this node (UPID)
//   POST /cluster/config/join              join this node into a cluster (UPID)
//   GET  /nodes/{node}/network             link address candidates
//
// Permissions: reads need Sys.Audit on /, create and join Sys.Modify on /.
// Removing a node has no API in the official UI (pvecm delnode on the CLI).
// pvecm returns most numbers as strings ("nodeid": "1").

import { useQuery } from '@tanstack/react-query'

import { get, isPveApiError, p, post, type Params } from './client'
import { queryKeys } from './queries'
import type { NodeNetworkInterface } from './types'

// ------------------------------------------------------------------ types

type Num = number | string

/** One `totem.interface.<n>` section. */
export interface TotemInterface {
  linknumber?: Num
  knet_link_priority?: Num
  [key: string]: unknown
}

/** GET /cluster/config/totem (also part of the join information). */
export interface Totem {
  cluster_name?: string
  config_version?: Num
  interface?: Record<string, TotemInterface>
  ip_version?: string
  link_mode?: string
  secauth?: string
  token_coefficient?: Num
  version?: Num
  [key: string]: unknown
}

/** Node entry of /cluster/config/nodes and of the join nodelist. */
export interface CorosyncNode {
  name: string
  node?: string
  nodeid?: Num
  quorum_votes?: Num
  /** Join nodelist only: address of the node's API (pveproxy). */
  pve_addr?: string
  /** Join nodelist only: SHA-256 fingerprint of the node's pve-ssl certificate. */
  pve_fp?: string
  /** ring0_addr … ring7_addr (older configs may use link<N>_addr). */
  [key: string]: unknown
}

/** GET /cluster/config/join */
export interface ClusterJoinData {
  config_digest: string
  nodelist: CorosyncNode[]
  /** The node the information was read for (pve_addr / pve_fp of that node). */
  preferred_node: string
  totem: Totem
}

/** GET /cluster/config/qdevice: parsed `corosync-qdevice-tool -sv` ({} when unconfigured). */
export type QdeviceStatus = Record<string, unknown>

// ------------------------------------------------------------------- keys

export const clusterKeys = {
  all: () => ['pve', 'cluster', 'config'] as const,
  join: (node?: string) => ['pve', 'cluster', 'config', 'join', node ?? ''] as const,
  nodes: () => ['pve', 'cluster', 'config', 'nodes'] as const,
  qdevice: () => ['pve', 'cluster', 'config', 'qdevice'] as const,
  networks: (node: string) => [...queryKeys.node(node), 'network-list', 'cluster'] as const,
}

/** True for the "not in a cluster" answer of a standalone node (not a real error). */
export function isNotInClusterError(e: unknown): boolean {
  if (!isPveApiError(e)) return false
  return e.status === 424 || /not in a cluster/i.test(e.message)
}

// ------------------------------------------------------------------ reads

/** Join information as read from `node` (default: the node this UI talks to). */
export function useClusterJoinInfo(node?: string, enabled = true) {
  return useQuery({
    queryKey: clusterKeys.join(node),
    queryFn: ({ signal }) => get<ClusterJoinData>('/cluster/config/join', node ? { node } : undefined, { signal }),
    enabled,
    refetchInterval: 15_000,
    retry: (count, e) => !isNotInClusterError(e) && count < 2,
  })
}

export function useCorosyncNodes(enabled = true) {
  return useQuery({
    queryKey: clusterKeys.nodes(),
    queryFn: ({ signal }) => get<CorosyncNode[]>('/cluster/config/nodes', undefined, { signal }),
    enabled,
    refetchInterval: 10_000,
  })
}

export function useQdevice(enabled = true) {
  return useQuery({
    queryKey: clusterKeys.qdevice(),
    queryFn: ({ signal }) => get<QdeviceStatus | null>('/cluster/config/qdevice', undefined, { signal }),
    enabled,
    refetchInterval: 30_000,
  })
}

/** Every interface of `node` (all types: corosync may run on a plain NIC). */
export function useLinkCandidates(node: string | null | undefined) {
  return useQuery({
    queryKey: clusterKeys.networks(node ?? ''),
    queryFn: async ({ signal }) => {
      const list = await get<NodeNetworkInterface[]>(p`/nodes/${node!}/network`, undefined, { signal })
      return [...list].sort((a, b) => a.iface.localeCompare(b.iface, undefined, { numeric: true }))
    },
    enabled: !!node,
    staleTime: 60_000,
  })
}

// ----------------------------------------------------------------- writes

/** Create a cluster with this node as its first member (returns a UPID). */
export function createCluster(params: Params) {
  return post<string>('/cluster/config', params)
}

/** Join this node into an existing cluster (returns a UPID). */
export function joinCluster(params: Params) {
  return post<string>('/cluster/config/join', params)
}
