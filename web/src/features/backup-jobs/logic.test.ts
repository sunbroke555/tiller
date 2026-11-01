import { describe, expect, it } from 'vitest'

import type { BackupJob } from '@/api/backup-jobs'

import {
  defaultJobForm,
  describeSchedule,
  describeSelection,
  includeReasonLabel,
  jobFormFromJob,
  jobParams,
  nextRunLabel,
  parseVmidList,
  retentionFromJob,
  retentionString,
  runNowParams,
  runNowTargets,
  selectionMode,
  validateJobForm,
  validateJobId,
  type JobForm,
} from './logic'

const form = (patch: Partial<JobForm> = {}): JobForm => ({ ...defaultJobForm(), storage: 'local', vmids: [100], ...patch })

const JOB: BackupJob = {
  id: 'e2e-bj-x',
  type: 'vzdump',
  schedule: 'sun 01:00',
  enabled: 1,
  storage: 'local',
  node: 'pve-lab',
  comment: 'nightly',
  vmid: '100,200',
  mode: 'stop',
  compress: 'zstd',
  'prune-backups': { 'keep-last': '2', 'keep-daily': '3' },
  performance: { 'max-workers': '4' },
  fleecing: { enabled: 1, storage: 'local-lvm' },
  'notes-template': '{{guestname}}\\nline2',
  bwlimit: 1024,
  'repeat-missed': 1,
  'exclude-path': ['/tmp', '/var/log'],
  'next-run': 1794070800,
}

