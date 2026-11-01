// Permission checks for permission-aware UI (hide actions the user may not run).
//
// Source of truth is GET /access/permissions (no path): a map of ACL path →
// { privilege: propagate(1|0) } with the user's *effective* privileges on
// every path that has an ACL entry plus the top-level paths (/, /vms, /nodes,
// /storage, /pool, /access, /sdn). A path that is not listed inherits the
// propagating privileges of its nearest listed ancestor, the way PVE
// evaluates ACLs. Guests and storages in a pool also get /pool/<id>.
//
// While that map loads, the coarse `cap` table of the login ticket is used
// (cap.vms['VM.PowerMgmt'] = "has it somewhere under /vms"). The backend
// always checks again (403), so the UI only needs to be helpful, not strict.

import type { Capabilities } from '@/api/types'

/** GET /access/permissions: path → privilege → propagate flag. */
export type PermissionMap = Record<string, Record<string, number>>

/**
 * What an action, command or button needs. `path` defaults to the object the
 * page is about (a guest: /vms/<vmid> and its pool; a node: /nodes/<node>; a
 * storage: /storage/<id>; otherwise "/").
 */
export interface PermissionCheck {
  privs: string | readonly string[]
  /** One path, or several (allowed when any of them grants the privileges). */
  path?: string | readonly string[]
  /** true: any one of `privs` is enough (default: all of them). */
  any?: boolean
  /**
   * true: also allowed when a *descendant* of `path` grants it (e.g.
   * "can create a VM somewhere": VM.Allocate on /vms or on any pool).
   */
  anywhere?: boolean
}

export type PermissionTarget =
  | { kind: 'guest'; vmid: number | string; pool?: string | undefined }
  | { kind: 'node'; node: string }
  | { kind: 'storage'; storage: string; pool?: string | undefined }
  | { kind: 'global' }

/** "/vms/100/" → "/vms/100"; "" → "/". */
export function normalizeAclPath(path: string): string {
  const p = ('/' + path.trim()).replace(/\/+/g, '/').replace(/\/$/, '')
  return p === '' ? '/' : p
}

/** "/vms/100" → ["/vms/100", "/vms", "/"]. */
export function aclAncestors(path: string): string[] {
  const p = normalizeAclPath(path)
  if (p === '/') return ['/']
  const parts = p.split('/').filter(Boolean)
  const out: string[] = []
  for (let i = parts.length; i > 0; i--) out.push('/' + parts.slice(0, i).join('/'))
  out.push('/')
  return out
}

/** Effective privileges on one path (exact entry, else inherited propagating ones). */
export function privilegesAt(map: PermissionMap, path: string): Set<string> {
  const chain = aclAncestors(path)
  for (let i = 0; i < chain.length; i++) {
    const entry = map[chain[i]!]
    if (!entry) continue
    // The exact path: everything listed applies. An ancestor: only what propagates.
    const exact = i === 0
    return new Set(Object.entries(entry).filter(([, v]) => exact || v === 1 || (v as unknown) === true).map(([k]) => k))
  }
  return new Set()
}

function asList(v: string | readonly string[] | undefined): string[] {
  if (v === undefined) return []
  return typeof v === 'string' ? [v] : [...v]
}

function satisfies(have: Set<string>, privs: string[], any: boolean): boolean {
  if (privs.length === 0) return true
  return any ? privs.some((p) => have.has(p)) : privs.every((p) => have.has(p))
}

/** Does the permission map grant `privs` on `path` (or one of several paths)? */
export function hasPrivileges(
  map: PermissionMap,
  path: string | readonly string[],
  privs: string | readonly string[],
  opts: { any?: boolean; anywhere?: boolean } = {},
): boolean {
  const wanted = asList(privs)
  const paths = asList(path).map(normalizeAclPath)
  for (const p of paths) {
    if (satisfies(privilegesAt(map, p), wanted, !!opts.any)) return true
    if (opts.anywhere) {
      const prefix = p === '/' ? '/' : p + '/'
      for (const key of Object.keys(map)) {
        const k = normalizeAclPath(key)
        if (k.startsWith(prefix) && satisfies(privilegesAt(map, k), wanted, !!opts.any)) return true
      }
    }
  }
  return false
}

