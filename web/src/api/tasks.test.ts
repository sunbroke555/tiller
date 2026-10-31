import { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearFinishedTasks,
  dismissTask,
  openTaskLog,
  resetTaskTracker,
  runTask,
  setTaskQueryClient,
  useTaskLogTarget,
  useTrackedTasks,
} from '@/components/tasks/tracker'
import { describeTask, describeUpid } from '@/lib/taskTypes'

import { exitStatusState, fetchTaskLog, isUpid, parseTaskProgress, parseUpid, taskState, useTaskLog } from './tasks'

const UPID = 'UPID:pve-lab:00000A0F:00003849:6AE6339E:qmstart:100:root@pam:'

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('UPID', () => {
  it('parses all fields', () => {
    expect(parseUpid(UPID)).toEqual({
      upid: UPID,
      node: 'pve-lab',
      pid: 0xa0f,
      pstart: 0x3849,
      starttime: 0x6ae6339e,
      type: 'qmstart',
      id: '100',
      user: 'root@pam',
    })
  })

  it('handles empty ids, API tokens and ids with colons', () => {
    expect(parseUpid('UPID:n1:0000ABCD:000012345:6AE6339E:aptupdate::root@pam!ci:')).toMatchObject({
      id: '',
      user: 'root@pam!ci',
      pstart: 0x12345,
    })
    expect(parseUpid('UPID:n1:0000ABCD:00001234:6AE6339E:download:local:iso:root@pam:')?.id).toBe('local:iso')
  })

  it('rejects other strings', () => {
    expect(parseUpid('UPID:broken')).toBeNull()
    expect(isUpid(null)).toBe(false)
    expect(isUpid('OK')).toBe(false)
    expect(isUpid(UPID)).toBe(true)
  })

  it('describes tasks in Chinese', () => {
    expect(describeUpid(UPID)).toBe('启动 VM 100')
    expect(describeTask({ type: 'vzdump', id: '' })).toBe('备份')
    expect(describeTask({ type: 'mystery', id: '7' })).toBe('mystery 7')
  })
})

describe('task state', () => {
  it('classifies exit statuses', () => {
    expect(exitStatusState('OK')).toBe('ok')
    expect(exitStatusState('WARNINGS: 2')).toBe('warning')
    expect(exitStatusState('command failed: exit code 1')).toBe('error')
    expect(exitStatusState(undefined)).toBe('error')
  })

  it('reads both status shapes', () => {
    expect(taskState({ status: 'running' })).toBe('running')
    expect(taskState({ status: 'stopped', exitstatus: 'OK' })).toBe('ok')
    expect(taskState({ status: 'stopped', exitstatus: 'unexpected status' })).toBe('error')
    // /cluster/tasks: status is the exit status, missing while running
    expect(taskState({})).toBe('running')
    expect(taskState({ status: 'OK', endtime: 1 })).toBe('ok')
    expect(taskState({ status: 'WARNINGS: 1' })).toBe('warning')
  })

  it('extracts progress percentages', () => {
    expect(parseTaskProgress('INFO:  45% (1.2 GiB of 2.6 GiB) in 10s')).toBeCloseTo(0.45)
    expect(parseTaskProgress('transferred 1.0 GiB of 4.0 GiB (25.00%)')).toBeCloseTo(0.25)
    expect(parseTaskProgress('no numbers here')).toBeNull()
    expect(parseTaskProgress('150%')).toBeNull()
  })
})

