import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GuestResource } from '@/api/types'
import { QemuConfigProvider } from './context'
import { splitPending } from './model'
import { PendingChangesBanner } from './PendingChangesBanner'

const mocks = vi.hoisted(() => ({ get: vi.fn(), retry: vi.fn(), pending: vi.fn(), task: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }))
vi.mock('@/api/client', async (original) => ({ ...await original<object>(), get: mocks.get }))
vi.mock('@/api/qemu-config', async (original) => ({ ...await original<object>(), retryQemuPending: mocks.retry, fetchQemuPending: mocks.pending }))
vi.mock('@/api/guest-core', () => ({ useGuestStatus: () => ({ data: { status: 'running', 'running-machine': 'pc-q35-10.1' } }) }))
vi.mock('@/components/tasks/tracker', () => ({ runTask: mocks.task }))
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }))

function setup({ can = true, running = true, memory = false } = {}) {
  const state = splitPending([{ key: 'digest', value: 'original' }, { key: memory ? 'memory' : 'cpulimit', value: 1, pending: 2 }])
  render(<QueryClientProvider client={new QueryClient()}><QemuConfigProvider value={{
    state, cfg: state.next, digest: state.digest, node: 'lab', vmid: 3400,
    guest: { vmid: 3400, type: 'qemu', node: 'lab', status: running ? 'running' : 'stopped' } as GuestResource,
    arch: 'x86_64', running, isRoot: can, can: () => can,
  }}><PendingChangesBanner rows={[{ key: memory ? 'memory' : 'cpulimit', title: memory ? '内存' : '处理器' }]} onRevertAll={() => {}} /></QemuConfigProvider></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.get.mockResolvedValue({ status: 'running', qmpstatus: 'running' })
  mocks.retry.mockResolvedValue('UPID:test')
  mocks.task.mockResolvedValue({ done: Promise.resolve({ state: 'ok' }) })
  mocks.pending.mockResolvedValue([{ key: 'cpulimit', value: 2 }])
})

describe('pending online apply', () => {
  it('waits for task completion, prevents repeated submission, then verifies actual config', async () => {
    let finish!: (value: { state: string }) => void
    mocks.task.mockResolvedValue({ done: new Promise((resolve) => { finish = resolve }) })
    setup()
    fireEvent.click(screen.getByRole('button', { name: '尝试在线应用' }))
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith('lab', 3400, { digest: 'original', cpulimit: '2' }))
    expect(screen.getByRole('button', { name: '正在应用…' })).toBeDisabled()
    expect(mocks.pending).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    finish({ state: 'ok' })
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('1 项参数已在线应用'))
  })
  it('an OK task with a pending value does not report application success', async () => {
    mocks.pending.mockResolvedValue([{ key: 'cpulimit', value: 1, pending: 2 }])
    setup()
    fireEvent.click(screen.getByRole('button', { name: '尝试在线应用' }))
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledWith('已确认 0/1 项参数生效', expect.anything()))
    expect(mocks.success).not.toHaveBeenCalled()
  })
  it('checks remaining pending values after a failed task', async () => {
    mocks.task.mockResolvedValue({ done: Promise.resolve({ state: 'error', exitstatus: 'hotplug failed' }) })
    setup()
    fireEvent.click(screen.getByRole('button', { name: '尝试在线应用' }))
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledWith('已确认 1/1 项参数生效', expect.objectContaining({ description: 'hotplug failed' })))
    expect(mocks.success).not.toHaveBeenCalled()
  })
  it('preserves digest conflict errors and does not resubmit with a fresh digest', async () => {
    mocks.task.mockRejectedValue(new Error('checksum mismatch'))
    mocks.pending.mockResolvedValue([{ key: 'cpulimit', value: 1 }])
    setup()
    fireEvent.click(screen.getByRole('button', { name: '尝试在线应用' }))
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledWith('已确认 0/1 项参数生效', expect.objectContaining({ description: 'checksum mismatch' })))
    expect(mocks.retry).toHaveBeenCalledTimes(1)
  })
  it('refuses submission if the VM stopped after render', async () => {
    mocks.get.mockResolvedValue({ status: 'stopped' })
    setup()
    fireEvent.click(screen.getByRole('button', { name: '尝试在线应用' }))
    await waitFor(() => expect(mocks.error).toHaveBeenCalled())
    expect(mocks.retry).not.toHaveBeenCalled()
  })
  it.each([{ can: false }, { running: false }, { memory: true }])('does not offer apply for %j', (options) => {
    setup(options)
    expect(screen.queryByRole('button', { name: '尝试在线应用' })).not.toBeInTheDocument()
  })
})
