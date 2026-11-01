import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RENEW_AFTER_MS, loginWithOpenId, startTicketRenewal } from './auth'
import { getSession, resetSessionCache, setSession, TICKET_LIFETIME_MS } from './session'
import { canChangePassword, decodeConsentText, fetchAppConfig, needsPasswordConfirmation, readOpenIdCallback, saveDatacenterNotes } from './shell'

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  resetSessionCache()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetSessionCache()
})

describe('OpenID', () => {
  it('reads code and state from the URL or from the login redirect', () => {
    expect(readOpenIdCallback(new URLSearchParams('code=c1&state=s1'))).toEqual({ code: 'c1', state: 's1' })
    expect(readOpenIdCallback(new URLSearchParams(`next=${encodeURIComponent('/?code=c2&state=s2')}`))).toEqual({ code: 'c2', state: 's2' })
    expect(readOpenIdCallback(new URLSearchParams('next=%2Fnode%2Fpve'))).toBeNull()
    expect(readOpenIdCallback(new URLSearchParams('code=only'))).toBeNull()
  })

  it('trades code and state for a session', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { username: 'alice@oidc', ticket: 'PVE:alice@oidc:1::sig', CSRFPreventionToken: 'csrf' } }),
    )
    const s = await loginWithOpenId('C', 'S', 'https://web.example')
    expect(s.username).toBe('alice@oidc')
    const body = new URLSearchParams((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(fetchMock.mock.calls[0]![0]).toBe('/api2/json/access/openid/login')
    expect(Object.fromEntries(body)).toEqual({ code: 'C', state: 'S', 'redirect-url': 'https://web.example' })
    expect(getSession()?.username).toBe('alice@oidc')
  })
})

describe('account helpers', () => {
  it('knows which realms can change passwords and who must confirm', () => {
    expect(canChangePassword('root@pam')).toBe(true)
    expect(canChangePassword('bob@pve')).toBe(true)
    expect(canChangePassword('carol@ad')).toBe(false)
    expect(needsPasswordConfirmation('root@pam')).toBe(false)
    expect(needsPasswordConfirmation('bob@pve')).toBe(true)
  })

  it('clears empty datacenter notes with delete', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ data: null })))
    await saveDatacenterNotes('  ')
    expect((fetchMock.mock.calls[0]![1] as RequestInit).body).toBe('delete=description')
    await saveDatacenterNotes('# hi')
    expect((fetchMock.mock.calls[1]![1] as RequestInit).body).toBe('description=%23+hi')
  })
})

describe('consent text', () => {
  it('decodes base64 UTF-8 and reads the server config', async () => {
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode('仅限授权人员')))
    expect(decodeConsentText(b64)).toBe('仅限授权人员')
    expect(decodeConsentText(undefined)).toBe('')
    fetchMock.mockResolvedValueOnce(jsonResponse({ consentText: '# 须知' }))
    expect(await fetchAppConfig()).toEqual({ consentText: '# 须知' })
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    expect(await fetchAppConfig()).toEqual({ consentText: '' })
  })
})

describe('ticket renewal edge cases', () => {
  const session = (issuedAgo: number) => {
    setSession({ username: 'root@pam', csrfToken: 'c', ticketIssuedAt: Date.now() - issuedAgo })
  }

  it('warns once when renewal fails offline and the ticket is about to expire', async () => {
    session(TICKET_LIFETIME_MS - 5 * 60_000)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const onExpiringSoon = vi.fn()
    const onExpired = vi.fn()
    const stop = startTicketRenewal({ onExpiringSoon, onExpired })
    await vi.waitFor(() => expect(onExpiringSoon).toHaveBeenCalledTimes(1))
    window.dispatchEvent(new Event('online'))
    await new Promise((r) => setTimeout(r, 20))
    expect(onExpiringSoon).toHaveBeenCalledTimes(1)
    expect(onExpired).not.toHaveBeenCalled()
    expect(getSession()).not.toBeNull()
    stop()
  })

  it('logs out when PVE rejects the renewal', async () => {
    session(RENEW_AFTER_MS + 1000)
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ data: null, message: 'authentication failure' }, { status: 401 })))
    const onExpired = vi.fn()
    const stop = startTicketRenewal({ onExpired })
    await vi.waitFor(() => expect(onExpired).toHaveBeenCalled())
    expect(getSession()).toBeNull()
    stop()
  })

  it('renews and reports it; skips fresh tickets', async () => {
    session(RENEW_AFTER_MS + 1000)
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ data: { username: 'root@pam', ticket: 'PVE:root@pam:2::new', CSRFPreventionToken: 'c2' } })),
    )
    const onRenewed = vi.fn()
    const stop = startTicketRenewal({ onRenewed })
    await vi.waitFor(() => expect(onRenewed).toHaveBeenCalledTimes(1))
    expect(getSession()?.csrfToken).toBe('c2')
    // Now fresh: a visibility change does not renew again.
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    stop()
  })

  it('still accepts a plain onExpired callback', () => {
    const stop = startTicketRenewal(() => {})
    stop()
  })
})
