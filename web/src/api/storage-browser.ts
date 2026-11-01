// API of the storage browser area: storage status and RRD, content listing,
// upload / download / templates / OCI pull, volume attributes, prune,
// backup restore and guest import. Types follow `pvesh usage … -v`.

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

import {
  apiUrl,
  CSRF_HEADER,
  del,
  get,
  isPveApiError,
  p,
  post,
  put,
  PveApiError,
  type Params,
} from './client'
import { POLL, queryKeys } from './queries'
import { getSession } from './session'
import type { NodeStorage, PveBool, StorageContent } from './types'

// ------------------------------------------------------------------ types

export type StorageRrdTimeframe = 'hour' | 'day' | 'week' | 'month' | 'year'

/** GET /nodes/{node}/storage/{storage}/status */
export interface StorageStatus {
  type: string
  content: string
  active?: PveBool
  enabled?: PveBool
  shared?: PveBool
  total?: number
  used?: number
  avail?: number
}

/** GET /nodes/{node}/storage/{storage}/rrddata — one sample. */
export interface StorageRrdPoint {
  time: number
  total?: number
  used?: number
}

/** GET /storage/{storage} (storage.cfg entry; needs Datastore.Allocate). */
export interface StorageConfig {
  storage: string
  type: string
  content?: string
  path?: string
  nodes?: string
  shared?: PveBool
  disable?: PveBool
  'prune-backups'?: string
  server?: string
  export?: string
  share?: string
  pool?: string
  vgname?: string
  thinpool?: string
  datastore?: string
  digest?: string
  [key: string]: unknown
}

export type BackupVerifyState = 'ok' | 'failed' | 'none' | (string & {})

/** One entry of GET /nodes/{node}/storage/{storage}/content. */
export interface StorageVolume {
  volid: string
  content: StorageContent
  format: string
  /** Bytes. Missing for some PBS entries (see approximate-size). */
  size?: number
  'approximate-size'?: number
  used?: number
  /** Unix seconds; LVM-thin returns it as a string. */
  ctime?: number | string
  vmid?: number | string
  notes?: string
  protected?: PveBool
  encrypted?: string
  verification?: { state: BackupVerifyState; upid?: string }
  /** Backups: guest type (qemu / lxc). */
  subtype?: 'qemu' | 'lxc' | (string & {})
  parent?: string
}

/** GET /nodes/{node}/aplinfo — one appliance/template of the catalog. */
export interface AplInfoEntry {
  template: string
  package: string
  version: string
  section: string
  os?: string
  type?: string
  headline?: string
  description?: string
  infopage?: string
  location?: string
  architecture?: string
  sha512sum?: string
  md5sum?: string
  source?: string
  manageurl?: string
}

/** GET /nodes/{node}/query-url-metadata */
export interface UrlMetadata {
  filename?: string
  size?: number
  mimetype?: string
}

export type PruneMark = 'keep' | 'remove' | 'protected' | 'renamed'

/** GET /nodes/{node}/storage/{storage}/prunebackups — dry run entry. */
export interface PruneEntry {
  volid: string
  ctime: number
  mark: PruneMark
  type: 'qemu' | 'lxc' | (string & {})
  vmid?: number
}

export interface ImportWarning {
  type: string
  key?: string
  value?: string
  message?: string
}

/** GET /nodes/{node}/storage/{storage}/import-metadata */
export interface ImportMetadata {
  type: 'vm' | (string & {})
  source: string
  'create-args': Record<string, string | number>
  disks?: Record<string, { volid: string; size?: number } | string>
  net?: Record<string, Record<string, string>>
  warnings: ImportWarning[]
}

/** pxar entry types of the PBS file browser (Proxmox.Schema.pxarFileTypes). */
export type FileRestoreType = 'b' | 'c' | 'd' | 'f' | 'h' | 'l' | 'p' | 's' | 'v' | (string & {})

/** One entry of GET /nodes/{node}/storage/{storage}/file-restore/list. */
export interface FileRestoreEntry {
  /** Base64 of the path inside the backup; pass back as `filepath`. */
  filepath: string
  text: string
  type: FileRestoreType
  leaf?: PveBool | boolean
  size?: number
  /** Unix seconds. */
  mtime?: number
}

export const CHECKSUM_ALGORITHMS = ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512'] as const
export type ChecksumAlgorithm = (typeof CHECKSUM_ALGORITHMS)[number]

