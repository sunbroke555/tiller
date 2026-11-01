// API of area guest-create: the data the VM / CT creation wizards pick from
// (pools, ISO images and templates, storages with their disk formats, CPU
// models, CPU flags, machine versions) and the two create calls.

import { useQuery } from '@tanstack/react-query'

import { get, p, post, type Params } from './client'
import { queryKeys } from './queries'
import type { NodeStorage, StorageContent } from './types'

// ------------------------------------------------------------------ types

/** GET /pools */
export interface PoolEntry {
  poolid: string
  comment?: string
}

/** GET /nodes/{node}/storage/{storage}/content */
export interface StorageVolume {
  volid: string
  content: StorageContent | (string & {})
  /** iso, txz, tgz, tzst, tar, raw, qcow2, … */
  format: string
  size: number
  ctime?: number
  notes?: string
  protected?: 0 | 1
}

/** GET /nodes/{node}/storage?format=1: storages with the disk formats they support. */
export interface StorageWithFormats extends NodeStorage {
  formats?: { default: string; supported: string[] }
  /** Storages like iSCSI only offer existing LUNs ("select existing"). */
  select_existing?: 0 | 1
}

/** GET /nodes/{node}/capabilities/qemu/cpu */
export interface CpuModel {
  name: string
  vendor: string
  custom: 0 | 1
}

/** GET /nodes/{node}/capabilities/qemu/cpu-flags */
export interface CpuFlag {
  name: string
  description: string
  'supported-on'?: string[]
}

/** GET /nodes/{node}/capabilities/qemu/machines */
export interface MachineVersion {
  /** "pc-q35-10.1", "pc-i440fx-9.2+pve1" */
  id: string
  type: 'i440fx' | 'q35' | (string & {})
  version: string
  changes?: string
}

// ------------------------------------------------------------------ keys

export const createKeys = {
  pools: () => ['pve', 'pools'] as const,
  content: (node: string, storage: string, content: string) =>
    [...queryKeys.storage(node, storage), 'content', content] as const,
  storageFormats: (node: string, content: string) => [...queryKeys.node(node), 'storage-list', 'formats', content] as const,
  cpuModels: (node: string) => [...queryKeys.node(node), 'capabilities', 'cpu'] as const,
  cpuFlags: (node: string) => [...queryKeys.node(node), 'capabilities', 'cpu-flags'] as const,
  machines: (node: string) => [...queryKeys.node(node), 'capabilities', 'machines'] as const,
}

// ----------------------------------------------------------------- hooks

export function usePools() {
  return useQuery({
    queryKey: createKeys.pools(),
    queryFn: async ({ signal }) => {
      const pools = await get<PoolEntry[]>('/pools', undefined, { signal })
      return [...pools].sort((a, b) => a.poolid.localeCompare(b.poolid))
    },
    staleTime: 60_000,
  })
}

/** Volumes of one content type on a storage (ISO images, CT templates, …), newest first. */
export function useStorageContent(node: string | undefined, storage: string | undefined, content: StorageContent) {
  return useQuery({
    queryKey: createKeys.content(node ?? '', storage ?? '', content),
    queryFn: async ({ signal }) => {
      const list = await get<StorageVolume[]>(p`/nodes/${node!}/storage/${storage!}/content`, { content }, { signal })
      return [...list].sort((a, b) => volumeLabel(a.volid).localeCompare(volumeLabel(b.volid), undefined, { numeric: true }))
    },
    enabled: !!node && !!storage,
    staleTime: 30_000,
  })
}

/** Storages for guest disks with their supported formats (raw/qcow2/vmdk). */
export function useStoragesWithFormats(node: string | undefined, content: StorageContent) {
  return useQuery({
    queryKey: createKeys.storageFormats(node ?? '', content),
    queryFn: ({ signal }) =>
      get<StorageWithFormats[]>(p`/nodes/${node!}/storage`, { content, enabled: 1, format: 1 }, { signal }),
    enabled: !!node,
    staleTime: 15_000,
  })
}

export function useCpuModels(node: string | undefined) {
  return useQuery({
    queryKey: createKeys.cpuModels(node ?? ''),
    queryFn: ({ signal }) => get<CpuModel[]>(p`/nodes/${node!}/capabilities/qemu/cpu`, undefined, { signal }),
    enabled: !!node,
    staleTime: 10 * 60_000,
  })
}

export function useCpuFlags(node: string | undefined) {
  return useQuery({
    queryKey: createKeys.cpuFlags(node ?? ''),
    queryFn: ({ signal }) => get<CpuFlag[]>(p`/nodes/${node!}/capabilities/qemu/cpu-flags`, undefined, { signal }),
    enabled: !!node,
    staleTime: 10 * 60_000,
  })
}

export function useMachineVersions(node: string | undefined) {
  return useQuery({
    queryKey: createKeys.machines(node ?? ''),
    queryFn: ({ signal }) => get<MachineVersion[]>(p`/nodes/${node!}/capabilities/qemu/machines`, undefined, { signal }),
    enabled: !!node,
    staleTime: 10 * 60_000,
  })
}

// ---------------------------------------------------------------- create

/** POST /nodes/{node}/qemu — resolves to the qmcreate UPID. */
export function createQemu(node: string, params: Params): Promise<string> {
  return post<string>(p`/nodes/${node}/qemu`, params)
}

/** POST /nodes/{node}/lxc — resolves to the vzcreate UPID. */
export function createLxc(node: string, params: Params): Promise<string> {
  return post<string>(p`/nodes/${node}/lxc`, params)
}

// --------------------------------------------------------------- helpers

/** "local:iso/alpine-virt.iso" → "alpine-virt.iso" */
export function volumeLabel(volid: string): string {
  const afterStorage = volid.slice(volid.indexOf(':') + 1)
  const slash = afterStorage.lastIndexOf('/')
  return slash === -1 ? afterStorage : afterStorage.slice(slash + 1)
}

/**
 * OCI images pulled into a template storage are plain (uncompressed) .tar
 * archives; LXC system templates are compressed (.tar.xz/.tar.gz/.tar.zst).
 */
export function isOciImage(vol: Pick<StorageVolume, 'volid' | 'format'>): boolean {
  return vol.format === 'tar' || (/\.tar$/i.test(vol.volid) && !/\.(?:xz|gz|zst|bz2)$/i.test(vol.volid))
}
