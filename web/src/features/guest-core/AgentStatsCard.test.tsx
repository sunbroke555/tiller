import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { guestCoreKeys } from '@/api/guest-core'

import { AgentStatsCard } from './AgentStatsCard'

type Route = (path: string) => Response | undefined

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const unsupported = (cmd: string) => json({ data: null, message: `VM 100 qmp command 'guest-${cmd}' failed - The command guest-${cmd} has not been found` }, 500)

function setup(route: Route, apt: () => Response = () => json({ data: [{ Package: 'qemu-server', Version: '9.2.14' }] })) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (input: string) => {
    const path = new URL(input, 'http://x').pathname
    calls.push(path)
    if (path.endsWith('/nodes/pve1/apt/versions')) return apt()
    return route(path) ?? json({ data: null, message: 'not implemented' }, 501)
  })
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { calls, client, wrapper }
}

describe('AgentStatsCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows the blocks whose commands work and hides the others', async () => {
    const { wrapper } = setup((path) => {
      if (path.endsWith('/agent/get-load')) return json({ data: { result: { load1: 0.42, load5: 1, load15: 2.5 } } })
      if (path.endsWith('/agent/get-disks'))
        return json({
          data: {
            result: [
              { name: '/dev/sda', partition: false, address: { 'bus-type': 'scsi', serial: 'drive-scsi0' } },
              { name: '/dev/sda1', partition: true, dependencies: ['/dev/sda'] },
            ],
          },
        })
      if (path.endsWith('/agent/get-cpustats')) return unsupported('get-cpustats')
      if (path.endsWith('/agent/get-diskstats')) return unsupported('get-diskstats')
    })
    render(<AgentStatsCard node="pve1" vmid={100} active />, { wrapper })

    expect(await screen.findByText('0.42')).toBeInTheDocument()
    expect(screen.getByText('2.50')).toBeInTheDocument()
    expect(await screen.findByText('sda1')).toBeInTheDocument()
    expect(screen.getByText('分区')).toBeInTheDocument()
    expect(screen.getByText('SCSI · 序列号 drive-scsi0')).toBeInTheDocument()
    expect(screen.queryByText('CPU 时间分布')).not.toBeInTheDocument()
    expect(screen.queryByText('磁盘 IO')).not.toBeInTheDocument()
  })

  it('computes CPU shares and disk rates from the second sample', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 10))
    let round = 0
    const { client, wrapper } = setup((path) => {
      if (path.endsWith('/agent/get-cpustats')) {
        const n = round
        return json({ data: { result: [{ type: 'linux', cpu: 0, user: 100 + 50 * n, system: 0, idle: 1000 + 50 * n }] } })
      }
      if (path.endsWith('/agent/get-diskstats')) {
        const n = round
        return json({ data: { result: [{ name: 'vda', stats: { 'read-sectors': 2048 * n, 'write-sectors': 0, 'read-ios': 4 * n, 'write-ios': 0 } }] } })
      }
    })
    render(<AgentStatsCard node="pve1" vmid={100} active />, { wrapper })

    await waitFor(() => expect(screen.getAllByText('正在采样，稍后显示…')).toHaveLength(2))
    expect(screen.getByText('CPU 时间分布')).toBeInTheDocument()

    round = 1
    await act(async () => {
      await client.refetchQueries({ queryKey: guestCoreKeys.agentCpuStats('pve1', 100) })
      await client.refetchQueries({ queryKey: guestCoreKeys.agentDiskStats('pve1', 100) })
    })
    await waitFor(() => expect(screen.getByText('使用率 50%')).toBeInTheDocument())
    expect(screen.getByText('vda')).toBeInTheDocument()
    expect(screen.queryByText('正在采样，稍后显示…')).not.toBeInTheDocument()
  })

  it('renders nothing and asks nothing on PVE without the endpoints', async () => {
    const { calls, wrapper } = setup(
      () => undefined,
      () => json({ data: [{ Package: 'qemu-server', Version: '9.2.13' }] }),
    )
    const { container } = render(<AgentStatsCard node="pve1" vmid={100} active />, { wrapper })
    await waitFor(() => expect(calls.some((c) => c.endsWith('/apt/versions'))).toBe(true))
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
    expect(calls.filter((c) => c.includes('/agent/'))).toEqual([])
  })

  it('tolerates 501 when the version is unknown', async () => {
    // No Sys.Audit: the version stays unknown, so the calls are tried and answer 501.
    const { calls, wrapper } = setup(
      () => undefined,
      () => json({ data: null, message: 'Permission check failed' }, 403),
    )
    const { container } = render(<AgentStatsCard node="pve1" vmid={100} active />, { wrapper })
    await waitFor(() => expect(calls.filter((c) => c.includes('/agent/')).length).toBe(4))
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
  })

  it('does not query while the VM or its agent is not running', async () => {
    const { calls, wrapper } = setup(() => undefined)
    const { container } = render(<AgentStatsCard node="pve1" vmid={100} active={false} />, { wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
    expect(calls.filter((c) => c.includes('/agent/'))).toEqual([])
  })
})
