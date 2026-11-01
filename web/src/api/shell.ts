// Endpoints of the shell-polish area: datacenter options and notes, pools,
// the account page (password, own TFA), OpenID login and the Tiller server
// config (login consent text).

import { useQuery } from '@tanstack/react-query'

import { del, get, isPveApiError, p, post, put } from './client'
import { POLL } from './queries'
import type { GuestResource, PveBool, StorageResource } from './types'

// ------------------------------------------------------- cluster options

/** GET /cluster/options (fields used by the UI; everything else is kept as unknown). */
export interface ClusterOptions {
  description?: string
  /** base64 encoded Markdown shown before login. */
  'consent-text'?: string
  'tag-style'?: string
  'allowed-tags'?: string[]
  'user-tag-access'?: string
  'registered-tags'?: string[]
  console?: string
  language?: string
  keyboard?: string
  webauthn?: string
  [key: string]: unknown
}

export const clusterOptionsKey = () => ['pve', 'cluster', 'options'] as const

export function useClusterOptions() {
  return useQuery({
    queryKey: clusterOptionsKey(),
    queryFn: ({ signal }) => get<ClusterOptions>('/cluster/options', undefined, { signal }),
    staleTime: 5 * 60_000,
    // Everyone may log in, not everyone may read /cluster/options (Sys.Audit).
    retry: (n, e) => !(isPveApiError(e) && e.status === 403) && n < 1,
  })
}

/** Datacenter notes (Markdown); empty clears them. Needs Sys.Modify on /. */
export function saveDatacenterNotes(text: string) {
  return text.trim() ? put('/cluster/options', { description: text }) : put('/cluster/options', { delete: 'description' })
}

// ------------------------------------------------------------- ceph

/** GET /cluster/ceph/status (only the health part). Fails when Ceph is not installed. */
export interface CephStatus {
  health?: { status?: string; checks?: Record<string, { severity?: string; summary?: { message?: string } }> }
}

export function useCephStatus(enabled = true) {
  return useQuery({
    queryKey: ['pve', 'cluster', 'ceph', 'status'] as const,
    queryFn: async ({ signal }) => {
      try {
        return await get<CephStatus>('/cluster/ceph/status', undefined, { signal })
      } catch (e) {
        // Not installed / not configured / no permission: no Ceph card.
        if (isPveApiError(e) && e.status >= 400 && e.status < 600) return null
        throw e
      }
    },
    enabled,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: false,
  })
}

// ---------------------------------------------------------------- pools

export type PoolMember =
  | (GuestResource & { type: 'qemu' | 'lxc' })
  | (StorageResource & { type: 'storage' })

export interface PoolInfo {
  poolid: string
  comment?: string
  members?: PoolMember[]
}

export const poolsKey = () => ['pve', 'pools'] as const

/** All pools (GET /pools), without members. */
export function usePools() {
  return useQuery({
    queryKey: poolsKey(),
    queryFn: ({ signal }) => get<PoolInfo[]>('/pools', undefined, { signal }),
    staleTime: 30_000,
  })
}

/**
 * One pool with its members and their live usage (GET /pools?poolid=…, which
 * also works for nested pools "parent/child"; /pools/{poolid} is deprecated).
 */
export function usePool(poolid: string) {
  return useQuery({
    queryKey: [...poolsKey(), poolid],
    queryFn: async ({ signal }) => {
      const list = await get<PoolInfo[]>('/pools', { poolid }, { signal })
      const pool = list.find((x) => x.poolid === poolid) ?? list[0]
      if (!pool) throw new Error(`资源池 ${poolid} 不存在`)
      return pool
    },
    enabled: !!poolid,
    refetchInterval: POLL.status,
  })
}

// --------------------------------------------------------------- account

export function changePassword(userid: string, password: string, confirmationPassword?: string) {
  return put('/access/password', {
    userid,
    password,
    'confirmation-password': confirmationPassword || undefined,
  })
}

export type TfaType = 'totp' | 'webauthn' | 'recovery' | 'yubico' | 'u2f'

