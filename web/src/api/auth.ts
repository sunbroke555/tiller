// Login, two-factor completion, ticket renewal and logout.
//
// PVE ≥ 7 two-factor flow: POST /access/ticket with the password returns a
// ticket "PVE:!tfa!<url-encoded challenge JSON>:<time>::<sig>". The second
// request posts that ticket as `tfa-challenge` with `password=<type>:<code>`
// (totp, recovery, yubico or webauthn) and returns the real ticket.

import { PveApiError, get, post } from './client'
import { clearSession, getSession, getTicket, isExpired, setSession, type Session } from './session'
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

export type TfaMethod = 'totp' | 'recovery' | 'yubico'

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
      { noAuthRedirect: true },
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
  setSession(session, data.ticket)
  return { kind: 'ok', session }
}

export async function completeTfa(pending: PendingTfa, method: TfaMethod, code: string): Promise<Session> {
  let data: TicketResponse
  try {
    data = await post<TicketResponse>(
      '/access/ticket',
      { username: pending.username, 'tfa-challenge': pending.ticket, password: `${method}:${code.trim()}` },
      { noAuthRedirect: true },
    )
  } catch (e) {
    if (e instanceof PveApiError && e.status === 401) {
      throw new PveApiError({ status: 401, message: '验证码不正确或已过期', method: e.method, path: e.path })
    }
    throw e
  }
  if (isTfaTicket(data.ticket)) throw new Error('两步验证未完成，请重试')
  const session = sessionFrom(data, pending)
  setSession(session, data.ticket)
  return session
}

/** Renew the ticket by logging in with the current ticket as password. */
export async function renewTicket(): Promise<void> {
  const session = getSession()
  const ticket = getTicket()
  if (!session || !ticket) return
  const data = await post<TicketResponse>(
    '/access/ticket',
    { username: session.username, password: ticket },
    { noAuthRedirect: true },
  )
  setSession(sessionFrom(data, { username: session.username, csrfToken: session.csrfToken }), data.ticket)
}

export function logout(): void {
  clearSession('logout')
}

/** Renew this long after issue; the ticket itself lasts two hours. */
export const RENEW_AFTER_MS = 15 * 60 * 1000
const CHECK_EVERY_MS = 60 * 1000

/**
 * Keep the ticket fresh while the app is open. Returns a stop function.
 * Expired sessions (laptop slept for hours) are cleared instead of renewed.
 */
export function startTicketRenewal(onExpired: () => void): () => void {
  let busy = false
  const check = async () => {
    const session = getSession()
    if (!session || busy) return
    if (isExpired(session)) {
      clearSession('expired')
      onExpired()
      return
    }
    if (Date.now() - session.ticketIssuedAt < RENEW_AFTER_MS) return
    busy = true
    try {
      await renewTicket()
    } catch (e) {
      if (e instanceof PveApiError && e.status === 401) {
        clearSession('expired')
        onExpired()
      }
      // Network errors: try again on the next tick.
    } finally {
      busy = false
    }
  }
  const timer = window.setInterval(check, CHECK_EVERY_MS)
  const onVisible = () => {
    if (document.visibilityState === 'visible') void check()
  }
  document.addEventListener('visibilitychange', onVisible)
  void check()
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

/** Realms for the login form. Works without authentication. */
export function fetchDomains(signal?: AbortSignal): Promise<AuthDomain[]> {
  return get<AuthDomain[]>('/access/domains', undefined, { signal, noAuthRedirect: true })
}
