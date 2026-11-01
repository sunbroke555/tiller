// SDN (areas sdn + sdn-fabrics).
//
// Endpoints (docs/feature-map.md §2.11, §2.12, §3.14):
//   GET/PUT        /cluster/sdn                         (PUT = apply pending config on all nodes → UPID)
//   GET            /cluster/sdn/dry-run?node=           (frr-diff / interfaces-diff)
//   POST           /cluster/sdn/rollback                (drop all pending changes)
//   DELETE         /cluster/sdn/lock?force=1            (release a stale global lock)
//   GET/POST       /cluster/sdn/{zones,vnets,controllers,ipams,dns}        (?pending=1)
//   GET/PUT/DELETE /cluster/sdn/{zones,vnets,controllers,ipams,dns}/{id}
//   GET/POST       /cluster/sdn/vnets/{vnet}/subnets ; GET/PUT/DELETE …/subnets/{subnet}
//   POST/PUT/DELETE /cluster/sdn/vnets/{vnet}/ips       (IPAM mappings: zone, ip, mac, vmid)
//   GET            /cluster/sdn/ipams/{ipam}/status     (PVE IPAM entries)
//   GET            /cluster/sdn/fabrics/all?pending=1   (fabrics + fabric nodes)
//   POST           /cluster/sdn/fabrics/fabric ; PUT/DELETE …/fabric/{id}
//   POST           /cluster/sdn/fabrics/node/{fabric} ; PUT/DELETE …/node/{fabric}/{node}
//   GET/POST       /cluster/sdn/route-maps/entries ; PUT/DELETE …/entries/{id}/entry/{order}
//   GET/POST       /cluster/sdn/prefix-lists ; PUT/DELETE …/{id} ; POST …/{id}/entries ; PUT/DELETE …/entries/{seq}
//   GET            /nodes/{node}/sdn/zones/{zone}/{content,bridges,ip-vrf} ; /nodes/{node}/sdn/vnets/{vnet}/mac-vrf
//   GET            /nodes/{node}/sdn/fabrics/{fabric}/{routes,neighbors,interfaces}
//
// With pending=1 every object carries `state` (new | changed | deleted) and
// `pending` (the values that apply will write; for new objects all values
// live there, "deleted" marks a removed key). See features/sdn/pending.ts.
//
// Permissions: SDN.Audit to read, SDN.Allocate on /sdn to change, apply and
// roll back.

import { useQueries, useQuery } from '@tanstack/react-query'

import { del, get, p, post, put, type Params } from './client'
import { queryKeys } from './queries'

// ------------------------------------------------------------------ types

export type SdnState = 'new' | 'changed' | 'deleted'

/** Fields every pending-aware list entry has. */
export interface SdnPendingFields {
  state?: SdnState
  pending?: Record<string, unknown>
  digest?: string | null
}

export type ZoneType = 'simple' | 'vlan' | 'qinq' | 'vxlan' | 'evpn' | 'faucet'

export interface SdnZone extends SdnPendingFields {
  zone: string
  type: ZoneType
  mtu?: number
  nodes?: string
  ipam?: string
  dns?: string
  reversedns?: string
  dnszone?: string
  dhcp?: 'dnsmasq'
  bridge?: string
  'bridge-disable-mac-learning'?: number
  tag?: number
  'vlan-protocol'?: '802.1q' | '802.1ad'
  peers?: string
  fabric?: string
  'vxlan-port'?: number
  controller?: string
  'secondary-controllers'?: string
  'vrf-vxlan'?: number
  mac?: string
  exitnodes?: string
  'exitnodes-primary'?: string
  'exitnodes-local-routing'?: number
  'advertise-subnets'?: number
  'disable-arp-nd-suppression'?: number
  'rt-import'?: string
  [key: string]: unknown
}

export interface SdnVnet extends SdnPendingFields {
  vnet: string
  type: 'vnet'
  zone?: string
  alias?: string
  tag?: number
  vlanaware?: number
  'isolate-ports'?: number
  [key: string]: unknown
}

export interface DhcpRange {
  'start-address': string
  'end-address': string
}

export interface SdnSubnet extends SdnPendingFields {
  /** "<zone>-10.0.0.0-24". */
  subnet: string
  id?: string
  type: 'subnet'
  cidr?: string
  network?: string
  mask?: string
  vnet: string
  zone?: string
  gateway?: string
  snat?: number
  dnszoneprefix?: string
  'dhcp-dns-server'?: string
  /** Objects on GET of one subnet; property strings inside `pending`. */
  'dhcp-range'?: (DhcpRange | string)[]
  [key: string]: unknown
}

