// Ceph (area ceph): installation, status, monitors / managers / metadata
// servers, OSDs, pools, CephFS, configuration, CRUSH map, flags and log.
//
// Endpoints (see docs/feature-map.md §2.3 and §3.9; schema from
// `pvesh usage /nodes/{node}/ceph -v` and /cluster/ceph):
//   GET  /cluster/ceph/status | metadata?scope=all|versions | flags
//   PUT  /cluster/ceph/flags (task) · PUT /cluster/ceph/flags/{flag} value=
//   POST /nodes/{node}/termproxy cmd=ceph_install cmd-opts=…   (install, see features/ceph/install)
//   POST /nodes/{node}/ceph/init · GET /nodes/{node}/ceph/status
//   GET/POST/DELETE /nodes/{node}/ceph/{mon|mgr|mds}[/{id}]
//   POST /nodes/{node}/ceph/{start|stop|restart} service=<type>.<id> · GET …/cmd-safety
//   GET/POST /nodes/{node}/ceph/osd · DELETE …/osd/{id}?cleanup · POST …/osd/{id}/{in|out|scrub}
//   GET  /nodes/{node}/ceph/osd/{id}/metadata | lv-info?type=block|db|wal
//   GET/POST /nodes/{node}/ceph/pool · GET/PUT/DELETE …/pool/{name} · GET …/pool/{name}/status
//   GET/POST/DELETE /nodes/{node}/ceph/fs[/{name}]
//   GET  /nodes/{node}/ceph/{cfg/raw|cfg/db|cfg/value|crush|rules|log}
//
// Newer pve-manager only (gated with usePveFeature, api/pve-features.ts):
//   GET  /cluster/ceph/health-mute · PUT /cluster/ceph/health-mute/{code} value= ttl= sticky=   (≥ 9.2.12)
//   POST /cluster/ceph/restart-bulk service-type=mon|mgr|mds|osd (task)                          (≥ 9.2.5)
//   POST /nodes/{node}/ceph/restart-bulk service-type=osd (task)                                 (≥ 9.2.5)
//   GET  /nodes/{node}/ceph/releases                                                             (≥ 9.2.7)
//   PUT  /cluster/ceph/flags noautoscale=                                                        (≥ 9.2.23)
//
// Most node-scoped reads are cluster-wide (any node with Ceph configured
// answers them); the page picks one "API node" (features/ceph/useCephNode.ts).
// Services are managed on the node they run on.
//
// Pure parsing (health, PG states, OSD tree, services, forms → params) lives
// in features/ceph/model.ts.

import { useQuery } from '@tanstack/react-query'

import { del, get, isPveApiError, p, post, put, requestEnvelope, type Params } from './client'
import { queryKeys } from './queries'
import type { DiskEntry } from './node-disks'
import type { PveBool } from './types'

// ------------------------------------------------------------------ types

export type CephHealthStatus = 'HEALTH_OK' | 'HEALTH_WARN' | 'HEALTH_ERR' | (string & {})

export interface CephHealthCheck {
  severity: CephHealthStatus
  summary: { message: string; count?: number }
  detail?: { message: string }[]
  muted?: boolean
}

export interface CephPgState {
  state_name: string
  count: number
}

/** GET /cluster/ceph/status (raw `ceph status`, only the parts we read). */
export interface CephStatus {
  fsid?: string
  health?: { status: CephHealthStatus; checks?: Record<string, CephHealthCheck>; mutes?: unknown[] }
  quorum_names?: string[]
  monmap?: { mons?: { name: string; addr?: string; public_addr?: string; rank?: number }[]; min_mon_release_name?: string }
  mgrmap?: { active_name?: string; available?: boolean; standbys?: { name: string }[] }
  fsmap?: { by_rank?: { name: string; rank: number; status: string; filesystem_id?: number }[]; 'up:standby'?: number }
  osdmap?: { num_osds?: number; num_up_osds?: number; num_in_osds?: number; num_remapped_pgs?: number }
  pgmap?: {
    pgs_by_state?: CephPgState[]
    num_pgs?: number
    num_pools?: number
    num_objects?: number
    bytes_used?: number
    bytes_avail?: number
    bytes_total?: number
    data_bytes?: number
    read_bytes_sec?: number
    write_bytes_sec?: number
    read_op_per_sec?: number
    write_op_per_sec?: number
    degraded_objects?: number
    degraded_total?: number
    degraded_ratio?: number
    misplaced_objects?: number
    misplaced_total?: number
    unfound_objects?: number
    unfound_total?: number
    recovering_objects_per_sec?: number
    recovering_bytes_per_sec?: number
  }
  progress_events?: Record<string, { message: string; progress: number }>
}

