import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetTaskTracker } from '@/components/tasks/tracker'

import { useCreateFlow, waitForGuestListed } from './useCreateFlow'

const UPID = 'UPID:pve-lab:00000A0F:00003849:6AE6339E:qmcreate:3301:alice@pve:'

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('create flow: waiting for the new guest', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const resourceCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/cluster/resources')).length

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // The creator may not audit the new VMID: it never shows up in /cluster/resources.
    fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/status')) return json({ data: { status: 'stopped', exitstatus: 'OK' } })
      if (url.includes('/cluster/resources')) return json({ data: [] })
      return json({ data: [], total: 0 })
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    resetTaskTracker()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function renderFlow() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    )
    return renderHook(() => useCreateFlow('qemu'), { wrapper })
  }

  it('stops polling when aborted', async () => {
    const ac = new AbortController()
    const qc = new QueryClient()
    const wait = waitForGuestListed(qc, 3301, { signal: ac.signal })
    await vi.advanceTimersByTimeAsync(2500)
    const before = resourceCalls()
    ac.abort()
    await expect(wait).resolves.toBe(false)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(resourceCalls()).toBe(before)
  })

  it('offers a link instead of opening a guest page that would say "not found"', async () => {
    const { result } = renderFlow()
    act(() => void result.current.submit('pve-lab', 3301, () => Promise.resolve(UPID), '创建 VM 3301'))
    await act(() => vi.advanceTimersByTimeAsync(25_000))
    expect(result.current.state).toEqual({ phase: 'created', upid: UPID, node: 'pve-lab', type: 'qemu', vmid: 3301 })
    expect(result.current.busy).toBe(true)
  })

  it('stops waiting when the wizard is left', async () => {
    const { result, unmount } = renderFlow()
    act(() => void result.current.submit('pve-lab', 3301, () => Promise.resolve(UPID), '创建 VM 3301'))
    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(result.current.state.phase).toBe('opening')
    unmount()
    await vi.advanceTimersByTimeAsync(1_000)
    const after = resourceCalls()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(resourceCalls()).toBe(after)
  })
})
