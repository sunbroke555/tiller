import { act, fireEvent, render, screen } from '@testing-library/react'
import { use } from 'react'
import { describe, expect, it } from 'vitest'

import { ConfigChangedContext } from '@/components/form/FormDialog'
import type { GuestResource } from '@/api/types'

import { QemuConfigProvider, useDialogHost, useQemuConfig, type QemuConfigContextValue } from './context'
import type { PendingState } from './model'

function value(digest: string, memory: string): QemuConfigContextValue {
  const cfg = { memory }
  const state = { current: { ...cfg, digest }, next: cfg, pending: {}, deleting: new Set(), digest } as unknown as PendingState
  return {
    node: 'pve',
    vmid: 101,
    guest: { vmid: 101, type: 'qemu', node: 'pve', status: 'stopped' } as unknown as GuestResource,
    cfg,
    digest,
    state,
    arch: 'x86_64',
    running: false,
    isRoot: true,
    can: () => true,
  }
}

function Probe() {
  const { cfg, digest } = useQemuConfig()
  const changed = use(ConfigChangedContext)
  return (
    <p data-testid="probe">
      {String(cfg.memory)} {digest} {changed ? 'changed' : 'same'}
    </p>
  )
}

function Opener() {
  const { show, host } = useDialogHost()
  return (
    <>
      <button type="button" onClick={() => show(() => <Probe />)}>
        open
      </button>
      {host}
    </>
  )
}

describe('useDialogHost', () => {
  it('gives the dialog the config and digest from when it opened', () => {
    const { rerender } = render(
      <QemuConfigProvider value={value('d1', '1024')}>
        <Opener />
      </QemuConfigProvider>,
    )
    act(() => fireEvent.click(screen.getByRole('button', { name: 'open' })))
    expect(screen.getByTestId('probe').textContent).toBe('1024 d1 same')
    // Another user saved memory=2048; the 5 s poll refreshes the context.
    rerender(
      <QemuConfigProvider value={value('d2', '2048')}>
        <Opener />
      </QemuConfigProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('1024 d1 changed')
  })
})
