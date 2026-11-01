// API of the guest lifecycle area (guest-lifecycle): migrate, clone, convert
// to template, destroy, HA, and the node / cluster bulk actions.

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

import { del, get, p, post, put, type Params } from './client'
import { queryKeys } from './queries'
import type { GuestType, PveBool } from './types'

type QueryOpts<T> = Omit<UseQueryOptions<T, Error, T>, 'queryKey' | 'queryFn'>

// ------------------------------------------------------------------ types

export interface LocalDisk {
  volid: string
  drivename?: string
  size?: number
  cdrom?: PveBool
  is_unused?: PveBool
  is_vmstate?: PveBool
  is_tpmstate?: PveBool
  is_cloudinit?: PveBool
  is_attached?: PveBool
  replicate?: PveBool
  shared?: PveBool
}

/** Why a node cannot take the guest (qemu and lxc report different subsets). */
export interface NotAllowedNode {
  unavailable_storages?: string[]
  'unavailable-resources'?: string[]
  'blocking-ha-resources'?: { sid: string; cause: string }[]
}

/**
 * GET /nodes/{node}/{type}/{vmid}/migrate[?target=] (fields differ a bit between
 * qemu and lxc). Normalised by useMigratePrecondition: lxc spells the node lists
 * `allowed-nodes` / `not-allowed-nodes`, qemu `allowed_nodes` / `not_allowed_nodes`.
 */
export interface MigratePrecondition {
  running?: PveBool | boolean
  allowed_nodes?: string[]
  not_allowed_nodes?: Record<string, NotAllowedNode>
  local_disks?: LocalDisk[]
  local_resources?: string[]
  'mapped-resources'?: string[]
  'mapped-resource-info'?: Record<string, unknown>
  'dependent-ha-resources'?: string[]
  'has-dbus-vmstate'?: PveBool
}

/** GET .../feature?feature=clone|copy|snapshot */
export interface FeatureResult {
  hasFeature: PveBool | boolean
  nodes?: string[]
}

export interface GuestSnapshot {
  name: string
  description?: string
  snaptime?: number
  parent?: string
  vmstate?: PveBool
}

export interface PoolEntry {
  poolid: string
  comment?: string
}

/** GET /cluster/ha/resources/{sid} */
export interface HaResource {
  sid: string
  type?: 'vm' | 'ct'
  state?: 'started' | 'stopped' | 'enabled' | 'disabled' | 'ignored'
  max_restart?: number
  max_relocate?: number
  failback?: PveBool
  comment?: string
  group?: string
  digest?: string
}

// ------------------------------------------------------------------ keys

export const lifecycleKeys = {
  migrate: (node: string, type: GuestType, vmid: number, target: string | undefined) =>
    [...queryKeys.guest(node, type, vmid), 'migrate', target ?? ''] as const,
  feature: (node: string, type: GuestType, vmid: number, feature: string, snapname?: string) =>
    [...queryKeys.guest(node, type, vmid), 'feature', feature, snapname ?? ''] as const,
  snapshots: (node: string, type: GuestType, vmid: number) => [...queryKeys.guest(node, type, vmid), 'snapshot'] as const,
  pools: () => ['pve', 'pools'] as const,
  ha: (sid: string) => ['pve', 'cluster', 'ha', 'resources', sid] as const,
}

const base = (node: string, type: GuestType, vmid: number) => p`/nodes/${node}/${type}/${vmid}`

// ------------------------------------------------------------------ hooks

type RawMigratePrecondition = MigratePrecondition & {
  'allowed-nodes'?: string[]
  'not-allowed-nodes'?: Record<string, NotAllowedNode>
}

/** Accept both spellings of the node lists (lxc uses kebab-case). */
export function normalizeMigratePrecondition(raw: RawMigratePrecondition): MigratePrecondition {
  const { 'allowed-nodes': allowed, 'not-allowed-nodes': notAllowed, ...rest } = raw
  return {
    ...rest,
    allowed_nodes: rest.allowed_nodes ?? allowed,
    not_allowed_nodes: rest.not_allowed_nodes ?? notAllowed,
  }
}