/** One daemon in /cluster/ceph/metadata (keys "<id>@<host>" for mon/mgr/mds). */
export interface CephDaemonMetadata {
  name?: string
  hostname?: string
  addr?: string
  addrs?: string
  ceph_release?: string
  ceph_version?: string
  ceph_version_short?: string
  /** PVE: the systemd unit exists on the host. */
  service?: boolean
  direxists?: boolean
  mem_total_kb?: string
}

export interface CephOsdMetadata extends CephDaemonMetadata {
  id: number
  hostname?: string
  osd_objectstore?: string
  default_device_class?: string
  devices?: string
}

export interface CephMetadata {
  mon?: Record<string, CephDaemonMetadata>
  mgr?: Record<string, CephDaemonMetadata>
  mds?: Record<string, CephDaemonMetadata>
  osd?: CephOsdMetadata[]
  /** Installed Ceph version per node. */
  node?: Record<string, { buildcommit?: string; version?: { parts?: string[]; str?: string } }>
}

export interface CephFlag {
  name: string
  description: string
  value: PveBool | boolean
}

/** GET /nodes/{node}/ceph/mon entry. */
export interface CephMon {
  name: string
  host?: string
  addr?: string
  rank?: number
  quorum?: PveBool
  /** "running" | "stopped" | "unknown" */
  state?: string
  service?: boolean | PveBool
  direxists?: boolean | PveBool
  ceph_version?: string
  ceph_version_short?: string
}

/** GET /nodes/{node}/ceph/mgr entry. */
export interface CephMgr {
  name: string
  host?: string
  addr?: string
  /** "active" | "standby" | "stopped" | "unknown" */
  state?: string
  service?: boolean | PveBool
  direxists?: boolean | PveBool
  ceph_version?: string
  ceph_version_short?: string
}

/** GET /nodes/{node}/ceph/mds entry. */
export interface CephMds {
  name: string
  host?: string
  addr?: string
  /** "up:active" | "up:standby" | "up:standby-replay" | "stopped" | "unknown" */
  state?: string
  rank?: number
  standby_replay?: PveBool | boolean
  service?: boolean | PveBool
  direxists?: boolean | PveBool
  fs_name?: string
  ceph_version?: string
  ceph_version_short?: string
}

/** A node of GET /nodes/{node}/ceph/osd's tree (root → host → osd). */
export interface CephOsdTreeNode {
  id: string | number
  name: string
  /** "root" | "host" | "osd" | other CRUSH bucket types */
  type: string
  leaf?: number
  children?: CephOsdTreeNode[]
  status?: 'up' | 'down' | (string & {})
  in?: PveBool
  host?: string
  device_class?: string
  osdtype?: string
  blfsdev?: string | null
  dbdev?: string | null
  waldev?: string | null
  crush_weight?: number
  reweight?: number
  percent_used?: number
  bytes_used?: number
  total_space?: number
  apply_latency_ms?: number
  commit_latency_ms?: number
  pgs?: number
  ceph_version?: string
  ceph_version_short?: string
  /** host buckets: Ceph version installed on the host */
  version?: string
}

export interface CephOsdTree {
  /** Comma-separated OSD map flags (noout, …). */
  flags?: string
  root: { children?: CephOsdTreeNode[]; leaf?: number }
}

