// Form state → API parameters for the lifecycle dialogs, kept pure for tests.
// Semantics follow the official UI (PVE.window.Migrate, PVE.window.Clone,
// PVE.window.SafeDestroyGuest, PVE.window.BulkAction).

import type { Params } from '@/api/client'
import type { LocalDisk, MigratePrecondition } from '@/api/guest-lifecycle'
import type { GuestResource, GuestType } from '@/api/types'

// ---------------------------------------------------------------- migrate

export interface MigrateForm {
  target: string
  /** QEMU: live migration (running VM). LXC: restart mode (running CT). */
  online: boolean
  /** Target storage for local disks; empty = keep the same storage IDs. */
  targetStorage?: string
  /** QEMU: migrate despite local resources (only for stopped VMs). */
  force?: boolean
  /** QEMU: keep conntrack state (running VMs with dbus-vmstate). */
  conntrack?: boolean
  /** LXC restart mode: shutdown timeout in seconds. */
  timeout?: number
  /** KiB/s, empty = default. */
  bwlimit?: number
}

/** Local disks that really move (not CD-ROMs, not shared, not unused/vmstate leftovers that PVE skips). */
export function movableLocalDisks(pre: MigratePrecondition | undefined): LocalDisk[] {
  return (pre?.local_disks ?? []).filter((d) => !d.cdrom && !d.shared)
}

export function migrateParams(type: GuestType, f: MigrateForm, pre: MigratePrecondition | undefined): Params {
  const params: Params = { target: f.target }
  const localDisks = movableLocalDisks(pre).length > 0
  if (type === 'qemu') {
    if (f.online) params.online = 1
    if (localDisks) params['with-local-disks'] = 1
    if (f.targetStorage) params.targetstorage = f.targetStorage
    if (f.force) params.force = 1
    if (f.online && f.conntrack) params['with-conntrack-state'] = 1
  } else {
    if (f.online) {
      params.restart = 1
      if (f.timeout !== undefined) params.timeout = f.timeout
    }
    if (f.targetStorage) params['target-storage'] = f.targetStorage
  }
  if (f.bwlimit !== undefined) params.bwlimit = f.bwlimit
  return params
}

/** Local resources that block migration (not covered by a resource mapping). */
export function blockingResources(pre: MigratePrecondition | undefined): string[] {
  const mapped = pre?.['mapped-resource-info'] ?? {}
  return (pre?.local_resources ?? []).filter((r) => !(r in mapped))
}

/** Reasons a target node is not allowed, in Chinese. */
export function targetProblems(pre: MigratePrecondition | undefined, target: string | undefined): string[] {
  if (!pre || !target) return []
  const out: string[] = []
  const na = pre.not_allowed_nodes?.[target]
  if (na?.unavailable_storages?.length) out.push(`目标节点缺少存储：${na.unavailable_storages.join(', ')}`)
  if (na?.['unavailable-resources']?.length) out.push(`目标节点缺少映射资源：${na['unavailable-resources'].join(', ')}`)
  for (const b of na?.['blocking-ha-resources'] ?? []) {
    out.push(`HA 资源 ${b.sid} 阻止迁移${b.cause === 'resource-affinity' ? '（资源亲和规则）' : ''}`)
  }
  if (!pre.running && pre.allowed_nodes && !pre.allowed_nodes.includes(target) && !na) {
    out.push('目标节点不满足迁移条件')
  }
  return out
}

// ------------------------------------------------------------------ clone

export interface CloneForm {
  newid: number
  name?: string
  target?: string
  /** Full copy (always for non-templates). */
  full: boolean
  storage?: string
  format?: string
  pool?: string
  snapname?: string
  description?: string
  bwlimit?: number
}

export function cloneParams(type: GuestType, f: CloneForm, opts: { sourceNode: string; isTemplate: boolean }): Params {
  const params: Params = { newid: f.newid }
  const name = f.name?.trim()
  if (name) params[type === 'lxc' ? 'hostname' : 'name'] = name
  if (f.target && f.target !== opts.sourceNode) params.target = f.target
  if (f.pool) params.pool = f.pool
  if (f.snapname && f.snapname !== 'current') params.snapname = f.snapname
  // The official UI always sends full=1 for a full clone; templates default to linked.
  if (f.full || !opts.isTemplate) {
    params.full = 1
    if (f.storage) {
      params.storage = f.storage
      if (f.format && type === 'qemu') params.format = f.format
    }
  } else {
    params.full = 0
  }
  if (f.description?.trim()) params.description = f.description.trim()
  if (f.bwlimit !== undefined) params.bwlimit = f.bwlimit
  return params
}

/** Storage types that hold files, where QEMU disks can be raw, qcow2 or vmdk. */
export const FILE_STORAGE_TYPES = ['dir', 'nfs', 'cifs', 'glusterfs', 'cephfs', 'btrfs'] as const

