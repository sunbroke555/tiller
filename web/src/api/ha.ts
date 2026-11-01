// High availability (area ha).
//
// Endpoints (see docs/feature-map.md §2.10):
//   GET            /cluster/ha/status/current          quorum, master, fencing, LRMs, services
//   GET            /cluster/ha/status/manager_status   raw CRM/LRM state (node maintenance, LRM mode)
//   POST           /cluster/ha/status/arm-ha | disarm-ha (resource-mode=freeze|ignore)
//   GET/POST       /cluster/ha/resources
//   GET/PUT/DELETE /cluster/ha/resources/{sid}         (DELETE: purge = drop from rules)
//   POST           /cluster/ha/resources/{sid}/migrate | relocate (node)
//   GET/POST       /cluster/ha/rules
//   GET/PUT/DELETE /cluster/ha/rules/{rule}
//   GET            /cluster/ha/groups                   (deprecated: errors once migrated to rules)
//   GET/PUT        /cluster/options                     (crs property string)
//
// Reading needs Sys.Audit on /, changing resources and rules Sys.Console,
// CRS settings Sys.Modify.

import { useQuery } from '@tanstack/react-query'

import { del, get, isPveApiError, p, post, put, type Params } from './client'
import { clusterOptionsKey } from './shell'
import type { PveBool } from './types'

// ------------------------------------------------------------------ types

export type HaRequestState = 'started' | 'stopped' | 'enabled' | 'disabled' | 'ignored'
export type HaArmedState = 'armed' | 'standby' | 'disarming' | 'disarmed'

/** GET /cluster/ha/status/current entry. */
export interface HaStatusEntry {
  id: string
  type: 'quorum' | 'master' | 'fencing' | 'lrm' | 'service' | string
  node?: string
  status?: string
  timestamp?: number
  quorate?: PveBool
  'armed-state'?: HaArmedState
  // type = service
  sid?: string
  state?: string
  crm_state?: string
  request_state?: string
  max_restart?: number
  max_relocate?: number
  failback?: PveBool
  'auto-rebalance'?: PveBool
  comment?: string
}

/** GET /cluster/ha/status/manager_status */
export interface HaManagerStatus {
  quorum?: { node?: string; quorate?: string | number }
  manager_status?: {
    master_node?: string
    timestamp?: number
    node_status?: Record<string, string>
    node_request?: Record<string, { maintenance?: number }>
    service_status?: Record<string, { node?: string; state?: string; target?: string; failed_nodes?: string[] }>
  }
  lrm_status?: Record<string, { mode?: string; state?: string; timestamp?: number }>
}

/** GET /cluster/ha/resources entry. */
export interface HaResourceConfig {
  sid: string
  type?: 'vm' | 'ct'
  state?: HaRequestState
  max_restart?: number
  max_relocate?: number
  failback?: PveBool
  'auto-rebalance'?: PveBool
  comment?: string
  /** Legacy HA group (before the migration to rules). */
  group?: string
  digest?: string
}

export type HaRuleType = 'node-affinity' | 'resource-affinity'

/** GET /cluster/ha/rules entry. */
export interface HaRule {
  rule: string
  type: HaRuleType
  /** "vm:100,ct:101" */
  resources: string
  /** node-affinity: "node1:2,node2" */
  nodes?: string
  strict?: PveBool
  /** resource-affinity */
  affinity?: 'positive' | 'negative'
  disable?: PveBool
  comment?: string
  order?: number
  /** Conflicts / errors found by the HA stack: option → messages. */
  errors?: Record<string, string[]>
  digest?: string
}

/** GET /cluster/ha/groups entry (deprecated). */
export interface HaGroup {
  group: string
  nodes: string
  restricted?: PveBool
  nofailback?: PveBool
  comment?: string
  type?: 'group'
}

/** Result of migrate / relocate. */
export interface HaMoveResult {
  sid: string
  'requested-node': string
  'blocking-resources'?: { sid: string; cause: 'node-affinity' | 'resource-affinity' }[]
  'comigrated-resources'?: string[]
}

// ------------------------------------------------------------------- keys

