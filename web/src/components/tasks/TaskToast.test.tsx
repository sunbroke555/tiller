import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetTaskTracker, trackTask, type TrackedTask } from './tracker'
import { TaskToast, taskAnnouncements } from './TaskToast'

const UPID = 'UPID:pve-lab:00000A0F:00003849:6AE6339E:qmstart:100:root@pam:'

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function task(upid: string, state: TrackedTask['state'], title = upid): TrackedTask {
  return { upid, node: 'pve-lab', title, startedAt: 0, state, dismissed: false }
}

describe('taskAnnouncements', () => {
  it('speaks only when a task starts or ends, oldest first', () => {
    const prev = new Map<string, TrackedTask['state']>([
      ['a', 'running'],
      ['b', 'running'],
    ])
    // Newest first, as the tracker keeps them.
    const tasks = [task('c', 'running', '克隆 c'), task('b', 'running', '备份 b'), task('a', 'error', '启动 a')]
    expect(taskAnnouncements(prev, tasks)).toEqual(['启动 a：失败', '克隆 c：开始'])
    expect(taskAnnouncements(new Map<string, TrackedTask['state']>([['a', 'error']]), [task('a', 'error')])).toEqual([])
  })
})

describe('TaskToast', () => {
  let status: Record<string, unknown>
  beforeEach(() => {
    status = { status: 'running', upid: UPID, node: 'pve-lab', type: 'qmstart', id: '100' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/status')) return json({ data: status })
        return json({ data: [{ n: 1, t: 'progress 40%' }], total: 1 })
      }),
    )
  })
  afterEach(() => {
    resetTaskTracker()
    vi.unstubAllGlobals()
  })

  it('announces start and end, not the ticking stack', async () => {
    render(<TaskToast />)
    void trackTask(UPID, { title: '启动 web' })
    const region = screen.getByRole('status')
    await waitFor(() => expect(region).toHaveTextContent('启动 web：开始'))
    const stack = screen.getByRole('region', { name: '任务进度' })
    expect(stack).not.toHaveAttribute('aria-live')
    expect(stack).not.toContainElement(region)

    status = { ...status, status: 'stopped', exitstatus: 'command failed' }
    await waitFor(() => expect(region).toHaveTextContent('启动 web：失败'), { timeout: 4000 })
  })
})