/** Content types that can be uploaded or downloaded from a URL. */
export type TransferContent = Extract<StorageContent, 'iso' | 'vztmpl' | 'import'>

// ------------------------------------------------------------- query keys

export const storageKeys = {
  status: (node: string, storage: string) => [...queryKeys.storage(node, storage), 'status'] as const,
  rrd: (node: string, storage: string, timeframe: StorageRrdTimeframe) =>
    [...queryKeys.storage(node, storage), 'rrddata', timeframe] as const,
  /** Prefix of every content list of a storage. */
  contentAll: (node: string, storage: string) => [...queryKeys.storage(node, storage), 'content'] as const,
  content: (node: string, storage: string, content: StorageContent | 'all') =>
    [...queryKeys.storage(node, storage), 'content', content] as const,
  config: (storage: string) => ['pve', 'storage-config', storage] as const,
  /** Node storage list with disabled and inactive storages (storage overview). */
  nodeList: (node: string) => [...queryKeys.node(node), 'storage-overview'] as const,
  aplinfo: (node: string) => [...queryKeys.node(node), 'aplinfo'] as const,
  prune: (node: string, storage: string, params: Params) =>
    [...queryKeys.storage(node, storage), 'prune', JSON.stringify(params)] as const,
  importMeta: (node: string, storage: string, volume: string) =>
    [...queryKeys.storage(node, storage), 'import-metadata', volume] as const,
  fileRestore: (node: string, storage: string, volume: string, filepath: string) =>
    [...queryKeys.storage(node, storage), 'file-restore', volume, filepath] as const,
  backupConfig: (node: string, volume: string) => [...queryKeys.node(node), 'extractconfig', volume] as const,
}

type QueryOpts<T> = Omit<UseQueryOptions<T, Error, T>, 'queryKey' | 'queryFn'>

// ----------------------------------------------------------------- reads

export function useStorageStatus(node: string, storage: string, options?: QueryOpts<StorageStatus>) {
  return useQuery({
    queryKey: storageKeys.status(node, storage),
    queryFn: ({ signal }) => get<StorageStatus>(p`/nodes/${node}/storage/${storage}/status`, undefined, { signal }),
    refetchInterval: POLL.status,
    ...options,
  })
}

export function useStorageRrd(
  node: string,
  storage: string,
  timeframe: StorageRrdTimeframe,
  options?: QueryOpts<StorageRrdPoint[]>,
) {
  return useQuery({
    queryKey: storageKeys.rrd(node, storage, timeframe),
    queryFn: ({ signal }) =>
      get<StorageRrdPoint[]>(p`/nodes/${node}/storage/${storage}/rrddata`, { timeframe, cf: 'AVERAGE' }, { signal }),
    refetchInterval: POLL.rrd,
    staleTime: 30_000,
    ...options,
  })
}

/** storage.cfg entry. Fails with 403 without Datastore.Allocate: treat as optional. */
export function useStorageConfig(storage: string, options?: QueryOpts<StorageConfig>) {
  return useQuery({
    queryKey: storageKeys.config(storage),
    queryFn: ({ signal }) => get<StorageConfig>(p`/storage/${storage}`, undefined, { signal }),
    staleTime: 60_000,
    retry: (count, e) => !(isPveApiError(e) && e.status === 403) && count < 2,
    ...options,
  })
}

export function fetchStorageContent(
  node: string,
  storage: string,
  content?: StorageContent,
  vmid?: number,
  signal?: AbortSignal,
): Promise<StorageVolume[]> {
  return get<StorageVolume[]>(p`/nodes/${node}/storage/${storage}/content`, { content, vmid }, { signal })
}

export function useStorageContent(
  node: string,
  storage: string,
  content: StorageContent | undefined,
  options?: QueryOpts<StorageVolume[]>,
) {
  return useQuery({
    queryKey: storageKeys.content(node, storage, content ?? 'all'),
    queryFn: ({ signal }) => fetchStorageContent(node, storage, content, undefined, signal),
    refetchInterval: 30_000,
    ...options,
  })
}

/** All storages of a node, including disabled and inactive ones. */
export function useNodeStorageOverview(node: string, options?: QueryOpts<NodeStorage[]>) {
  return useQuery({
    queryKey: storageKeys.nodeList(node),
    queryFn: ({ signal }) => get<NodeStorage[]>(p`/nodes/${node}/storage`, undefined, { signal }),
    refetchInterval: POLL.status,
    ...options,
  })
}

