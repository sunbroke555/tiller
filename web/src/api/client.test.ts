import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PveApiError, apiUrl, del, encodeParams, get, p, post, put, setUnauthorizedHandler } from './client'
import { getSession, resetSessionCache, setSession } from './session'

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    ...init,
  })
}

let fetchMock: ReturnType<typeof vi.fn>

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, init }
}

function login() {
  setSession({ username: 'root@pam', csrfToken: 'csrf-123', ticketIssuedAt: Date.now() })
}

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({ data: null }))
  vi.stubGlobal('fetch', fetchMock)
  resetSessionCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthorizedHandler(null)
  resetSessionCache()
})

describe('encodeParams', () => {
  it('encodes booleans as 1/0, repeats arrays and skips null/undefined', () => {
    const qs = encodeParams({
      start: true,
      force: false,
      vmid: 100,
      name: 'web 01&x',
      tags: ['a', 'b'],
      skip: undefined,
      nothing: null,
      empty: '',
    })
    expect(qs.toString()).toBe('start=1&force=0&vmid=100&name=web+01%26x&tags=a&tags=b&empty=')
  })

  it('returns empty params for no input', () => {
    expect(encodeParams().toString()).toBe('')
  })
})

describe('paths', () => {
  it('prefixes API paths with /api2/json', () => {
    expect(apiUrl('/nodes')).toBe('/api2/json/nodes')
    expect(apiUrl('/api2/extjs/version')).toBe('/api2/extjs/version')
    expect(apiUrl('/nodes', new URLSearchParams({ a: '1' }))).toBe('/api2/json/nodes?a=1')
    expect(() => apiUrl('nodes')).toThrow()
  })

  it('p`` encodes interpolated segments', () => {
    const upid = 'UPID:pve:00184CC6:07BD427F:6AE5E655:vzdump::root@pam:'
    expect(p`/nodes/${'pve'}/tasks/${upid}/status`).toBe(
      '/nodes/pve/tasks/UPID%3Apve%3A00184CC6%3A07BD427F%3A6AE5E655%3Avzdump%3A%3Aroot%40pam%3A/status',
    )
    expect(p`/nodes/${'a/b'}/qemu/${100}`).toBe('/nodes/a%2Fb/qemu/100')
  })
})

describe('requests', () => {
  it('GET sends params as query string, no CSRF header and unwraps data', async () => {
    login()
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'qemu/100' }] }))
    const data = await get('/cluster/resources', { type: 'vm' })
    expect(data).toEqual([{ id: 'qemu/100' }])
    const { url, init } = lastCall()
    expect(url).toBe('/api2/json/cluster/resources?type=vm')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect((init.headers as Record<string, string>).CSRFPreventionToken).toBeUndefined()
    expect(init.credentials).toBe('same-origin')
  })

  it('POST sends a form body and the CSRF token', async () => {
    login()
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: 'UPID:pve:1:2:3:qmstart:100:root@pam:' }))
    const upid = await post<string>('/nodes/pve/qemu/100/status/start', { timeout: 30, 'skip-lock': true })
    expect(upid).toMatch(/^UPID:/)
    const { url, init } = lastCall()
    const headers = init.headers as Record<string, string>
    expect(url).toBe('/api2/json/nodes/pve/qemu/100/status/start')
    expect(init.method).toBe('POST')
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded;charset=UTF-8')
    expect(headers.CSRFPreventionToken).toBe('csrf-123')
    expect(init.body).toBe('timeout=30&skip-lock=1')
  })

  it('PUT uses a form body; DELETE uses the query string', async () => {
    login()
    await put('/nodes/pve/qemu/100/config', { memory: 2048, delete: ['net1', 'ide2'] })
    expect(lastCall().init.body).toBe('memory=2048&delete=net1&delete=ide2')
    expect((lastCall().init.headers as Record<string, string>).CSRFPreventionToken).toBe('csrf-123')

    await del('/nodes/pve/qemu/100', { purge: true })
    expect(lastCall().url).toBe('/api2/json/nodes/pve/qemu/100?purge=1')
    expect(lastCall().init.body).toBeUndefined()
    expect((lastCall().init.headers as Record<string, string>).CSRFPreventionToken).toBe('csrf-123')
  })
})

describe('errors', () => {
  it('parses PVE error bodies with message and field errors', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { data: null, message: 'Parameter verification failed.\n', errors: { vmid: 'invalid format\n' } },
        { status: 400, statusText: 'Parameter verification failed.' },
      ),
    )
    const err = (await post('/nodes/pve/qemu', { vmid: 'x' }).catch((e: unknown) => e)) as PveApiError
    expect(err).toBeInstanceOf(PveApiError)
    expect(err.status).toBe(400)
    expect(err.message).toBe('Parameter verification failed.')
    expect(err.errors).toEqual({ vmid: 'invalid format\n' })
    expect(err.detail).toBe('Parameter verification failed.\nvmid: invalid format')
    expect(err.method).toBe('POST')
    expect(err.path).toBe('/nodes/pve/qemu')
  })

  it('falls back to the status text and then to a generic message', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500, statusText: 'VM 100 already running' }))
    await expect(get('/x')).rejects.toMatchObject({ status: 500, message: 'VM 100 already running' })

    fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }))
    await expect(get('/x')).rejects.toMatchObject({ status: 502, message: '请求失败（HTTP 502）' })
  })

  it('reports network failures with status 0', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const err = (await get('/version').catch((e: unknown) => e)) as PveApiError
    expect(err.isNetworkError).toBe(true)
    expect(err.status).toBe(0)
  })

  it('passes aborts through untouched', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
    await expect(get('/version')).rejects.toHaveProperty('name', 'AbortError')
  })

  it('clears the session and notifies on 401', async () => {
    login()
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: null, message: 'invalid PVE ticket' }, { status: 401 }))
    await expect(get('/cluster/resources')).rejects.toMatchObject({ status: 401, isUnauthorized: true })
    expect(handler).toHaveBeenCalledOnce()
    expect(getSession()).toBeNull()
    expect(document.cookie).not.toContain('tiller-session=1')
  })

  it('keeps the session on 401 when noAuthRedirect is set (login form)', async () => {
    login()
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: null }, { status: 401 }))
    await expect(post('/access/ticket', {}, { noAuthRedirect: true })).rejects.toMatchObject({ status: 401 })
    expect(getSession()).not.toBeNull()
  })
})
