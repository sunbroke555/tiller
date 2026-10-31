import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StorageResource } from '@/api/types'

import ContentTab from './ContentTab'
import SummaryTab from './SummaryTab'

const resource: StorageResource = {
  id: 'storage/pve-lab/local',
  type: 'storage',
  node: 'pve-lab',
  storage: 'local',
  status: 'available',
  content: 'vztmpl,backup,iso,import',
  plugintype: 'dir',
  shared: 0,
  disk: 4_604_608_512,
  maxdisk: 16_729_894_912,
}

const responses: Record<string, unknown> = {
  '/api2/json/cluster/resources': [
    { id: 'qemu/100', type: 'qemu', vmid: 100, node: 'pve-lab', name: 'tiny-vm', status: 'stopped' },
  ],
  '/api2/json/nodes/pve-lab/storage/local/content?content=backup': [
    {
      content: 'backup',
      ctime: 1793479752,
      format: 'vma.zst',
      notes: '每周备份',
      size: 3523,
      subtype: 'qemu',
      vmid: 100,
      volid: 'local:backup/vzdump-qemu-100-2026_11_01-04_49_12.vma.zst',
    },
    {
      content: 'backup',
      ctime: 1793479754,
      format: 'vma.lzo',
      protected: 1,
      size: 7185,
      subtype: 'qemu',
      vmid: 100,
      volid: 'local:backup/vzdump-qemu-100-2026_11_01-04_49_14.vma.lzo',
    },
  ],
  '/api2/json/nodes/pve-lab/storage/local/content?content=iso': [],
  '/api2/json/nodes/pve-lab/storage/local/status': {
    active: 1,
    enabled: 1,
    shared: 0,
    type: 'dir',
    content: 'backup,import,iso,vztmpl',
    total: 16_729_894_912,
    used: 4_608_368_640,
    avail: 11_245_756_416,
  },
  '/api2/json/storage/local': { storage: 'local', type: 'dir', path: '/var/lib/vz', content: 'iso,vztmpl,backup,import' },
  '/api2/json/nodes/pve-lab/storage/local/content': [
    { content: 'iso', format: 'iso', size: 70_254_592, volid: 'local:iso/alpine.iso' },
  ],
  '/api2/json/nodes/pve-lab/storage/local/rrddata?timeframe=day&cf=AVERAGE': [
    { time: 1793478120, total: 16729894912, used: 4531660595 },
    { time: 1793478180, total: 16729894912, used: 4532270762 },
  ],
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({ matches: query.includes('min-width: 1024px'), media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList,
  )
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') return new Response(JSON.stringify({ data: null }), { status: 200 })
    const body = responses[url]
    if (body === undefined) return new Response(JSON.stringify({ message: `no mock for ${url}` }), { status: 500 })
    return new Response(JSON.stringify({ data: body }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ContentTab', () => {
  it('lists backups newest first with owner, notes and protection', async () => {
    renderWithProviders(<ContentTab node="pve-lab" storage="local" resource={resource} content="backup" />)
    const list = await screen.findByRole('list', { name: '备份' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    // Newest (04_49_14, protected) first; title is the owning guest.
    expect(rows[0]).toHaveTextContent('VM 100 · tiny-vm')
    expect(rows[0]).toHaveTextContent('受保护')
    expect(rows[1]).toHaveTextContent('每周备份')
    expect(screen.getByText('2 项')).toBeInTheDocument()
  })

  it('filters by search text', async () => {
    renderWithProviders(<ContentTab node="pve-lab" storage="local" resource={resource} content="backup" />)
    await screen.findByRole('list', { name: '备份' })
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索' }), { target: { value: 'lzo' } })
    expect(screen.getByText('1 / 2 项')).toBeInTheDocument()
  })

  it('deletes after typing the VMID, and refuses protected backups', async () => {
    renderWithProviders(<ContentTab node="pve-lab" storage="local" resource={resource} content="backup" />)
    const list = await screen.findByRole('list', { name: '备份' })
    // Protected backup: delete disabled in the details.
    fireEvent.click(within(list).getAllByRole('button', { name: /详情/ })[0]!)
    const details = await screen.findByRole('dialog')
    expect(within(details).getByRole('button', { name: '删除' })).toBeDisabled()
    expect(within(details).getByText(/受保护的备份不能删除/)).toBeInTheDocument()
    fireEvent.keyDown(details, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(within(list).getAllByRole('button', { name: /详情/ })[1]!)
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除' }))
    const confirm = await screen.findByRole('alertdialog')
    const button = within(confirm).getByRole('button', { name: '删除' })
    expect(button).toBeDisabled()
    fireEvent.change(within(confirm).getByRole('textbox'), { target: { value: '100' } })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api2/json/nodes/pve-lab/storage/local/content/local%3Abackup%2Fvzdump-qemu-100-2026_11_01-04_49_12.vma.zst?delay=5',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })

  it('offers upload and download on an empty ISO list', async () => {
    renderWithProviders(<ContentTab node="pve-lab" storage="local" resource={resource} content="iso" />)
    expect(await screen.findByText('还没有 ISO 镜像')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上传' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '从 URL 下载' })).toBeInTheDocument()
  })
})

describe('SummaryTab', () => {
  it('shows usage, type, path and content counts', async () => {
    renderWithProviders(<SummaryTab node="pve-lab" storage="local" resource={resource} />)
    expect(await screen.findByText('/var/lib/vz')).toBeInTheDocument()
    expect(screen.getByText('目录')).toBeInTheDocument()
    expect(screen.getByText('已激活')).toBeInTheDocument()
    expect(await screen.findByText('67.0 MiB')).toBeInTheDocument()
    expect(screen.getByText('28%')).toBeInTheDocument()
  })
})
