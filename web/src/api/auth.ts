// Login, two-factor completion, ticket renewal and logout.
//
// PVE ≥ 7 two-factor flow: POST /access/ticket with the password returns a
// ticket "PVE:!tfa!<url-encoded challenge JSON>:<time>::<sig>". The second
// request posts that ticket as `tfa-challenge` with `password=<type>:<code>`
// (totp, recovery, yubico or webauthn) and returns the real ticket.

import { PveApiError, get, post } from './client'
import { instanceApiBase } from './instance-scope'
import {
  RENEW_FROM_COOKIE,
  TICKET_COOKIE_HEADERS,
  TICKET_LIFETIME_MS,
  clearSession,
  getSession,
  isExpired,
  setSession,
  type Session,
} from './session'
import type { AuthDomain, TicketResponse } from './types'

export interface LoginCredentials {
  username: string
  password: string
  realm: string
}

/** Which second factors the user can answer with. */
export interface TfaChallenge {
  totp: boolean
  /** Ids of unused recovery keys; null when recovery keys are not set up. */
  recovery: number[] | null
  webauthn: boolean
  yubico: boolean
  u2f: boolean
}

export interface PendingTfa {
  username: string
  /** The "!tfa!" ticket, sent back as tfa-challenge. */
  ticket: string
  challenge: TfaChallenge
  csrfToken?: string | undefined
  cap?: TicketResponse['cap']
  clustername?: string | undefined
}

export type LoginResult = { kind: 'ok'; session: Session } | { kind: 'tfa'; pending: PendingTfa }

/** `webauthn`: the code is the JSON assertion (lib/webauthn.ts assertionToPve). */
export type TfaMethod = 'totp' | 'recovery' | 'yubico' | 'webauthn'

const TFA_MARKER = '!tfa!'

export function isTfaTicket(ticket: string | null | undefined): boolean {
  return typeof ticket === 'string' && ticket.split(':')[1]?.startsWith(TFA_MARKER) === true
}

/** Decode the challenge embedded in a "!tfa!" ticket. */
export function parseTfaChallenge(ticket: string): TfaChallenge {
  const field = ticket.split(':')[1] ?? ''
  let raw: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(field.slice(TFA_MARKER.length)))
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>
  } catch {
    // Unknown format: offer TOTP, the most common factor.
    raw = { totp: true }
  }
  const recovery = Array.isArray(raw.recovery) ? raw.recovery.filter((x): x is number => typeof x === 'number') : null
  return {
    totp: !!raw.totp,
    recovery,
    webauthn: !!raw.webauthn,
    yubico: !!raw.yubico,
    u2f: !!raw.u2f,
  }
}

/** "root" + "pam" → "root@pam"; an explicit "@realm" in the name wins. */
export function fullUserId(username: string, realm: string): string {
  const u = username.trim()
  return u.includes('@') ? u : `${u}@${realm}`
}

function loginErrorMessage(e: unknown): unknown {
  if (e instanceof PveApiError && e.status === 401) {
    return new PveApiError({
      status: 401,
      message: '用户名、密码或认证域不正确',
      method: e.method,
      path: e.path,
    })
  }
  return e
}

function sessionFrom(data: TicketResponse, fallback?: Partial<PendingTfa>): Session {
  const csrfToken = data.CSRFPreventionToken ?? fallback?.csrfToken
  if (!csrfToken) throw new Error('PVE 没有返回 CSRF token')
  const session: Session = {
    username: data.username || fallback?.username || '',
    csrfToken,
    ticketIssuedAt: Date.now(),
  }
  const cap = data.cap ?? fallback?.cap
  if (cap) session.cap = cap
  const clustername = data.clustername ?? fallback?.clustername
  if (clustername) session.clustername = clustername
  return session
}

export async function login(creds: LoginCredentials): Promise<LoginResult> {
  const username = fullUserId(creds.username, creds.realm)
  let data: TicketResponse
  try {
    data = await post<TicketResponse>(
      '/access/ticket',
      // No `realm` parameter: PVE appends it to the user name, so
      // "root@pam" + realm=pam would become "root@pam@pam".
      { username, password: creds.password, 'new-format': 1 },
      { noAuthRedirect: true, headers: TICKET_COOKIE_HEADERS },
    )
  } catch (e) {
    throw loginErrorMessage(e)
  }

  if (isTfaTicket(data.ticket)) {
    return {
      kind: 'tfa',
      pending: {
        username: data.username ?? username,
        ticket: data.ticket,
        challenge: parseTfaChallenge(data.ticket),
        csrfToken: data.CSRFPreventionToken,
        cap: data.cap,
        clustername: data.clustername,
      },
    }
  }
  if (data.NeedTFA) {
    // Pre-PVE-7 OTP flow (POST /access/tfa). Not supported: PVE 7+ only.
    throw new Error('该 PVE 版本使用旧版两步验证，暂不支持，请升级到 PVE 7 以上')
  }

  const session = sessionFrom(data)
  setSession(session)
  return { kind: 'ok', session }
}

