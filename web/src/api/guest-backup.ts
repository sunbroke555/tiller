// Snapshots, backups and restore (area guest-snapshots-backup).
//
// Endpoints (see docs/feature-map.md §4.4 / §5.4 / storage-file-restore):
//   GET/POST    /nodes/{node}/{type}/{vmid}/snapshot
//   GET/PUT     /nodes/{node}/{type}/{vmid}/snapshot/{snap}/config
//   POST        /nodes/{node}/{type}/{vmid}/snapshot/{snap}/rollback   (start)
//   DELETE      /nodes/{node}/{type}/{vmid}/snapshot/{snap}            (force)
//   GET         /nodes/{node}/{type}/{vmid}/feature?feature=snapshot
//   GET         /nodes/{node}/storage/{storage}/content?content=backup&vmid=
//   PUT/DELETE  /nodes/{node}/storage/{storage}/content/{volume}         (notes, protected / delay)
//   GET         /nodes/{node}/vzdump/defaults?storage=
//   POST        /nodes/{node}/vzdump
//   GET         /nodes/{node}/vzdump/extractconfig?volume=
//   POST        /nodes/{node}/qemu (archive=…) | /nodes/{node}/lxc (ostemplate=…, restore=1)
//   GET         /nodes/{node}/storage/{storage}/file-restore/list|download   (PBS only)

import { useQueries, useQuery } from '@tanstack/react-query'

import { apiUrl, del, encodeParams, get, p, post, put, type Params } from './client'
import { POLL, queryKeys, useNodeStorages } from './queries'
import type { GuestType, NodeStorage, PveBool } from './types'

// ------------------------------------------------------------------ types

/** GET /nodes/{node}/{type}/{vmid}/snapshot entry. `name === 'current'` is the live state. */
export interface Snapshot {
  name: string
  parent?: string
  /** Unix seconds; missing for "current". */
  snaptime?: number
  description?: string
  /** QEMU: RAM was saved with the snapshot. */
  vmstate?: PveBool
  /** "current" only: guest is running. */
  running?: PveBool
  digest?: string
  /** "prepare" while being taken, "delete" while being removed. */
  snapstate?: string
}

/** GET /nodes/{node}/storage/{storage}/content?content=backup entry (+ `storage`, added here). */
export interface BackupVolume {
  volid: string
  /** Added by useGuestBackups: the storage the entry came from. */
  storage: string
  content?: string
  /** vma.zst, tar.zst, vma.lzo, tgz, pbs-vm, pbs-ct, … */
  format: string
  size: number
  ctime: number
  vmid?: number
  /** qemu | lxc (PVE 7.2+). */
  subtype?: string
  notes?: string
  protected?: PveBool | boolean
  /** PBS: key fingerprint when encrypted. */
  encrypted?: string
  /** PBS verification result. */
  verification?: { state: 'ok' | 'failed' | string; upid?: string }
}

/** GET /nodes/{node}/vzdump/defaults (only the keys the backup dialog uses). */
export interface VzdumpDefaults {
  mode?: 'snapshot' | 'suspend' | 'stop'
  compress?: string
  'notes-template'?: string
  'notification-mode'?: 'auto' | 'legacy-sendmail' | 'notification-system'
  mailto?: string
  /** Property string ("keep-last=3,keep-daily=7") or, from some versions, an object. */
  'prune-backups'?: string | Record<string, string | number>
  protected?: PveBool
  storage?: string
}

/** GET /nodes/{node}/storage/{storage}/file-restore/list entry. */
export interface FileRestoreEntry {
  /** Base64 encoded path, passed back as `filepath`. */
  filepath: string
  /** Display name. */
  text: string
  /** pxar type: d dir, f file, l symlink, h hardlink, v virtual (disk / partition), b, c, p, s. */
  type: string
  leaf: PveBool | boolean
  size?: number
  /** Unix seconds. */
  mtime?: number
}

// ------------------------------------------------------------- query keys