/** GET /nodes/{node}/ceph/osd/{id}/metadata */
export interface CephOsdDetails {
  osd: {
    id: number
    hostname?: string
    pid?: number
    version?: string
    mem_usage?: number
    osd_data?: string
    osd_objectstore?: string
    front_addr?: string
    back_addr?: string
    hb_front_addr?: string
    hb_back_addr?: string
    encrypted?: PveBool
  }
  devices: { device: 'block' | 'db' | 'wal' | (string & {}); dev_node?: string; physical_device?: string; size?: number; support_discard?: boolean | PveBool; type?: string }[]
}

/** GET /nodes/{node}/ceph/osd/{id}/lv-info */
export interface CephLvInfo {
  creation_time?: string
  lv_name?: string
  lv_path?: string
  lv_size?: number
  lv_uuid?: string
  vg_name?: string
}

export type PgAutoscaleMode = 'on' | 'off' | 'warn'
export type PoolApplication = 'rbd' | 'cephfs' | 'rgw'

/** GET /nodes/{node}/ceph/pool entry. */
export interface CephPool {
  pool: number
  pool_name: string
  /** "replicated" | "erasure" */
  type?: string
  size: number
  min_size: number
  pg_num: number
  pg_num_min?: number
  pg_num_final?: number
  pg_autoscale_mode?: PgAutoscaleMode
  crush_rule?: number
  crush_rule_name?: string
  bytes_used?: number
  percent_used?: number
  target_size?: number
  target_size_ratio?: number
  /** { rbd: {}, cephfs: { data: 'cephfs' } } */
  application_metadata?: Record<string, unknown>
  autoscale_status?: Record<string, unknown>
}

/** GET /nodes/{node}/ceph/pool/{name}/status (editable settings). */
export interface CephPoolStatus {
  name: string
  id?: number
  size?: number
  min_size?: number
  pg_num?: number
  pg_num_min?: number
  pg_autoscale_mode?: PgAutoscaleMode
  crush_rule?: string
  application?: string
  application_list?: string[]
  target_size?: number
  target_size_ratio?: number
  fast_read?: PveBool | boolean
  hashpspool?: PveBool | boolean
  nodelete?: PveBool | boolean
  nopgchange?: PveBool | boolean
  nosizechange?: PveBool | boolean
  noscrub?: PveBool | boolean
  'nodeep-scrub'?: PveBool | boolean
  use_gmt_hitset?: PveBool | boolean
  write_fadvise_dontneed?: PveBool | boolean
}

/** GET /nodes/{node}/ceph/fs entry. */
export interface CephFs {
  name: string
  metadata_pool: string
  data_pool: string
}

/** GET /nodes/{node}/ceph/cfg/db entry. */
export interface CephConfigDbEntry {
  section: string
  name: string
  value: string
  level?: string
  mask?: string
  can_update_at_runtime?: PveBool | boolean
}

export interface CephLogLine {
  n: number
  t: string
}

export interface CephCmdSafety {
  safe: PveBool | boolean
  status?: string
}

export type CephServiceType = 'mon' | 'mgr' | 'mds' | 'osd'

/** GET /cluster/ceph/health-mute entry. */
export interface CephHealthMute {
  code: string
  /** The mute survives the check getting worse. */
  sticky?: boolean | PveBool
  summary?: string
  /** When the mute expires; absent when it does not. */
  ttl?: string
}

/** GET /nodes/{node}/ceph/releases entry. */
export interface CephReleaseInfo {
  /** Code name, e.g. "squid". */
  release: string
  /** Major version, e.g. "19.2". */
  version: string
  /** Installable on this node (packages for its architecture and PVE release). */
  available: boolean | PveBool
  /** Recommended for new installations. */
  'is-default'?: boolean | PveBool
  /** Not (yet) supported for production use. */
  unsupported?: boolean | PveBool
}

// ------------------------------------------------------------------- keys