export const haKeys = {
  /** Everything HA (guest-lifecycle's per-guest key lives below it too). */
  all: () => ['pve', 'cluster', 'ha'] as const,
  status: () => ['pve', 'cluster', 'ha', 'status', 'current'] as const,
  manager: () => ['pve', 'cluster', 'ha', 'status', 'manager'] as const,
  resources: () => ['pve', 'cluster', 'ha', 'resources'] as const,
  rules: () => ['pve', 'cluster', 'ha', 'rules'] as const,
  groups: () => ['pve', 'cluster', 'ha', 'groups'] as const,
}

/** HA status polls a bit faster than the cluster status: state changes take a few CRM rounds. */
export const HA_POLL = 5_000

// ------------------------------------------------------------------ hooks

export function useHaStatus() {
  return useQuery({
    queryKey: haKeys.status(),
    queryFn: ({ signal }) => get<HaStatusEntry[]>('/cluster/ha/status/current', undefined, { signal }),
    refetchInterval: HA_POLL,
  })
}

export function useHaManagerStatus() {
  return useQuery({
    queryKey: haKeys.manager(),
    queryFn: ({ signal }) => get<HaManagerStatus>('/cluster/ha/status/manager_status', undefined, { signal }),
    refetchInterval: HA_POLL,
  })
}

export function useHaResources() {
  return useQuery({
    queryKey: haKeys.resources(),
    queryFn: ({ signal }) => get<HaResourceConfig[]>('/cluster/ha/resources', undefined, { signal }),
    refetchInterval: HA_POLL * 2,
  })
}

export function useHaRules() {
  return useQuery({
    queryKey: haKeys.rules(),
    queryFn: ({ signal }) => get<HaRule[]>('/cluster/ha/rules', undefined, { signal }),
    refetchInterval: HA_POLL * 2,
  })
}

/**
 * Legacy HA groups. PVE 9 refuses to list them once the CRM migrated them to
 * node affinity rules; that answer becomes `{ migrated: true }`.
 */
export function useHaGroups() {
  return useQuery({
    queryKey: haKeys.groups(),
    queryFn: async ({ signal }): Promise<{ migrated: boolean; groups: HaGroup[] }> => {
      try {
        const groups = await get<HaGroup[]>('/cluster/ha/groups', undefined, { signal })
        return { migrated: false, groups: groups ?? [] }
      } catch (e) {
        if (isPveApiError(e) && /migrated to rules/i.test(e.message)) return { migrated: true, groups: [] }
        throw e
      }
    },
    staleTime: 60_000,
    retry: false,
  })
}

/** /cluster/options: only `crs` (and `ha`) are read here. Shares the cache with api/shell. */
export function useCrsOptions(enabled = true) {
  return useQuery({
    queryKey: clusterOptionsKey(),
    queryFn: ({ signal }) => get<{ crs?: string; ha?: string; fencing?: string; [k: string]: unknown }>('/cluster/options', undefined, { signal }),
    staleTime: 0,
    enabled,
  })
}

// --------------------------------------------------------------- commands

export const createHaResource = (params: Params) => post<null>('/cluster/ha/resources', params)
export const updateHaResource = (sid: string, params: Params) => put<null>(p`/cluster/ha/resources/${sid}`, params)
export const deleteHaResource = (sid: string, purge = true) =>
  del<null>(p`/cluster/ha/resources/${sid}`, purge ? undefined : { purge: 0 })
export const migrateHaResource = (sid: string, node: string) => post<HaMoveResult>(p`/cluster/ha/resources/${sid}/migrate`, { node })
export const relocateHaResource = (sid: string, node: string) => post<HaMoveResult>(p`/cluster/ha/resources/${sid}/relocate`, { node })

export const createHaRule = (params: Params) => post<null>('/cluster/ha/rules', params)
export const updateHaRule = (rule: string, params: Params) => put<null>(p`/cluster/ha/rules/${rule}`, params)
export const deleteHaRule = (rule: string) => del<null>(p`/cluster/ha/rules/${rule}`)

export const armHa = () => post<null>('/cluster/ha/status/arm-ha')
export const disarmHa = (mode: 'freeze' | 'ignore') => post<null>('/cluster/ha/status/disarm-ha', { 'resource-mode': mode })

export const saveCrsOptions = (params: Params) => put<null>('/cluster/options', params)
