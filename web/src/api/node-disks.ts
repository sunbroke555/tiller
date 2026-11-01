// Node disk management (node-disks): physical disks and partitions, SMART,
// GPT initialisation, wiping, and the LVM / LVM-Thin / directory / ZFS
// storages built on unused disks.
//
// Endpoints and field rules follow pvemanagerlib.js (PVE.node.CreateLVM,
// CreateLVMThin, CreateDirectory, CreateZFS, the *List panels and
// PVE.window.SafeDestroyStorage) and proxmoxlib.js (Proxmox.DiskList,
// Proxmox.window.DiskSmart, Proxmox.window.ZFSDetail). Pure helpers (tree
// building, labels, validation, form → params) are in
// features/node-disks/model.ts.

import { useQuery } from '@tanstack/react-query'

import { del, get, p, post, put, type Params } from './client'
import { queryKeys } from './queries'

// ------------------------------------------------------------------ types

/** One entry of GET /nodes/{node}/disks/list (a disk, or a partition with include-partitions=1). */
export interface DiskEntry {
  devpath: string
  size?: number
  /** 1 when the disk has a GPT partition table. */
  gpt?: number | boolean
  /** "ssd" | "hdd" | "nvme" | "usb" | "unknown" | "partition" */
  type?: string
  /**
   * What uses it: missing = unused; "partitions", "LVM", "ZFS", "mounted",
   * "BIOS boot", "EFI", "ZFS reserved", "Device Mapper", "filesystem"
   * (partitions: see `filesystem`), …
   */
  used?: string
  /** Partitions with used="filesystem": ext4, xfs, … */
  filesystem?: string
  mounted?: number | boolean
  /** "OK" / "PASSED" / "FAILED" / "UNKNOWN" (missing for partitions or with skipsmart). */
  health?: string
  /** Percentage of the rated life already used (SSDs), or "N/A". */
  wearout?: number | string
  vendor?: string
  model?: string
  serial?: string
  wwn?: string
  by_id_link?: string
  /** -1 unknown, 0 for SSDs, otherwise spindle speed. */
  rpm?: number
  osdid?: number
  'osdid-list'?: number[] | null
  journals?: number
  db?: number
  wal?: number
  /** Partitions only: the disk's devpath. */
  parent?: string
  /** Older APIs nest partitions instead of listing them with `parent`. */
  partitions?: DiskEntry[]
}

/** GET /nodes/{node}/disks/smart */
export interface SmartData {
  health?: string
  /** "ata" (attribute table) or "text" (NVMe / SAS: smartctl text output). */
  type?: string
  text?: string
  attributes?: RawSmartAttribute[]
}

export interface RawSmartAttribute {
  /** smartctl prints it right-aligned: "  5". */
  id?: number | string
  name?: string
  value?: number | string
  worst?: number | string
  threshold?: number | string
  flags?: string
  fail?: string
  raw?: string
  normalized?: number | string
}

/** GET /nodes/{node}/disks/lvm: root → volume groups → physical volumes. */
export interface LvmTree {
  leaf?: number | boolean
  children?: LvmVolumeGroup[]
}

export interface LvmVolumeGroup {
  name: string
  size: number
  free: number
  lvcount?: number
  leaf?: number | boolean
  children?: LvmPhysicalVolume[]
}

export interface LvmPhysicalVolume {
  name: string
  size: number
  free: number
  leaf?: number | boolean
}

/** GET /nodes/{node}/disks/lvmthin */
export interface LvmThinPool {
  lv: string
  vg: string
  lv_size: number
  used: number
  metadata_size: number
  metadata_used: number
  lv_state?: string
  lv_type?: string
  ctime?: string
}

/** GET /nodes/{node}/disks/directory */
export interface DirectoryMount {
  path: string
  device?: string
  type?: string
  options?: string
  unitfile?: string
}

/** GET /nodes/{node}/disks/zfs */
export interface ZfsPool {
  name: string
  size: number
  alloc: number
  free: number
  frag: number
  dedup: number
  health: string
}

/** A vdev (or section like "logs", "cache", "spares") of GET /nodes/{node}/disks/zfs/{name}. */
export interface ZfsVdev {
  name: string
  state?: string
  read?: number
  write?: number
  cksum?: number
  msg?: string
  leaf?: number | boolean
  children?: ZfsVdev[]
}

/** GET /nodes/{node}/disks/zfs/{name} */
export interface ZfsPoolDetail {
  name: string
  state: string
  status?: string
  action?: string
  scan?: string
  errors?: string
  children?: ZfsVdev[]
}