export const backupKeys = {
  snapshots: (node: string, type: GuestType, vmid: number) => [...queryKeys.guest(node, type, vmid), 'snapshots'] as const,
  snapshotConfig: (node: string, type: GuestType, vmid: number, snap: string) =>
    [...queryKeys.guest(node, type, vmid), 'snapshots', snap, 'config'] as const,
  snapshotFeature: (node: string, type: GuestType, vmid: number) =>
    [...queryKeys.guest(node, type, vmid), 'feature', 'snapshot'] as const,
  /** Running config (`current=1`): its own key, the plain 'config' entry holds the pending-applied one. */
  guestConfig: (node: string, type: GuestType, vmid: number) => [...queryKeys.guest(node, type, vmid), 'config', 'current'] as const,
  backups: (node: string, storage: string, vmid?: number) =>
    [...queryKeys.storage(node, storage), 'content', 'backup', vmid === undefined ? '' : String(vmid)] as const,
  vzdumpDefaults: (node: string, storage: string) => [...queryKeys.node(node), 'vzdump', 'defaults', storage] as const,
  backupConfig: (node: string, volid: string) => [...queryKeys.node(node), 'vzdump', 'extractconfig', volid] as const,
  fileRestore: (node: string, storage: string, volid: string, filepath: string) =>
    [...queryKeys.storage(node, storage), 'file-restore', volid, filepath] as const,
}

// -------------------------------------------------------------- snapshots

const guestBase = (node: string, type: GuestType, vmid: number) => p`/nodes/${node}/${type}/${vmid}`

export function fetchSnapshots(node: string, type: GuestType, vmid: number, signal?: AbortSignal) {
  return get<Snapshot[]>(`${guestBase(node, type, vmid)}/snapshot`, undefined, { signal })
}

/** Snapshot list incl. "current", polled (snapshots change while tasks run). */
export function useSnapshots(node: string, type: GuestType, vmid: number) {
  return useQuery({
    queryKey: backupKeys.snapshots(node, type, vmid),
    queryFn: ({ signal }) => fetchSnapshots(node, type, vmid, signal),
    refetchInterval: POLL.status,
  })
}

/** Whether the current configuration can take snapshots (storage support). */
export function useSnapshotFeature(node: string, type: GuestType, vmid: number, enabled = true) {
  return useQuery({
    queryKey: backupKeys.snapshotFeature(node, type, vmid),
    queryFn: async ({ signal }) => {
      const r = await get<{ hasFeature: PveBool | boolean }>(`${guestBase(node, type, vmid)}/feature`, { feature: 'snapshot' }, { signal })
      return !!r.hasFeature
    },
    enabled,
    staleTime: 30_000,
  })
}

/** The guest config as stored in a snapshot (for display), incl. description and snaptime. */
export function useSnapshotConfig(node: string, type: GuestType, vmid: number, snap: string | null | undefined) {
  return useQuery({
    queryKey: backupKeys.snapshotConfig(node, type, vmid, snap ?? ''),
    queryFn: ({ signal }) =>
      get<Record<string, string | number>>(`${guestBase(node, type, vmid)}/snapshot/${encodeURIComponent(snap!)}/config`, undefined, {
        signal,
      }),
    enabled: !!snap && snap !== 'current',
  })
}

/** Current guest config (QEMU: to know whether the guest agent is enabled). */
export function useGuestConfig(node: string, type: GuestType, vmid: number, enabled = true) {
  return useQuery({
    queryKey: backupKeys.guestConfig(node, type, vmid),
    queryFn: ({ signal }) => get<Record<string, string | number>>(`${guestBase(node, type, vmid)}/config`, { current: 1 }, { signal }),
    enabled,
    staleTime: 15_000,
  })
}

