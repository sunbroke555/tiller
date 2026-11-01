import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'

import { ActionBar, useActionRunner } from './ActionBar'
import type { ActionDef } from './registry'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }))

const actions: ActionDef<null>[] = [
  { id: 'start', label: '启动', order: 1, placement: 'primary', disabled: () => '已锁定（backup）' },
  { id: 'console', label: '控制台', order: 2, placement: 'primary' },
]

describe('ActionBar dock', () => {
  it('explains a disabled action on tap instead of ignoring it', () => {
    const trigger = vi.fn()
    render(<ActionBar actions={actions} ctx={null} trigger={trigger} variant="dock" />)
    const start = screen.getByRole('button', { name: '启动' })
    expect(start).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(start)
    expect(trigger).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalledWith('暂时不能启动', { description: '已锁定（backup）' })
    fireEvent.click(screen.getByRole('button', { name: '控制台' }))
    expect(trigger).toHaveBeenCalledWith(actions[1])
  })
})

function Page({ actions, variant }: { actions: ActionDef<null>[]; variant: 'toolbar' | 'dock' }) {
  const { trigger, host, busy } = useActionRunner(null)
  return (
    <>
      <ActionBar actions={actions} ctx={null} trigger={trigger} busy={busy} variant={variant} />
      {host}
    </>
  )
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('action runner in-flight guard', () => {
  it.each(['toolbar', 'dock'] as const)('runs a direct action once until its task ends (%s)', async (variant) => {
    const done = deferred<{ state: 'ok' }>()
    const run = vi.fn(async () => ({ upid: 'UPID:x', done: done.promise }))
    render(<Page variant={variant} actions={[{ id: 'start', label: '启动', order: 1, placement: 'primary', run }]} />)
    const button = screen.getByRole('button', { name: '启动' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'))
    fireEvent.click(button)
    expect(run).toHaveBeenCalledTimes(1)

    await act(async () => done.resolve({ state: 'ok' }))
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'))
    fireEvent.click(button)
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2))
  })

  it('releases the action and reports the error when the call fails', async () => {
    const run = vi.fn(() => Promise.reject(new Error('VM 100 already running')))
    render(<Page variant="toolbar" actions={[{ id: 'start', label: '启动', order: 1, placement: 'primary', run }]} />)
    const button = screen.getByRole('button', { name: '启动' })
    fireEvent.click(button)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('启动失败', { description: 'VM 100 already running' }))
    await waitFor(() => expect(button).toBeEnabled())
  })
})
