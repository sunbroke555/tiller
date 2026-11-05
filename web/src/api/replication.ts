// Storage replication (area replication).
//
// Endpoints (see docs/feature-map.md §2.7 / §3.10 / §4.5 / §5.5):
//   GET/POST       /cluster/replication                      (jobs of the whole cluster)
//   GET/PUT/DELETE /cluster/replication/{id}                  (DELETE: keep, force)
//   GET            /nodes/{node}/replication?guest=            (jobs whose guest lives on the node, with state)
//   GET            /nodes/{node}/replication/{id}/log           (start, limit; limit=0 reads all)
//   POST           /nodes/{node}/replication/{id}/schedule_now
//   GET            /cluster/jobs/schedule-analyze               (schedule preview / validation)
//
// Permissions: listing needs VM.Audit on /vms/<vmid> (jobs without it are
// left out), everything that changes a job needs VM.Replicate there.

import { useQueries, useQuery } from '@tanstack/react-query'

import { del, get, p, post, put, type Params } from './client'
import { queryKeys } from './queries'
import type { GuestType, PveBool } from './types'

// ------------------------------------------------------------------ types

/** GET /cluster/replication entry (job configuration). */
export interface ReplicationJob {
  /** "<vmid>-<jobnum>". */
  id: string
  guest: number
  jobnum: number
  target: string
  type: 'local'
  /** Calendar event; missing = "*\/15". */
  schedule?: string
  /** MB/s; missing = unlimited. */
  rate?: number
  comment?: string
  disable?: PveBool
  /** Don't freeze/thaw the guest's filesystems during a run (libpve-guest-common-perl ≥ 6.0.6). */
  'skip-freeze-fs'?: PveBool
  /** Node the guest lived on when the job was last checked. */
  source?: string
  /** Set after DELETE until the runner has cleaned up. */
  remove_job?: 'full' | 'local'
  digest?: string
}

/** GET /nodes/{node}/replication entry: the job plus its run state. */
export interface ReplicationStatus extends ReplicationJob {
  /** Unix seconds of the last successful sync (0 = never). */
  last_sync?: number
  /** Unix seconds of the last attempt (0 after "schedule now"). */
  last_try?: number
  /** Unix seconds; in the past = due ("pending"). */
  next_sync?: number
  /** Seconds the last run took (fractional). */
  duration?: number
  fail_count?: number
  /** Error of the last failed run. */
  error?: string
  /** Set while a sync is running. */
  pid?: number
  vmtype?: GuestType
}

/** GET /nodes/{node}/replication/{id}/log line. */
export interface ReplicationLogLine {
  n: number
  t: string
}

/** GET /cluster/jobs/schedule-analyze entry. */
export interface ScheduleEvent {
  timestamp: number
  utc: string
}

// ------------------------------------------------------------------- keys

export const replicationKeys = {
  /** Cluster-wide job configuration. */
  jobs: () => ['pve', 'cluster', 'replication'] as const,
  job: (id: string) => ['pve', 'cluster', 'replication', id] as const,
  /** Job states on one node (optionally one guest). */
  node: (node: string, guest?: number) => [...queryKeys.node(node), 'replication', guest === undefined ? '' : String(guest)] as const,
  /** Prefix covering every node-scoped replication query of `node`. */
  nodeScope: (node: string) => [...queryKeys.node(node), 'replication'] as const,
  log: (node: string, id: string) => [...queryKeys.node(node), 'replication-log', id] as const,
  schedule: (schedule: string) => ['pve', 'cluster', 'jobs', 'schedule-analyze', schedule] as const,
}

/** Live state polls about as often as the official UI (3 s) without hammering phones. */
export const REPLICATION_POLL = 5_000

// ------------------------------------------------------------------ reads

export function fetchReplicationJobs(signal?: AbortSignal) {
  return get<ReplicationJob[]>('/cluster/replication', undefined, { signal })
}

