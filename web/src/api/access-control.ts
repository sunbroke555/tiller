// Access control (area access-control): ACLs, roles, realms, realm sync and
// pool management.
//
// Endpoints (docs/feature-map.md §2.9, §4.7, §5.7, §6.2, §7.2):
//   GET/PUT          /access/acl                     (PUT: path, roles, users|groups|tokens, propagate, delete=1)
//   GET/POST         /access/roles                   GET/PUT/DELETE /access/roles/{roleid}
//   GET/POST         /access/domains                 GET/PUT/DELETE /access/domains/{realm}
//   POST             /access/domains/{realm}/sync    (UPID; dry-run=1 previews)
//   GET              /cluster/jobs/realm-sync        GET/POST/PUT/DELETE /cluster/jobs/realm-sync/{id}
//   GET/POST/PUT/DELETE /pools                       (?poolid=…; the /pools/{poolid} form is deprecated)
//   GET              /access/users?full=1, /access/groups (subjects for the ACL editor)
//
// Permissions (apidoc): ACL PUT needs Permissions.Modify on the path (or
// Datastore.Allocate / VM.Allocate / Pool.Allocate on storage / guest / pool
// paths); roles need Sys.Modify on /access; realms Realm.Allocate on
// /access/realm; sync Realm.AllocateUser on /access/realm/<realm> plus
// User.Modify on /access/groups; pools Pool.Allocate on /pool/<id>.

import { useQuery } from '@tanstack/react-query'

import { del, get, p, post, put, type Params } from './client'
import { queryKeys } from './queries'
import { poolsKey } from './shell'
import type { PveBool } from './types'

// ------------------------------------------------------------------ types

export type AclSubjectType = 'user' | 'group' | 'token'

/** GET /access/acl entry. */
export interface AclEntry {
  path: string
  type: AclSubjectType
  /** User id, group id or token id ("user@realm!token"). */
  ugid: string
  roleid: string
  propagate: PveBool
}

/** GET /access/roles entry. */
export interface RoleInfo {
  roleid: string
  /** Comma separated privileges. */
  privs?: string
  /** Built-in role (read-only). */
  special?: PveBool
}

/** GET /access/roles/{roleid}: privilege → 1. */
export type RolePrivileges = Record<string, PveBool>

export type RealmType = 'pam' | 'pve' | 'ldap' | 'ad' | 'openid'

/** GET /access/domains entry. */
export interface RealmInfo {
  realm: string
  type: RealmType | string
  comment?: string
  default?: PveBool
  tfa?: string
}

/** GET /access/domains/{realm}: the realm's configuration (keys are API parameter names). */
export type RealmConfig = { type: RealmType | string; digest?: string } & Record<string, string | number | undefined>

/** GET /cluster/jobs/realm-sync entry. */
export interface SyncJob {
  id: string
  realm: string
  schedule: string
  enabled?: PveBool
  comment?: string
  scope?: 'users' | 'groups' | 'both'
  'enable-new'?: PveBool
  'remove-vanished'?: string
  'next-run'?: number
  'last-run'?: number
  type?: string
  digest?: string
}

export interface UserToken {
  tokenid: string
  comment?: string
  expire?: number
  privsep?: PveBool
}

/** GET /access/users?full=1 entry (only the fields used here). */
export interface UserEntry {
  userid: string
  enable?: PveBool
  comment?: string
  firstname?: string
  lastname?: string
  'realm-type'?: string
  tokens?: UserToken[] | null
}

export interface GroupEntry {
  groupid: string
  comment?: string
  users?: string
}

// ------------------------------------------------------------- query keys

export const accessKeys = {
  /** Everything below /access (ACL, roles, realms, users, own permissions). */
  all: () => ['pve', 'access'] as const,
  acl: () => ['pve', 'access', 'acl'] as const,
  roles: () => ['pve', 'access', 'roles'] as const,
  role: (roleid: string) => ['pve', 'access', 'roles', roleid] as const,
  realms: () => ['pve', 'access', 'domains'] as const,
  realm: (realm: string) => ['pve', 'access', 'domains', realm] as const,
  users: () => ['pve', 'access', 'users', 'full'] as const,
  groups: () => ['pve', 'access', 'groups'] as const,
  syncJobs: () => ['pve', 'cluster', 'jobs', 'realm-sync'] as const,
  syncJob: (id: string) => ['pve', 'cluster', 'jobs', 'realm-sync', id] as const,
}

/** After a realm change also refresh the login realm list (outside ['pve']). */
export const realmInvalidate = [accessKeys.realms(), queryKeys.domains(), accessKeys.syncJobs()] as const

