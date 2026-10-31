// API of area `qemu-config`: VM hardware, Cloud-Init, options and monitor.
//
// The hardware / options / cloud-init lists all read GET .../pending, which
// returns every config key with its current value, the pending value (changes
// that wait for a reboot) and a delete marker. The forms edit the
// pending-applied config (what GET .../config returns by default) and send
// only changed keys with the config digest (lib/propstring configUpdateParams).

import { useQuery } from '@tanstack/react-query'

import { get, post, put, p, type Params } from './client'
import { POLL, queryKeys } from './queries'
import type { NodeStorage } from './types'

// ------------------------------------------------------------------ types

/** One entry of GET /nodes/{node}/qemu/{vmid}/pending. */
export interface QemuPendingEntry {
  key: string
  /** Current (running) value; absent for keys only added as pending. */
  value?: string | number
  /** New value that applies after a reboot / hotplug. */
  pending?: string | number
  /** 1: deletion pending; 2: deletion requested with force. */
  delete?: 0 | 1 | 2
}

/** GET /nodes/{node}/capabilities/qemu/cpu */
export interface QemuCpuModel {
  name: string
  vendor: string
  custom: 0 | 1
}

/** GET /nodes/{node}/capabilities/qemu/cpu-flags */
export interface QemuCpuFlag {
  name: string
  description?: string
  'supported-on'?: string[]
}

/** GET /nodes/{node}/capabilities/qemu/machines */
export interface QemuMachine {
  id: string
  type: string
  version: string
  changes?: string
}

/** GET /nodes/{node}/hardware/usb */
export interface HostUsbDevice {
  busnum: number
  devnum: number
  port: number
  level: number
  class: number
  vendid: string
  prodid: string
  usbpath?: string
  speed?: string
  product?: string
  manufacturer?: string
  serial?: string
}

/** GET /nodes/{node}/hardware/pci */
export interface HostPciDevice {
  id: string
  class: string
  vendor: string
  device: string
  vendor_name?: string
  device_name?: string
  subsystem_vendor?: string
  subsystem_device?: string
  subsystem_vendor_name?: string
  subsystem_device_name?: string
  iommugroup: number
  mdev?: 0 | 1
}

/** GET /nodes/{node}/hardware/pci/{id}/mdev */
export interface HostPciMdev {
  type: string
  available: number
  description?: string
  name?: string
}

/** GET /cluster/mapping/{pci|usb|dir}?check-node=… */
export interface ResourceMapping {
  id: string
  description?: string
  map?: string[]
  /** Per-node check result; non-empty means the mapping is not usable on that node. */
  checks?: { severity: string; message: string }[]
  'live-migration-capable'?: 0 | 1
}

/** GET /nodes/{node}/storage/{storage}/content */
export interface StorageVolume {
  volid: string
  content: string
  format?: string
  size?: number
  ctime?: number
  vmid?: number
  notes?: string
}

/** GET /nodes/{node}/storage?format=1: storages with their image formats. */
export interface NodeStorageWithFormats extends NodeStorage {
  formats?: { default: string; supported: string[] }
  select_existing?: 0 | 1
}

/** GET /nodes/{node}/qemu/{vmid}/cloudinit: values that differ from the generated image. */
export interface CloudinitPendingEntry {
  key: string
  value?: string
  pending?: string
  delete?: 0 | 1
}

// ------------------------------------------------------------------ keys

