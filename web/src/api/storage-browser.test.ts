import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PveApiError } from './client'
import { resetSessionCache, setSession } from './session'
import { uploadFormData, uploadToStorage } from './storage-browser'

describe('uploadFormData', () => {
  it('puts the fields first and the file last as "filename" (like the official UI)', () => {
    const file = new File(['abc'], 'local name.iso', { type: 'application/octet-stream' })
    const fd = uploadFormData({ content: 'iso', file, filename: 'target.iso', checksumAlgorithm: 'sha256', checksum: ' ab ' })
    const entries = [...fd.entries()]
    expect(entries.map(([k]) => k)).toEqual(['content', 'checksum-algorithm', 'checksum', 'filename'])
    expect(entries[2]![1]).toBe('ab')
    const part = entries[3]![1] as File
    expect(part.name).toBe('target.iso')
    expect(part.size).toBe(3)
  })

  it('leaves out an empty checksum', () => {
    const fd = uploadFormData({ content: 'vztmpl', file: new Blob(['x']), filename: 'a.tar.zst', checksumAlgorithm: 'md5', checksum: '' })
    expect([...fd.keys()]).toEqual(['content', 'filename'])
  })
})

// Minimal XMLHttpRequest stand-in: records the request, lets the test answer.
class FakeXhr {
  static last: FakeXhr | null = null
  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: unknown = null
  status = 0
  statusText = ''
  responseText = ''
  withCredentials = false
  private listeners: Record<string, ((e: unknown) => void)[]> = {}
  upload = {
    listeners: [] as ((e: ProgressEvent) => void)[],
    addEventListener: (_: string, fn: (e: ProgressEvent) => void) => this.upload.listeners.push(fn),
  }
  constructor() {
    FakeXhr.last = this
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    ;(this.listeners[type] ??= []).push(fn)
  }
  send(body: unknown) {
    this.body = body
  }
  abort() {
    this.fire('abort')
  }
  fire(type: string) {
    for (const fn of this.listeners[type] ?? []) fn({})
  }
  respond(status: number, body: unknown) {
    this.status = status
    this.responseText = JSON.stringify(body)
    this.fire('load')
  }
}

describe('uploadToStorage', () => {
  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    resetSessionCache()
    setSession({ username: 'root@pam', csrfToken: 'csrf-1', ticketIssuedAt: Date.now() }, 'PVE:root@pam::sig')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetSessionCache()
  })

  const params = { node: 'pve-lab', storage: 'local', content: 'iso' as const, file: new Blob(['x']), filename: 'a.iso' }

  it('posts multipart with the CSRF header, reports progress and resolves the UPID', async () => {
    const progress = vi.fn()
    const h = uploadToStorage(params, progress)
    const xhr = FakeXhr.last!
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api2/json/nodes/pve-lab/storage/local/upload')
    expect(xhr.headers.CSRFPreventionToken).toBe('csrf-1')
    expect(xhr.body).toBeInstanceOf(FormData)
    xhr.upload.listeners[0]!({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent)
    expect(progress).toHaveBeenCalledWith({ loaded: 5, total: 10 })
    xhr.respond(200, { data: 'UPID:pve-lab:00001234:00005678:65F00000:imgcopy::root@pam:' })
    await expect(h.promise).resolves.toMatch(/^UPID:/)
  })

  it('rejects with the PVE message and field errors', async () => {
    const h = uploadToStorage(params)
    FakeXhr.last!.respond(400, { message: 'Parameter verification failed.', errors: { filename: 'wrong extension' } })
    const err = await h.promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PveApiError)
    expect((err as PveApiError).errors).toEqual({ filename: 'wrong extension' })
  })

  it('rejects with an AbortError when cancelled', async () => {
    const h = uploadToStorage(params)
    h.abort()
    await expect(h.promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})