// ------------------------------------------------------------------ reads

export function useAcl(enabled = true) {
  return useQuery({
    queryKey: accessKeys.acl(),
    queryFn: ({ signal }) => get<AclEntry[]>('/access/acl', undefined, { signal }),
    enabled,
    staleTime: 10_000,
  })
}

export function useRoles(enabled = true) {
  return useQuery({
    queryKey: accessKeys.roles(),
    queryFn: ({ signal }) => get<RoleInfo[]>('/access/roles', undefined, { signal }),
    enabled,
    staleTime: 30_000,
  })
}

export function useRole(roleid: string | null | undefined) {
  return useQuery({
    queryKey: accessKeys.role(roleid ?? ''),
    queryFn: ({ signal }) => get<RolePrivileges>(p`/access/roles/${roleid!}`, undefined, { signal }),
    enabled: !!roleid,
  })
}

/** Every privilege PVE knows (the official UI reads them from the Administrator role). */
export function useAllPrivileges(enabled = true) {
  return useQuery({
    queryKey: accessKeys.role('Administrator'),
    queryFn: ({ signal }) => get<RolePrivileges>('/access/roles/Administrator', undefined, { signal }),
    enabled,
    staleTime: 10 * 60_000,
    select: (map) => Object.keys(map).sort(),
  })
}

export function useRealms(enabled = true) {
  return useQuery({
    queryKey: accessKeys.realms(),
    queryFn: ({ signal }) => get<RealmInfo[]>('/access/domains', undefined, { signal }),
    enabled,
    staleTime: 30_000,
  })
}

export function useRealmConfig(realm: string | null | undefined) {
  return useQuery({
    queryKey: accessKeys.realm(realm ?? ''),
    queryFn: ({ signal }) => get<RealmConfig>(p`/access/domains/${realm!}`, undefined, { signal }),
    enabled: !!realm,
    staleTime: 0,
  })
}

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: accessKeys.users(),
    queryFn: ({ signal }) => get<UserEntry[]>('/access/users', { full: 1 }, { signal }),
    enabled,
    staleTime: 30_000,
  })
}

export function useGroups(enabled = true) {
  return useQuery({
    queryKey: accessKeys.groups(),
    queryFn: ({ signal }) => get<GroupEntry[]>('/access/groups', undefined, { signal }),
    enabled,
    staleTime: 30_000,
  })
}

export function useSyncJobs(enabled = true) {
  return useQuery({
    queryKey: accessKeys.syncJobs(),
    queryFn: ({ signal }) => get<SyncJob[]>('/cluster/jobs/realm-sync', undefined, { signal }),
    enabled,
    staleTime: 10_000,
  })
}

export function useSyncJob(id: string | null | undefined) {
  return useQuery({
    queryKey: accessKeys.syncJob(id ?? ''),
    queryFn: ({ signal }) => get<SyncJob>(p`/cluster/jobs/realm-sync/${id!}`, undefined, { signal }),
    enabled: !!id,
    staleTime: 0,
  })
}

// ----------------------------------------------------------------- writes

export const updateAcl = (params: Params) => put('/access/acl', params)

export const createRole = (params: Params) => post('/access/roles', params)
export const updateRole = (roleid: string, params: Params) => put(p`/access/roles/${roleid}`, params)
export const deleteRole = (roleid: string) => del(p`/access/roles/${roleid}`)

export const createRealm = (params: Params) => post('/access/domains', params)
export const updateRealm = (realm: string, params: Params) => put(p`/access/domains/${realm}`, params)
export const deleteRealm = (realm: string) => del(p`/access/domains/${realm}`)
/** Returns a UPID (also for dry-run). */
export const syncRealm = (realm: string, params: Params) => post<string>(p`/access/domains/${realm}/sync`, params)

export const createSyncJob = (id: string, params: Params) => post(p`/cluster/jobs/realm-sync/${id}`, params)
export const updateSyncJob = (id: string, params: Params) => put(p`/cluster/jobs/realm-sync/${id}`, params)
export const deleteSyncJob = (id: string) => del(p`/cluster/jobs/realm-sync/${id}`)

export const createPool = (params: Params) => post('/pools', params)
export const updatePool = (params: Params) => put('/pools', params)
export const deletePool = (poolid: string) => del('/pools', { poolid })

/** Query keys a pool change touches (pool list, pool detail, resource tree). */
export const poolInvalidate = [poolsKey(), queryKeys.resources(), accessKeys.acl()] as const