export const qemuConfigKeys = {
  pending: (node: string, vmid: number) => [...queryKeys.guest(node, 'qemu', vmid), 'pending'] as const,
  cloudinit: (node: string, vmid: number) => [...queryKeys.guest(node, 'qemu', vmid), 'cloudinit'] as const,
  cloudinitDump: (node: string, vmid: number, type: string) =>
    [...queryKeys.guest(node, 'qemu', vmid), 'cloudinit-dump', type] as const,
  cpuModels: (node: string, arch: string) => [...queryKeys.node(node), 'capabilities', 'cpu', arch] as const,
  cpuFlags: (node: string, arch: string, accel: string) =>
    [...queryKeys.node(node), 'capabilities', 'cpu-flags', arch, accel] as const,
  machines: (node: string, arch: string) => [...queryKeys.node(node), 'capabilities', 'machines', arch] as const,
  hostUsb: (node: string) => [...queryKeys.node(node), 'hardware', 'usb'] as const,
  hostPci: (node: string) => [...queryKeys.node(node), 'hardware', 'pci'] as const,
  pciMdev: (node: string, id: string) => [...queryKeys.node(node), 'hardware', 'pci', id, 'mdev'] as const,
  mappings: (kind: MappingKind, node: string) => ['pve', 'cluster', 'mapping', kind, node] as const,
  storageFormats: (node: string, content: string) => [...queryKeys.node(node), 'storage-formats', content] as const,
  volumes: (node: string, storage: string, content: string) =>
    [...queryKeys.storage(node, storage), 'content', content] as const,
}

export type MappingKind = 'pci' | 'usb' | 'dir'

// --------------------------------------------------------------- queries

/** Config with pending changes, polled every 5 s like the official grid. */
export function useQemuPending(node: string, vmid: number) {
  return useQuery({
    queryKey: qemuConfigKeys.pending(node, vmid),
    queryFn: ({ signal }) => get<QemuPendingEntry[]>(p`/nodes/${node}/qemu/${vmid}/pending`, undefined, { signal }),
    refetchInterval: POLL.resources,
  })
}

export function useCloudinitPending(node: string, vmid: number, enabled = true) {
  return useQuery({
    queryKey: qemuConfigKeys.cloudinit(node, vmid),
    queryFn: ({ signal }) =>
      get<CloudinitPendingEntry[]>(p`/nodes/${node}/qemu/${vmid}/cloudinit`, undefined, { signal }),
    enabled,
    refetchInterval: POLL.resources,
  })
}

export type CloudinitDumpType = 'user' | 'network' | 'meta'

export function useCloudinitDump(node: string, vmid: number, type: CloudinitDumpType, enabled: boolean) {
  return useQuery({
    queryKey: qemuConfigKeys.cloudinitDump(node, vmid, type),
    queryFn: ({ signal }) => get<string>(p`/nodes/${node}/qemu/${vmid}/cloudinit/dump`, { type }, { signal }),
    enabled,
    staleTime: 0,
  })
}

export function useCpuModels(node: string, arch: string) {
  return useQuery({
    queryKey: qemuConfigKeys.cpuModels(node, arch),
    queryFn: ({ signal }) =>
      get<QemuCpuModel[]>(p`/nodes/${node}/capabilities/qemu/cpu`, { arch }, { signal }),
    staleTime: 5 * 60_000,
  })
}

export function useCpuFlags(node: string, arch: string, accel: 'kvm' | 'tcg') {
  return useQuery({
    queryKey: qemuConfigKeys.cpuFlags(node, arch, accel),
    queryFn: ({ signal }) =>
      get<QemuCpuFlag[]>(p`/nodes/${node}/capabilities/qemu/cpu-flags`, { arch, accel }, { signal }),
    staleTime: 5 * 60_000,
  })
}

export function useQemuMachines(node: string, arch: string) {
  return useQuery({
    queryKey: qemuConfigKeys.machines(node, arch),
    queryFn: ({ signal }) =>
      get<QemuMachine[]>(p`/nodes/${node}/capabilities/qemu/machines`, { arch }, { signal }),
    staleTime: 5 * 60_000,
  })
}

export function useHostUsb(node: string, enabled = true) {
  return useQuery({
    queryKey: qemuConfigKeys.hostUsb(node),
    queryFn: ({ signal }) => get<HostUsbDevice[]>(p`/nodes/${node}/hardware/usb`, undefined, { signal }),
    enabled,
    staleTime: 15_000,
  })
}

export function useHostPci(node: string, enabled = true) {
  return useQuery({
    queryKey: qemuConfigKeys.hostPci(node),
    // An empty blacklist lists every device class (the default hides bridges etc.).
    queryFn: ({ signal }) =>
      get<HostPciDevice[]>(p`/nodes/${node}/hardware/pci`, { 'pci-class-blacklist': '' }, { signal }),
    enabled,
    staleTime: 30_000,
  })
}

