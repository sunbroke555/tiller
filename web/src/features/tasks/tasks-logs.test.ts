import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchNodeTasks,
  filterClusterLog,
  filtersFromSearch,
  filtersToSearch,
  logTone,
  matchesTaskFilters,
  mergeRunningTasks,
  nodeTaskParams,
  normalizeNodeTask,
  recentFailures,
  resolveTimeRange,
  sortClusterLog,
  splitUpids,
  type ClusterLogEntry,
} from '@/api/tasks-logs'
import { parseUpid } from '@/api/tasks'
import type { ClusterTask } from '@/api/types'
import { TASK_TYPES, TASK_TYPE_GROUPS, describeTask, taskTypeOptionLabel } from '@/lib/taskTypes'

import { formatTaskTime, guestNameMap, taskDuration, taskTitle } from './format'
import { activeChips } from './TaskFilters'

const UPID_RUN = 'UPID:pve-lab:000067EC:000A8DC0:6AE64E12:qmshutdown:3000:root@pam:'
const UPID_OK = 'UPID:pve-lab:000067AF:000A8C80:6AE64E0F:qmstart:3000:root@pam:'

function task(over: Partial<ClusterTask>): ClusterTask {
  return { upid: UPID_OK, node: 'pve-lab', type: 'qmstart', id: '100', user: 'root@pam', starttime: 1_000, ...over }
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

// 2026-11-01 12:00 local time
const NOW = new Date(2026, 10, 1, 12, 0, 0).getTime()

describe('time range', () => {
  it('resolves presets relative to now', () => {
    expect(resolveTimeRange({ range: '1d' }, NOW)).toEqual({ since: NOW / 1000 - 86400 })
    expect(resolveTimeRange({ range: '7d' }, NOW)).toEqual({ since: NOW / 1000 - 7 * 86400 })
  })

  it('resolves custom dates to local day bounds, until inclusive', () => {
    const { since, until } = resolveTimeRange({ from: '2026-10-30', to: '2026-10-31' })
    expect(since).toBe(new Date(2026, 9, 30).getTime() / 1000)
    expect(until).toBe(new Date(2026, 10, 1).getTime() / 1000 - 1)
    expect(resolveTimeRange({ from: 'garbage' })).toEqual({})
  })
})

describe('URL filters', () => {
  it('round-trips and keeps unrelated params', () => {
    const f = { status: 'error' as const, type: 'qmstart', user: 'root', vmid: 100, range: '7d' as const, node: 'n1' }
    const search = filtersToSearch(f, new URLSearchParams('tab=x&from=2020-01-01'))
    expect(search.get('tab')).toBe('x')
    expect(search.get('from')).toBeNull() // range wins over from/to
    expect(filtersFromSearch(search)).toEqual(f)
  })

  it('drops invalid values', () => {
    expect(filtersFromSearch(new URLSearchParams('status=bogus&vmid=abc&range=2y&from=2026-13-45&user=%20'))).toEqual({})
    expect(filtersFromSearch(new URLSearchParams('from=2026-10-01&to=2026-10-02'))).toEqual({ from: '2026-10-01', to: '2026-10-02' })
  })
})

describe('node task params', () => {
  it('lists running and archived tasks without a status filter', () => {
    expect(nodeTaskParams({}, 0, 50)).toMatchObject({ start: 0, limit: 50, source: 'all', statusfilter: undefined })
  })

  it('maps running to the active source and the rest to statusfilter', () => {
    expect(nodeTaskParams({ status: 'running' }, 0, 50)).toMatchObject({ source: 'active', statusfilter: undefined })
    expect(nodeTaskParams({ status: 'error' }, 50, 50)).toMatchObject({ start: 50, source: 'archive', statusfilter: 'error,unknown' })
    expect(nodeTaskParams({ status: 'warning' }, 0, 50)).toMatchObject({ source: 'archive', statusfilter: 'warning' })
  })

  it('passes type, user, vmid and time', () => {
    expect(nodeTaskParams({ type: 'vzdump', user: 'bob', vmid: 101, range: '3d' }, 0, 10, NOW)).toEqual({
      start: 0,
      limit: 10,
      source: 'all',
      statusfilter: undefined,
      typefilter: 'vzdump',
      userfilter: 'bob',
      vmid: 101,
      since: NOW / 1000 - 3 * 86400,
      until: undefined,
    })
  })
})

describe('fetchNodeTasks', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('sends the filters, reads total and normalizes RUNNING', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        data: [
          { ...task({ upid: UPID_RUN, type: 'qmshutdown', id: '3000' }), status: 'RUNNING' },
          task({ status: 'OK', endtime: 1_002 }),
        ],
        total: 42,
      }),
    )
    const res = await fetchNodeTasks('pve-lab', { status: undefined, vmid: 3000 }, 0, 50)
    const url = new URL(String(fetchMock.mock.calls[0]![0]), 'http://x')
    expect(url.pathname).toBe('/api2/json/nodes/pve-lab/tasks')
    expect(Object.fromEntries(url.searchParams)).toEqual({ start: '0', limit: '50', source: 'all', vmid: '3000' })
    expect(res.total).toBe(42)
    expect(res.tasks[0]).not.toHaveProperty('status')
    expect(res.tasks[1]?.status).toBe('OK')
  })

  it('leaves other tasks alone', () => {
    const t = task({ status: 'OK' })
    expect(normalizeNodeTask(t)).toBe(t)
  })
})

