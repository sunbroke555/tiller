// Login state. The ticket lives only in the PVEAuthCookie cookie, which the Go
// server sets HttpOnly, as a session cookie, for /api2/ (the browser sends it
// with API calls; JavaScript never sees it). The CSRF token and the user name
// are kept in localStorage so a reload keeps the user logged in; a session
// marker cookie tells whether the browser still has the ticket cookie (both
// end when the browser closes).

import type { Capabilities } from './types'

export const AUTH_COOKIE = 'PVEAuthCookie'
/** Not secret: only says "the HttpOnly ticket cookie was set in this browser session". */
export const SESSION_MARKER_COOKIE = 'tiller-session'
const SESSION_KEY = 'tiller:session'

/**
 * Sent with login, two-factor, OpenID and renewal requests: the Go server
 * then keeps the ticket in the HttpOnly cookie instead of the JSON answer.
 */
export const TICKET_COOKIE_HEADERS = { 'X-Tiller-Ticket': 'cookie' } as const
/** Renewal password the Go server replaces with the ticket from the cookie. */
export const RENEW_FROM_COOKIE = 'tiller:cookie-ticket'

/** PVE tickets are valid for two hours. */
export const TICKET_LIFETIME_MS = 2 * 60 * 60 * 1000

export interface Session {
  username: string
  csrfToken: string
  /** Client clock time (ms) when the current ticket was issued or renewed. */
  ticketIssuedAt: number
  cap?: Capabilities
  clustername?: string
}

type Listener = () => void
const listeners = new Set<Listener>()
let cached: Session | null | undefined

function emit() {
  for (const l of listeners) l()
}

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Login, logout and renewals in another tab.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === SESSION_KEY || e.key === null) {
      cached = undefined
      emit()
    }
  })
}

function readStored(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<Session>
    if (typeof s.username !== 'string' || typeof s.csrfToken !== 'string' || typeof s.ticketIssuedAt !== 'number') {
      return null
    }
    return s as Session
  } catch {
    return null
  }
}

/**
 * Current session, or null when logged out. A stored session without its
 * cookie (browser restarted after the ticket expired) counts as logged out.
 */
export function getSession(): Session | null {
  if (cached === undefined) {
    const stored = readStored()
    cached = stored && hasSessionMarker() && !isExpired(stored) ? stored : null
    // A leftover session (tab reopened after the ticket ran out): tell the
    // login page why, instead of silently showing an empty form.
    if (stored && !cached && lastLogoutReason === null) lastLogoutReason = 'expired'
  }
  return cached
}

export function isExpired(s: Session, now = Date.now()): boolean {
  return now - s.ticketIssuedAt >= TICKET_LIFETIME_MS
}

/** True while this browser session holds the (HttpOnly) ticket cookie. */
export function hasSessionMarker(): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie.split(';').some((part) => part.trim().startsWith(`${SESSION_MARKER_COOKIE}=1`))
}

function writeMarker(on: boolean) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  // A session cookie (no Max-Age), like the ticket cookie it stands for.
  document.cookie = on
    ? `${SESSION_MARKER_COOKIE}=1; Path=/; SameSite=Strict${secure}`
    : `${SESSION_MARKER_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict${secure}`
}

/** Record a login or renewal (the server has set the ticket cookie). */
export function setSession(session: Session): void {
  writeMarker(true)
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // Storage unavailable: the session still works until reload.
  }
  cached = session
  lastLogoutReason = null
  emit()
}

export type LogoutReason = 'logout' | 'expired' | 'unauthorized'
let lastLogoutReason: LogoutReason | null = null

export function clearSession(reason: LogoutReason = 'logout'): void {
  writeMarker(false)
  try {
    window.localStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
  const wasLoggedIn = cached != null
  cached = null
  lastLogoutReason = reason
  if (wasLoggedIn) emit()
}

/** Why the user was last logged out (shown on the login page); reset by the next login. */
export function getLogoutReason(): LogoutReason | null {
  return lastLogoutReason
}

/** Test helper: forget the in-memory copy so the next read hits storage. */
export function resetSessionCache(): void {
  cached = undefined
}
