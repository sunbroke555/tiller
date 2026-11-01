// Node network area (node-network): interfaces of /etc/network/interfaces,
// create / edit / delete (written to interfaces.new), the pending diff, apply
// (ifreload -a, a task) and revert.
//
// Endpoints and field rules follow Proxmox.node.NetworkView / NetworkEdit in
// proxmoxlib.js and PVE/API2/Network.pm.

import { useQuery } from '@tanstack/react-query'

import { del, p, post, put, requestEnvelope, type Params } from './client'
import { queryKeys } from './queries'
import type { NodeNetworkInterface, PveBool } from './types'

// ------------------------------------------------------------------ types

/** One entry of GET /nodes/{node}/network (fields depend on the type). */
export interface NetworkIface extends NodeNetworkInterface {
  /** Physical NIC present on the host (eth only). */
  exists?: PveBool
  netmask6?: string | number
  bridge_vids?: string
  bridge_stp?: string
  bridge_fd?: string | number
  slaves?: string
  bond_mode?: string
  bond_xmit_hash_policy?: string
  'bond-primary'?: string
  'vlan-id'?: string | number
  'vlan-raw-device'?: string
  mtu?: string | number
  comments6?: string
  ovs_type?: string
  ovs_ports?: string
  ovs_bonds?: string
  ovs_bridge?: string
  ovs_options?: string
  ovs_tag?: string | number
  /** Alternative names (udev altnames such as enp0s19, enx<MAC>). */
  altnames?: string[]
}

export interface NodeNetworkConfig {
  ifaces: NetworkIface[]
  /** Unified diff of /etc/network/interfaces → interfaces.new; "" when nothing is pending. */
  changes: string
}

// ------------------------------------------------------------------ keys

export const networkKeys = {
  /** Interface list plus pending diff of one node. */
  config: (node: string) => [...queryKeys.node(node), 'network'] as const,
}

// ------------------------------------------------------------------ queries

/**
 * Interfaces of a node as configured in interfaces.new (when changes are
 * pending) plus the diff. `active` is the live state of the running system.
 */
export function useNodeNetwork(node: string) {
  return useQuery({
    queryKey: networkKeys.config(node),
    queryFn: async ({ signal }): Promise<NodeNetworkConfig> => {
      const env = await requestEnvelope<NetworkIface[]>('GET', p`/nodes/${node}/network`, undefined, { signal })
      const raw = env.changes as unknown
      const ifaces = [...(env.data ?? [])].sort((a, b) => a.iface.localeCompare(b.iface, undefined, { numeric: true }))
      return { ifaces, changes: typeof raw === 'string' ? raw : '' }
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  })
}

// ------------------------------------------------------------------ writes

/** POST /nodes/{node}/network: written to interfaces.new, not applied. */
export const createIface = (node: string, params: Params) => post(p`/nodes/${node}/network`, params)

/** PUT /nodes/{node}/network/{iface}: needs `type`; empty fields go into `delete`. */
export const updateIface = (node: string, iface: string, params: Params) => put(p`/nodes/${node}/network/${iface}`, params)

/** DELETE /nodes/{node}/network/{iface} (pending until applied). */
export const deleteIface = (node: string, iface: string) => del(p`/nodes/${node}/network/${iface}`)

/** PUT /nodes/{node}/network: move interfaces.new in place and `ifreload -a` (UPID). */
export const applyNetwork = (node: string, opts: { regenerateFrr?: boolean } = {}) =>
  put<string>(p`/nodes/${node}/network`, opts.regenerateFrr ? { 'regenerate-frr': 1 } : undefined)

/** DELETE /nodes/{node}/network: discard interfaces.new. */
export const revertNetwork = (node: string) => del(p`/nodes/${node}/network`)
