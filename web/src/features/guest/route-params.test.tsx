import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ConsolePage from '@/features/console/ConsolePage'
import { isGuestPathname, isVmidParam } from '@/lib/resources'

import { GuestPage } from './GuestPage'

vi.mock('@/features/console/ConsoleScreen', () => ({
  ConsoleScreen: ({ title }: { title: string }) => <div>console {title}</div>,
}))

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function renderAt(path: string, routes: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {routes}
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('route params', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async (input: string) =>
      String(input).endsWith('/cluster/resources')
        ? json({ data: [{ id: 'qemu/100', type: 'qemu', vmid: 100, node: 'pve-lab', name: 'tiny-vm', status: 'stopped' }] })
        : json({ data: null }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('accepts only plain VMIDs', () => {
    expect(isVmidParam('100')).toBe(true)
    for (const bad of ['abc', '', '0', '010', '1e3', '-5', '12.5', '1234567890', undefined]) expect(isVmidParam(bad)).toBe(false)
  })

  it('matches guest pages by whole segments', () => {
    const vm10 = { node: 'pve-lab', type: 'qemu' as const, vmid: 10 }
    expect(isGuestPathname('/guest/pve-lab/qemu/10', vm10)).toBe(true)
    expect(isGuestPathname('/guest/pve-lab/qemu/10/hardware', vm10)).toBe(true)
    expect(isGuestPathname('/guest/pve-lab/qemu/100', vm10)).toBe(false)
    expect(isGuestPathname('/guest/pve-lab/qemu/100/hardware', vm10)).toBe(false)
  })

  it('never opens a console for a VMID that is no number', async () => {
    renderAt('/console/pve-lab/qemu/abc', <Route path="/console/:node/:type/:vmid" element={<ConsolePage />} />)
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/)
    expect(screen.queryByText(/^console/)).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('NaN'))).toBe(false)
  })

  it('sends a misspelt guest type to the canonical URL', async () => {
    renderAt(
      '/guest/pve-lab/vm/100',
      <>
        <Route path="/guest/:node/:type/:vmid/:tab?" element={<GuestPage />} />
        {/* The canonical page itself is not under test here. */}
        <Route path="/guest/pve-lab/qemu/100" element={<Where />} />
      </>,
    )
    expect(await screen.findByTestId('where')).toHaveTextContent('/guest/pve-lab/qemu/100')
  })

  it('shows not found for a non-numeric guest VMID', async () => {
    renderAt('/guest/pve-lab/qemu/abc', <Route path="/guest/:node/:type/:vmid/:tab?" element={<GuestPage />} />)
    expect(await screen.findByText('找不到这台客户机')).toBeInTheDocument()
  })
})