/** Migration preconditions, re-checked for each target node. */
export function useMigratePrecondition(
  node: string,
  type: GuestType,
  vmid: number,
  target: string | undefined,
  options?: QueryOpts<MigratePrecondition>,
) {
  return useQuery({
    queryKey: lifecycleKeys.migrate(node, type, vmid, target),
    queryFn: async ({ signal }) =>
      normalizeMigratePrecondition(await get<RawMigratePrecondition>(`${base(node, type, vmid)}/migrate`, { target }, { signal })),
    staleTime: 0,
    retry: false,
    ...options,
  })
}

/** Can this guest (or snapshot) be cloned in this mode, and on which nodes? */
export function useGuestFeature(
  node: string,
  type: GuestType,
  vmid: number,
  feature: 'clone' | 'copy',
  snapname?: string,
  options?: QueryOpts<FeatureResult>,
) {
  return useQuery({
    queryKey: lifecycleKeys.feature(node, type, vmid, feature, snapname),
    queryFn: ({ signal }) =>
      get<FeatureResult>(`${base(node, type, vmid)}/feature`, { feature, snapname: snapname && snapname !== 'current' ? snapname : undefined }, { signal }),
    staleTime: 10_000,
    retry: false,
    ...options,
  })
}

export function useGuestSnapshots(node: string, type: GuestType, vmid: number, options?: QueryOpts<GuestSnapshot[]>) {
  return useQuery({
    queryKey: lifecycleKeys.snapshots(node, type, vmid),
    queryFn: ({ signal }) => get<GuestSnapshot[]>(`${base(node, type, vmid)}/snapshot`, undefined, { signal }),
    staleTime: 10_000,
    ...options,
  })
}

export function usePools(options?: QueryOpts<PoolEntry[]>) {
  return useQuery({
    queryKey: lifecycleKeys.pools(),
    queryFn: ({ signal }) => get<PoolEntry[]>('/pools', undefined, { signal }),
    staleTime: 60_000,
    ...options,
  })
}

/** HA resource of a guest, or null when it is not HA managed. */
export function useHaResource(sid: string, options?: QueryOpts<HaResource | null>) {
  return useQuery({
    queryKey: lifecycleKeys.ha(sid),
    queryFn: async ({ signal }) => {
      const list = await get<HaResource[]>('/cluster/ha/resources', undefined, { signal })
      return list.find((r) => r.sid === sid) ?? null
    },
    staleTime: 0,
    ...options,
  })
}

// --------------------------------------------------------------- commands

export const migrateGuest = (node: string, type: GuestType, vmid: number, params: Params) =>
  post<string>(`${base(node, type, vmid)}/migrate`, params)

export const cloneGuest = (node: string, type: GuestType, vmid: number, params: Params) =>
  post<string>(`${base(node, type, vmid)}/clone`, params)

export const convertToTemplate = (node: string, type: GuestType, vmid: number) =>
  post<string | null>(`${base(node, type, vmid)}/template`)

export const destroyGuest = (node: string, type: GuestType, vmid: number, params: Params) =>
  del<string>(base(node, type, vmid), params)

export const setGuestConfig = (node: string, type: GuestType, vmid: number, params: Params) =>
  put<null>(`${base(node, type, vmid)}/config`, params)

export const createHaResource = (params: Params) => post<null>('/cluster/ha/resources', params)
export const updateHaResource = (sid: string, params: Params) => put<null>(p`/cluster/ha/resources/${sid}`, params)
export const deleteHaResource = (sid: string) => del<null>(p`/cluster/ha/resources/${sid}`)

/** POST /nodes/{node}/{startall|stopall|suspendall|migrateall} */
export const nodeBulkAction = (node: string, action: 'startall' | 'stopall' | 'suspendall' | 'migrateall', params: Params) =>
  post<string>(p`/nodes/${node}/${action}`, params)

/** POST /cluster/bulk-action/guest/{start|shutdown|suspend|migrate} (PVE 9). */
export const clusterBulkAction = (action: 'start' | 'shutdown' | 'suspend' | 'migrate', params: Params) =>
  post<string>(p`/cluster/bulk-action/guest/${action}`, params)