export const cephKeys = {
  /** Everything Ceph of the cluster (also the node-scoped reads below). */
  all: () => ['pve', 'ceph'] as const,
  status: () => ['pve', 'ceph', 'status'] as const,
  metadata: (scope: 'all' | 'versions') => ['pve', 'ceph', 'metadata', scope] as const,
  flags: () => ['pve', 'ceph', 'flags'] as const,
  /** Per-node install / config state (GET /nodes/{node}/ceph/status). */
  nodeStatus: (node: string) => [...queryKeys.node(node), 'ceph', 'status'] as const,
  mons: () => ['pve', 'ceph', 'mon'] as const,
  mgrs: () => ['pve', 'ceph', 'mgr'] as const,
  mds: () => ['pve', 'ceph', 'mds'] as const,
  osd: () => ['pve', 'ceph', 'osd'] as const,
  osdDetails: (id: number) => ['pve', 'ceph', 'osd', id, 'details'] as const,
  osdLv: (id: number, type: string) => ['pve', 'ceph', 'osd', id, 'lv', type] as const,
  pools: () => ['pve', 'ceph', 'pool'] as const,
  pool: (name: string) => ['pve', 'ceph', 'pool', name] as const,
  rules: () => ['pve', 'ceph', 'rules'] as const,
  fs: () => ['pve', 'ceph', 'fs'] as const,
  cfgRaw: () => ['pve', 'ceph', 'cfg', 'raw'] as const,
  cfgDb: () => ['pve', 'ceph', 'cfg', 'db'] as const,
  cfgValue: (keys: string) => ['pve', 'ceph', 'cfg', 'value', keys] as const,
  crush: () => ['pve', 'ceph', 'crush'] as const,
  log: (node: string) => [...queryKeys.node(node), 'ceph', 'log'] as const,
  healthMutes: () => ['pve', 'ceph', 'health-mute'] as const,
  releases: (node: string) => [...queryKeys.node(node), 'ceph', 'releases'] as const,
}

/** Ceph status polls like the official UI (5 s); lists a bit slower. */
export const CEPH_POLL = { status: 5_000, lists: 10_000 } as const

// --------------------------------------------------------- install state

/**
 * What GET …/ceph/status tells about the installation (official
 * PVE.Utils.monitor_ceph_installed / the install wizard's polling):
 * - "binary not installed: /usr/bin/ceph-mon"           → not-installed
 * - "pveceph configuration not initialized - …"          → not-initialized
 * - "rados_connect failed - …" / "got timeout"           → unreachable (configured, no monitor answers)
 */
export type CephInstallState = 'ok' | 'not-installed' | 'not-initialized' | 'unreachable' | 'error'

export function cephErrorState(error: unknown): CephInstallState {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  if (/not installed/i.test(msg)) return 'not-installed'
  if (/not initialized/i.test(msg)) return 'not-initialized'
  if (/rados_connect failed|got timeout|ENOENT.*ceph\.conf|error connecting to the cluster/i.test(msg)) return 'unreachable'
  return 'error'
}

const noRetryOnSetup = (count: number, error: unknown) =>
  count < 2 && !(isPveApiError(error) && error.status < 500) && cephErrorState(error) === 'error'

// ------------------------------------------------------------------ reads

export function fetchCephStatus(signal?: AbortSignal) {
  return get<CephStatus>('/cluster/ceph/status', undefined, { signal })
}

/** Cluster status (health, maps, usage). Errors carry the install state. */
export function useCephStatus(options: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: cephKeys.status(),
    queryFn: ({ signal }) => fetchCephStatus(signal),
    refetchInterval: options.refetchInterval ?? CEPH_POLL.status,
    enabled: options.enabled ?? true,
    retry: noRetryOnSetup,
  })
}

/** Install state of one node (its /nodes/{node}/ceph/status). */
export function useNodeCephStatus(node: string | null | undefined, options: { refetchInterval?: number | false; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: cephKeys.nodeStatus(node ?? ''),
    queryFn: ({ signal }) => get<CephStatus>(p`/nodes/${node ?? ''}/ceph/status`, undefined, { signal }),
    enabled: !!node && (options.enabled ?? true),
    refetchInterval: options.refetchInterval ?? CEPH_POLL.lists,
    retry: noRetryOnSetup,
  })
}

