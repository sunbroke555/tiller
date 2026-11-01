// Node system settings (node-system): DNS, /etc/hosts, time zone and the node
// options of /nodes/{node}/config (start-on-boot delay, Wake-on-LAN, ballooning
// target, location).
//
// Endpoints and field rules follow the official UI (proxmoxlib.js
// Proxmox.node.DNSView / DNSEdit / HostsView / TimeView / TimeEdit /
// NodeOptionsView, Proxmox.window.LocationEdit) and `pvesh usage -v`.
// The node notes (`description`) are edited by node-summary; both share the
// config query key, so saving either refreshes the other.

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

import { get, p, post, put, type Params } from './client'
import { nodeKeys, type NodeConfig } from './node-summary'
import { queryKeys } from './queries'
import type { NodeNetworkInterface } from './types'

type QueryOpts<TData> = Omit<UseQueryOptions<TData, Error, TData>, 'queryKey' | 'queryFn'>

// ------------------------------------------------------------------ types

/** GET /nodes/{node}/dns (no digest: PUT replaces the whole resolv.conf). */
export interface NodeDns {
  search?: string
  dns1?: string
  dns2?: string
  dns3?: string
}

/** GET /nodes/{node}/hosts */
export interface NodeHosts {
  data: string
  digest?: string
}

/** GET /nodes/{node}/time */
export interface NodeTime {
  timezone: string
  /** Unix seconds (UTC). */
  time: number
  /** Unix seconds shifted by the node's UTC offset (format it as UTC). */
  localtime: number
}

/** GET /nodes/{node}/config with every option this area edits. */
export interface NodeOptionsConfig extends Omit<NodeConfig, 'startall-onboot-delay' | 'ballooning-target'> {
  /** PVE 9.2 answers these as strings ("15"). */
  'startall-onboot-delay'?: number | string
  'ballooning-target'?: number | string
  /** "latitude=…,longitude=…[,name=…]"; unset = datacenter default. */
  location?: string
  /** ACME settings (acme, acmedomainN) belong to certificates-acme; never sent from here. */
  acme?: string
}

// ------------------------------------------------------------- query keys

export const systemKeys = {
  dns: (node: string) => [...queryKeys.node(node), 'dns'] as const,
  hosts: (node: string) => [...queryKeys.node(node), 'hosts'] as const,
  time: (node: string) => [...queryKeys.node(node), 'time'] as const,
  config: nodeKeys.config,
  interfaces: (node: string) => [...queryKeys.node(node), 'network-list', '*'] as const,
}

// ------------------------------------------------------------------ hooks

export function useNodeDns(node: string, options?: QueryOpts<NodeDns>) {
  return useQuery({
    queryKey: systemKeys.dns(node),
    queryFn: ({ signal }) => get<NodeDns>(p`/nodes/${node}/dns`, undefined, { signal }),
    refetchInterval: 30_000,
    ...options,
  })
}

export function useNodeHosts(node: string, options?: QueryOpts<NodeHosts>) {
  return useQuery({
    queryKey: systemKeys.hosts(node),
    queryFn: ({ signal }) => get<NodeHosts>(p`/nodes/${node}/hosts`, undefined, { signal }),
    staleTime: 15_000,
    ...options,
  })
}

/** Node time, refetched every 10 s; the clock ticks locally in between. */
export function useNodeTime(node: string, options?: QueryOpts<NodeTimeSample>) {
  return useQuery({
    queryKey: systemKeys.time(node),
    queryFn: async ({ signal }) => {
      const data = await get<NodeTime>(p`/nodes/${node}/time`, undefined, { signal })
      return { ...data, fetchedAt: Date.now() }
    },
    refetchInterval: 10_000,
    ...options,
  })
}

export interface NodeTimeSample extends NodeTime {
  /** Browser clock (ms) when the answer arrived. */
  fetchedAt: number
}

/** Node options (same query as node-summary's useNodeConfig). */
export function useNodeOptions(node: string, options?: QueryOpts<NodeOptionsConfig>) {
  return useQuery({
    queryKey: systemKeys.config(node),
    queryFn: ({ signal }) => get<NodeOptionsConfig>(p`/nodes/${node}/config`, undefined, { signal }),
    staleTime: 15_000,
    refetchInterval: 30_000,
    ...options,
  })
}

/** Every network interface of the node (for the Wake-on-LAN bind interface). */
export function useNodeInterfaces(node: string, options?: QueryOpts<NodeNetworkInterface[]>) {
  return useQuery({
    queryKey: systemKeys.interfaces(node),
    queryFn: async ({ signal }) => {
      const list = await get<NodeNetworkInterface[]>(p`/nodes/${node}/network`, undefined, { signal })
      return [...list].sort((a, b) => a.iface.localeCompare(b.iface, undefined, { numeric: true }))
    },
    staleTime: 60_000,
    ...options,
  })
}

// -------------------------------------------------------------- mutations

/** PUT /nodes/{node}/dns — `search` is required; omitted servers are removed. */
export function updateNodeDns(node: string, params: Params) {
  return put(p`/nodes/${node}/dns`, params)
}

/** POST /nodes/{node}/hosts — writes the whole file (digest guards against concurrent edits). */
export function writeNodeHosts(node: string, data: string, digest?: string) {
  return post(p`/nodes/${node}/hosts`, { data, digest })
}

/** PUT /nodes/{node}/time */
export function setNodeTimezone(node: string, timezone: string) {
  return put(p`/nodes/${node}/time`, { timezone })
}

/** PUT /nodes/{node}/config */
export function updateNodeOptions(node: string, params: Params) {
  return put(p`/nodes/${node}/config`, params)
}