export function createSnapshot(
  node: string,
  type: GuestType,
  vmid: number,
  params: { snapname: string; description?: string; vmstate?: boolean },
) {
  return post<string>(`${guestBase(node, type, vmid)}/snapshot`, {
    snapname: params.snapname,
    description: params.description || undefined,
    // LXC has no vmstate parameter.
    vmstate: type === 'qemu' && params.vmstate ? 1 : undefined,
  })
}

export function updateSnapshotDescription(node: string, type: GuestType, vmid: number, snap: string, description: string) {
  return put(`${guestBase(node, type, vmid)}/snapshot/${encodeURIComponent(snap)}/config`, { description })
}

export function rollbackSnapshot(node: string, type: GuestType, vmid: number, snap: string, opts: { start?: boolean } = {}) {
  return post<string>(`${guestBase(node, type, vmid)}/snapshot/${encodeURIComponent(snap)}/rollback`, {
    start: opts.start ? 1 : undefined,
  })
}

export function deleteSnapshot(node: string, type: GuestType, vmid: number, snap: string, opts: { force?: boolean } = {}) {
  return del<string>(`${guestBase(node, type, vmid)}/snapshot/${encodeURIComponent(snap)}`, {
    force: opts.force ? 1 : undefined,
  })
}

// ---------------------------------------------------------------- backups

/** Storages of a node that can hold backups. */
export function useBackupStorages(node: string | null | undefined) {
  return useNodeStorages(node, 'backup')
}

export function fetchBackups(node: string, storage: string, vmid?: number, signal?: AbortSignal) {
  return get<Omit<BackupVolume, 'storage'>[]>(p`/nodes/${node}/storage/${storage}/content`, { content: 'backup', vmid }, { signal }).then(
    (list) => list.map((b) => ({ ...b, storage })),
  )
}

export interface GuestBackups {
  /** All backups of the guest on every (active) backup storage, newest first. */
  backups: BackupVolume[]
  /** Backup storages that were queried. */
  storages: NodeStorage[]
  /** Storages that failed to list, with the error. */
  errors: { storage: string; error: Error }[]
  /** An unfinished storage must not hide rows already loaded from another one. */
  pendingStorages: string[]
  storageError: Error | null
  isPending: boolean
  isFetching: boolean
  refetch: () => void
}

/**
 * Backups of one guest across all backup storages of the node
 * (one content request per storage, merged). Entries of the other guest type
 * with the same VMID (a deleted CT 100 vs. the VM 100) are left out.
 */
export function useGuestBackups(node: string, type: GuestType, vmid: number): GuestBackups {
  const storagesQuery = useBackupStorages(node)
  const storages = (storagesQuery.data ?? []).filter((s) => s.active !== 0)
  const results = useQueries({
    queries: storages.map((s) => ({
      queryKey: backupKeys.backups(node, s.storage, vmid),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchBackups(node, s.storage, vmid, signal),
      refetchInterval: 60_000,
    })),
  })
  const backups: BackupVolume[] = []
  const errors: GuestBackups['errors'] = []
  results.forEach((r, i) => {
    const storage = storages[i]!.storage
    if (r.error) errors.push({ storage, error: r.error })
    for (const b of r.data ?? []) {
      if (b.vmid !== undefined && Number(b.vmid) !== vmid) continue
      if (backupGuestType(b) !== type) continue
      backups.push(b)
    }
  })
  backups.sort((a, b) => b.ctime - a.ctime || a.volid.localeCompare(b.volid))
  return {
    backups,
    storages,
    errors,
    pendingStorages: storages.filter((_, i) => results[i]?.isPending).map((s) => s.storage),
    storageError: storagesQuery.error,
    isPending: storagesQuery.isPending || (results.length > 0 && results.every((r) => r.isPending)),
    isFetching: storagesQuery.isFetching || results.some((r) => r.isFetching),
    refetch: () => {
      void storagesQuery.refetch()
      for (const r of results) void r.refetch()
    },
  }
}

