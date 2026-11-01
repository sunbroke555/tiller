import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { completeTfa, fullUserId, isTfaTicket, login, logout, parseTfaChallenge, renewTicket } from './auth'
import { getSession, hasSessionMarker, resetSessionCache, setSession } from './session'

const challengeJson = { totp: true, recovery: [0, 2, 5], webauthn: { publicKey: { challenge: 'abc' } } }
const TFA_TICKET = `PVE:!tfa!${encodeURIComponent(JSON.stringify(challengeJson))}:6AE5E655::c2lnbmF0dXJl`
const REAL_TICKET = 'PVE:root@pam:6AE5E655::aGVsbG8+d29ybGQ/PQ=='

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })
}

let fetchMock: ReturnType<typeof vi.fn>
const bodyOf = (i: number) => new URLSearchParams((fetchMock.mock.calls[i]![1] as RequestInit).body as string)

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  resetSessionCache()
})
afterEach(() => {
  vi.unstubAllGlobals()
  resetSessionCache()
})

describe('TFA ticket detection', () => {
  it('recognises !tfa! tickets only', () => {
    expect(isTfaTicket(TFA_TICKET)).toBe(true)
    expect(isTfaTicket(REAL_TICKET)).toBe(false)
    expect(isTfaTicket('')).toBe(false)
    expect(isTfaTicket(undefined)).toBe(false)
  })

  it('decodes the embedded challenge', () => {
    expect(parseTfaChallenge(TFA_TICKET)).toEqual({
      totp: true,
      recovery: [0, 2, 5],
      webauthn: true,
      yubico: false,
      u2f: false,
    })
  })

  it('treats missing recovery as not configured and garbage as TOTP', () => {
    const t = `PVE:!tfa!${encodeURIComponent('{"webauthn":{}}')}:1::x`
    expect(parseTfaChallenge(t)).toMatchObject({ totp: false, recovery: null, webauthn: true })
    expect(parseTfaChallenge('PVE:!tfa!%7Bnot-json:1::x')).toMatchObject({ totp: true })
  })
})

describe('login', () => {
  it('builds the user id from realm unless one is given', () => {
    expect(fullUserId(' root ', 'pam')).toBe('root@pam')
    expect(fullUserId('admin@pve', 'pam')).toBe('admin@pve')
  })

  it('lets the server keep the ticket and stores the session on success', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { username: 'root@pam', ticket: REAL_TICKET, CSRFPreventionToken: 'csrf', clustername: 'lab' } }),
    )
    const result = await login({ username: 'root', password: 'secret', realm: 'pam' })
    expect(result.kind).toBe('ok')
    const body = bodyOf(0)
    expect(body.get('username')).toBe('root@pam')
    expect(body.get('password')).toBe('secret')
    // The realm is part of the user id; sending it again makes PVE look up "root@pam@pam".
    expect(body.has('realm')).toBe(false)
    // The Go server moves the ticket into an HttpOnly cookie when asked to.
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ 'X-Tiller-Ticket': 'cookie' })
    expect(hasSessionMarker()).toBe(true)
    expect(document.cookie).not.toContain('PVEAuthCookie')
    expect(getSession()).toMatchObject({ username: 'root@pam', csrfToken: 'csrf', clustername: 'lab' })
  })

  it('returns a pending TFA step without logging in', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { username: 'root@pam', ticket: TFA_TICKET, CSRFPreventionToken: 'csrf-1', NeedTFA: 1 } }),
    )
    const result = await login({ username: 'root', password: 'secret', realm: 'pam' })
    expect(result.kind).toBe('tfa')
    if (result.kind !== 'tfa') return
    expect(result.pending.challenge.totp).toBe(true)
    expect(getSession()).toBeNull()
    expect(hasSessionMarker()).toBe(false)

    // Second factor: the !tfa! ticket goes back as tfa-challenge.
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { username: 'root@pam', ticket: REAL_TICKET } }))
    const session = await completeTfa(result.pending, 'totp', ' 123456 ')
    const body = bodyOf(1)
    expect(body.get('tfa-challenge')).toBe(TFA_TICKET)
    expect(body.get('password')).toBe('totp:123456')
    expect(body.get('username')).toBe('root@pam')
    // The CSRF token from the first step is kept when the second omits it.
    expect(session.csrfToken).toBe('csrf-1')
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toMatchObject({ 'X-Tiller-Ticket': 'cookie' })
    expect(getSession()?.username).toBe('root@pam')
  })

  it('sends recovery keys with the recovery: prefix', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { username: 'u@pve', ticket: REAL_TICKET, CSRFPreventionToken: 'c' } }))
    await completeTfa(
      { username: 'u@pve', ticket: TFA_TICKET, challenge: parseTfaChallenge(TFA_TICKET), csrfToken: 'c' },
      'recovery',
      'abcd-efgh-ijkl-mnop',
    )
    expect(bodyOf(0).get('password')).toBe('recovery:abcd-efgh-ijkl-mnop')
  })

  it('translates a 401 into a friendly message and stays logged out', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: null, message: 'authentication failure' }, { status: 401 }))
    await expect(login({ username: 'root', password: 'bad', realm: 'pam' })).rejects.toMatchObject({
      status: 401,
      message: '用户名、密码或认证域不正确',
    })
    expect(getSession()).toBeNull()
  })

  it('renews the ticket with the cookie placeholder as password', async () => {
    setSession({ username: 'root@pam', csrfToken: 'old', ticketIssuedAt: 0 })
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { username: 'root@pam', ticket: '', CSRFPreventionToken: 'new' } }))
    await renewTicket()
    // The Go server swaps this placeholder for the HttpOnly cookie's ticket.
    expect(bodyOf(0).get('password')).toBe('tiller:cookie-ticket')
    expect(getSession()?.csrfToken).toBe('new')
    expect(getSession()?.ticketIssuedAt).toBeGreaterThan(0)
  })

  it('logs out on the server too (only it can drop the HttpOnly cookie)', async () => {
    setSession({ username: 'root@pam', csrfToken: 'c', ticketIssuedAt: Date.now() })
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    logout()
    expect(getSession()).toBeNull()
    expect(hasSessionMarker()).toBe(false)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/logout', expect.objectContaining({ method: 'POST' })))
  })

  it('counts a stored session without the browser-session marker as logged out', () => {
    setSession({ username: 'root@pam', csrfToken: 'c', ticketIssuedAt: Date.now() })
    document.cookie = 'tiller-session=; Path=/; Max-Age=0'
    resetSessionCache()
    expect(getSession()).toBeNull()
  })
})