export type ControllerType = 'evpn' | 'bgp' | 'isis' | 'faucet'

export interface SdnController extends SdnPendingFields {
  controller: string
  type: ControllerType
  asn?: number
  peers?: string
  node?: string
  nodes?: string
  fabric?: string
  ebgp?: number
  'ebgp-multihop'?: number
  'bgp-mode'?: 'auto' | 'external' | 'internal'
  'bgp-multipath-as-path-relax'?: number
  loopback?: string
  'peer-group-name'?: string
  'route-map-in'?: string
  'route-map-out'?: string
  'isis-domain'?: string
  'isis-net'?: string
  'isis-ifaces'?: string
  [key: string]: unknown
}

export type IpamType = 'pve' | 'netbox' | 'phpipam'

export interface SdnIpam {
  ipam: string
  type: IpamType
  url?: string
  token?: string
  section?: number
  fingerprint?: string
  digest?: string
  [key: string]: unknown
}

export interface SdnDns {
  dns: string
  type: 'powerdns'
  url?: string
  key?: string
  ttl?: number
  reversemaskv6?: number
  fingerprint?: string
  digest?: string
  [key: string]: unknown
}

/** GET /cluster/sdn/ipams/{ipam}/status entry. */
export interface IpamEntry {
  zone: string
  vnet: string
  subnet: string
  ip: string
  mac?: string
  vmid?: number
  hostname?: string
  /** 1 for the subnet gateway. */
  gateway?: number
}

export type FabricProtocol = 'openfabric' | 'ospf' | 'wireguard' | 'bgp'

export interface SdnFabric extends SdnPendingFields {
  id: string
  protocol: FabricProtocol
  ip_prefix?: string
  ip6_prefix?: string
  hello_interval?: number
  csnp_interval?: number
  area?: string
  route_filter?: string
  redistribute?: string[]
  persistent_keepalive?: number
  [key: string]: unknown
}

export interface SdnFabricNode extends SdnPendingFields {
  fabric_id: string
  node_id: string
  protocol: FabricProtocol
  ip?: string
  ip6?: string
  /** Property strings: "name=ens19,ip=10.0.0.1/31,hello_multiplier=10". */
  interfaces?: string[] | string
  role?: 'internal' | 'external'
  endpoint?: string
  public_key?: string
  allowed_ips?: string[]
  peers?: string[]
  [key: string]: unknown
}

export interface SdnFabricsAll {
  fabrics: SdnFabric[]
  nodes: SdnFabricNode[]
}

export interface RouteMapEntry extends SdnPendingFields {
  'route-map-id': string
  order: number
  action: 'permit' | 'deny'
  /** "key=metric,value=10". */
  match?: string[]
  set?: string[]
  call?: string
  /** "key=on-match-goto,value=20". */
  'exit-action'?: string
  [key: string]: unknown
}

export interface PrefixList extends SdnPendingFields {
  id: string
  type?: 'prefix-list'
  /** "action=permit,prefix=10.0.0.0/8,le=24,seq=5". */
  entries?: string[]
  [key: string]: unknown
}

export interface PrefixListEntry {
  seq: number
  action: 'permit' | 'deny'
  prefix: string
  ge?: number
  le?: number
}

/** /cluster/resources entry of type "network" (SDN zone or fabric on a node). */
export interface SdnResource {
  id: string
  type: 'network' | 'sdn'
  node: string
  network?: string
  sdn?: string
  'network-type'?: 'zone' | 'fabric' | string
  zone?: string
  status?: string
}

export interface DryRun {
  'frr-diff'?: string
  'interfaces-diff'?: string
}

export interface ZoneContentEntry {
  vnet: string
  status?: string
  statusmsg?: string
}

export interface ZoneBridge {
  name: string
  vlan_filtering?: string
  ports?: { name: string; index?: string; vmid?: number; primary_vlan?: number; vlans?: string[] }[]
}

export interface IpVrfEntry {
  ip: string
  metric?: number
  nexthops?: string[]
  protocol?: string
}

export interface MacVrfEntry {
  ip?: string
  mac?: string
  nexthop?: string
}

export interface FabricRoute {
  route: string
  via?: string[]
}

export interface FabricNeighbor {
  neighbor: string
  status?: string
  uptime?: string
}

export interface FabricInterface {
  name: string
  state?: string
  type?: string
}

// ------------------------------------------------------------------- keys

const base = ['pve', 'cluster', 'sdn'] as const