/** Guest type of a backup volume (like PVE.Utils.volume_is_qemu_backup / _lxc_backup). */
export function backupGuestType(b: Pick<BackupVolume, 'volid' | 'format' | 'subtype'>): GuestType | null {
  if (b.subtype === 'qemu' || b.format === 'pbs-vm' || /:backup\/vzdump-qemu-/.test(b.volid)) return 'qemu'
  if (b.subtype === 'lxc' || b.format === 'pbs-ct' || /:backup\/vzdump-(lxc|openvz)-/.test(b.volid)) return 'lxc'
  // PBS volids: "pbs:backup/vm/100/2026-01-01T00:00:00Z", ".../ct/…".
  if (/:backup\/vm\//.test(b.volid)) return 'qemu'
  if (/:backup\/ct\//.test(b.volid)) return 'lxc'
  return null
}

export function isProtected(b: Pick<BackupVolume, 'protected'>): boolean {
  return b.protected === 1 || b.protected === true
}

const contentPath = (node: string, storage: string, volid: string) => p`/nodes/${node}/storage/${storage}/content/${volid}`

export function updateBackupNotes(node: string, storage: string, volid: string, notes: string) {
  return put(contentPath(node, storage, volid), { notes })
}

export function setBackupProtected(node: string, storage: string, volid: string, value: boolean) {
  return put(contentPath(node, storage, volid), { protected: value ? 1 : 0 })
}

/** Delete a backup; waits up to 5 s server side, so it returns null or a UPID. */
export function deleteBackup(node: string, storage: string, volid: string) {
  return del<string | null>(contentPath(node, storage, volid), { delay: 5 })
}

export function useVzdumpDefaults(node: string, storage: string | null | undefined) {
  return useQuery({
    queryKey: backupKeys.vzdumpDefaults(node, storage ?? ''),
    queryFn: ({ signal }) => get<VzdumpDefaults>(p`/nodes/${node}/vzdump/defaults`, { storage: storage! }, { signal }),
    enabled: !!storage,
    staleTime: 30_000,
  })
}

export function startBackup(node: string, params: Params) {
  return post<string>(p`/nodes/${node}/vzdump`, params)
}

/** The guest config stored in a backup (plain text, "key: value" lines). */
export function useBackupConfig(node: string, volid: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: backupKeys.backupConfig(node, volid ?? ''),
    queryFn: ({ signal }) => get<string>(p`/nodes/${node}/vzdump/extractconfig`, { volume: volid! }, { signal }),
    enabled: enabled && !!volid,
    staleTime: Infinity,
    retry: false,
  })
}

/** POST /nodes/{node}/qemu|lxc with restore parameters (see restoreParams). */
export function startRestore(node: string, type: GuestType, params: Params) {
  return post<string>(p`/nodes/${node}/${type}`, params)
}

// ----------------------------------------------------------- file restore

/** Base64 of a UTF-8 path, as file-restore expects in `filepath`. */
export function encodeFilePath(path: string): string {
  const bytes = new TextEncoder().encode(path)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** Decode a base64 `filepath` back to a readable path. */
export function decodeFilePath(filepath: string): string {
  try {
    const bin = atob(filepath)
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch {
    return filepath
  }
}

/**
 * Children of `filepath` ("/" for the root, otherwise an entry's base64
 * filepath). The first listing of a VM backup boots a small restore VM and
 * answers 503 until it is ready: callers retry on 503.
 */
export function fetchFileRestoreList(node: string, storage: string, volid: string, filepath: string, signal?: AbortSignal) {
  return get<FileRestoreEntry[]>(p`/nodes/${node}/storage/${storage}/file-restore/list`, { volume: volid, filepath }, { signal })
}

/** Browser download URL for a file (or a directory as .zip / .tar.zst). */
export function fileRestoreDownloadUrl(node: string, storage: string, volid: string, filepath: string, opts: { tar?: boolean } = {}) {
  return apiUrl(
    p`/nodes/${node}/storage/${storage}/file-restore/download`,
    encodeParams({ volume: volid, filepath, tar: opts.tar ? 1 : undefined }),
  )
}
