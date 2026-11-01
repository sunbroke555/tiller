// Container configuration (area lxc-config): config with pending changes,
// live interfaces, config updates, volume actions.
//
//   GET  /nodes/{node}/lxc/{vmid}/pending      current + pending values (+ digest)
//   GET  /nodes/{node}/lxc/{vmid}/interfaces   addresses of a running CT
//   PUT  /nodes/{node}/lxc/{vmid}/config       synchronous; delete=…, revert=…, digest
//   PUT  /nodes/{node}/lxc/{vmid}/resize       disk, size (+NG) → UPID
//   POST /nodes/{node}/lxc/{vmid}/move_volume  volume + storage [delete, bwlimit] or
//                                              target-vmid + target-volume (reassign) → UPID

import { useQuery } from '@tanstack/react-query'

import { get, post, put, p, type Params } from './client'
import { queryKeys } from './queries'

/** One row of GET /nodes/{node}/lxc/{vmid}/pending. */
export interface PendingEntry {
  key: string
  value?: string | number
  pending?: string | number
  /** 1 = pending delete, 2 = forced delete. */
  delete?: number
}

/** GET /nodes/{node}/lxc/{vmid}/interfaces entry. */
export interface LxcInterface {
  name: string
  hwaddr?: string
  'hardware-address'?: string
  inet?: string
  inet6?: string
  'ip-addresses'?: { 'ip-address': string; 'ip-address-type': 'inet' | 'inet6' | string; prefix: string | number }[]
}

export const lxcKeys = {
  pending: (node: string, vmid: number) => [...queryKeys.guest(node, 'lxc', vmid), 'pending'] as const,
  interfaces: (node: string, vmid: number) => [...queryKeys.guest(node, 'lxc', vmid), 'interfaces'] as const,
  config: (node: string, vmid: number) => [...queryKeys.guest(node, 'lxc', vmid), 'config'] as const,
}

/** Polling of the config tabs (the official UI polls the pending grid every 2–5 s). */
export const LXC_CONFIG_POLL = 5_000

/** Config with pending changes; every config tab reads this one query. */
export function useLxcPending(node: string, vmid: number) {
  return useQuery({
    queryKey: lxcKeys.pending(node, vmid),
    queryFn: ({ signal }) => get<PendingEntry[]>(p`/nodes/${node}/lxc/${vmid}/pending`, undefined, { signal }),
    refetchInterval: LXC_CONFIG_POLL,
  })
}

/** Interfaces and addresses of a running container (fails while stopped). */
export function useLxcInterfaces(node: string, vmid: number, enabled: boolean) {
  return useQuery({
    queryKey: lxcKeys.interfaces(node, vmid),
    queryFn: ({ signal }) => get<LxcInterface[]>(p`/nodes/${node}/lxc/${vmid}/interfaces`, undefined, { signal }),
    enabled,
    refetchInterval: 10_000,
    retry: false,
  })
}

/** Config of another container (reassign target). */
export function useLxcConfig(node: string, vmid: number | undefined) {
  return useQuery({
    queryKey: lxcKeys.config(node, vmid ?? 0),
    queryFn: ({ signal }) => get<Record<string, string | number>>(p`/nodes/${node}/lxc/${vmid!}/config`, undefined, { signal }),
    enabled: vmid !== undefined,
  })
}

export function updateLxcConfig(node: string, vmid: number, params: Params) {
  return put<null>(p`/nodes/${node}/lxc/${vmid}/config`, params)
}

/** Drop pending changes of these keys. */
export function revertLxcPending(node: string, vmid: number, keys: readonly string[]) {
  return put<null>(p`/nodes/${node}/lxc/${vmid}/config`, { revert: keys.join(',') })
}

/** Grow a volume by `addGiB` (PVE cannot shrink). Returns a UPID. */
export function resizeLxcVolume(node: string, vmid: number, disk: string, addGiB: number, digest?: string) {
  return put<string>(p`/nodes/${node}/lxc/${vmid}/resize`, { disk, size: `+${formatGiB(addGiB)}G`, digest })
}

export interface MoveVolumeParams {
  volume: string
  storage: string
  /** Remove the source instead of keeping it as unused[n]. */
  delete?: boolean
  /** KiB/s. */
  bwlimit?: number
  digest?: string
}

export function moveLxcVolume(node: string, vmid: number, params: MoveVolumeParams) {
  return post<string>(p`/nodes/${node}/lxc/${vmid}/move_volume`, {
    volume: params.volume,
    storage: params.storage,
    delete: params.delete ? 1 : undefined,
    bwlimit: params.bwlimit,
    digest: params.digest,
  })
}

export interface ReassignVolumeParams {
  volume: string
  targetVmid: number
  /** mp[n] / unused[n] key in the target. */
  targetVolume: string
  digest?: string
  targetDigest?: string
}

export function reassignLxcVolume(node: string, vmid: number, params: ReassignVolumeParams) {
  return post<string | null>(p`/nodes/${node}/lxc/${vmid}/move_volume`, {
    volume: params.volume,
    'target-vmid': params.targetVmid,
    'target-volume': params.targetVolume,
    digest: params.digest,
    'target-digest': params.targetDigest,
  })
}

/** 1.5 → "1.5", 2 → "2", 0.1+0.2 → "0.3" (at most 3 decimals, like the official dialog). */
export function formatGiB(v: number): string {
  return String(Math.round(v * 1000) / 1000)
}
