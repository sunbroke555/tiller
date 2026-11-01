// Login state. The ticket lives only in the PVEAuthCookie cookie (the browser
// sends it to the Go server, which forwards it to PVE); the CSRF token and the
// user name are kept in localStorage so a reload keeps the user logged in.

import type { Capabilities } from './types'

export const AUTH_COOKIE = 'PVEAuthCookie'
const SESSION_KEY = 'pve-web:session'

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
    cached = stored && getTicket() && !isExpired(stored) ? stored : null
    // A leftover session (tab reopened after the ticket ran out): tell the
    // login page why, instead of silently showing an empty form.
    if (stored && !cached && lastLogoutReason === null) lastLogoutReason = 'expired'
  }
  return cached
}

export function isExpired(s: Session, now = Date.now()): boolean {
  return now - s.ticketIssuedAt >= TICKET_LIFETIME_MS
}

export function getTicket(): string | null {
  if (typeof document === 'undefined') return null
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === AUTH_COOKIE) {
      const value = rest.join('=')
      try {
        return value ? decodeURIComponent(value) : null
      } catch {
        return value || null
      }
    }
  }
  return null
}

function writeCookie(value: string, maxAgeSeconds: number) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  // pveproxy URI-unescapes the cookie value, so encoding is safe and keeps
  // characters like ";" or "=" in the base64 signature intact.
  document.cookie = `${AUTH_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Strict${secure}`
}

/** Store a freshly issued (or renewed) ticket. */
export function setSession(session: Session, ticket: string): void {
  writeCookie(ticket, Math.floor(TICKET_LIFETIME_MS / 1000))
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
  writeCookie('', 0)
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
