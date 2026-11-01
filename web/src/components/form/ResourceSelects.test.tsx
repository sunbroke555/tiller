import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NodeSelect, StorageSelect } from './ResourceSelects'

// A 3-node cluster as the lab cluster: c2 answers the API (local), c3 is offline.
let responses: Record<string, unknown>

beforeEach(() => {
  responses = {
    '/api2/json/cluster/resources': [
      { id: 'node/c3', type: 'node', node: 'c3', status: 'offline' },
      { id: 'node/c2', type: 'node', node: 'c2', status: 'online' },
      { id: 'node/c1', type: 'node', node: 'c1', status: 'online' },
    ],
    '/api2/json/cluster/status': [
      { type: 'cluster', id: 'cluster', name: 'lab', quorate: 1, nodes: 3 },
      { type: 'node', id: 'node/c1', name: 'c1', nodeid: 1, online: 1, local: 0 },
      { type: 'node', id: 'node/c2', name: 'c2', nodeid: 2, online: 1, local: 1 },
      { type: 'node', id: 'node/c3', name: 'c3', nodeid: 3, online: 0, local: 0 },
    ],
    '/api2/json/nodes/c1/storage': [
      { storage: 'local-lvm', type: 'lvmthin', active: 1, avail: 10, total: 100 },
      { storage: 'e2e-rep', type: 'zfspool', active: 1, avail: 90, total: 100 },
      { storage: 'a-offline', type: 'nfs', active: 0 },
    ],
  }
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({ matches: query.includes('min-width: 1024px'), media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList,
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = responses[url.split('?')[0]!]
      if (body === undefined) return new Response(JSON.stringify({ message: `no mock for ${url}` }), { status: 500 })
      return new Response(JSON.stringify({ data: body }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('StorageSelect', () => {
  it('preselects the first active storage by name, like the official selector', async () => {
    const onValueChange = vi.fn()
    renderWithClient(<StorageSelect node="c1" content="images" value={undefined} onValueChange={onValueChange} />)
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith('e2e-rep'))
    expect(onValueChange).toHaveBeenCalledTimes(1)
  })
})

describe('NodeSelect', () => {
  it('does not guess a node on a cluster by default', async () => {
    const onValueChange = vi.fn()
    renderWithClient(<NodeSelect value={undefined} onValueChange={onValueChange} />)
    // Give the queries time to settle.
    await new Promise((r) => setTimeout(r, 50))
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('preferLocal picks the node the app talks to', async () => {
    const onValueChange = vi.fn()
    renderWithClient(<NodeSelect value={undefined} onValueChange={onValueChange} preferLocal />)
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith('c2'))
    expect(onValueChange).toHaveBeenCalledTimes(1)
  })

  it('preferLocal falls back to the first online node', async () => {
    const onValueChange = vi.fn()
    renderWithClient(<NodeSelect value={undefined} onValueChange={onValueChange} exclude={['c2']} preferLocal />)
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith('c1'))

    responses['/api2/json/cluster/status'] = undefined
    const second = vi.fn()
    renderWithClient(<NodeSelect value={undefined} onValueChange={second} preferLocal />)
    await waitFor(() => expect(second).toHaveBeenCalledWith('c1'))
  })
})
