import { useQuery } from '@tanstack/react-query'

import { getInstanceScope, instanceBase, type InstanceScope } from './instance-scope'
import { getSession } from './session'

export interface PveInstance extends InstanceScope {
  name: string
  url: string
  fingerprint: string
  insecureTLS: boolean
  readOnly?: boolean
  tokenId?: string
  hasCredential?: boolean
  authMode?: 'password' | 'token'
  username?: string
  realm?: string
}

export interface InstanceCatalog {
  instances: PveInstance[]
  canManage: boolean
}

export const instancesKey = ['tiller-instances'] as const
export const LAST_INSTANCE_KEY = 'tiller:last-instance'
const endpoint = '/api2/tiller/instances'

export function rememberInstance(instance: InstanceScope): void {
  try { localStorage.setItem(LAST_INSTANCE_KEY, instance.id) } catch { /* Storage may be unavailable. */ }
}

/** Resolve the saved ID against the live catalog, including its latest revision. */
export function preferredInstance(instances: PveInstance[]): PveInstance | undefined {
  let last: string | null = null
  try { last = localStorage.getItem(LAST_INSTANCE_KEY) } catch { /* Use the first configured instance. */ }
  return instances.find((instance) => instance.id === last && instance.hasCredential)
    ?? instances.find((instance) => instance.hasCredential)
}

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
    // The boundary, sidebar, mobile switcher and identity all share this catalog.
    // Saving/deleting invalidates it; mounting another consumer need not fetch again.
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  })
}

export function instanceUrl(instance: InstanceScope, path = '/'): string {
  return (instance.id === 'default' ? '' : instanceBase(instance)) + path
}

export function switchInstance(instance: InstanceScope) {
  rememberInstance(instance)
  window.location.assign(instanceUrl(instance))
}

export function usePveIdentity(): string | undefined {
  const scope = getInstanceScope()
  const { data } = useInstances()
  const instance = data?.instances.find((i) => i.id === scope?.id && i.version === scope?.version)
  if (!instance?.hasCredential) return undefined
  return instance.authMode === 'password' ? `${instance.username}@${instance.realm}` : instance.tokenId
}

export async function saveInstance(input: Pick<PveInstance, 'name' | 'url' | 'fingerprint' | 'insecureTLS'> & { authMode: 'password' | 'token'; username?: string; realm?: string; password?: string; tokenId?: string; tokenSecret?: string }, existing?: PveInstance): Promise<PveInstance> {
  return decode<PveInstance>(await fetch(endpoint + (existing ? `/${existing.id}` : ''), {
    method: existing ? 'PUT' : 'POST', credentials: 'same-origin',
    headers: { CSRFPreventionToken: getSession()?.csrfToken ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, ...(existing ? { version: existing.version } : {}) }),
  }))
}

export async function deleteInstance(instance: PveInstance): Promise<void> {
  await decode<void>(await fetch(`${endpoint}/${instance.id}`, {
    method: 'DELETE', credentials: 'same-origin', headers: { CSRFPreventionToken: getSession()?.csrfToken ?? '' },
  }))
}
