import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { GuestResource } from '@/api/types'
import { sameTreeGuest } from '@/components/layout/resourceTree'

import { GuestList, sameGuestRow } from './GuestList'

const web: GuestResource = {
  id: 'qemu/101',
  type: 'qemu',
  vmid: 101,
  node: 'pve-lab',
  name: 'web',
  status: 'running',
  cpu: 0.2312,
  mem: 512 * 1024 * 1024,
  netin: 1000,
  tags: 'web',
}

const row = (guest: GuestResource) => ({ guest, showNode: false, showPool: false })

describe('guest rows on a resource poll', () => {
  it('refreshes threshold colours even when rounded text is unchanged', () => {
    expect(sameGuestRow(row({ ...web, cpu: 0.7499 }), row({ ...web, cpu: 0.75 }))).toBe(false)
    expect(sameGuestRow(row({ ...web, cpu: 0.8999 }), row({ ...web, cpu: 0.9 }))).toBe(false)
    expect(sameGuestRow(row({ ...web, maxmem: web.mem! * 2 }), row({ ...web, maxmem: web.mem! }))).toBe(false)
    // Capacity changes must refresh the memory meter even within one colour band.
    expect(sameGuestRow(row({ ...web, maxmem: web.mem! * 4 }), row({ ...web, maxmem: web.mem! * 8 }))).toBe(false)
  })
  it('skip re-rendering when nothing they show changed', () => {
    // A poll hands out a new object: netin and the unshown digits of cpu moved.
    const polled = { ...web, cpu: 0.2309, netin: 5000, mem: web.mem! + 1000 }
    expect(sameGuestRow(row(web), row(polled))).toBe(true)
    expect(sameTreeGuest(web, { ...polled, cpu: 0.9, mem: 1 })).toBe(true)
  })

  it('re-render when a shown value changed', () => {
    expect(sameGuestRow(row(web), row({ ...web, cpu: 0.25 }))).toBe(false)
    expect(sameGuestRow(row(web), row({ ...web, status: 'stopped' }))).toBe(false)
    expect(sameGuestRow(row(web), row({ ...web, lock: 'backup' }))).toBe(false)
    expect(sameGuestRow(row(web), { ...row(web), selected: true })).toBe(false)
    expect(sameTreeGuest(web, { ...web, tags: 'web;prod' })).toBe(false)
    expect(sameTreeGuest(web, { ...web, name: 'web-2' })).toBe(false)
  })

  it('still shows fresh values', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: {} }))))
    const client = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    )
    const { rerender } = render(<GuestList guests={[web]} showNode={false} />, { wrapper })
    expect(screen.getByLabelText('CPU 使用率')).toHaveTextContent('23%')
    rerender(<GuestList guests={[{ ...web, cpu: 0.5 }]} showNode={false} />)
    expect(screen.getByLabelText('CPU 使用率')).toHaveTextContent('50%')
    vi.unstubAllGlobals()
  })
})