describe('client-side filters (/cluster/tasks)', () => {
  const running = task({ upid: UPID_RUN, type: 'qmshutdown', id: '3000', starttime: NOW / 1000 - 60 })
  const failed = task({ status: "bridge 'vmbr9' does not exist", endtime: 1_001, user: 'alice@pve', node: 'n2' })
  const ok = task({ status: 'OK', endtime: 1_001 })
  const all = [running, failed, ok]

  it('filters by status, node, type, user (substring, any case) and vmid', () => {
    expect(all.filter((t) => matchesTaskFilters(t, { status: 'running' }, NOW))).toEqual([running])
    expect(all.filter((t) => matchesTaskFilters(t, { status: 'error' }, NOW))).toEqual([failed])
    expect(all.filter((t) => matchesTaskFilters(t, { node: 'n2' }, NOW))).toEqual([failed])
    expect(all.filter((t) => matchesTaskFilters(t, { type: 'qmstart' }, NOW))).toEqual([failed, ok])
    expect(all.filter((t) => matchesTaskFilters(t, { user: 'ALICE' }, NOW))).toEqual([failed])
    expect(all.filter((t) => matchesTaskFilters(t, { vmid: 3000 }, NOW))).toEqual([running])
  })

  it('filters by time', () => {
    expect(all.filter((t) => matchesTaskFilters(t, { range: '1d' }, NOW))).toEqual([running])
  })
})

describe('running tasks', () => {
  const clusterRunning = task({ upid: UPID_RUN, type: 'qmshutdown', id: '3000', starttime: 0x6ae64e12 })
  const clusterDone = task({ status: 'OK', endtime: 5 })

  it('lists running cluster tasks', () => {
    expect(mergeRunningTasks([clusterRunning, clusterDone], [], parseUpid).map((t) => t.upid)).toEqual([UPID_RUN])
  })

  it('adds tracked tasks right away, with their live details', () => {
    const tracked = [{ upid: UPID_OK, node: 'pve-lab', title: '启动 web', state: 'running' as const, lastLine: 'x 10%', progress: 0.1 }]
    const merged = mergeRunningTasks([clusterRunning], tracked, parseUpid)
    expect(merged.map((t) => t.upid)).toEqual([UPID_RUN, UPID_OK])
    expect(merged[1]).toMatchObject({ title: '启动 web', type: 'qmstart', id: '3000', progress: 0.1, lastLine: 'x 10%' })
  })

  it('hides cluster entries the tracker already saw finish', () => {
    const tracked = [{ upid: UPID_RUN, node: 'pve-lab', title: '关机', state: 'ok' as const }]
    expect(mergeRunningTasks([clusterRunning], tracked, parseUpid)).toEqual([])
  })

  it('counts recent failures', () => {
    const failed = task({ status: 'boom', endtime: 2_000, starttime: 2_000 })
    const old = task({ status: 'boom', endtime: 10, starttime: 10 })
    expect(recentFailures([failed, old, clusterDone], 1_000)).toEqual([failed])
  })
})

