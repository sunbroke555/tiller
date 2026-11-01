import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mergeHistoryRows, useTaskHistory, type NodeTask } from '@/api/tasks-logs'

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function nodeTask(i: number, over: Partial<NodeTask> = {}): NodeTask {
  const hex = i.toString(16).toUpperCase().padStart(8, '0')
  return {
    upid: `UPID:pve-lab:${hex}:00000000:${hex}:qmstart:100:root@pam:`,
    node: 'pve-lab',
    type: 'qmstart',
    id: '100',
    user: 'root@pam',
    starttime: i,
    endtime: i + 1,
    status: 'OK',
    ...over,
  }
}

describe('node task history paging', () => {
  // Newest first, like PVE: starttime 1000, 999, …
  let list: NodeTask[]
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    list = Array.from({ length: 120 }, (_, i) => nodeTask(1000 - i))
    fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input, 'http://x')
      const start = Number(url.searchParams.get('start'))
      const limit = Number(url.searchParams.get('limit'))
      return json({ data: list.slice(start, start + limit), total: list.length })
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const starts = () => fetchMock.mock.calls.map(([u]) => Number(new URL(String(u), 'http://x').searchParams.get('start')))

  function render() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    return renderHook(() => useTaskHistory({ node: 'pve-lab' }, { pageSize: 50 }), { wrapper })
  }

  it('refreshes only the first page after older pages were loaded', async () => {
    const { result } = render()
    await waitFor(() => expect(result.current.tasks).toHaveLength(50))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.tasks).toHaveLength(100))
    expect(result.current.hasMore).toBe(true)

    act(() => result.current.refetch())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(starts()).toEqual([0, 50, 0])
  })

  it('keeps rows that new tasks push off the first page (no gap)', async () => {
    const { result } = render()
    await waitFor(() => expect(result.current.tasks).toHaveLength(50))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.tasks).toHaveLength(100))

    // Three new tasks arrive: rows 47–49 of the old first page move to 50–52.
    list = [nodeTask(1003), nodeTask(1002), nodeTask(1001), ...list]
    act(() => result.current.refetch())
    await waitFor(() => expect(result.current.tasks).toHaveLength(103))
    const times = result.current.tasks.map((t) => t.starttime)
    expect(times).toEqual(Array.from({ length: 103 }, (_, i) => 1003 - i))

    // The next page starts where the shown rows end: overlap, never a gap.
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.tasks).toHaveLength(123))
    expect(starts().at(-1)).toBe(103)
    expect(result.current.hasMore).toBe(false)
  })
})

describe('mergeHistoryRows', () => {
  it('drops running rows that left the first page (their state would be stale)', () => {
    const running = nodeTask(5, { status: undefined, endtime: undefined })
    const done = nodeTask(4)
    expect(mergeHistoryRows([nodeTask(6)], [running, done], [done, nodeTask(3)]).map((t) => t.starttime)).toEqual([6, 4, 3])
  })
})
