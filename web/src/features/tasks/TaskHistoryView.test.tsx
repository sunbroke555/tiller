import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetTaskTracker, useTaskLogTarget } from '@/components/tasks/tracker'

import { TaskHistoryView } from './TaskHistoryView'

const UPID_RUN = 'UPID:pve-lab:000067EC:000A8DC0:6AE64E12:qmshutdown:3000:root@pam:'
const UPID_FAIL = 'UPID:pve-lab:00004911:000786B7:6AE64652:qmstart:3000:root@pam:'

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function wrapper(initial = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('TaskHistoryView', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    resetTaskTracker()
    fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input, 'http://x')
      if (url.pathname.endsWith('/cluster/resources')) {
        return json({ data: [{ id: 'qemu/3000', type: 'qemu', vmid: 3000, node: 'pve-lab', name: 'e2e-probe', status: 'running' }] })
      }
      if (url.pathname.endsWith('/cluster/tasks')) return json({ data: [] })
      if (url.pathname.endsWith('/nodes/pve-lab/tasks')) {
        const status = url.searchParams.get('statusfilter')
        const all = [
          { upid: UPID_RUN, node: 'pve-lab', type: 'qmshutdown', id: '3000', user: 'root@pam', starttime: 0x6ae64e12, status: 'RUNNING' },
          {
            upid: UPID_FAIL,
            node: 'pve-lab',
            type: 'qmstart',
            id: '3000',
            user: 'root@pam',
            starttime: 0x6ae64652,
            endtime: 0x6ae64653,
            status: "bridge 'vmbr9' does not exist",
          },
        ]
        const data = status === 'error,unknown' ? all.slice(1) : all
        return json({ data, total: data.length })
      }
      return json({ data: null })
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lists the node history, filters by status and opens a task log', async () => {
    const Wrapper = wrapper()
    const target = renderHook(() => useTaskLogTarget())
    render(<TaskHistoryView fixed={{ node: 'pve-lab' }} />, { wrapper: Wrapper })

    expect(await screen.findByText('关机 VM 3000（e2e-probe）')).toBeInTheDocument()
    expect(screen.getByText("bridge 'vmbr9' does not exist")).toBeInTheDocument()
    expect(screen.getByText('已显示 2 / 共 2 个任务')).toBeInTheDocument()
    const firstUrl = new URL(String(fetchMock.mock.calls.find(([u]) => String(u).includes('/nodes/pve-lab/tasks'))![0]), 'http://x')
    expect(firstUrl.searchParams.get('source')).toBe('all')

    fireEvent.click(screen.getByRole('radio', { name: '失败' }))
    await waitFor(() => expect(screen.queryByText('关机 VM 3000（e2e-probe）')).not.toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('statusfilter=error%2Cunknown'))).toBe(true)

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /启动 VM 3000/ }))
    })
    expect(target.result.current).toMatchObject({ node: 'pve-lab', upid: UPID_FAIL, endtime: 0x6ae64653 })
  })

  it('keeps the guest filter fixed and drops the subject from titles', async () => {
    render(<TaskHistoryView fixed={{ node: 'pve-lab', vmid: 3000 }} omitSubject />, { wrapper: wrapper('/?vmid=1') })
    expect(await screen.findByText('关机')).toBeInTheDocument()
    // The tab's own VMID is not an editable filter: no chip, no count.
    expect(screen.queryByText('VMID 3000')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '筛选' })).toBeInTheDocument()
    const url = new URL(String(fetchMock.mock.calls.find(([u]) => String(u).includes('/nodes/pve-lab/tasks'))![0]), 'http://x')
    expect(url.searchParams.get('vmid')).toBe('3000')
  })
})