/** Ticket `cap` category for an ACL path. */
export function capCategory(path: string): keyof CapCategories {
  const top = normalizeAclPath(path).split('/')[1] ?? ''
  switch (top) {
    case 'vms':
    case 'pool':
      return 'vms'
    case 'nodes':
      return 'nodes'
    case 'storage':
      return 'storage'
    case 'access':
      return 'access'
    case 'sdn':
      return 'sdn'
    case 'mapping':
      return 'mapping'
    default:
      return 'dc'
  }
}

interface CapCategories {
  vms: unknown
  nodes: unknown
  storage: unknown
  access: unknown
  sdn: unknown
  mapping: unknown
  dc: unknown
}

/**
 * Coarse check against the ticket's cap table. Privileges are looked up in
 * the path's category first, then in every category (cap lists e.g.
 * Sys.Console under "nodes" but Sys.Audit under "dc" and "nodes").
 */
export function capAllows(
  cap: Capabilities | undefined,
  path: string | readonly string[],
  privs: string | readonly string[],
  opts: { any?: boolean } = {},
): boolean | undefined {
  if (!cap) return undefined
  const wanted = asList(privs)
  const paths = asList(path)
  const all = new Set<string>()
  for (const cat of Object.values(cap)) for (const [k, v] of Object.entries(cat ?? {})) if (v) all.add(k)
  for (const p of paths.length ? paths : ['/']) {
    const cat = cap[capCategory(p)] ?? {}
    const have = new Set([...Object.entries(cat).filter(([, v]) => v).map(([k]) => k)])
    // Unknown category content: fall back to the union so we never hide by mistake.
    const pool = have.size ? new Set([...have, ...all]) : all
    if (satisfies(pool, wanted, !!opts.any)) return true
  }
  return false
}

/** Default ACL paths for a target (what "this guest/node/storage" means). */
export function targetPaths(target: PermissionTarget): string[] {
  switch (target.kind) {
    case 'guest':
      return [`/vms/${target.vmid}`, ...(target.pool ? [`/pool/${target.pool}`] : [])]
    case 'node':
      return [`/nodes/${target.node}`]
    case 'storage':
      return [`/storage/${target.storage}`, ...(target.pool ? [`/pool/${target.pool}`] : [])]
    case 'global':
      return ['/']
  }
}

// ------------------------------------------------- defaults by action id
//
// Actions and commands may declare `permission`; those that do not are
// looked up here by id (command ids without their "guest-"/"node-" prefix),
// so the common actions are permission-aware without every area repeating
// the official privilege names. `null` = explicitly no check.

const POWER = { privs: 'VM.PowerMgmt' } as const

export const DEFAULT_GUEST_PERMISSIONS: Record<string, PermissionCheck> = {
  start: POWER,
  shutdown: POWER,
  stop: POWER,
  reboot: POWER,
  reset: POWER,
  suspend: POWER,
  hibernate: POWER,
  pause: POWER,
  resume: POWER,
  console: { privs: 'VM.Console' },
  'open-console': { privs: 'VM.Console' },
  snapshot: { privs: 'VM.Snapshot' },
  'take-snapshot': { privs: 'VM.Snapshot' },
  'create-snapshot': { privs: 'VM.Snapshot' },
  rollback: { privs: 'VM.Snapshot.Rollback' },
  backup: { privs: 'VM.Backup' },
  'backup-now': { privs: 'VM.Backup' },
  restore: { privs: 'VM.Backup' },
  migrate: { privs: 'VM.Migrate' },
  clone: { privs: 'VM.Clone' },
  template: { privs: 'VM.Allocate' },
  'convert-template': { privs: 'VM.Allocate' },
  delete: { privs: 'VM.Allocate' },
  destroy: { privs: 'VM.Allocate' },
  remove: { privs: 'VM.Allocate' },
  protection: { privs: 'VM.Config.Options' },
  rename: { privs: 'VM.Config.Options' },
  tags: { privs: 'VM.Config.Options' },
  notes: { privs: 'VM.Config.Options' },
}

