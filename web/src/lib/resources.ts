// Helpers for cluster resources shared by overview, tree and command palette.

import type { ClusterResource, GuestResource, GuestType } from '@/api/types'

export const GUEST_TYPE_LABEL: Record<GuestType, string> = {
  qemu: '虚拟机',
  lxc: '容器',
}

export const STATUS_LABEL: Record<string, string> = {
  running: '运行中',
  stopped: '已停止',
  paused: '已暂停',
  suspended: '已休眠',
  prelaunch: '准备启动',
  online: '在线',
  offline: '离线',
  available: '可用',
  unknown: '未知',
}

export function statusLabel(status: string | undefined): string {
  if (!status) return STATUS_LABEL.unknown!
  return STATUS_LABEL[status] ?? status
}

export function guestName(g: Pick<GuestResource, 'name' | 'vmid' | 'type'>): string {
  return g.name || `${g.type === 'lxc' ? 'CT' : 'VM'} ${g.vmid}`
}

export function guestPath(g: Pick<GuestResource, 'node' | 'type' | 'vmid'>): string {
  return `/guest/${encodeURIComponent(g.node)}/${g.type}/${g.vmid}`
}

export function nodePath(node: string): string {
  return `/node/${encodeURIComponent(node)}`
}

export function isTemplate(g: GuestResource): boolean {
  return g.template === 1
}

/** PVE tags are ";" or "," or space separated. */
export function parseTags(tags: string | undefined): string[] {
  if (!tags) return []
  return tags
    .split(/[;,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

export function byVmid(a: GuestResource, b: GuestResource): number {
  return a.vmid - b.vmid
}

/** Stable label for any resource (command palette, tree). */
export function resourceLabel(r: ClusterResource): string {
  switch (r.type) {
    case 'qemu':
    case 'lxc':
      return guestName(r)
    case 'node':
      return r.node
    case 'storage':
      return r.storage
    case 'pool':
      return r.pool
    default:
      return r.id
  }
}
