// Scheduled backup jobs (area backup-jobs, /datacenter/backup).
//
// Endpoints (see docs/feature-map.md §2.6):
//   GET/POST          /cluster/backup
//   GET/PUT/DELETE    /cluster/backup/{id}
//   GET               /cluster/backup/{id}/included_volumes
//   GET               /cluster/backup-info/not-backed-up
//   GET               /cluster/jobs/schedule-analyze?schedule=&iterations=
//   POST              /nodes/{node}/vzdump                 (run now)
//
// List/detail need Sys.Audit on "/", writes Sys.Modify on "/".

import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { del, get, p, post, put, type Params } from './client'
import type { GuestType, PveBool } from './types'

// ------------------------------------------------------------------ types

/** Property-string options come back from the JSON API as objects. */
export type PropObject = Record<string, string | number>

/** GET /cluster/backup entry (= GET /cluster/backup/{id}, plus next-run in the list). */
export interface BackupJob {
  id: string
  type?: 'vzdump'
  schedule?: string
  enabled?: PveBool | boolean
  /** Unix seconds; list only. */
  'next-run'?: number
  node?: string
  storage?: string
  comment?: string
  // Selection: vmid list | all (+ exclude) | pool.
  vmid?: string
  all?: PveBool | boolean
  exclude?: string
  pool?: string
  mode?: 'snapshot' | 'suspend' | 'stop'
  compress?: string
  'notification-mode'?: 'auto' | 'legacy-sendmail' | 'notification-system'
  mailto?: string
  mailnotification?: 'always' | 'failure'
  'prune-backups'?: PropObject | string
  'max-protected-backups'?: number
  'notes-template'?: string
  protected?: PveBool | boolean
  bwlimit?: number
  zstd?: number
  ionice?: number
  performance?: PropObject | string
  fleecing?: PropObject | string
  'repeat-missed'?: PveBool | boolean
  'pbs-change-detection-mode'?: 'data' | 'metadata' | 'legacy'
  'exclude-path'?: string[] | string
  // Legacy cron jobs.
  starttime?: string
  dow?: string
  [key: string]: unknown
}

/** One node of GET /cluster/backup/{id}/included_volumes. */
export interface IncludedGuest {
  id: number
  name?: string
  type: GuestType | string
  leaf?: PveBool
  children?: IncludedVolume[]
}

export interface IncludedVolume {
  /** "<vmid>:<key>", e.g. "100:scsi0". */
  id: string
  /** Volume id ("local-lvm:vm-100-disk-0") or a description. */
  name?: string
  included: PveBool | boolean
  /** "backup=yes", "backup=no", "rootfs", "not a volume", … */
  reason?: string
  leaf?: PveBool
}

/** GET /cluster/backup-info/not-backed-up entry. */
export interface UncoveredGuest {
  vmid: number
  name?: string
  type: GuestType
}

/** GET /cluster/jobs/schedule-analyze entry. */
export interface ScheduleRun {
  timestamp: number
  utc?: string
}

// ------------------------------------------------------------- query keys

export const backupJobKeys = {
  all: () => ['pve', 'cluster', 'backup'] as const,
  list: () => [...backupJobKeys.all(), 'list'] as const,
  job: (id: string) => [...backupJobKeys.all(), 'job', id] as const,
  included: (id: string) => [...backupJobKeys.all(), 'job', id, 'included'] as const,
  uncovered: () => [...backupJobKeys.all(), 'not-backed-up'] as const,
  schedule: (schedule: string, iterations: number) => ['pve', 'cluster', 'jobs', 'schedule-analyze', schedule, iterations] as const,
}

// ---------------------------------------------------------------- queries

export function useBackupJobs() {
  return useQuery({
    queryKey: backupJobKeys.list(),
    queryFn: ({ signal }) => get<BackupJob[]>('/cluster/backup', undefined, { signal }),
    refetchInterval: 30_000,
  })
}

export function useBackupJob(id: string | null | undefined) {
  return useQuery({
    queryKey: backupJobKeys.job(id ?? ''),
    queryFn: ({ signal }) => get<BackupJob>(p`/cluster/backup/${id!}`, undefined, { signal }),
    enabled: !!id,
  })
}

export function useIncludedVolumes(id: string | null | undefined) {
  return useQuery({
    queryKey: backupJobKeys.included(id ?? ''),
    queryFn: async ({ signal }) => {
      const r = await get<{ children?: IncludedGuest[] }>(p`/cluster/backup/${id!}/included_volumes`, undefined, { signal })
      return r.children ?? []
    },
    enabled: !!id,
  })
}

export function useUncoveredGuests(enabled = true) {
  return useQuery({
    queryKey: backupJobKeys.uncovered(),
    queryFn: ({ signal }) => get<UncoveredGuest[]>('/cluster/backup-info/not-backed-up', undefined, { signal }),
    enabled,
    refetchInterval: 60_000,
  })
}

/** Next runs of a calendar event (the server's own parser: invalid events fail with 400). */
export function useScheduleRuns(schedule: string | null | undefined, iterations = 5) {
  const s = schedule?.trim() ?? ''
  return useQuery({
    queryKey: backupJobKeys.schedule(s, iterations),
    queryFn: ({ signal }) => get<ScheduleRun[]>('/cluster/jobs/schedule-analyze', { schedule: s, iterations }, { signal }),
    enabled: !!s,
    staleTime: 60_000,
    retry: false,
    placeholderData: keepPreviousData,
  })
}

// ---------------------------------------------------------------- writes

export function createBackupJob(params: Params) {
  return post<null>('/cluster/backup', params)
}

export function updateBackupJob(id: string, params: Params) {
  return put<null>(p`/cluster/backup/${id}`, params)
}

export function deleteBackupJob(id: string) {
  return del<null>(p`/cluster/backup/${id}`)
}

export function startVzdump(node: string, params: Params) {
  return post<string>(p`/nodes/${node}/vzdump`, params)
}