export function useCephMetadata(scope: 'all' | 'versions' = 'all', enabled = true) {
  return useQuery({
    queryKey: cephKeys.metadata(scope),
    queryFn: ({ signal }) => get<CephMetadata>('/cluster/ceph/metadata', { scope }, { signal }),
    enabled,
    refetchInterval: CEPH_POLL.lists,
    retry: noRetryOnSetup,
  })
}

export function useCephFlags(enabled = true) {
  return useQuery({
    queryKey: cephKeys.flags(),
    queryFn: ({ signal }) => get<CephFlag[]>('/cluster/ceph/flags', undefined, { signal }),
    enabled,
    refetchInterval: CEPH_POLL.lists,
  })
}

/** 501: the endpoint does not exist on this (older) PVE. */
function isNotImplemented(error: unknown): boolean {
  return isPveApiError(error) && error.status === 501
}

/**
 * Muted health checks (pve-manager ≥ 9.2.12). `null` when the node answers 501
 * (older PVE); other errors (no Sys.Audit / Datastore.Audit) stay errors and
 * are not retried. Polling stops once the endpoint is known to be missing.
 */
export function useCephHealthMutes(enabled = true) {
  return useQuery({
    queryKey: cephKeys.healthMutes(),
    queryFn: async ({ signal }) => {
      try {
        return await get<CephHealthMute[]>('/cluster/ceph/health-mute', undefined, { signal })
      } catch (e) {
        if (isNotImplemented(e)) return null
        throw e
      }
    },
    enabled,
    retry: false,
    refetchInterval: (q) => (q.state.data === null || q.state.error ? false : CEPH_POLL.lists),
  })
}

/** Ceph releases known to the node (pve-manager ≥ 9.2.7); `null` on 501. */
export function useCephReleases(node: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: cephKeys.releases(node ?? ''),
    queryFn: async ({ signal }) => {
      try {
        return await get<CephReleaseInfo[]>(p`/nodes/${node ?? ''}/ceph/releases`, undefined, { signal })
      } catch (e) {
        if (isNotImplemented(e)) return null
        throw e
      }
    },
    enabled: !!node && enabled,
    retry: false,
    staleTime: 5 * 60_000,
  })
}

function nodeList<T>(key: readonly unknown[], path: string, node: string | null | undefined, poll: number | false = CEPH_POLL.lists) {
  return {
    queryKey: [...key, node ?? ''],
    queryFn: ({ signal }: { signal: AbortSignal }) => get<T>(path, undefined, { signal }),
    enabled: !!node,
    refetchInterval: poll,
    retry: noRetryOnSetup,
  }
}

export function useCephMons(node: string | null | undefined) {
  return useQuery(nodeList<CephMon[]>(cephKeys.mons(), p`/nodes/${node ?? ''}/ceph/mon`, node))
}

export function useCephMgrs(node: string | null | undefined) {
  return useQuery(nodeList<CephMgr[]>(cephKeys.mgrs(), p`/nodes/${node ?? ''}/ceph/mgr`, node))
}

export function useCephMds(node: string | null | undefined) {
  return useQuery(nodeList<CephMds[]>(cephKeys.mds(), p`/nodes/${node ?? ''}/ceph/mds`, node))
}

export function useCephOsdTree(node: string | null | undefined) {
  return useQuery(nodeList<CephOsdTree>(cephKeys.osd(), p`/nodes/${node ?? ''}/ceph/osd`, node))
}

export function useCephPools(node: string | null | undefined) {
  return useQuery(nodeList<CephPool[]>(cephKeys.pools(), p`/nodes/${node ?? ''}/ceph/pool`, node))
}

export function useCephFsList(node: string | null | undefined) {
  return useQuery(nodeList<CephFs[]>(cephKeys.fs(), p`/nodes/${node ?? ''}/ceph/fs`, node))
}