/** Appliance catalog of `pveam`. Updated daily by the node, so cache long. */
export function useAplInfo(node: string, options?: QueryOpts<AplInfoEntry[]>) {
  return useQuery({
    queryKey: storageKeys.aplinfo(node),
    queryFn: ({ signal }) => get<AplInfoEntry[]>(p`/nodes/${node}/aplinfo`, undefined, { signal }),
    staleTime: 10 * 60_000,
    ...options,
  })
}

export function queryUrlMetadata(node: string, url: string, verifyCertificates: boolean, signal?: AbortSignal) {
  return get<UrlMetadata>(p`/nodes/${node}/query-url-metadata`, { url, 'verify-certificates': verifyCertificates }, { signal })
}

export function queryOciTags(node: string, reference: string, signal?: AbortSignal) {
  return get<string[]>(p`/nodes/${node}/query-oci-repo-tags`, { reference }, { signal })
}

export function fetchBackupConfig(node: string, volume: string, signal?: AbortSignal) {
  return get<string>(p`/nodes/${node}/vzdump/extractconfig`, { volume }, { signal })
}

export function useBackupConfig(node: string, volume: string | null, options?: QueryOpts<string>) {
  return useQuery({
    queryKey: storageKeys.backupConfig(node, volume ?? ''),
    queryFn: ({ signal }) => fetchBackupConfig(node, volume!, signal),
    enabled: !!volume,
    staleTime: 5 * 60_000,
    retry: false,
    ...options,
  })
}

export function fetchPrunePreview(node: string, storage: string, params: Params, signal?: AbortSignal) {
  return get<PruneEntry[]>(p`/nodes/${node}/storage/${storage}/prunebackups`, params, { signal })
}

export function useImportMetadata(node: string, storage: string, volume: string | null, options?: QueryOpts<ImportMetadata>) {
  return useQuery({
    queryKey: storageKeys.importMeta(node, storage, volume ?? ''),
    queryFn: ({ signal }) =>
      get<ImportMetadata>(p`/nodes/${node}/storage/${storage}/import-metadata`, { volume: volume! }, { signal }),
    enabled: !!volume,
    staleTime: 60_000,
    retry: false,
    ...options,
  })
}

/** Root of a PBS backup's file tree (the official browser's defaultRootId). */
export const FILE_RESTORE_ROOT = '/'

export function fetchFileRestoreList(node: string, storage: string, volume: string, filepath: string, signal?: AbortSignal) {
  return get<FileRestoreEntry[]>(p`/nodes/${node}/storage/${storage}/file-restore/list`, { volume, filepath }, { signal })
}

/**
 * One directory of a PBS backup. VM backups start a small restore VM on the
 * first request; meanwhile PVE answers 503, which the official browser
 * retries up to 10 times — so do we.
 */
export function useFileRestoreList(
  node: string,
  storage: string,
  volume: string | null,
  filepath: string,
  options?: QueryOpts<FileRestoreEntry[]>,
) {
  return useQuery({
    queryKey: storageKeys.fileRestore(node, storage, volume ?? '', filepath),
    queryFn: ({ signal }) => fetchFileRestoreList(node, storage, volume!, filepath, signal),
    enabled: !!volume,
    staleTime: 5 * 60_000,
    retry: (count, e) => isPveApiError(e) && e.status === 503 && count < 10,
    retryDelay: 2_000,
    ...options,
  })
}

/**
 * Download URL of a file (or a directory as .zip, or .tar.zst with `tar`).
 * Plain GET: the browser sends the session cookie, the server streams it.
 */
export function fileRestoreDownloadUrl(node: string, storage: string, volume: string, filepath: string, tar = false): string {
  const q = new URLSearchParams({ volume, filepath })
  if (tar) q.set('tar', '1')
  return apiUrl(p`/nodes/${node}/storage/${storage}/file-restore/download`, q)
}

// ---------------------------------------------------------------- writes

/** DELETE a volume; waits up to `delay` s and returns null when it finished, else a UPID. */
export function deleteVolume(node: string, storage: string, volid: string, delay = 5) {
  return del<string | null>(p`/nodes/${node}/storage/${storage}/content/${volid}`, { delay })
}