export const DEFAULT_NODE_PERMISSIONS: Record<string, PermissionCheck> = {
  shell: { privs: 'Sys.Console' },
  reboot: { privs: 'Sys.PowerMgmt' },
  shutdown: { privs: 'Sys.PowerMgmt' },
  wol: { privs: 'Sys.PowerMgmt' },
  wakeonlan: { privs: 'Sys.PowerMgmt' },
  'system-report': { privs: 'Sys.Audit' },
  report: { privs: 'Sys.Audit' },
  startall: { privs: 'VM.PowerMgmt', path: '/vms', anywhere: true },
  stopall: { privs: 'VM.PowerMgmt', path: '/vms', anywhere: true },
  suspendall: { privs: 'VM.PowerMgmt', path: '/vms', anywhere: true },
  'bulk-start': { privs: 'VM.PowerMgmt', path: '/vms', anywhere: true },
  'bulk-stop': { privs: 'VM.PowerMgmt', path: '/vms', anywhere: true },
  'bulk-shutdown': { privs: 'VM.PowerMgmt', path: '/vms', anywhere: true },
  'bulk-suspend': { privs: 'VM.PowerMgmt', path: '/vms', anywhere: true },
  migrateall: { privs: 'VM.Migrate', path: '/vms', anywhere: true },
  'bulk-migrate': { privs: 'VM.Migrate', path: '/vms', anywhere: true },
}

export const DEFAULT_STORAGE_PERMISSIONS: Record<string, PermissionCheck> = {
  upload: { privs: 'Datastore.AllocateTemplate' },
  'download-url': { privs: 'Datastore.AllocateTemplate' },
  download: { privs: 'Datastore.AllocateTemplate' },
  'oci-pull': { privs: 'Datastore.AllocateTemplate' },
  templates: { privs: 'Datastore.AllocateTemplate' },
}

export const DEFAULT_GLOBAL_PERMISSIONS: Record<string, PermissionCheck> = {
  'create-qemu': { privs: 'VM.Allocate', path: ['/vms', '/pool'], anywhere: true },
  'create-lxc': { privs: 'VM.Allocate', path: ['/vms', '/pool'], anywhere: true },
}

const DEFAULTS: Record<PermissionTarget['kind'], Record<string, PermissionCheck>> = {
  guest: DEFAULT_GUEST_PERMISSIONS,
  node: DEFAULT_NODE_PERMISSIONS,
  storage: DEFAULT_STORAGE_PERMISSIONS,
  global: DEFAULT_GLOBAL_PERMISSIONS,
}

/** Command ids carry their scope as a prefix ("guest-start"); action ids do not. */
export function defaultPermission(kind: PermissionTarget['kind'], id: string): PermissionCheck | undefined {
  const table = DEFAULTS[kind]
  if (Object.hasOwn(table, id)) return table[id]
  const bare = id.replace(/^(guest|vm|ct|node|storage)-/, '')
  return Object.hasOwn(table, bare) ? table[bare] : undefined
}

/** Something with an id and an optional `permission` (an ActionDef or a CommandDef). */
export interface PermissionAware<Ctx> {
  id: string
  permission?: PermissionCheck | ((ctx: Ctx) => PermissionCheck | null | undefined) | null
}

/** The check that applies to an action or command: its own, else the default for its id. */
export function resolvePermission<Ctx>(
  item: PermissionAware<Ctx>,
  ctx: Ctx,
  kind: PermissionTarget['kind'],
): PermissionCheck | null {
  if (item.permission === null) return null
  if (typeof item.permission === 'function') return item.permission(ctx) ?? null
  if (item.permission) return item.permission
  return defaultPermission(kind, item.id) ?? null
}

/** The user's privileges as a checker, built from the permission map and/or ticket caps. */
export interface PermissionChecker {
  /** True when the privileges are granted (or unknown yet and the caps allow it). */
  can(check: PermissionCheck, target?: PermissionTarget): boolean
  /** Whether the precise map has loaded (otherwise answers come from the ticket caps). */
  ready: boolean
}

export function createPermissionChecker(map: PermissionMap | undefined, cap: Capabilities | undefined): PermissionChecker {
  return {
    ready: !!map,
    can(check, target = { kind: 'global' }) {
      const path = check.path ?? targetPaths(target)
      if (map) return hasPrivileges(map, path, check.privs, { any: check.any, anywhere: check.anywhere })
      // Not loaded (or failed): coarse caps; no caps at all → allow, PVE checks anyway.
      return capAllows(cap, path, check.privs, { any: check.any }) ?? true
    },
  }
}

/** Filter predicate for registries: is this action/command allowed for the target? */
export function allowedFor<Ctx>(
  checker: PermissionChecker,
  item: PermissionAware<Ctx>,
  ctx: Ctx,
  target: PermissionTarget,
): boolean {
  const check = resolvePermission(item, ctx, target.kind)
  return check ? checker.can(check, target) : true
}

/** Human readable privilege list for hints ("VM.PowerMgmt"). */
export function describePrivs(check: PermissionCheck): string {
  return asList(check.privs).join(check.any ? ' 或 ' : '、')
}