export const sdnKeys = {
  all: () => base,
  zones: () => [...base, 'zones'] as const,
  zone: (id: string) => [...base, 'zones', id] as const,
  vnets: () => [...base, 'vnets'] as const,
  vnet: (id: string) => [...base, 'vnets', id] as const,
  subnets: (vnet: string) => [...base, 'vnets', vnet, 'subnets'] as const,
  controllers: () => [...base, 'controllers'] as const,
  ipams: () => [...base, 'ipams'] as const,
  ipamStatus: (ipam: string) => [...base, 'ipams', ipam, 'status'] as const,
  dns: () => [...base, 'dns'] as const,
  fabrics: () => [...base, 'fabrics'] as const,
  routeMaps: () => [...base, 'route-maps'] as const,
  prefixLists: () => [...base, 'prefix-lists'] as const,
  dryRun: (node: string) => [...base, 'dry-run', node] as const,
  /** Per-node runtime views (zone content, bridges, VRFs, fabric routes). */
  node: (node: string, ...rest: string[]) => [...queryKeys.node(node), 'sdn', ...rest] as const,
}

const PENDING = { pending: 1 } as const

// ------------------------------------------------------------------ reads

export function useSdnZones() {
  return useQuery({ queryKey: sdnKeys.zones(), queryFn: ({ signal }) => get<SdnZone[]>('/cluster/sdn/zones', PENDING, { signal }) })
}

export function useSdnVnets() {
  return useQuery({ queryKey: sdnKeys.vnets(), queryFn: ({ signal }) => get<SdnVnet[]>('/cluster/sdn/vnets', PENDING, { signal }) })
}

export function useSdnSubnets(vnet: string | null) {
  return useQuery({
    queryKey: sdnKeys.subnets(vnet ?? ''),
    queryFn: ({ signal }) => get<SdnSubnet[]>(p`/cluster/sdn/vnets/${vnet ?? ''}/subnets`, PENDING, { signal }),
    enabled: !!vnet,
  })
}

/** Subnets of several VNets (pending-change count, IPAM view). */
export function useSdnSubnetsOf(vnets: readonly string[]) {
  return useQueries({
    queries: vnets.map((vnet) => ({
      queryKey: sdnKeys.subnets(vnet),
      queryFn: ({ signal }: { signal: AbortSignal }) => get<SdnSubnet[]>(p`/cluster/sdn/vnets/${vnet}/subnets`, PENDING, { signal }),
    })),
    combine: (results) => ({
      data: results.flatMap((r) => r.data ?? []),
      isPending: results.some((r) => r.isPending),
    }),
  })
}

export function useSdnControllers() {
  return useQuery({
    queryKey: sdnKeys.controllers(),
    queryFn: ({ signal }) => get<SdnController[]>('/cluster/sdn/controllers', PENDING, { signal }),
  })
}

export function useSdnIpams() {
  return useQuery({ queryKey: sdnKeys.ipams(), queryFn: ({ signal }) => get<SdnIpam[]>('/cluster/sdn/ipams', undefined, { signal }) })
}

export function useIpamStatus(ipam: string) {
  return useQuery({
    queryKey: sdnKeys.ipamStatus(ipam),
    queryFn: ({ signal }) => get<IpamEntry[]>(p`/cluster/sdn/ipams/${ipam}/status`, undefined, { signal }),
  })
}

export function useSdnDns() {
  return useQuery({ queryKey: sdnKeys.dns(), queryFn: ({ signal }) => get<SdnDns[]>('/cluster/sdn/dns', undefined, { signal }) })
}

export function useSdnFabrics() {
  return useQuery({
    queryKey: sdnKeys.fabrics(),
    queryFn: ({ signal }) => get<SdnFabricsAll>('/cluster/sdn/fabrics/all', PENDING, { signal }),
  })
}

export function useRouteMapEntries() {
  return useQuery({
    queryKey: sdnKeys.routeMaps(),
    queryFn: ({ signal }) => get<RouteMapEntry[]>('/cluster/sdn/route-maps/entries', PENDING, { signal }),
  })
}

export function usePrefixLists() {
  return useQuery({
    queryKey: sdnKeys.prefixLists(),
    queryFn: ({ signal }) => get<PrefixList[]>('/cluster/sdn/prefix-lists', { ...PENDING, verbose: 1 }, { signal }),
  })
}

export function useDryRun(node: string | undefined) {
  return useQuery({
    queryKey: sdnKeys.dryRun(node ?? ''),
    queryFn: ({ signal }) => get<DryRun>('/cluster/sdn/dry-run', { node }, { signal }),
    enabled: !!node,
    staleTime: 0,
    gcTime: 0,
  })
}