export function useCephRules(node: string | null | undefined, enabled = true) {
  return useQuery({ ...nodeList<{ name: string }[]>(cephKeys.rules(), p`/nodes/${node ?? ''}/ceph/rules`, node, false), enabled: !!node && enabled })
}

export function useCephConfigRaw(node: string | null | undefined) {
  return useQuery(nodeList<string>(cephKeys.cfgRaw(), p`/nodes/${node ?? ''}/ceph/cfg/raw`, node, false))
}

export function useCephConfigDb(node: string | null | undefined) {
  return useQuery(nodeList<CephConfigDbEntry[]>(cephKeys.cfgDb(), p`/nodes/${node ?? ''}/ceph/cfg/db`, node, false))
}

export function useCephCrush(node: string | null | undefined) {
  return useQuery(nodeList<string>(cephKeys.crush(), p`/nodes/${node ?? ''}/ceph/crush`, node, false))
}

/** `section:key` values from ceph.conf or the config DB, e.g. global:osd_pool_default_size. */
export function useCephConfigValues(node: string | null | undefined, keys: string[], enabled = true) {
  const joined = keys.join(';')
  return useQuery({
    queryKey: [...cephKeys.cfgValue(joined), node ?? ''],
    queryFn: ({ signal }) =>
      get<Record<string, Record<string, string>>>(p`/nodes/${node ?? ''}/ceph/cfg/value`, { 'config-keys': joined }, { signal }),
    enabled: !!node && enabled,
    staleTime: 30_000,
  })
}

export function usePoolStatus(node: string | null | undefined, name: string | null | undefined) {
  return useQuery({
    queryKey: [...cephKeys.pool(name ?? ''), 'status', node ?? ''],
    queryFn: ({ signal }) => get<CephPoolStatus>(p`/nodes/${node ?? ''}/ceph/pool/${name ?? ''}/status`, undefined, { signal }),
    enabled: !!node && !!name,
    staleTime: 0,
  })
}

export function useOsdDetails(node: string | null | undefined, id: number | null | undefined) {
  return useQuery({
    queryKey: [...cephKeys.osdDetails(id ?? -1), node ?? ''],
    queryFn: ({ signal }) => get<CephOsdDetails>(p`/nodes/${node ?? ''}/ceph/osd/${id ?? 0}/metadata`, undefined, { signal }),
    enabled: !!node && id != null && id >= 0,
    staleTime: 10_000,
  })
}

export function useOsdLvInfo(node: string | null | undefined, id: number | null | undefined, type: 'block' | 'db' | 'wal', enabled = true) {
  return useQuery({
    queryKey: [...cephKeys.osdLv(id ?? -1, type), node ?? ''],
    queryFn: ({ signal }) => get<CephLvInfo>(p`/nodes/${node ?? ''}/ceph/osd/${id ?? 0}/lv-info`, { type }, { signal }),
    enabled: enabled && !!node && id != null && id >= 0,
    staleTime: 60_000,
    retry: false,
  })
}

/** Disks / partitions usable for an OSD (type=unused) or for its DB/WAL (type=journal_disks). */
export function useOsdDisks(node: string | null | undefined, type: 'unused' | 'journal_disks', enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.node(node ?? ''), 'disks', 'list', type],
    queryFn: ({ signal }) =>
      get<DiskEntry[]>(p`/nodes/${node ?? ''}/disks/list`, { type, 'include-partitions': 1, skipsmart: 1 }, { signal }),
    enabled: !!node && enabled,
    staleTime: 0,
  })
}

/** The last `lines` lines of the node's Ceph cluster log (and the total line count). */
export async function fetchCephLogTail(node: string, lines: number, signal?: AbortSignal): Promise<{ lines: CephLogLine[]; total: number }> {
  const head = await requestEnvelope<CephLogLine[]>('GET', p`/nodes/${node}/ceph/log`, { start: 0, limit: 1 }, { signal })
  const total = typeof head.total === 'number' ? head.total : 0
  const start = Math.max(0, total - lines)
  const data = await get<CephLogLine[]>(p`/nodes/${node}/ceph/log`, { start, limit: lines }, { signal })
  return { lines: data.filter((l) => l.t !== 'no content'), total }
}

