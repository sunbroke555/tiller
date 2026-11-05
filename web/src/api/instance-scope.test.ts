import { afterEach, describe, expect, it, vi } from 'vitest'

const id = 'a'.repeat(24)
const version = 'b'.repeat(24)
const scopePath = `/i/${id}/${version}`

afterEach(() => {
  window.history.replaceState(null, '', '/')
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('instance isolation', () => {
  it('shares the Tiller admin login across instance pages and clears it globally', async () => {
    localStorage.setItem('tiller:admin-session', JSON.stringify({ username: 'admin', csrfToken: 'tiller-csrf', ticketIssuedAt: Date.now(), expiresAt: Date.now() + 3600000 }))
    document.cookie = 'tiller-admin-session=1; Path=/'
    window.history.replaceState(null, '', scopePath + '/')
    vi.resetModules()
    const session = await import('./session')
    expect(session.getSession()?.username).toBe('admin')
    expect(session.getSession()?.csrfToken).toBe('tiller-csrf')
    expect(localStorage.getItem(`tiller:admin-session:${id}:${version}`)).toBeNull()
    session.clearSession()
    expect(localStorage.getItem('tiller:admin-session')).toBeNull()
    expect(document.cookie).not.toContain('tiller-admin-session=1')
  })

  it('scopes API, download, websocket and OpenID URLs to the same connection', async () => {
    window.history.replaceState(null, '', scopePath + '/')
    vi.resetModules()
    const { apiUrl, post } = await import('./client')
    const { setSession } = await import('./session')
    const { vncWebsocketUrl } = await import('./console')
    const { openIdRedirectUrl } = await import('./shell')
    const prefix = `/api/instances/${id}/${version}`
    expect(apiUrl('/nodes')).toBe(prefix + '/api2/json/nodes')
    expect(apiUrl('/api2/json/download', new URLSearchParams({ volume: 'local:one' }))).toBe(prefix + '/api2/json/download?volume=local%3Aone')
    setSession({ username: 'alice@pve', csrfToken: 'instance-csrf', ticketIssuedAt: Date.now() })
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: null }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    await post('/nodes/pve/status', { command: 'test' })
    expect(fetch).toHaveBeenCalledWith(prefix + '/api2/json/nodes/pve/status', expect.objectContaining({ headers: expect.objectContaining({ CSRFPreventionToken: 'instance-csrf' }) }))
    expect(vncWebsocketUrl({ kind: 'node', node: 'pve' }, { port: 5900, ticket: 'vnc' }, { host: 'tiller.test', protocol: 'https:' })).toContain('wss://tiller.test' + prefix + '/api2/json/')
    expect(openIdRedirectUrl()).toBe(window.location.origin + scopePath + '/')
  })

  it('keeps a document pinned to its instance, and rejects malformed namespaces', async () => {
    window.history.replaceState(null, '', scopePath + '/')
    vi.resetModules()
    const scope = await import('./instance-scope')
    expect(scope.getInstanceScope()).toEqual({ id, version })
    window.history.replaceState(null, '', '/')
    expect(scope.instanceAppUrl('/console/pve/shell')).toBe(scopePath + '/console/pve/shell')
    expect(scope.scopeFromPath('/i/default/../../')).toBeNull()
    expect(scope.scopeFromPath('/i/' + id + '/bad/')).toBeNull()
  })
})
