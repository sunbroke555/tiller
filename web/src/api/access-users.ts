// Users, groups, API tokens and TFA administration (area access-users,
// /datacenter/users). Endpoints (docs/feature-map.md §2.8):
//
//   GET/POST          /access/users                 (full=1: groups, tokens, tfa lock state)
//   GET/PUT/DELETE    /access/users/{userid}
//   PUT               /access/users/{userid}/unlock-tfa
//   GET               /access/users/{userid}/token
//   GET/POST/PUT/DEL  /access/users/{userid}/token/{tokenid}   (POST, PUT regenerate=1 return the secret once)
//   GET/POST          /access/groups
//   GET/PUT/DELETE    /access/groups/{groupid}       (members are kept on the users: PUT groups=…)
//   GET               /access/tfa                    (every user's entries, with lock state)
//   GET/POST          /access/tfa/{userid}           (add: features/account/TfaDialogs)
//   GET/PUT/DELETE    /access/tfa/{userid}/{id}
//   PUT               /access/password
//   GET               /access/permissions?userid=    (a user's or a token's effective privileges)
//   GET               /access/domains
//
// None of these return a digest; the official UI does not guard edits either.

import { useQuery } from '@tanstack/react-query'

import { del, get, p, post, put, type Params } from './client'
import type { PveBool } from './types'
import type { TfaEntry } from './shell'
import type { PermissionMap } from '@/lib/permissions'

// ------------------------------------------------------------------ types

export interface ApiToken {
  tokenid: string
  comment?: string
  /** Epoch seconds; 0 never. */
  expire?: number
  privsep?: PveBool
}

/** GET /access/users?full=1 entry. */
export interface UserEntry {
  userid: string
  enable?: PveBool
  /** Epoch seconds; 0 never. */
  expire?: number
  firstname?: string
  lastname?: string
  email?: string
  comment?: string
  /** "x" (has TFA entries), "x!oath", "x!yubico", or legacy Yubico key ids. */
  keys?: string
  /** Comma separated (full=1). */
  groups?: string
  'realm-type'?: string
  tokens?: ApiToken[] | null
  /** Epoch seconds: all second factors locked until then (too many failures). */
  'tfa-locked-until'?: number
  'totp-locked'?: PveBool | boolean
}

/** GET /access/users/{userid}. */
export interface UserConfig {
  enable?: PveBool
  expire?: number
  firstname?: string
  lastname?: string
  email?: string
  comment?: string
  keys?: string
  groups?: string[]
  tokens?: Record<string, Omit<ApiToken, 'tokenid'>>
}

export interface GroupEntry {
  groupid: string
  comment?: string
  /** Comma separated user ids. */
  users?: string
}

export interface GroupConfig {
  comment?: string
  members?: string[]
}

/** GET /access/tfa entry: one user and their second factors. */
export interface TfaUser {
  userid: string
  entries: TfaEntry[]
  'tfa-locked-until'?: number
  'totp-locked'?: PveBool | boolean
}

export interface Realm {
  realm: string
  type: string
  comment?: string
  default?: PveBool
  tfa?: string
}

/** POST /access/users/{u}/token/{t} and PUT … regenerate=1. */
export interface TokenSecret {
  'full-tokenid': string
  value: string
  info?: Record<string, unknown>
}

// ------------------------------------------------------------- query keys

export const accessKeys = {
  all: () => ['pve', 'access'] as const,
  users: () => ['pve', 'access', 'users'] as const,
  user: (userid: string) => ['pve', 'access', 'users', userid] as const,
  groups: () => ['pve', 'access', 'groups'] as const,
  group: (groupid: string) => ['pve', 'access', 'groups', groupid] as const,
  /** Same prefix as tfaKey(userid) in api/shell.ts, so one invalidation refreshes both. */
  tfa: () => ['pve', 'access', 'tfa'] as const,
  realms: () => ['pve', 'access', 'domains'] as const,
  permissionsOf: (userid: string) => ['pve', 'access', 'permissions-of', userid] as const,
}

// ------------------------------------------------------------------ hooks

export function useUsers() {
  return useQuery({
    queryKey: accessKeys.users(),
    queryFn: ({ signal }) => get<UserEntry[]>('/access/users', { full: 1 }, { signal }),
    refetchInterval: 30_000,
  })
}

export function useUser(userid: string | undefined) {
  return useQuery({
    queryKey: accessKeys.user(userid ?? ''),
    queryFn: ({ signal }) => get<UserConfig>(p`/access/users/${userid!}`, undefined, { signal }),
    enabled: !!userid,
  })
}

export function useGroups(enabled = true) {
  return useQuery({
    queryKey: accessKeys.groups(),
    queryFn: ({ signal }) => get<GroupEntry[]>('/access/groups', undefined, { signal }),
    enabled,
    refetchInterval: 30_000,
  })
}

export function useGroup(groupid: string) {
  return useQuery({
    queryKey: accessKeys.group(groupid),
    queryFn: ({ signal }) => get<GroupConfig>(p`/access/groups/${groupid}`, undefined, { signal }),
    enabled: !!groupid,
  })
}

/** Every user's second factors (official UI polls every 5 s; 15 s is plenty here). */
export function useAllTfa() {
  return useQuery({
    queryKey: accessKeys.tfa(),
    queryFn: ({ signal }) => get<TfaUser[]>('/access/tfa', undefined, { signal }),
    refetchInterval: 15_000,
  })
}

export function useRealms() {
  return useQuery({
    queryKey: accessKeys.realms(),
    queryFn: ({ signal }) => get<Realm[]>('/access/domains', undefined, { signal }),
    staleTime: 5 * 60_000,
  })
}

/** Effective privileges of a user or a token ("user@realm!token"). */
export function usePermissionsOf(userid: string | undefined) {
  return useQuery({
    queryKey: accessKeys.permissionsOf(userid ?? ''),
    queryFn: ({ signal }) => get<PermissionMap>('/access/permissions', { userid: userid! }, { signal }),
    enabled: !!userid,
  })
}

// ---------------------------------------------------------------- writes

export const createUser = (params: Params) => post('/access/users', params)
export const updateUser = (userid: string, params: Params) => put(p`/access/users/${userid}`, params)
export const deleteUser = (userid: string) => del(p`/access/users/${userid}`)
export const unlockTfa = (userid: string) => put(p`/access/users/${userid}/unlock-tfa`)

export function setUserPassword(userid: string, password: string, confirmationPassword?: string) {
  return put('/access/password', { userid, password, 'confirmation-password': confirmationPassword || undefined })
}

export const createGroup = (params: Params) => post('/access/groups', params)
export const updateGroup = (groupid: string, params: Params) => put(p`/access/groups/${groupid}`, params)
export const deleteGroup = (groupid: string) => del(p`/access/groups/${groupid}`)

export const createToken = (userid: string, tokenid: string, params: Params) =>
  post<TokenSecret>(p`/access/users/${userid}/token/${tokenid}`, params)
export const updateToken = (userid: string, tokenid: string, params: Params) => put(p`/access/users/${userid}/token/${tokenid}`, params)
export const regenerateToken = (userid: string, tokenid: string) =>
  put<TokenSecret>(p`/access/users/${userid}/token/${tokenid}`, { regenerate: 1 })
export const deleteToken = (userid: string, tokenid: string) => del(p`/access/users/${userid}/token/${tokenid}`)