/** DNS-name rule the official UI applies to names and hostnames. */
export function nameError(name: string | undefined): string | null {
  const n = name?.trim()
  if (!n) return null
  if (n.length > 63 * 4) return '名称太长'
  return /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(n)
    ? null
    : '只能包含字母、数字、- 和 .，且不能以 - 开头或结尾'
}

// ---------------------------------------------------------------- destroy

export interface DestroyForm {
  purge: boolean
  destroyUnreferenced: boolean
  /** LXC: destroy even when running. */
  force?: boolean
}

export function destroyParams(type: GuestType, f: DestroyForm): Params {
  const params: Params = {
    purge: f.purge ? 1 : 0,
    'destroy-unreferenced-disks': f.destroyUnreferenced ? 1 : 0,
  }
  if (type === 'lxc' && f.force) params.force = 1
  return params
}

// ------------------------------------------------------------------- bulk

export type BulkAction = 'start' | 'shutdown' | 'suspend' | 'migrate'

export interface BulkForm {
  action: BulkAction
  vmids: number[]
  maxWorkers?: number
  /** shutdown */
  timeout?: number
  forceStop?: boolean
  /** suspend (cluster API only) */
  toDisk?: boolean
  statestorage?: string
  /** migrate */
  target?: string
  online?: boolean
  withLocalDisks?: boolean
}

const NODE_ACTION = { start: 'startall', shutdown: 'stopall', suspend: 'suspendall', migrate: 'migrateall' } as const

/**
 * Parameters for the node endpoints (/nodes/{node}/startall …): `vms` is a
 * comma separated string, startall needs force=1 to ignore onboot.
 */
export function nodeBulkParams(f: BulkForm): { action: (typeof NODE_ACTION)[BulkAction]; params: Params } {
  const params: Params = { vms: f.vmids.join(',') }
  if (f.action === 'start') params.force = 1
  if (f.action === 'shutdown') {
    params['force-stop'] = f.forceStop === false ? 0 : 1
    if (f.timeout !== undefined) params.timeout = f.timeout
  }
  if (f.action === 'migrate') {
    params.target = f.target
    params['with-local-disks'] = f.withLocalDisks === false ? 0 : 1
    // migrateall needs max-workers (or datacenter max_workers); default 1 like the official UI.
    params['max-workers'] = f.maxWorkers ?? 1
  } else if (f.maxWorkers !== undefined) {
    params['max-workers'] = f.maxWorkers
  }
  return { action: NODE_ACTION[f.action], params }
}

/** Parameters for /cluster/bulk-action/guest/{action}: `vms` as repeated keys. */
export function clusterBulkParams(f: BulkForm): Params {
  const params: Params = { vms: f.vmids }
  if (f.action === 'shutdown') {
    params['force-stop'] = f.forceStop === false ? 0 : 1
    if (f.timeout !== undefined) params.timeout = f.timeout
  }
  if (f.action === 'suspend' && f.toDisk) {
    params['to-disk'] = 1
    if (f.statestorage) params.statestorage = f.statestorage
  }
  if (f.action === 'migrate') {
    params.target = f.target
    if (f.online) params.online = 1
    params['with-local-disks'] = f.withLocalDisks === false ? 0 : 1
    params['max-workers'] = f.maxWorkers ?? 1
  } else if (f.maxWorkers !== undefined) {
    params['max-workers'] = f.maxWorkers
  }
  return params
}

/** Guests a bulk action applies to by default (official: start → stopped, shutdown/suspend → running). */
export function bulkCandidate(action: BulkAction, g: Pick<GuestResource, 'status' | 'type' | 'template'>): boolean {
  if (g.template === 1) return action === 'migrate'
  switch (action) {
    case 'start':
      return g.status !== 'running'
    case 'shutdown':
      return g.status === 'running' || g.status === 'paused'
    case 'suspend':
      return g.type === 'qemu' && g.status === 'running'
    case 'migrate':
      return true
  }
}

export const BULK_LABEL: Record<BulkAction, string> = {
  start: '批量启动',
  shutdown: '批量关机',
  suspend: '批量挂起',
  migrate: '批量迁移',
}

// --------------------------------------------------------------------- HA

export interface HaForm {
  state: 'started' | 'stopped' | 'enabled' | 'disabled' | 'ignored' | undefined
  maxRestart?: number
  maxRelocate?: number
  failback: boolean
  comment: string
}

/**
 * Parameters for POST /cluster/ha/resources (plus sid) or PUT …/{sid}.
 * On update, a cleared comment goes into `delete`.
 */
export function haParams(f: HaForm, existing: { comment?: string; digest?: string } | null): Params {
  const params: Params = {
    state: f.state ?? 'started',
    max_restart: f.maxRestart ?? 1,
    max_relocate: f.maxRelocate ?? 1,
    failback: f.failback ? 1 : 0,
  }
  const comment = f.comment.trim()
  if (comment) params.comment = comment
  else if (existing?.comment) params.delete = 'comment'
  if (existing?.digest) params.digest = existing.digest
  return params
}