export type DiskStorageKind = 'lvm' | 'lvmthin' | 'directory' | 'zfs'

// ------------------------------------------------------------- query keys

export const diskKeys = {
  all: (node: string) => [...queryKeys.node(node), 'disks'] as const,
  list: (node: string, filter?: 'unused') => [...queryKeys.node(node), 'disks', 'list', filter ?? 'all'] as const,
  smart: (node: string, disk: string) => [...queryKeys.node(node), 'disks', 'smart', disk] as const,
  storage: (node: string, kind: DiskStorageKind) => [...queryKeys.node(node), 'disks', kind] as const,
  zfsDetail: (node: string, name: string) => [...queryKeys.node(node), 'disks', 'zfs', name] as const,
}

// ------------------------------------------------------------------ reads

/** Disks with their partitions (include-partitions=1, like the official list). */
export function useDiskList(node: string) {
  return useQuery({
    queryKey: diskKeys.list(node),
    queryFn: ({ signal }) => get<DiskEntry[]>(p`/nodes/${node}/disks/list`, { 'include-partitions': 1 }, { signal }),
    staleTime: 15_000,
  })
}

/** Unused disks and partitions, for the create dialogs (no SMART: faster). */
export function useUnusedDisks(node: string, enabled = true) {
  return useQuery({
    queryKey: diskKeys.list(node, 'unused'),
    queryFn: ({ signal }) =>
      get<DiskEntry[]>(p`/nodes/${node}/disks/list`, { type: 'unused', 'include-partitions': 1, skipsmart: 1 }, { signal }),
    enabled,
    staleTime: 0,
  })
}

export function useDiskSmart(node: string, disk: string | null) {
  return useQuery({
    queryKey: diskKeys.smart(node, disk ?? ''),
    queryFn: ({ signal }) => get<SmartData>(p`/nodes/${node}/disks/smart`, { disk: disk! }, { signal }),
    enabled: !!disk,
    staleTime: 30_000,
  })
}

export function useLvmTree(node: string) {
  return useQuery({
    queryKey: diskKeys.storage(node, 'lvm'),
    queryFn: ({ signal }) => get<LvmTree>(p`/nodes/${node}/disks/lvm`, undefined, { signal }),
  })
}

export function useLvmThinPools(node: string) {
  return useQuery({
    queryKey: diskKeys.storage(node, 'lvmthin'),
    queryFn: ({ signal }) => get<LvmThinPool[]>(p`/nodes/${node}/disks/lvmthin`, undefined, { signal }),
  })
}

export function useDirectoryMounts(node: string) {
  return useQuery({
    queryKey: diskKeys.storage(node, 'directory'),
    queryFn: ({ signal }) => get<DirectoryMount[]>(p`/nodes/${node}/disks/directory`, undefined, { signal }),
  })
}

export function useZfsPools(node: string) {
  return useQuery({
    queryKey: diskKeys.storage(node, 'zfs'),
    queryFn: ({ signal }) => get<ZfsPool[]>(p`/nodes/${node}/disks/zfs`, undefined, { signal }),
  })
}

export function useZfsPoolDetail(node: string, name: string | null) {
  return useQuery({
    queryKey: diskKeys.zfsDetail(node, name ?? ''),
    queryFn: ({ signal }) => get<ZfsPoolDetail>(p`/nodes/${node}/disks/zfs/${name!}`, undefined, { signal }),
    enabled: !!name,
  })
}

// ----------------------------------------------------------------- writes
// All return a UPID: pass the promise to runTask.

export function initGpt(node: string, disk: string) {
  return post<string>(p`/nodes/${node}/disks/initgpt`, { disk })
}

export function wipeDisk(node: string, disk: string) {
  return put<string>(p`/nodes/${node}/disks/wipedisk`, { disk })
}

/** POST /nodes/{node}/disks/{lvm|lvmthin|directory|zfs} with params from model.ts. */
export function createDiskStorage(node: string, kind: DiskStorageKind, params: Params) {
  return post<string>(p`/nodes/${node}/disks/${kind}`, params)
}

/**
 * DELETE /nodes/{node}/disks/{kind}/{name}: `name` is the VG, the thin LV
 * (with params['volume-group']), the directory name (without /mnt/pve/) or
 * the pool.
 */
export function destroyDiskStorage(node: string, kind: DiskStorageKind, name: string, params: Params) {
  return del<string>(p`/nodes/${node}/disks/${kind}/${name}`, params)
}