/** Every job of the cluster (configuration only, no state). */
export function useReplicationJobs(enabled = true) {
  return useQuery({
    queryKey: replicationKeys.jobs(),
    queryFn: ({ signal }) => fetchReplicationJobs(signal),
    enabled,
    refetchInterval: 10_000,
  })
}

/** One job with its digest (for editing). */
export function useReplicationJob(id: string | null | undefined) {
  return useQuery({
    queryKey: replicationKeys.job(id ?? ''),
    queryFn: ({ signal }) => get<ReplicationJob>(p`/cluster/replication/${id ?? ''}`, undefined, { signal }),
    enabled: !!id,
    staleTime: 0,
  })
}

function fetchNodeReplication(node: string, guest: number | undefined, signal?: AbortSignal) {
  return get<ReplicationStatus[]>(p`/nodes/${node}/replication`, guest === undefined ? undefined : { guest }, { signal })
}

/** Jobs whose guest currently lives on `node`, with their run state. */
export function useNodeReplication(node: string | null | undefined, guest?: number, enabled = true) {
  return useQuery({
    queryKey: replicationKeys.node(node ?? '', guest),
    queryFn: ({ signal }) => fetchNodeReplication(node!, guest, signal),
    enabled: !!node && enabled,
    refetchInterval: REPLICATION_POLL,
  })
}

/** State of every job on several nodes at once (datacenter view), keyed by job id. */
export function useReplicationStates(nodes: readonly string[]) {
  return useQueries({
    queries: nodes.map((node) => ({
      queryKey: replicationKeys.node(node),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchNodeReplication(node, undefined, signal),
      refetchInterval: REPLICATION_POLL,
    })),
    combine: (results) => {
      const byId = new Map<string, ReplicationStatus & { node: string }>()
      results.forEach((r, i) => {
        for (const s of r.data ?? []) byId.set(s.id, { ...s, node: nodes[i]! })
      })
      return {
        byId,
        pending: results.some((r) => r.isPending),
        failedNodes: nodes.filter((_, i) => results[i]?.isError),
      }
    },
  })
}

/** Log of the job's last run (the runner rewrites it on every run). */
export function useReplicationLog(node: string | null | undefined, id: string | null | undefined, { enabled = true, interval = 2_000 } = {}) {
  return useQuery({
    queryKey: replicationKeys.log(node ?? '', id ?? ''),
    queryFn: ({ signal }) => get<ReplicationLogLine[]>(p`/nodes/${node!}/replication/${id!}/log`, { start: 0, limit: 0 }, { signal }),
    enabled: !!node && !!id && enabled,
    refetchInterval: interval,
  })
}

/** Next runs of a calendar event; errors when the server cannot parse it. */
export function analyzeSchedule(schedule: string, iterations = 3, signal?: AbortSignal) {
  return get<ScheduleEvent[]>('/cluster/jobs/schedule-analyze', { schedule, iterations }, { signal })
}

export function useScheduleAnalyze(schedule: string, enabled = true) {
  return useQuery({
    queryKey: replicationKeys.schedule(schedule),
    queryFn: ({ signal }) => analyzeSchedule(schedule, 3, signal),
    enabled: enabled && schedule.trim() !== '',
    staleTime: 60_000,
    retry: false,
  })
}

// ----------------------------------------------------------------- writes

export function createReplicationJob(params: Params) {
  return post('/cluster/replication', params)
}

export function updateReplicationJob(id: string, params: Params) {
  return put(p`/cluster/replication/${id}`, params)
}

export interface DeleteReplicationOptions {
  /** Keep the replicated volumes on the target. */
  keep?: boolean
  /** Only drop the configuration entry, no cleanup at all. */
  force?: boolean
}

export function deleteReplicationJob(id: string, { keep, force }: DeleteReplicationOptions = {}) {
  return del(p`/cluster/replication/${id}`, { keep: keep ? 1 : undefined, force: force ? 1 : undefined })
}

/** Run the job as soon as possible on the node its guest lives on. */
export function scheduleReplicationNow(node: string, id: string) {
  return post(p`/nodes/${node}/replication/${id}/schedule_now`)
}
