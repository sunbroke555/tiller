import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { instanceApiBase } from './instance-scope'
import { getSession } from './session'

export interface HardwareReading { id: string; name: string; value: number; limit?: number; warningLimit?: number }
export interface HardwareBattery {
  name: string; source: string; status?: string
  charge?: number; runtime?: number; load?: number; voltage?: number
}
export interface HardwareDisk { device: string; model: string; health: string; temperature?: number; temperatureWarning?: number; temperatureCritical?: number; life?: number; state?: 'online' | 'sleeping' | 'unsupported' | 'error'; updatedAt?: string }
export interface HardwareSnapshot {
  enabled: boolean; connected: boolean; managed: boolean; updatedAt?: string; error?: string
  paused?: boolean; notice?: string
  temperatures: HardwareReading[] | null; fans: HardwareReading[] | null; powers: HardwareReading[] | null
  batteries: HardwareBattery[] | null; disks: HardwareDisk[] | null; disksUpdatedAt?: string
  cpuWatts?: number; frequencyGHz?: number; powerPending: boolean; collectorErrors?: string[]
  powerUpdatedAt?: string; powerSampleSeconds?: number; powerError?: string
  powerCollectorVersion?: number
  smartAuto?: boolean
  smartCollectorVersion?: number
}
interface NeedsInstall { needsInstall: true; message: string }
interface NeedsTFA { requiresTFA: true; challenge: string }
interface NeedsAuthorization { needsAuthorization: true; operation: 'stop' | 'resume' | 'install' | 'upgrade' | 'uninstall'; message: string }
export interface HardwareAuthorization { password?: string; challenge?: string; code?: string }
export type HardwareResult = HardwareSnapshot | NeedsInstall | NeedsTFA | NeedsAuthorization
export type HardwareAction = 'connect' | 'upgrade' | 'install' | 'disks' | 'disconnect' | 'resume' | 'uninstall'
export interface HardwareProgress { at: string; message: string }
export interface HardwareDiagnostic { code: string; stage: string; reason: string; suggestion: string; state: string }
export class HardwareRequestError extends Error {
  readonly status: number
  readonly diagnostic?: HardwareDiagnostic
  constructor(message: string, status: number, diagnostic?: HardwareDiagnostic) {
    super(message)
    this.status = status
    this.diagnostic = diagnostic
  }
}

function interruptedHardwareResponse() {
  return new HardwareRequestError('操作日志连接已中断，尚未收到执行结果', 0, {
    code: 'PROGRESS_INTERRUPTED', stage: '接收操作结果', reason: '浏览器与 Tiller 的日志连接已中断。',
    suggestion: '恢复连接后重新打开硬件监控，检查当前状态后再决定是否重试。',
    state: '节点操作可能仍在进行，不能据此确认成功或失败。',
  })
}

export async function readHardwareResponse<T>(res: Response, onProgress?: (entry: HardwareProgress) => void): Promise<{ status: number; data: T }> {
  if (!res.headers.get('Content-Type')?.includes('application/x-ndjson')) return { status: res.status, data: await res.json() as T }
  const reader = res.body?.getReader()
  if (!reader) throw interruptedHardwareResponse()
  const decoder = new TextDecoder()
  let pending = ''
  try {
    while (true) {
      const { value, done } = await reader.read().catch(() => { throw interruptedHardwareResponse() })
      pending += decoder.decode(value, { stream: !done })
      if (pending.length > 1024 * 1024) throw new Error('接入日志响应过大')
      const lines = pending.split('\n')
      pending = lines.pop()!
      if (done && pending) { lines.push(pending); pending = '' }
      for (const line of lines) {
        if (!line.trim()) continue
        const event = JSON.parse(line) as { type: string; at?: string; message?: string; status?: number; data?: T }
        if (event.type === 'log' && typeof event.at === 'string' && typeof event.message === 'string') onProgress?.({ at: event.at, message: event.message })
        if (event.type === 'result' && typeof event.status === 'number' && event.data) return { status: event.status, data: event.data }
      }
      if (done) throw interruptedHardwareResponse()
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

const key = (node: string) => ['node-hardware', instanceApiBase(), node] as const

async function request<T>(node: string, method = 'GET', action = '', body?: unknown, signal?: AbortSignal, onProgress?: (entry: HardwareProgress) => void): Promise<T> {
  const res = await fetch(`${instanceApiBase()}/api/hardware/${encodeURIComponent(node)}${action ? '/' + action : ''}`, {
    method, credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', Accept: onProgress ? 'application/x-ndjson' : 'application/json', CSRFPreventionToken: getSession()?.csrfToken ?? '' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch((error: unknown) => {
    if (onProgress && !signal?.aborted) throw interruptedHardwareResponse()
    throw error
  })
  const { status, data } = await readHardwareResponse<T & { message?: string; diagnostic?: HardwareDiagnostic; needsInstall?: boolean; needsAuthorization?: boolean }>(res, onProgress)
  if ((status < 200 || status >= 300) && !(status === 409 && (data.needsAuthorization || (data.needsInstall && (action === 'connect' || action === 'upgrade'))))) {
    throw new HardwareRequestError(data.message || `请求失败（HTTP ${status}）`, status, data.diagnostic)
  }
  return data
}

export function useNodeHardware(node: string) {
  return useQuery({
    queryKey: key(node), queryFn: ({ signal }) => request<HardwareSnapshot>(node, 'GET', '', undefined, signal), staleTime: 2_000,
    refetchInterval: (q) => {
      const data = q.state.data
      if (!data?.enabled) return false
      if (q.state.error || !data.connected) return 30_000
      // Power is the energy delta between normal hardware scrapes.
      // A cold cache uses the same interval, with no extra warm-up requests.
      return 5_000
    },
    refetchIntervalInBackground: false, retry: 1,
  })
}

export function useHardwareAction(node: string, action: HardwareAction, onProgress?: (entry: HardwareProgress) => void) {
  const cache = useQueryClient()
  return useMutation({
    onMutate: () => cache.cancelQueries({ queryKey: key(node) }),
    mutationFn: (input?: HardwareAuthorization) => request<HardwareResult>(node, action === 'disconnect' ? 'DELETE' : 'POST', action === 'disconnect' ? '' : action, input, undefined, onProgress),
    onSuccess: (data) => { if ('enabled' in data) cache.setQueryData(key(node), data) },
    onError: () => cache.invalidateQueries({ queryKey: key(node) }),
  })
}
