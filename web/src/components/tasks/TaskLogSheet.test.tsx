import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/lib/queryClient'

import { TaskLogSheet } from './TaskLogSheet'

const UPID = 'UPID:pve-lab:00000A0F:00003849:6AE6339E:qmstart:100:alice@pve:'

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('TaskLogSheet', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) =>
      url.includes('/status')
        ? new Response(JSON.stringify({ data: null, message: 'Permission check failed (/nodes/pve-lab, Sys.Audit)' }), {
            status: 403,
          })
        : new Response(JSON.stringify({ data: [], total: 0 })),
    )
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows why the status failed instead of a running task with a stop button, and stops polling', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true })
    render(<TaskLogSheet node="pve-lab" upid={UPID} open onOpenChange={() => undefined} />, {
      wrapper: wrapper(createQueryClient()),
    })
    expect(await screen.findByText('无法读取任务状态')).toBeInTheDocument()
    expect(screen.getByText(/Permission check failed/)).toBeInTheDocument()
    expect(screen.queryByText('运行中')).not.toBeInTheDocument()
    expect(screen.queryByText('正在读取日志…')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /停止/ })).not.toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(10_000)
    const statusCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/status'))
    expect(statusCalls).toHaveLength(1)
    // The log is never requested without a readable status.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/log'))).toBe(false)
  })
})