describe('schedule', () => {
  it('labels presets and leaves custom events alone', () => {
    expect(describeSchedule('sun 01:00')).toBe('每周日 01:00')
    expect(describeSchedule(' monthly ')).toBe('每月 1 日 00:00')
    expect(describeSchedule('tue 03:00')).toBeNull()
  })

  it('renders next-run like render_next_event', () => {
    const now = 1_800_000_000_000
    expect(nextRunLabel(undefined, now)).toBe('—')
    expect(nextRunLabel(1_700_000_000, now)).toBe('等待运行')
    expect(nextRunLabel(1_900_000_000, now)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

describe('selection', () => {
  it('detects the mode like prepareValues', () => {
    expect(selectionMode({ vmid: '100' })).toBe('include')
    expect(selectionMode({ all: 1 })).toBe('all')
    expect(selectionMode({ all: 1, exclude: '101' })).toBe('exclude')
    expect(selectionMode({ pool: 'lab-pool' })).toBe('pool')
  })

  it('describes the selection', () => {
    expect(describeSelection({ all: 1 })).toBe('全部客户机')
    expect(describeSelection({ all: 1, exclude: '102,101' })).toBe('全部，排除 101、102')
    expect(describeSelection({ vmid: '200,100' })).toBe('100、200')
    expect(describeSelection({ pool: 'p' })).toBe('资源池 p')
  })

  it('parses vmid lists', () => {
    expect(parseVmidList('200, 100,100 abc 300')).toEqual([100, 200, 300])
    expect(parseVmidList(undefined)).toEqual([])
  })

  it('maps each mode to API keys', () => {
    expect(jobParams(form({ selMode: 'include', vmids: [100, 200] }), { original: null, pbs: false })).toMatchObject({ vmid: '100,200' })
    const all = jobParams(form({ selMode: 'all', vmids: [] }), { original: null, pbs: false })
    expect(all.all).toBe(1)
    expect(all).not.toHaveProperty('vmid')
    expect(all).not.toHaveProperty('exclude')
    expect(jobParams(form({ selMode: 'exclude', vmids: [101] }), { original: null, pbs: false })).toMatchObject({ all: 1, exclude: '101' })
    const pool = jobParams(form({ selMode: 'pool', pool: 'lab-pool', vmids: [] }), { original: null, pbs: false })
    expect(pool).toMatchObject({ pool: 'lab-pool' })
    expect(pool).not.toHaveProperty('all')
  })

  it('deletes a stale exclude list when switching to all', () => {
    const p = jobParams(form({ selMode: 'all', vmids: [] }), { original: { ...JOB, vmid: undefined, all: 1, exclude: '101' }, pbs: false })
    expect(String(p.delete).split(',')).toContain('exclude')
  })
})

describe('retention', () => {
  it('reads API objects and strings', () => {
    expect(retentionFromJob({ 'keep-last': '2', 'keep-daily': '3' })).toEqual({ keepAll: false, keeps: { 'keep-last': 2, 'keep-daily': 3 } })
    expect(retentionFromJob('keep-all=1')).toEqual({ keepAll: true, keeps: {} })
    expect(retentionFromJob(undefined)).toEqual({ keepAll: false, keeps: {} })
  })

  it('prints keep-* sorted, keep-all alone, nothing when empty', () => {
    expect(retentionString({ keepAll: false, keeps: { 'keep-last': 3, 'keep-daily': 7, 'keep-weekly': undefined } })).toBe('keep-daily=7,keep-last=3')
    expect(retentionString({ keepAll: true, keeps: { 'keep-last': 3 } })).toBe('keep-all=1')
    expect(retentionString({ keepAll: false, keeps: {} })).toBe('')
  })

  it('sends prune-backups or deletes it on edit', () => {
    const p = jobParams(form({ retention: { keepAll: false, keeps: { 'keep-last': 5 } } }), { original: null, pbs: false })
    expect(p['prune-backups']).toBe('keep-last=5')
    const cleared = jobParams(form({ retention: { keepAll: false, keeps: {} } }), { original: JOB, pbs: false })
    expect(cleared).not.toHaveProperty('prune-backups')
    expect(String(cleared.delete).split(',')).toContain('prune-backups')
  })
})

describe('job form', () => {
  it('round-trips a job config', () => {
    const f = jobFormFromJob(JOB)
    expect(f).toMatchObject({
      id: 'e2e-bj-x',
      node: 'pve-lab',
      selMode: 'include',
      vmids: [100, 200],
      mode: 'stop',
      maxWorkers: 4,
      fleecing: true,
      fleecingStorage: 'local-lvm',
      notesTemplate: '{{guestname}}\nline2',
      bwlimit: 1024,
      repeatMissed: true,
      excludePaths: '/tmp\n/var/log',
      notificationMode: 'notification-system',
    })
    const p = jobParams(f, { original: JOB, pbs: false })
    expect(p).toMatchObject({
      node: 'pve-lab',
      storage: 'local',
      schedule: 'sun 01:00',
      enabled: 1,
      comment: 'nightly',
      vmid: '100,200',
      mode: 'stop',
      compress: 'zstd',
      'prune-backups': 'keep-daily=3,keep-last=2',
      performance: 'max-workers=4',
      fleecing: 'enabled=1,storage=local-lvm',
      'notes-template': '{{guestname}}\\nline2',
      bwlimit: 1024,
      'repeat-missed': 1,
      'exclude-path': ['/tmp', '/var/log'],
    })
    expect(p).not.toHaveProperty('id')
    expect(p).not.toHaveProperty('delete')
  })

  it('deletes cleared options on edit only', () => {
    const cleared = form({
      node: '',
      comment: '',
      notesTemplate: '',
      fleecing: false,
      repeatMissed: false,
      excludePaths: '',
      bwlimit: undefined,
    })
    const edit = jobParams(cleared, { original: JOB, pbs: false })
    expect(String(edit.delete).split(',').sort()).toEqual(
      ['bwlimit', 'comment', 'exclude-path', 'fleecing', 'node', 'notes-template', 'performance', 'prune-backups', 'repeat-missed'].sort(),
    )
    expect(jobParams(cleared, { original: null, pbs: false })).not.toHaveProperty('delete')
  })

  it('keeps the id on create and leaves compression to PBS', () => {
    const p = jobParams(form({ id: ' e2e-bj-a ', zstd: 2 }), { original: null, pbs: true })
    expect(p.id).toBe('e2e-bj-a')
    expect(p).not.toHaveProperty('compress')
    expect(p).not.toHaveProperty('zstd')
    expect(jobParams(form({ zstd: 2 }), { original: null, pbs: false }).zstd).toBe(2)
    expect(jobParams(form({ compress: 'lzo', zstd: 2 }), { original: null, pbs: false })).not.toHaveProperty('zstd')
  })

  it('sends legacy mail settings only for sendmail', () => {
    expect(jobParams(form(), { original: null, pbs: false })).toMatchObject({ 'notification-mode': 'notification-system' })
    expect(jobParams(form(), { original: null, pbs: false })).not.toHaveProperty('mailto')
    const legacy = jobParams(form({ notificationMode: 'legacy-sendmail', mailto: 'a@b.c', mailnotification: 'failure' }), { original: null, pbs: false })
    expect(legacy).toMatchObject({ 'notification-mode': 'legacy-sendmail', mailto: 'a@b.c', mailnotification: 'failure' })
  })

  it('maps "auto" notification mode like the official panel', () => {
    expect(jobFormFromJob({ id: 'a', mailto: 'x@y.z' }).notificationMode).toBe('legacy-sendmail')
    expect(jobFormFromJob({ id: 'a' }).notificationMode).toBe('notification-system')
    expect(jobFormFromJob({ id: 'a', compress: '1' }).compress).toBe('lzo')
    expect(jobFormFromJob({ id: 'a' }).compress).toBe('0')
  })

  it('validates required fields', () => {
    expect(validateJobForm(form(), { create: true })).toEqual({})
    expect(validateJobForm(form({ storage: '', schedule: ' ', vmids: [] }), { create: true })).toEqual({
      storage: '请选择存储',
      schedule: '请输入计划',
      vmid: '至少选择一台客户机',
    })
    expect(validateJobForm(form({ selMode: 'pool', pool: '' }), { create: false })).toHaveProperty('pool')
    expect(validateJobForm(form({ selMode: 'all', vmids: [] }), { create: false })).toEqual({})
    expect(validateJobForm(form({ fleecing: true }), { create: false })).toHaveProperty('fleecing')
    expect(validateJobId('')).toBeNull()
    expect(validateJobId('e2e-bj-1')).toBeNull()
    expect(validateJobId('1abc')).toBe('需以字母开头')
    expect(validateJobId('a b')).not.toBeNull()
  })
})

describe('run now', () => {
  it('strips scheduling keys and prints property strings', () => {
    const p = runNowParams(JOB)
    for (const k of ['id', 'schedule', 'enabled', 'type', 'node', 'comment', 'next-run', 'repeat-missed']) expect(p).not.toHaveProperty(k)
    expect(p).toMatchObject({
      vmid: '100,200',
      storage: 'local',
      all: 0,
      'prune-backups': 'keep-last=2,keep-daily=3',
      performance: 'max-workers=4',
      fleecing: 'enabled=1,storage=local-lvm',
      'exclude-path': ['/tmp', '/var/log'],
    })
    expect(runNowParams({ id: 'x', all: 1, exclude: '101' })).toMatchObject({ all: 1, exclude: '101' })
  })

  it('targets the job node or every online node', () => {
    const nodes = [
      { node: 'a', status: 'online' },
      { node: 'b', status: 'offline' },
    ]
    expect(runNowTargets({ node: 'a' }, nodes)).toEqual({ nodes: ['a'], errors: [] })
    expect(runNowTargets({ node: 'b' }, nodes).nodes).toEqual([])
    expect(runNowTargets({}, nodes)).toEqual({ nodes: ['a'], errors: ['b：节点离线'] })
    // Listed by name, whatever order /cluster/resources returns.
    const cluster = ['c3', 'c1', 'c2'].map((node) => ({ node, status: 'online' }))
    expect(runNowTargets({}, cluster).nodes).toEqual(['c1', 'c2', 'c3'])
  })
})

it('translates include reasons', () => {
  expect(includeReasonLabel('backup=no')).toBe('已禁用备份')
  expect(includeReasonLabel('something new')).toBe('something new')
})
