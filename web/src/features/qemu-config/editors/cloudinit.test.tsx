import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GuestResource } from '@/api/types'

import { QemuConfigProvider, type QemuConfigContextValue } from '../context'
import type { PendingState } from '../model'
import { CiPasswordDialog } from './cloudinit'

function value(): QemuConfigContextValue {
  const cfg = { cipassword: '**********' }
  const state = { current: { ...cfg, digest: 'd1' }, next: cfg, pending: {}, deleting: new Set(), digest: 'd1' } as unknown as PendingState
  return {
    node: 'pve',
    vmid: 101,
    guest: { vmid: 101, type: 'qemu', node: 'pve', status: 'stopped' } as unknown as GuestResource,
    cfg,
    digest: 'd1',
    state,
    arch: 'x86_64',
    running: false,
    isRoot: true,
    can: () => true,
  }
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  // Desktop layout: a Radix Dialog (vaul needs a real browser).
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('min-width: 1024px'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  )
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: null }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('CiPasswordDialog', () => {
  it('asks before clearing the password', async () => {
    const onOpenChange = vi.fn()
    render(
      <QemuConfigProvider value={value()}>
        <CiPasswordDialog open onOpenChange={onOpenChange} />
      </QemuConfigProvider>,
    )
    // Footer on wide screens, a body row on phones (CSS picks one).
    const clear = screen.getAllByRole('button', { name: '清除密码' })
    expect(clear).toHaveLength(2)
    expect(clear.some((b) => b.closest('[data-slot="dialog-body"]'))).toBe(true)

    fireEvent.click(clear[0]!)
    const confirm = await screen.findByRole('alertdialog', { name: '清除 Cloud-Init 密码？' })
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(within(confirm).getByRole('button', { name: '清除' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/nodes/pve/qemu/101/config')
    expect(init.method).toBe('PUT')
    expect(String(init.body)).toContain('delete=cipassword')
  })
})