export function usePciMdev(node: string, pciIdOrMapping: string | undefined) {
  return useQuery({
    queryKey: qemuConfigKeys.pciMdev(node, pciIdOrMapping ?? ''),
    queryFn: ({ signal }) =>
      get<HostPciMdev[]>(p`/nodes/${node}/hardware/pci/${pciIdOrMapping!}/mdev`, undefined, { signal }),
    enabled: !!pciIdOrMapping,
    staleTime: 30_000,
  })
}

export function useMappings(kind: MappingKind, node: string, enabled = true) {
  return useQuery({
    queryKey: qemuConfigKeys.mappings(kind, node),
    queryFn: ({ signal }) =>
      get<ResourceMapping[]>(p`/cluster/mapping/${kind}`, { 'check-node': node }, { signal }),
    enabled,
    staleTime: 30_000,
  })
}

/** Storages for `content` with the image formats they support (format=1). */
export function useStorageFormats(node: string, content = 'images') {
  return useQuery({
    queryKey: qemuConfigKeys.storageFormats(node, content),
    queryFn: ({ signal }) =>
      get<NodeStorageWithFormats[]>(p`/nodes/${node}/storage`, { content, enabled: 1, format: 1 }, { signal }),
    staleTime: 15_000,
  })
}

export function useStorageVolumes(node: string, storage: string | undefined, content: string) {
  return useQuery({
    queryKey: qemuConfigKeys.volumes(node, storage ?? '', content),
    queryFn: ({ signal }) =>
      get<StorageVolume[]>(p`/nodes/${node}/storage/${storage!}/content`, { content }, { signal }),
    enabled: !!storage,
    staleTime: 15_000,
  })
}

// ------------------------------------------------------------- mutations

const configPath = (node: string, vmid: number) => p`/nodes/${node}/qemu/${vmid}/config`

/**
 * Write config params. `async` uses POST (returns a UPID; needed for edits
 * that allocate or import volumes), otherwise PUT (synchronous).
 */
export function writeQemuConfig(node: string, vmid: number, params: Params, opts: { async?: boolean } = {}) {
  if (opts.async) return post<string | null>(configPath(node, vmid), { ...params, background_delay: 5 })
  return put<null>(configPath(node, vmid), params)
}

/** Drop pending changes of these keys (PUT config revert=k1,k2). */
export function revertQemuPending(node: string, vmid: number, keys: readonly string[]) {
  return put<null>(configPath(node, vmid), { revert: keys.join(',') })
}

/** PUT .../resize: size is "+10G" (grow by) or an absolute size. */
export function resizeQemuDisk(node: string, vmid: number, disk: string, size: string, digest?: string) {
  return put<string | null>(p`/nodes/${node}/qemu/${vmid}/resize`, { disk, size, digest })
}

export interface MoveDiskParams {
  disk: string
  storage: string
  format?: string
  delete?: boolean
  bwlimit?: number
}

export function moveQemuDisk(node: string, vmid: number, params: MoveDiskParams) {
  return post<string>(p`/nodes/${node}/qemu/${vmid}/move_disk`, { ...params })
}

export interface ReassignDiskParams {
  disk: string
  'target-vmid': number
  'target-disk': string
  digest?: string
  'target-digest'?: string
}

export function reassignQemuDisk(node: string, vmid: number, params: ReassignDiskParams) {
  return post<string>(p`/nodes/${node}/qemu/${vmid}/move_disk`, { ...params })
}

/** Regenerate the cloud-init drive (PUT .../cloudinit). */
export function regenerateCloudinit(node: string, vmid: number) {
  return put<null>(p`/nodes/${node}/qemu/${vmid}/cloudinit`)
}

/** Run a QEMU monitor (HMP) command; returns its text output. */
export function qemuMonitor(node: string, vmid: number, command: string) {
  return post<string>(p`/nodes/${node}/qemu/${vmid}/monitor`, { command })
}

/** GET .../config of another VM (reassign target slot check). */
export function fetchQemuConfig(node: string, vmid: number, signal?: AbortSignal) {
  return get<Record<string, string | number>>(configPath(node, vmid), undefined, { signal })
}
