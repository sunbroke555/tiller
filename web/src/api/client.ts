// Minimal PVE API client.
//
//   get('/cluster/resources', { type: 'vm' })
//   post(p`/nodes/${node}/qemu/${vmid}/status/start`)
//
// Paths are API paths ("/nodes/..."); the /api2/json prefix, the CSRF header
// and form encoding are added here. Responses are unwrapped from {data}.
// Failures throw PveApiError.

import { clearSession, getSession } from './session'
import { instanceApiBase, type InstanceScope } from './instance-scope'

export const API_PREFIX = '/api2/json'
export const CSRF_HEADER = 'CSRFPreventionToken'

export type ParamValue = string | number | boolean | null | undefined | readonly (string | number)[]
export type Params = Record<string, ParamValue>

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export class PveApiError extends Error {
  override readonly name = 'PveApiError'
  /** HTTP status; 0 for network failures. */
  readonly status: number
  /** Per-parameter validation errors, e.g. { vmid: "value must be ≥ 100" }. */
  readonly errors: Record<string, string> | undefined
  readonly method: HttpMethod
  readonly path: string

  constructor(init: {
    status: number
    message: string
    errors?: Record<string, string> | undefined
    method: HttpMethod
    path: string
  }) {
    super(init.message)
    this.status = init.status
    this.errors = init.errors
    this.method = init.method
    this.path = init.path
  }

  get isUnauthorized() {
    return this.status === 401
  }
  get isForbidden() {
    return this.status === 403
  }
  get isNetworkError() {
    return this.status === 0
  }

  /** Message including field errors, suitable for a toast. */
  get detail(): string {
    if (!this.errors) return this.message
    const fields = Object.entries(this.errors).map(([k, v]) => `${k}: ${v.trim()}`)
    return [this.message, ...fields].join('\n')
  }
}

export function isPveApiError(e: unknown): e is PveApiError {
  return e instanceof PveApiError
}

/** A 4xx answer (auth, permission, not found, validation): retrying will not fix it. */
export function isClientError(e: unknown): e is PveApiError {
  return isPveApiError(e) && e.status >= 400 && e.status < 500
}

/**
 * Tagged template that URI-encodes interpolated path segments:
 * p`/nodes/${node}/tasks/${upid}/status` keeps the ":" in UPIDs safe.
 */
export function p(strings: TemplateStringsArray, ...values: (string | number)[]): string {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? encodeURIComponent(String(values[i])) : ''), '')
}

/**
 * Encode params the way PVE expects form/query values: booleans as 1/0,
 * arrays as repeated keys, null/undefined omitted.
 */
export function encodeParams(params?: Params): URLSearchParams {
  const out = new URLSearchParams()
  if (!params) return out
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const v of value as readonly (string | number)[]) out.append(key, String(v))
    } else if (typeof value === 'boolean') {
      out.append(key, value ? '1' : '0')
    } else {
      out.append(key, String(value))
    }
  }
  return out
}

export function apiUrl(path: string, query?: URLSearchParams, instance?: InstanceScope | null): string {
  if (!path.startsWith('/')) throw new Error(`API path must start with "/": ${path}`)
  const base = instanceApiBase(instance) + (path.startsWith('/api2/') ? path : API_PREFIX + path)
  const qs = query?.toString()
  return qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base
}

export interface RequestOptions {
  /** Explicit immutable target for multi-instance reads; normal pages use their URL scope. */
  instance?: InstanceScope | null
  signal?: AbortSignal | undefined
  /**
   * Do not log the user out on 401 (login and ticket renewal handle 401
   * themselves: it means wrong credentials there, not an expired session).
   */
  noAuthRedirect?: boolean
  /** Extra request headers. */
  headers?: Record<string, string>
}

/** Full PVE response envelope; most callers only want `data`. */
export interface PveEnvelope<T> {
  data: T
  total?: number
  changes?: Record<string, unknown>
  message?: string
  errors?: Record<string, string>
}

let unauthorizedHandler: (() => void) | null = null

/** Called after a 401 cleared the session (the app navigates to /login). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  const ct = res.headers.get('Content-Type') ?? ''
  if (ct.includes('json') || text.startsWith('{') || text.startsWith('[')) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return text
}

function errorMessage(res: Response, body: unknown): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message?: unknown }).message
    if (typeof m === 'string' && m.trim()) return m.trim()
  }
  if (typeof body === 'string' && body.trim() && body.length < 300 && !body.trimStart().startsWith('<')) {
    return body.trim()
  }
  if (res.statusText) return res.statusText
  return `请求失败（HTTP ${res.status}）`
}

export async function requestEnvelope<T>(
  method: HttpMethod,
  path: string,
  params?: Params,
  options: RequestOptions = {},
): Promise<PveEnvelope<T>> {
  const encoded = encodeParams(params)
  const hasBody = method === 'POST' || method === 'PUT'
  const url = apiUrl(path, hasBody ? undefined : encoded, options.instance)

  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers }
  if (method !== 'GET') {
    const csrf = getSession()?.csrfToken
    if (csrf) headers[CSRF_HEADER] = csrf
  }
  let body: string | undefined
  if (hasBody) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
    body = encoded.toString()
  }

  let res: Response
  try {
    res = await fetch(url, { method, headers, body, credentials: 'same-origin', signal: options.signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new PveApiError({ status: 0, message: '网络错误，无法连接服务器', method, path })
  }

  const parsed = await parseBody(res)
  if (!res.ok) {
    const errors =
      parsed && typeof parsed === 'object' && 'errors' in parsed
        ? ((parsed as { errors?: Record<string, string> }).errors ?? undefined)
        : undefined
    const err = new PveApiError({ status: res.status, message: errorMessage(res, parsed), errors, method, path })
    if (res.status === 401 && !options.noAuthRedirect) {
      clearSession('unauthorized')
      unauthorizedHandler?.()
    }
    throw err
  }

  if (parsed && typeof parsed === 'object' && 'data' in parsed) return parsed as PveEnvelope<T>
  return { data: parsed as T }
}

export async function request<T>(method: HttpMethod, path: string, params?: Params, options?: RequestOptions): Promise<T> {
  return (await requestEnvelope<T>(method, path, params, options)).data
}

export const get = <T>(path: string, params?: Params, options?: RequestOptions) => request<T>('GET', path, params, options)
export const post = <T = null>(path: string, params?: Params, options?: RequestOptions) =>
  request<T>('POST', path, params, options)
export const put = <T = null>(path: string, params?: Params, options?: RequestOptions) =>
  request<T>('PUT', path, params, options)
export const del = <T = null>(path: string, params?: Params, options?: RequestOptions) =>
  request<T>('DELETE', path, params, options)