/** GET /access/tfa/{userid} */
export interface TfaEntry {
  id: string
  type: TfaType
  description?: string
  /** Epoch seconds. */
  created: number
  /** Missing means enabled. */
  enable?: PveBool
}

export const tfaKey = (userid: string) => ['pve', 'access', 'tfa', userid] as const

export function useOwnTfa(userid: string | undefined) {
  return useQuery({
    queryKey: tfaKey(userid ?? ''),
    queryFn: ({ signal }) => get<TfaEntry[]>(p`/access/tfa/${userid!}`, undefined, { signal }),
    enabled: !!userid,
  })
}

/** POST /access/tfa/{userid}: returns recovery keys, a WebAuthn challenge or the new id. */
export interface TfaAddResult {
  id?: string
  recovery?: string[]
  /** WebAuthn registration step 1: JSON string of the credential creation options. */
  challenge?: string
}

export function addTfa(
  userid: string,
  params: { type: TfaType; description?: string; totp?: string; value?: string; challenge?: string; password?: string },
) {
  return post<TfaAddResult>(p`/access/tfa/${userid}`, params)
}

export function updateTfa(userid: string, id: string, params: { enable?: boolean; description?: string; password?: string }) {
  return put(p`/access/tfa/${userid}/${id}`, params)
}

export function deleteTfa(userid: string, id: string, password?: string) {
  return del(p`/access/tfa/${userid}/${id}`, { password })
}

/**
 * Users other than root@pam confirm TFA and password changes with their
 * current password (the official UI hides the field for root@pam only).
 */
export function needsPasswordConfirmation(userid: string): boolean {
  return userid !== 'root@pam'
}

/** Realms whose passwords PVE can change. */
export function canChangePassword(userid: string): boolean {
  const realm = userid.slice(userid.lastIndexOf('@') + 1)
  return realm === 'pam' || realm === 'pve'
}

// ---------------------------------------------------------------- OpenID

/** The redirect URL PVE and the IdP see: this app's origin (per API docs). */
export function openIdRedirectUrl(): string {
  return window.location.origin
}

export async function openIdAuthUrl(realm: string): Promise<string> {
  return post<string>('/access/openid/auth-url', { realm, 'redirect-url': openIdRedirectUrl() }, { noAuthRedirect: true })
}

/**
 * The IdP sends the browser back to `<origin>/?code=…&state=…`; the auth
 * guard turns that into /login?next=%2F%3Fcode%3D…. Find code and state in
 * either place.
 */
export function readOpenIdCallback(search: URLSearchParams): { code: string; state: string } | null {
  const direct = { code: search.get('code'), state: search.get('state') }
  if (direct.code && direct.state) return { code: direct.code, state: direct.state }
  const next = search.get('next')
  if (next) {
    const q = next.indexOf('?')
    if (q >= 0) {
      const inner = new URLSearchParams(next.slice(q + 1))
      const code = inner.get('code')
      const state = inner.get('state')
      if (code && state) return { code, state }
    }
  }
  return null
}

// ----------------------------------------------------------- app config

/** GET /api/config from the Tiller server (works without login). */
export interface AppConfig {
  /** Markdown consent text configured in the datacenter options; empty when none. */
  consentText: string
}

export async function fetchAppConfig(signal?: AbortSignal): Promise<AppConfig> {
  const res = await fetch('/api/config', { signal, credentials: 'same-origin', headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as Partial<AppConfig>
  return { consentText: typeof data.consentText === 'string' ? data.consentText : '' }
}

export function useAppConfig() {
  return useQuery({
    queryKey: ['app-config'] as const,
    queryFn: ({ signal }) => fetchAppConfig(signal),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

/** Decode the datacenter `consent-text` (base64 of UTF-8 Markdown). */
export function decodeConsentText(b64: string | undefined): string {
  if (!b64) return ''
  try {
    const bin = atob(b64.replace(/\s+/g, ''))
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch {
    return b64
  }
}