/** A per-node runtime view (only while `enabled`). */
export function useNodeSdn<T>(node: string | undefined, path: string, key: string[], enabled = true) {
  return useQuery({
    queryKey: sdnKeys.node(node ?? '', ...key),
    queryFn: ({ signal }) => get<T>(path, undefined, { signal }),
    enabled: !!node && enabled,
    refetchInterval: 15_000,
  })
}

// ----------------------------------------------------------------- writes

export const applySdn = () => put<string>('/cluster/sdn')
export const rollbackSdn = () => post('/cluster/sdn/rollback')
export const releaseSdnLock = () => del('/cluster/sdn/lock', { force: 1 })

export type SdnCollection = 'zones' | 'vnets' | 'controllers' | 'ipams' | 'dns'

export const createSdnObject = (kind: SdnCollection, params: Params) => post(`/cluster/sdn/${kind}`, params)
export const updateSdnObject = (kind: SdnCollection, id: string, params: Params) => put(p`/cluster/sdn/${kind}/${id}`, params)
export const deleteSdnObject = (kind: SdnCollection, id: string) => del(p`/cluster/sdn/${kind}/${id}`)

export const createSubnet = (vnet: string, params: Params) => post(p`/cluster/sdn/vnets/${vnet}/subnets`, params)
export const updateSubnet = (vnet: string, subnet: string, params: Params) => put(p`/cluster/sdn/vnets/${vnet}/subnets/${subnet}`, params)
export const deleteSubnet = (vnet: string, subnet: string) => del(p`/cluster/sdn/vnets/${vnet}/subnets/${subnet}`)

export const createIpMapping = (vnet: string, params: { zone: string; ip: string; mac?: string }) =>
  post(p`/cluster/sdn/vnets/${vnet}/ips`, params)
export const updateIpMapping = (vnet: string, params: { zone: string; ip: string; mac?: string; vmid?: number }) =>
  put(p`/cluster/sdn/vnets/${vnet}/ips`, params)
export const deleteIpMapping = (vnet: string, params: { zone: string; ip: string; mac?: string }) =>
  del(p`/cluster/sdn/vnets/${vnet}/ips`, params)

export const createFabric = (params: Params) => post('/cluster/sdn/fabrics/fabric', params)
export const updateFabric = (id: string, params: Params) => put(p`/cluster/sdn/fabrics/fabric/${id}`, params)
export const deleteFabric = (id: string) => del(p`/cluster/sdn/fabrics/fabric/${id}`)
export const createFabricNode = (fabric: string, params: Params) => post(p`/cluster/sdn/fabrics/node/${fabric}`, params)
export const updateFabricNode = (fabric: string, node: string, params: Params) => put(p`/cluster/sdn/fabrics/node/${fabric}/${node}`, params)
export const deleteFabricNode = (fabric: string, node: string) => del(p`/cluster/sdn/fabrics/node/${fabric}/${node}`)

export const createRouteMapEntry = (params: Params) => post('/cluster/sdn/route-maps/entries', params)
export const updateRouteMapEntry = (id: string, order: number, params: Params) =>
  put(p`/cluster/sdn/route-maps/entries/${id}/entry/${order}`, params)
export const deleteRouteMapEntry = (id: string, order: number) => del(p`/cluster/sdn/route-maps/entries/${id}/entry/${order}`)

export const createPrefixList = (params: Params) => post('/cluster/sdn/prefix-lists', params)
export const deletePrefixList = (id: string) => del(p`/cluster/sdn/prefix-lists/${id}`)
export const createPrefixListEntry = (id: string, params: Params) => post(p`/cluster/sdn/prefix-lists/${id}/entries`, params)
export const updatePrefixListEntry = (id: string, seq: number, params: Params) => put(p`/cluster/sdn/prefix-lists/${id}/entries/${seq}`, params)
export const deletePrefixListEntry = (id: string, seq: number) => del(p`/cluster/sdn/prefix-lists/${id}/entries/${seq}`)

/** Every network interface of a node (fabric interface pickers). */
export function useNodeInterfaces(node: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.node(node ?? ''), 'network-list', 'all'],
    queryFn: async ({ signal }) => {
      const list = await get<{ iface: string; type: string; cidr?: string; cidr6?: string }[]>(p`/nodes/${node ?? ''}/network`, undefined, { signal })
      return [...list].sort((a, b) => a.iface.localeCompare(b.iface, undefined, { numeric: true }))
    },
    enabled: !!node,
    staleTime: 30_000,
  })
}
