// API of area `resource-mappings`: cluster-wide PCI / USB / directory
// mappings (/cluster/mapping/{pci,usb,dir}) and custom CPU models
// (/cluster/qemu/custom-cpu-models).
//
// The VM hardware editors (api/qemu-config.ts) read the same mappings with
// `?check-node=<node>` under ['pve','cluster','mapping',kind,node]; the full
// lists here live under the same prefix, so one invalidation of
// mappingKeys.all refreshes both. Host hardware lists and the per-node dir
// check reuse the qemu-config hooks (useHostPci, useHostUsb, useMappings).

import { useQuery } from '@tanstack/react-query'

import { del, get, post, put, p, type Params } from './client'
import type { MappingKind, ResourceMapping } from './qemu-config'

export type { MappingKind } from './qemu-config'

// ------------------------------------------------------------------ types

/** One diagnostic of a mapping on the checked node (pci/dir: `checks`, usb: `errors`). */
export interface MappingCheck {
  severity: 'warning' | 'error' | string
  message: string
}

/** GET /cluster/mapping/{pci|usb|dir}: a logical mapping and its per-node entries. */
export interface ClusterMapping extends ResourceMapping {
  /** Property strings: "node=pve1,path=0000:01:00.0,id=10de:1eb8,…". */
  map?: string[]
  digest?: string
  /** USB lists its diagnostics under `errors` instead of `checks`. */
  errors?: MappingCheck[]
}

/** GET /cluster/qemu/custom-cpu-models */
export interface CustomCpuModel {
  /** Always "custom-<name>" in the list and in VM configs. */
  cputype: string
  'reported-model'?: string
  /** "+aes;-pcid" */
  flags?: string
  hidden?: 0 | 1 | boolean
  'hv-vendor-id'?: string
  /** 8–64 or "host". */
  'phys-bits'?: string | number
  'guest-phys-bits'?: number
  level?: number
  digest?: string
}

/** GET /cluster/qemu/cpu-flags: every flag QEMU knows, with the nodes supporting it. */
export interface ClusterCpuFlag {
  name: string
  description?: string
  'supported-on'?: string[]
}

// ------------------------------------------------------------------ keys

export const mappingKeys = {
  /** Prefix shared with qemu-config's per-node mapping lists. */
  all: ['pve', 'cluster', 'mapping'] as const,
  /** '*' is not a valid node name, so this never collides with a check-node list. */
  list: (kind: MappingKind) => ['pve', 'cluster', 'mapping', kind, '*'] as const,
  cpuModels: () => ['pve', 'cluster', 'qemu', 'custom-cpu-models'] as const,
  cpuFlags: (arch: string) => ['pve', 'cluster', 'qemu', 'cpu-flags', arch] as const,
}

// ----------------------------------------------------------- UTF-8 repair

/**
 * PVE 9.2 reads mapping configs (/etc/pve/mapping/*.cfg) without decoding
 * UTF-8, so non-ASCII text comes back as its bytes read as Latin-1
 * ("网卡" → "ç½\u0091å\u008d¡"; the official UI shows that too). Writes
 * store proper UTF-8. Re-decode strings that are valid UTF-8 byte sequences;
 * anything else is returned unchanged.
 */
export function repairUtf8(s: string): string
export function repairUtf8(s: string | undefined): string | undefined
export function repairUtf8(s: string | undefined): string | undefined {
  if (!s || !/[\u0080-\u00ff]/.test(s) || /[^\u0000-\u00ff]/.test(s)) return s
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(s, (c) => c.charCodeAt(0)))
  } catch {
    return s
  }
}

export function repairMapping(m: ClusterMapping): ClusterMapping {
  return { ...m, description: repairUtf8(m.description), map: m.map?.map((e) => repairUtf8(e)) }
}

// --------------------------------------------------------------- queries

export function useMappingList(kind: MappingKind) {
  return useQuery({
    queryKey: mappingKeys.list(kind),
    queryFn: async ({ signal }) => (await get<ClusterMapping[]>(p`/cluster/mapping/${kind}`, undefined, { signal })).map(repairMapping),
  })
}

export function useCustomCpuModels() {
  return useQuery({
    queryKey: mappingKeys.cpuModels(),
    queryFn: ({ signal }) => get<CustomCpuModel[]>('/cluster/qemu/custom-cpu-models', undefined, { signal }),
  })
}

export function useClusterCpuFlags(arch = 'x86_64', enabled = true) {
  return useQuery({
    queryKey: mappingKeys.cpuFlags(arch),
    queryFn: ({ signal }) => get<ClusterCpuFlag[]>('/cluster/qemu/cpu-flags', { arch, accel: 'kvm' }, { signal }),
    enabled,
    staleTime: 5 * 60_000,
  })
}

// ---------------------------------------------------------------- writes

export const mappingApi = {
  create: (kind: MappingKind, params: Params) => post(p`/cluster/mapping/${kind}`, params),
  update: (kind: MappingKind, id: string, params: Params) => put(p`/cluster/mapping/${kind}/${id}`, params),
  remove: (kind: MappingKind, id: string) => del(p`/cluster/mapping/${kind}/${id}`),
}

export const cpuModelApi = {
  create: (params: Params) => post('/cluster/qemu/custom-cpu-models', params),
  update: (cputype: string, params: Params) => put(p`/cluster/qemu/custom-cpu-models/${cputype}`, params),
  remove: (cputype: string) => del(p`/cluster/qemu/custom-cpu-models/${cputype}`),
}
