// API of the storage-config area (数据中心 → 存储配置): storage.cfg entries
// (GET/POST /storage, GET/PUT/DELETE /storage/{id}) and the scan helpers of
// the add dialog (/nodes/{node}/scan/*). Types follow `pvesh usage /storage -v`.

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

import { del, get, p, post, put, type Params } from './client'
import type { PveBool } from './types'

// ------------------------------------------------------------------ types

/** Storage plugin types PVE 9 can create (POST /storage `type`). */
export const STORAGE_TYPES = [
  'dir',
  'lvm',
  'lvmthin',
  'btrfs',
  'zfspool',
  'nfs',
  'cifs',
  'cephfs',
  'rbd',
  'iscsi',
  'iscsidirect',
  'zfs',
  'pbs',
  'esxi',
] as const
export type StorageType = (typeof STORAGE_TYPES)[number]

export function isStorageType(t: string | undefined): t is StorageType {
  return !!t && (STORAGE_TYPES as readonly string[]).includes(t)
}

/**
 * One storage.cfg entry (GET /storage, GET /storage/{id}). Only the keys of
 * its type are present; secrets (password, keyring, encryption-key) are never
 * returned in clear (encryption-key shows the key fingerprint).
 */
export interface StorageDef {
  storage: string
  type: string
  digest?: string
  content?: string
  nodes?: string
  disable?: PveBool
  shared?: PveBool
  'prune-backups'?: string
  'max-protected-backups'?: number
  path?: string
  server?: string
  port?: number
  export?: string
  share?: string
  subdir?: string
  domain?: string
  username?: string
  options?: string
  smbversion?: string
  vgname?: string
  thinpool?: string
  base?: string
  saferemove?: PveBool
  pool?: string
  blocksize?: string
  sparse?: PveBool
  portal?: string
  target?: string
  iscsiprovider?: string
  comstar_tg?: string
  comstar_hg?: string
  lio_tpg?: string
  nowritecache?: PveBool
  monhost?: string
  'fs-name'?: string
  namespace?: string
  krbd?: PveBool
  fuse?: PveBool
  datastore?: string
  fingerprint?: string
  'encryption-key'?: string
  'master-pubkey'?: string
  'skip-cert-verification'?: PveBool
  preallocation?: string
  'snapshot-as-volume-chain'?: PveBool
  bwlimit?: string
  [key: string]: unknown
}

/** POST /storage and PUT /storage/{id} answer. */
export interface StorageWriteResult {
  storage: string
  type: string
  /** Server-generated settings; `encryption-key` after encryption-key=autogen. */
  config?: { 'encryption-key'?: string; [key: string]: unknown }
}

export interface NfsExport {
  path: string
  options?: string
}
export interface CifsShare {
  share: string
  description?: string
}
export interface IscsiTarget {
  target: string
  portal: string
}
export interface LvmGroup {
  vg: string
  size?: number
  free?: number
}
export interface LvmThinPool {
  lv: string
  lv_size?: number
  used?: number
}
export interface ZfsPool {
  pool: string
  size?: number
  free?: number
}
export interface PbsDatastore {
  store: string
  comment?: string
}
/** GET /nodes/{node}/storage/{storage}/content of an iSCSI storage (LUNs). */
export interface IscsiLun {
  volid: string
  size?: number
}
export interface CephPool {
  pool_name: string
}
export interface CephFs {
  name: string
}
export interface CephMon {
  name: string
  addr?: string
}

// ------------------------------------------------------------- query keys

export const storageConfigKeys = {
  /** Prefix of all storage.cfg reads (storage-browser's useStorageConfig lives under it too). */
  all: ['pve', 'storage-config'] as const,
  list: () => ['pve', 'storage-config', '__list__'] as const,
  one: (storage: string) => ['pve', 'storage-config', storage] as const,
  scan: (node: string, kind: string, params?: Params) =>
    ['pve', 'nodes', node, 'scan', kind, JSON.stringify(params ?? {})] as const,
}

type QueryOpts<T> = Omit<UseQueryOptions<T, Error, T>, 'queryKey' | 'queryFn'>

// ----------------------------------------------------------------- reads

/** Every storage.cfg entry the user may see (Datastore.Audit / AllocateSpace). */
export function useStorageDefs(options?: QueryOpts<StorageDef[]>) {
  return useQuery({
    queryKey: storageConfigKeys.list(),
    queryFn: async ({ signal }) => {
      const list = await get<StorageDef[]>('/storage', undefined, { signal })
      return [...list].sort((a, b) => a.storage.localeCompare(b.storage))
    },
    refetchInterval: 30_000,
    ...options,
  })
}

export function fetchStorageDef(storage: string, signal?: AbortSignal) {
  return get<StorageDef>(p`/storage/${storage}`, undefined, { signal })
}

// ---------------------------------------------------------------- writes

export function createStorage(params: Params) {
  return post<StorageWriteResult | null>('/storage', params)
}

export function updateStorage(storage: string, params: Params) {
  return put<StorageWriteResult | null>(p`/storage/${storage}`, params)
}

export function deleteStorage(storage: string) {
  return del(p`/storage/${storage}`)
}

// ----------------------------------------------------------------- scans

export const scanNfs = (node: string, server: string, signal?: AbortSignal) =>
  get<NfsExport[]>(p`/nodes/${node}/scan/nfs`, { server }, { signal })

export const scanCifs = (
  node: string,
  params: { server: string; username?: string; password?: string; domain?: string },
  signal?: AbortSignal,
) => get<CifsShare[]>(p`/nodes/${node}/scan/cifs`, params, { signal })

export const scanIscsi = (node: string, portal: string, signal?: AbortSignal) =>
  get<IscsiTarget[]>(p`/nodes/${node}/scan/iscsi`, { portal }, { signal })

export const scanLvm = (node: string, signal?: AbortSignal) => get<LvmGroup[]>(p`/nodes/${node}/scan/lvm`, undefined, { signal })

export const scanLvmThin = (node: string, vg: string, signal?: AbortSignal) =>
  get<LvmThinPool[]>(p`/nodes/${node}/scan/lvmthin`, { vg }, { signal })

export const scanZfs = (node: string, signal?: AbortSignal) => get<ZfsPool[]>(p`/nodes/${node}/scan/zfs`, undefined, { signal })

export const scanPbs = (
  node: string,
  params: { server: string; username: string; password: string; fingerprint?: string; port?: number },
  signal?: AbortSignal,
) => get<PbsDatastore[]>(p`/nodes/${node}/scan/pbs`, params, { signal })

export const listIscsiLuns = (node: string, storage: string, signal?: AbortSignal) =>
  get<IscsiLun[]>(p`/nodes/${node}/storage/${storage}/content`, { content: 'images' }, { signal })

export const listCephPools = (node: string, signal?: AbortSignal) =>
  get<CephPool[]>(p`/nodes/${node}/ceph/pool`, undefined, { signal })

export const listCephFs = (node: string, signal?: AbortSignal) => get<CephFs[]>(p`/nodes/${node}/ceph/fs`, undefined, { signal })

export const listCephMons = (node: string, signal?: AbortSignal) =>
  get<CephMon[]>(p`/nodes/${node}/ceph/mon`, undefined, { signal })
