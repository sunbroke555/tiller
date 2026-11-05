import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LAST_INSTANCE_KEY, instancesKey, preferredInstance, rememberInstance, useInstances, usePveIdentity, type PveInstance } from './instances'
import { setSession } from './session'

vi.mock('./instance-scope', async (original) => ({
  ...await original<object>(),
  getInstanceScope: () => ({ id: 'chosen', version: 'current' }),
}))
afterEach(() => { vi.unstubAllGlobals(); localStorage.removeItem(LAST_INSTANCE_KEY) })

const first: PveInstance = { id: 'first', version: 'v1', name: 'A', url: 'https://pve-a', fingerprint: '', insecureTLS: false, hasCredential: true }
const second: PveInstance = { ...first, id: 'second', name: 'B' }

it('reuses the boundary catalog when the sidebar mounts, but refreshes after an edit', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ canManage: true, instances: [first] })))
  vi.stubGlobal('fetch', fetch)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const boundary = renderHook(() => useInstances(), { wrapper })
  await waitFor(() => expect(boundary.result.current.isSuccess).toBe(true))
  const sidebar = renderHook(() => useInstances(), { wrapper })
  expect(sidebar.result.current.data?.instances).toEqual([first])
  expect(fetch).toHaveBeenCalledTimes(1)
  await client.invalidateQueries({ queryKey: instancesKey })
  expect(fetch).toHaveBeenCalledTimes(2)
  sidebar.unmount(); boundary.unmount(); client.clear()
})

it('resumes the last instance using its latest connection revision', () => {
  rememberInstance(second)
  const updated = { ...second, version: 'v2' }
  expect(preferredInstance([first, updated])).toBe(updated)
})

it('falls back after the remembered instance is removed or has no credentials', () => {
  rememberInstance(second)
  expect(preferredInstance([first])).toBe(first)
  expect(preferredInstance([{ ...second, hasCredential: false }, first])).toBe(first)
  expect(preferredInstance([])).toBeUndefined()
  expect(preferredInstance([{ ...first, hasCredential: false }])).toBeUndefined()
})

it('opens the first configured instance when storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  expect(preferredInstance([first, second])).toBe(first)
})

it.each([
  { authMode: 'password' as const, username: 'operator', realm: 'pve', expected: 'operator@pve' },
  { authMode: 'password' as const, username: 'root', realm: 'pam', expected: 'root@pam' },
  { authMode: 'token' as const, tokenId: 'root@pam!limited', expected: 'root@pam!limited' },
])('uses the selected PVE identity for permission UI: $expected', async ({ expected, ...identity }) => {
  // Even a legacy local administrator named root@pam cannot make a limited
  // PVE account or root-owned API Token appear to be the PVE root user.
  setSession({ username: 'root@pam', csrfToken: 'admin-only', ticketIssuedAt: Date.now() })
  const instance: PveInstance = { id: 'chosen', version: 'current', name: 'selected', url: 'https://pve', fingerprint: '', insecureTLS: false, hasCredential: true, ...identity }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ canManage: true, instances: [
    { ...instance, id: 'other', username: 'root', realm: 'pam', authMode: 'password' },
    instance,
  ] }))))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result, unmount } = renderHook(usePveIdentity, { wrapper })
  await waitFor(() => expect(result.current).toBe(expected))
  unmount(); client.clear()
})

it('does not use a different connection revision as the current PVE identity', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ canManage: true, instances: [
    { id: 'chosen', version: 'old', authMode: 'password', username: 'root', realm: 'pam', hasCredential: true },
  ] }))))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result, unmount } = renderHook(usePveIdentity, { wrapper })
  await waitFor(() => expect(client.isFetching()).toBe(0))
  expect(result.current).toBeUndefined()
  unmount(); client.clear()
})
