import { useQuery } from '@tanstack/react-query'

import { instanceBase, type InstanceScope } from './instance-scope'
import { TICKET_COOKIE_HEADERS } from './session'

export interface PveInstance extends InstanceScope {
  name: string
  url: string
  fingerprint: string
  insecureTLS: boolean
  readOnly?: boolean
}

export interface InstanceCatalog {
  instances: PveInstance[]
  canManage: boolean
}

export const instancesKey = ['tiller-instances'] as const
const endpoint = '/api2/tiller/instances'

async function decode<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T
  const data = await res.json() as T & { message?: string }
  if (!res.ok) throw new Error(data.message || `请求失败（HTTP ${res.status}）`)
  return data
}

export function useInstances(manage = false) {
  return useQuery({
    queryKey: [...instancesKey, manage],
    queryFn: async ({ signal }) => decode<InstanceCatalog>(await fetch(endpoint + (manage ? '?manage=1' : ''), {
      signal, credentials: 'same-origin', headers: { Accept: 'application/json' },
    })),
    staleTime: 0,
    refetchInterval: 30_000,
    retry: 1,
  })
}

export function instanceUrl(instance: InstanceScope, path = '/'): string {
  return (instance.id === 'default' ? '' : instanceBase(instance)) + path
}

export function switchInstance(instance: InstanceScope) {
  window.location.assign(instanceUrl(instance))
}

export async function saveInstance(input: Pick<PveInstance, 'name' | 'url' | 'fingerprint' | 'insecureTLS'>, existing?: PveInstance): Promise<PveInstance> {
  return decode<PveInstance>(await fetch(endpoint + (existing ? `/${existing.id}` : ''), {
    method: existing ? 'PUT' : 'POST', credentials: 'same-origin',
    headers: { ...TICKET_COOKIE_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, ...(existing ? { version: existing.version } : {}) }),
  }))
}

export async function deleteInstance(instance: PveInstance): Promise<void> {
  await decode<void>(await fetch(`${endpoint}/${instance.id}`, {
    method: 'DELETE', credentials: 'same-origin', headers: TICKET_COOKIE_HEADERS,
  }))
}