describe('cluster log', () => {
  const entry = (over: Partial<ClusterLogEntry>): ClusterLogEntry => ({
    id: '1:n',
    uid: 1,
    node: 'n',
    pid: 1,
    pri: 6,
    tag: 'pvedaemon',
    time: 100,
    user: 'root@pam',
    msg: 'hello',
    ...over,
  })

  it('sorts newest first, uid breaking ties', () => {
    const a = entry({ id: 'a', uid: 1, time: 100 })
    const b = entry({ id: 'b', uid: 2, time: 100 })
    const c = entry({ id: 'c', uid: 3, time: 50 })
    expect(sortClusterLog([c, a, b]).map((e) => e.id)).toEqual(['b', 'a', 'c'])
  })

  it('filters by level, node and text', () => {
    const err = entry({ id: 'e', pri: 3, msg: 'auth failure' })
    const warn = entry({ id: 'w', pri: 4, node: 'n2' })
    const info = entry({ id: 'i', tag: 'vzdump' })
    const all = [err, warn, info]
    expect(filterClusterLog(all, { level: 'error' })).toEqual([err])
    expect(filterClusterLog(all, { level: 'warning' })).toEqual([err, warn])
    expect(filterClusterLog(all, { node: 'n2' })).toEqual([warn])
    expect(filterClusterLog(all, { query: 'AUTH' })).toEqual([err])
    expect(filterClusterLog(all, { query: 'vzdump' })).toEqual([info])
  })

  it('maps priorities to tones', () => {
    expect([0, 3, 4, 5, 6, 7].map(logTone)).toEqual(['error', 'error', 'warning', 'notice', 'info', 'info'])
  })

  it('finds UPIDs in messages', () => {
    expect(splitUpids(`starting task ${UPID_OK}`)).toEqual([{ text: 'starting task ' }, { upid: UPID_OK }])
    expect(splitUpids(`end task ${UPID_OK} OK`)).toEqual([{ text: 'end task ' }, { upid: UPID_OK }, { text: ' OK' }])
    expect(splitUpids("successful auth for user 'root@pam'")).toEqual([{ text: "successful auth for user 'root@pam'" }])
  })
})

describe('task type names', () => {
  it('groups every known type exactly once', () => {
    const grouped = TASK_TYPE_GROUPS.flatMap((g) => g.types)
    expect(new Set(grouped).size).toBe(grouped.length)
    expect([...grouped].sort()).toEqual(Object.keys(TASK_TYPES).sort())
  })

  it('labels options and descriptions', () => {
    expect(taskTypeOptionLabel('qmstart')).toBe('启动（VM）')
    expect(taskTypeOptionLabel('aptupdate')).toBe('更新软件包索引')
    expect(taskTypeOptionLabel('mystery')).toBe('mystery')
    expect(describeTask({ type: 'vzdump', id: '100' })).toBe('备份 VM/CT 100')
    expect(describeTask({ type: 'srvrestart', id: 'pveproxy' })).toBe('重启服务 pveproxy')
  })
})

describe('display helpers', () => {
  it('formats list times compactly', () => {
    expect(formatTaskTime(new Date(2026, 9, 31, 8, 5, 9).getTime() / 1000, NOW)).toBe('10-31 08:05:09')
    expect(formatTaskTime(new Date(2025, 0, 2, 3, 4).getTime() / 1000, NOW)).toBe('2025-01-02 03:04')
    expect(formatTaskTime(undefined, NOW)).toBe('—')
  })

  it('computes durations, live while running', () => {
    expect(taskDuration({ starttime: 100, endtime: 225 })).toBe('2 分 5 秒')
    expect(taskDuration({ starttime: NOW / 1000 - 30 }, NOW)).toBe('30 秒')
  })

  it('titles tasks with the guest name', () => {
    const names = guestNameMap([{ vmid: 100, name: 'web' }, { vmid: 101 }])
    expect(taskTitle({ type: 'qmstart', id: '100' }, names)).toBe('启动 VM 100（web）')
    expect(taskTitle({ type: 'qmstart', id: '101' }, names)).toBe('启动 VM 101')
    expect(taskTitle({ type: 'qmstart', id: '100' }, names, { omitSubject: true })).toBe('启动')
  })

  it('shows chips for active filters', () => {
    const chips = activeChips({ node: 'n1', type: 'qmstart', user: 'root', vmid: 100, from: '2026-10-01' }, { showNode: true })
    expect(chips.map((c) => c.label)).toEqual(['节点 n1', '类型：启动（VM）', '用户：root', 'VMID 100', '2026-10-01 之后'])
    expect(chips[1]!.remove({ type: 'qmstart', user: 'x' })).toEqual({ user: 'x' })
    expect(activeChips({ node: 'n1', range: '7d' }, { showNode: false }).map((c) => c.label)).toEqual(['最近 7 天'])
  })
})