export function useCephLog(node: string | null | undefined, lines: number, follow: boolean) {
  return useQuery({
    queryKey: [...cephKeys.log(node ?? ''), lines],
    queryFn: ({ signal }) => fetchCephLogTail(node ?? '', lines, signal),
    enabled: !!node,
    refetchInterval: follow ? 5_000 : false,
  })
}

export function fetchCmdSafety(node: string, service: Exclude<CephServiceType, 'mgr'>, id: string, action: 'stop' | 'destroy') {
  return get<CephCmdSafety>(p`/nodes/${node}/ceph/cmd-safety`, { service, id, action })
}

// ----------------------------------------------------------------- writes

export function cephInit(node: string, params: Params) {
  return post<null>(p`/nodes/${node}/ceph/init`, params)
}

/** Monitor / manager / metadata server: create (task). */
export function createCephService(node: string, type: Exclude<CephServiceType, 'osd'>, id: string, params?: Params) {
  return post<string>(p`/nodes/${node}/ceph/${type}/${id}`, params)
}

/** Monitor / manager / metadata server: destroy (task). */
export function destroyCephService(node: string, type: Exclude<CephServiceType, 'osd'>, id: string) {
  return del<string>(p`/nodes/${node}/ceph/${type}/${id}`)
}

/** systemd start/stop/restart of `<type>.<id>` (or "ceph" for every service of the node). */
export function cephServiceCommand(node: string, action: 'start' | 'stop' | 'restart', service: string) {
  return post<string>(p`/nodes/${node}/ceph/${action}`, { service })
}

export function createOsd(node: string, params: Params) {
  return post<string>(p`/nodes/${node}/ceph/osd`, params)
}

export function destroyOsd(node: string, id: number, cleanup: boolean) {
  return del<string>(p`/nodes/${node}/ceph/osd/${id}`, cleanup ? { cleanup: 1 } : undefined)
}

export function osdInOut(node: string, id: number, dir: 'in' | 'out') {
  return post<null>(p`/nodes/${node}/ceph/osd/${id}/${dir}`)
}

export function osdScrub(node: string, id: number, deep: boolean) {
  return post<null>(p`/nodes/${node}/ceph/osd/${id}/scrub`, deep ? { deep: 1 } : undefined)
}

export function setCephFlags(values: Record<string, 0 | 1>) {
  return put<string>('/cluster/ceph/flags', values)
}

/** Mute (value=1, optional ttl / sticky) or unmute (value=0) a health check; see model.healthMuteParams. */
export function setCephHealthMute(code: string, params: Params) {
  return put<null>(p`/cluster/ceph/health-mute/${code}`, params)
}

/** Cluster-wide rolling restart of every daemon of one type (task); see model.restartBulkParams. */
export function restartCephBulk(params: Params) {
  return post<string>('/cluster/ceph/restart-bulk', params)
}

/** Rolling restart of all OSDs on one node (task); see model.nodeOsdRestartParams. */
export function restartNodeOsds(node: string, params: Params) {
  return post<string>(p`/nodes/${node}/ceph/restart-bulk`, params)
}

export function createPool(node: string, params: Params) {
  return post<string>(p`/nodes/${node}/ceph/pool`, params)
}

export function updatePool(node: string, name: string, params: Params) {
  return put<string>(p`/nodes/${node}/ceph/pool/${name}`, params)
}

export function destroyPool(node: string, name: string, params: Params) {
  return del<string>(p`/nodes/${node}/ceph/pool/${name}`, params)
}

export function createCephFs(node: string, name: string, params: Params) {
  return post<string>(p`/nodes/${node}/ceph/fs/${name}`, params)
}

export function destroyCephFs(node: string, name: string, params: Params) {
  return del<string>(p`/nodes/${node}/ceph/fs/${name}`, params)
}