describe('task log', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('treats the "no content" placeholder of an empty log as empty', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [{ n: 1, t: 'no content' }], total: 1 }))
    expect(await fetchTaskLog('n', UPID, 0)).toEqual({ lines: [], total: 0 })
    fetchMock.mockResolvedValueOnce(json({ data: [{ n: 1, t: 'unable to open file - No such file or directory' }], total: 1 }))
    expect(await fetchTaskLog('n', UPID, 0)).toEqual({ lines: [], total: 0 })
    fetchMock.mockResolvedValueOnce(json({ data: [{ n: 1, t: 'starting' }], total: 1 }))
    expect((await fetchTaskLog('n', UPID, 0)).lines).toHaveLength(1)
  })

  it('drops lines at or before the offset', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [{ n: 3, t: 'no content' }], total: 3 }))
    expect(await fetchTaskLog('n', UPID, 3)).toEqual({ lines: [], total: 3 })
    const url = String(fetchMock.mock.calls[0]![0])
    expect(url).toContain(`/api2/json/nodes/n/tasks/${encodeURIComponent(UPID)}/log?start=3&limit=1000`)
  })

  it('reads incrementally while following, then once more when stopped', async () => {
    let lines = [
      { n: 1, t: 'starting' },
      { n: 2, t: 'step 1' },
    ]
    fetchMock.mockImplementation(async (url: string) => {
      const start = Number(new URL(url, 'http://x').searchParams.get('start'))
      return json({ data: lines.filter((l) => l.n > start), total: lines.length })
    })
    const { result, rerender } = renderHook(({ follow }) => useTaskLog('n', UPID, { follow, intervalMs: 20 }), {
      initialProps: { follow: true },
    })
    await waitFor(() => expect(result.current.lines.map((l) => l.t)).toEqual(['starting', 'step 1']))
    lines = [...lines, { n: 3, t: 'TASK OK' }]
    await waitFor(() => expect(result.current.lines).toHaveLength(3))
    rerender({ follow: false })
    await waitFor(() => expect(result.current.isComplete).toBe(true))
    // Every request after the first asked only for new lines.
    const starts = fetchMock.mock.calls.map(([u]) => Number(new URL(String(u), 'http://x').searchParams.get('start')))
    expect(starts[0]).toBe(0)
    expect(Math.max(...starts)).toBe(3)
  })
})

describe('task tracker', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let qc: QueryClient
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    qc = new QueryClient()
    setTaskQueryClient(qc)
  })
  afterEach(() => {
    resetTaskTracker()
    setTaskQueryClient(null)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('tracks a task until it stops and refreshes queries', async () => {
    let status: Record<string, unknown> = { status: 'running', upid: UPID, node: 'pve-lab', type: 'qmstart', id: '100' }
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/status')) return json({ data: status })
      if (url.includes('/log')) return json({ data: [{ n: 1, t: 'progress 40%' }], total: 1 })
      return json({ data: UPID }) // the start call
    })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useTrackedTasks())

    const handle = await runTask(fetch('/api2/json/start').then((r) => r.json()).then((b: { data: string }) => b.data), {
      title: '启动 web',
    })
    expect(handle.upid).toBe(UPID)
    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({ title: '启动 web', state: 'running', node: 'pve-lab' })

    await waitFor(() => expect(result.current[0]?.progress).toBeCloseTo(0.4), { timeout: 4000 })
    status = { ...status, status: 'stopped', exitstatus: 'OK' }
    const outcome = await handle.done
    expect(outcome).toEqual({ upid: UPID, state: 'ok', exitstatus: 'OK' })
    expect(result.current[0]?.state).toBe('ok')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pve'] })
  }, 10_000)

  it('keeps failed tasks visible with the exit status and calls onError', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/status')) return json({ data: { status: 'stopped', exitstatus: "can't lock file" } })
      return json({ data: [], total: 0 })
    })
    const onError = vi.fn()
    const { result } = renderHook(() => useTrackedTasks())
    const handle = await runTask(Promise.resolve(UPID), { title: '迁移', onError })
    const outcome = await handle.done
    expect(outcome.state).toBe('error')
    expect(onError).toHaveBeenCalledWith(outcome)
    expect(result.current[0]).toMatchObject({ state: 'error', exitstatus: "can't lock file", dismissed: false })
    act(() => clearFinishedTasks())
    expect(result.current).toHaveLength(0)
  })

  it('rejects when the call fails and resolves synchronous results', async () => {
    await expect(runTask(Promise.reject(new Error('403')), { title: 'x' })).rejects.toThrow('403')
    const onSuccess = vi.fn()
    const handle = await runTask(Promise.resolve(null), { title: '保存', syncSuccessMessage: false, onSuccess })
    expect(handle.upid).toBeNull()
    expect(await handle.done).toEqual({ upid: null, state: 'ok' })
    expect(onSuccess).toHaveBeenCalled()
  })

  it('hides a running task but keeps tracking; opens the log sheet', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/status') ? json({ data: { status: 'running' } }) : json({ data: [], total: 0 }),
    )
    const tasks = renderHook(() => useTrackedTasks())
    const log = renderHook(() => useTaskLogTarget())
    await runTask(Promise.resolve(UPID), { title: 't' })
    act(() => dismissTask(UPID))
    expect(tasks.result.current[0]?.dismissed).toBe(true)
    act(() => openTaskLog({ node: 'pve-lab', upid: UPID }))
    expect(log.result.current).toEqual({ node: 'pve-lab', upid: UPID })
  })
})