export function updateVolume(node: string, storage: string, volid: string, attrs: { notes?: string; protected?: boolean }) {
  return put<null>(p`/nodes/${node}/storage/${storage}/content/${volid}`, attrs)
}

export function downloadFromUrl(node: string, storage: string, params: Params) {
  return post<string>(p`/nodes/${node}/storage/${storage}/download-url`, params)
}

export function downloadTemplate(node: string, storage: string, template: string) {
  return post<string>(p`/nodes/${node}/aplinfo`, { storage, template })
}

export function pullOciImage(node: string, storage: string, reference: string, filename?: string) {
  return post<string>(p`/nodes/${node}/storage/${storage}/oci-registry-pull`, { reference, filename: filename || undefined })
}

export function pruneBackups(node: string, storage: string, params: Params) {
  return del<string | null>(p`/nodes/${node}/storage/${storage}/prunebackups`, params)
}

/** POST /nodes/{node}/qemu|lxc with archive / ostemplate+restore=1. */
export function restoreBackup(node: string, type: 'qemu' | 'lxc', params: Params) {
  return post<string>(p`/nodes/${node}/${type}`, params)
}

export function createImportedVm(node: string, params: Params) {
  return post<string>(p`/nodes/${node}/qemu`, params)
}

// ---------------------------------------------------------------- upload

export interface UploadProgress {
  loaded: number
  total: number
}

export interface UploadParams {
  node: string
  storage: string
  content: TransferContent
  file: Blob
  /** Target file name on the storage (PVE normalizes it). */
  filename: string
  checksumAlgorithm?: ChecksumAlgorithm
  checksum?: string
}

export interface UploadHandle {
  /** Resolves with the UPID of the copy task PVE starts after the transfer. */
  promise: Promise<string>
  abort: () => void
}

/**
 * The multipart body PVE expects (like the official UI): plain fields first,
 * the file last in the "filename" field, named after the target file.
 */
export function uploadFormData(params: Omit<UploadParams, 'node' | 'storage'>): FormData {
  const fd = new FormData()
  fd.append('content', params.content)
  if (params.checksumAlgorithm && params.checksum?.trim()) {
    fd.append('checksum-algorithm', params.checksumAlgorithm)
    fd.append('checksum', params.checksum.trim())
  }
  fd.append('filename', params.file, params.filename)
  return fd
}

/**
 * Upload a file with progress (XMLHttpRequest: fetch has no upload progress).
 * The Go server streams the body to PVE without buffering. PVE stores it in
 * /var/tmp first, then answers with the UPID of the task that moves it.
 */
export function uploadToStorage(params: UploadParams, onProgress?: (p: UploadProgress) => void): UploadHandle {
  const xhr = new XMLHttpRequest()
  const path = p`/nodes/${params.node}/storage/${params.storage}/upload`
  const promise = new Promise<string>((resolve, reject) => {
    xhr.open('POST', apiUrl(path))
    xhr.withCredentials = true
    xhr.setRequestHeader('Accept', 'application/json')
    const csrf = getSession()?.csrfToken
    if (csrf) xhr.setRequestHeader(CSRF_HEADER, csrf)
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress?.({ loaded: e.loaded, total: e.total })
    })
    xhr.addEventListener('load', () => {
      type Body = { data?: unknown; message?: string; errors?: Record<string, string> }
      let body: Body | null
      try {
        body = xhr.responseText ? (JSON.parse(xhr.responseText) as Body) : null
      } catch {
        body = null
      }
      if (xhr.status >= 200 && xhr.status < 300 && typeof body?.data === 'string') {
        resolve(body.data)
        return
      }
      const message =
        body?.message?.trim() ||
        (xhr.status === 413 ? '文件太大，服务器拒绝接收' : xhr.statusText || `上传失败（HTTP ${xhr.status}）`)
      reject(new PveApiError({ status: xhr.status, message, errors: body?.errors, method: 'POST', path }))
    })
    xhr.addEventListener('error', () =>
      reject(new PveApiError({ status: 0, message: '网络错误，上传中断', method: 'POST', path })),
    )
    xhr.addEventListener('abort', () => reject(new DOMException('上传已取消', 'AbortError')))
    xhr.send(uploadFormData(params))
  })
  return { promise, abort: () => xhr.abort() }
}