/**
 * OpenID Connect: after the IdP redirected back with code and state, trade
 * them for a ticket (POST /access/openid/login). OpenID realms do their own
 * second factor, so this never returns a TFA challenge.
 */
export async function loginWithOpenId(code: string, state: string, redirectUrl: string): Promise<Session> {
  const data = await post<TicketResponse>(
    '/access/openid/login',
    { code, state, 'redirect-url': redirectUrl },
    { noAuthRedirect: true, headers: TICKET_COOKIE_HEADERS },
  )
  const session = sessionFrom(data)
  setSession(session)
  return session
}

export async function completeTfa(pending: PendingTfa, method: TfaMethod, code: string): Promise<Session> {
  let data: TicketResponse
  try {
    data = await post<TicketResponse>(
      '/access/ticket',
      { username: pending.username, 'tfa-challenge': pending.ticket, password: `${method}:${code.trim()}` },
      { noAuthRedirect: true, headers: TICKET_COOKIE_HEADERS },
    )
  } catch (e) {
    if (e instanceof PveApiError && e.status === 401) {
      throw new PveApiError({ status: 401, message: '验证码不正确或已过期', method: e.method, path: e.path })
    }
    throw e
  }
  if (isTfaTicket(data.ticket)) throw new Error('两步验证未完成，请重试')
  const session = sessionFrom(data, pending)
  setSession(session)
  return session
}

/**
 * Renew the ticket by logging in with the current ticket as password. The
 * ticket is in an HttpOnly cookie, so a placeholder goes in its place and
 * the Go server substitutes the cookie's value.
 */
export async function renewTicket(): Promise<void> {
  const session = getSession()
  if (!session) return
  const data = await post<TicketResponse>(
    '/access/ticket',
    { username: session.username, password: RENEW_FROM_COOKIE },
    { noAuthRedirect: true, headers: TICKET_COOKIE_HEADERS },
  )
  setSession(sessionFrom(data, { username: session.username, csrfToken: session.csrfToken }))
}

export function logout(): void {
  // Only the server can drop the HttpOnly ticket cookie; best effort.
  Promise.resolve()
    .then(() => fetch(instanceApiBase() + '/api/logout', { method: 'POST', headers: TICKET_COOKIE_HEADERS, credentials: 'same-origin' }))
    .catch(() => {})
  clearSession('logout')
}

/** Renew this long after issue; the ticket itself lasts two hours. */
export const RENEW_AFTER_MS = 15 * 60 * 1000
const CHECK_EVERY_MS = 60 * 1000
/** Warn when renewal keeps failing and less than this is left. */
export const EXPIRY_WARNING_MS = 10 * 60 * 1000

export interface RenewalHooks {
  /** The session expired or PVE rejected the renewal (user is logged out now). */
  onExpired?: () => void
  /** Renewal failed for another reason (offline, PVE down) and the ticket runs out soon. */
  onExpiringSoon?: (msLeft: number) => void
  /** The ticket was renewed (e.g. to refresh permission data). */
  onRenewed?: () => void
}

/**
 * Keep the ticket fresh while the app is open. Returns a stop function.
 *
 * - Expired sessions (laptop slept for hours) are cleared instead of renewed.
 * - Checks again when the tab becomes visible or the network comes back
 *   (background tabs' timers are throttled).
 * - A 401 on renewal logs out; network errors retry on the next tick and
 *   warn once when less than EXPIRY_WARNING_MS remain.
 * - Several tabs share the cookie and the stored session: a renewal in one
 *   tab updates ticketIssuedAt for all, so the others skip theirs.
 */
export function startTicketRenewal(hooks: RenewalHooks | (() => void) = {}): () => void {
  const { onExpired, onExpiringSoon, onRenewed } = typeof hooks === 'function' ? { onExpired: hooks } : hooks
  let busy = false
  let warnedFor: number | null = null
  const check = async () => {
    const session = getSession()
    if (!session || busy) return
    if (isExpired(session)) {
      clearSession('expired')
      onExpired?.()
      return
    }
    if (Date.now() - session.ticketIssuedAt < RENEW_AFTER_MS) return
    busy = true
    try {
      await renewTicket()
      warnedFor = null
      onRenewed?.()
    } catch (e) {
      if (e instanceof PveApiError && e.status === 401) {
        clearSession('expired')
        onExpired?.()
      } else {
        // Network errors: try again on the next tick; warn once per ticket when time runs short.
        const left = session.ticketIssuedAt + TICKET_LIFETIME_MS - Date.now()
        if (left < EXPIRY_WARNING_MS && warnedFor !== session.ticketIssuedAt) {
          warnedFor = session.ticketIssuedAt
          onExpiringSoon?.(left)
        }
      }
    } finally {
      busy = false
    }
  }
  const timer = window.setInterval(check, CHECK_EVERY_MS)
  const onVisible = () => {
    if (document.visibilityState === 'visible') void check()
  }
  const onOnline = () => void check()
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  void check()
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
  }
}

/** Realms for the login form. Works without authentication. */
export function fetchDomains(signal?: AbortSignal): Promise<AuthDomain[]> {
  return get<AuthDomain[]>('/access/domains', undefined, { signal, noAuthRedirect: true })
}
