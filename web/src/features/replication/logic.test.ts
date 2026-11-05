import { describe, expect, it } from 'vitest'

import type { ReplicationJob, ReplicationStatus } from '@/api/replication'

import {
  createJobParams,
  deleteOptions,
  describeSchedule,
  emptyJobForm,
  formatLastSync,
  formatNextSync,
  formatRateLimit,
  formatSyncDuration,
  jobState,
  jobToForm,
  nextJobId,
  parseJobId,
  scheduleErrorText,
  takenTargets,
  updateJobParams,
  validateJobForm,
} from './logic'

const job = (over: Partial<ReplicationJob> = {}): ReplicationJob => ({
  id: '100-0',
  guest: 100,
  jobnum: 0,
  target: 'b',
  type: 'local',
  ...over,
})

const status = (over: Partial<ReplicationStatus> = {}): ReplicationStatus => ({ ...job(), ...over })

describe('describeSchedule', () => {
  it('names presets and simple forms', () => {
    expect(describeSchedule(undefined)).toBe('每 15 分钟')
    expect(describeSchedule('')).toBe('每 15 分钟')
    expect(describeSchedule('*/15')).toBe('每 15 分钟')
    expect(describeSchedule('*/10')).toBe('每 10 分钟')
    expect(describeSchedule('*/1')).toBe('每分钟')
    expect(describeSchedule('*/3:00')).toBe('每 3 小时')
    expect(describeSchedule('21:00')).toBe('每天 21:00')
    expect(describeSchedule('6:30')).toBe('每天 06:30')
    expect(describeSchedule('2,14:05')).toBe('每天 02:05、14:05')
    expect(describeSchedule('mon..fri 00:00')).toBe('周一至周五 00:00')
    expect(describeSchedule('sat,sun  */30')).toBe('周六、周日 每 30 分钟')
    expect(describeSchedule('mon..fri 7..18:00/15')).toBe('周一至周五 07:00–18:45 每 15 分钟')
    expect(describeSchedule('daily')).toBe('每天 00:00')
  })

  it('returns null for forms it cannot word', () => {
    expect(describeSchedule('*-*-1 03:00')).toBeNull()
    expect(describeSchedule('fri 7..18/2:00')).toBeNull()
    expect(describeSchedule('xyz 21:00')).toBeNull()
  })
})

describe('scheduleErrorText', () => {
  it('keeps the useful part of the server message', () => {
    expect(
      scheduleErrorText(`invalid format - invalid calendar event 'bogus' - unable to parse calendar event at 'bogus' - Context("weekday")`),
    ).toBe("无法识别的计划格式（unable to parse calendar event at 'bogus'）")
    expect(scheduleErrorText('invalid format')).toBe('无法识别的计划格式')
  })
})

describe('jobState', () => {
  it('orders syncing, removal, error, disabled, never, ok', () => {
    expect(jobState(job(), status({ pid: 42, error: 'x' })).kind).toBe('syncing')
    expect(jobState(job({ remove_job: 'full' }), status()).kind).toBe('removing')
    expect(jobState(job(), status({ error: 'boom', fail_count: 3 }))).toEqual({ kind: 'error', label: '失败（3 次）', tone: 'error' })
    expect(jobState(job(), status({ error: 'boom', fail_count: 1 })).label).toBe('失败')
    expect(jobState(job({ disable: 1 }), status({ disable: 1, last_sync: 5 })).kind).toBe('disabled')
    expect(jobState(job(), status({ last_sync: 0 })).kind).toBe('never')
    expect(jobState(job(), status({ last_sync: 1_700_000_000 })).kind).toBe('ok')
  })

  it('is unknown without a status', () => {
    expect(jobState(job()).kind).toBe('unknown')
    expect(jobState(job({ disable: 1 }), null).kind).toBe('disabled')
  })
})

describe('formatting', () => {
  const now = 1_800_000_000_000
  it('formats last and next sync like the official grid', () => {
    expect(formatLastSync(undefined)).toBe('—')
    expect(formatLastSync({ last_sync: 0 })).toBe('—')
    expect(formatLastSync({ last_sync: 1_800_000_000, pid: 7 })).toBe('同步中')
    expect(formatLastSync({ last_sync: 1_800_000_000 })).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)

    expect(formatNextSync({ next_sync: 0 }, now)).toBe('—')
    expect(formatNextSync({ next_sync: 1800 }, now)).toBe('即将开始')
    expect(formatNextSync({ next_sync: 1_800_000_900 }, now)).toMatch(/^\d{4}-/)
    expect(formatNextSync({ next_sync: 1_800_000_900, disable: 1 }, now)).toBe('—')
    expect(formatNextSync({ next_sync: 1_800_000_900, pid: 3 }, now)).toBe('同步中')
  })

  it('formats durations and rates', () => {
    expect(formatSyncDuration(1.787898)).toBe('1.8 秒')
    expect(formatSyncDuration(0.04)).toBe('0.0 秒')
    expect(formatSyncDuration(12.4)).toBe('12 秒')
    expect(formatSyncDuration(125)).toBe('2 分 5 秒')
    expect(formatSyncDuration(undefined)).toBe('—')
    expect(formatRateLimit(undefined)).toBe('不限速')
    expect(formatRateLimit(12.5)).toBe('12.5 MB/s')
  })
})

describe('job ids and targets', () => {
  const jobs = [job({ id: '100-0' }), job({ id: '100-3', jobnum: 3, target: 'c' }), job({ id: '101-0', guest: 101 })]
  it('parses ids and picks the next job number', () => {
    expect(parseJobId('100-3')).toEqual({ guest: 100, jobnum: 3 })
    expect(parseJobId('x')).toBeNull()
    expect(nextJobId(jobs, 100)).toBe('100-4')
    expect(nextJobId(jobs, 102)).toBe('102-0')
  })

  it('excludes the source and existing targets', () => {
    expect(takenTargets(jobs, 100, 'a').sort()).toEqual(['a', 'b', 'c'])
    expect(takenTargets(jobs, 100, 'a', '100-3').sort()).toEqual(['a', 'b'])
    expect(takenTargets([job({ remove_job: 'full' })], 100, 'a')).toEqual(['a'])
  })
})

describe('form → params', () => {
  it('validates required fields and the rate', () => {
    expect(validateJobForm(emptyJobForm(), true)).toEqual({ guest: '请选择客户机', target: '请选择目标节点' })
    expect(validateJobForm({ ...emptyJobForm(100), target: 'b', rate: 0.5 }, true).rate).toBeDefined()
    expect(validateJobForm({ ...emptyJobForm(), rate: 2 }, false)).toEqual({})
  })

  it('creates with defaults left out', () => {
    const form = { ...emptyJobForm(100), target: 'b', schedule: ' */15 ' }
    expect(createJobParams(form, [job()])).toEqual({
      id: '100-1',
      type: 'local',
      target: 'b',
      schedule: undefined,
      rate: undefined,
      comment: undefined,
      disable: undefined,
    })
    const custom = { ...form, schedule: 'mon..fri   */30', rate: 25, comment: ' nightly ', enabled: false }
    expect(createJobParams(custom, [])).toMatchObject({
      id: '100-0',
      schedule: 'mon..fri */30',
      rate: 25,
      comment: 'nightly',
      disable: 1,
    })
    expect(() => createJobParams(emptyJobForm(), [])).toThrow()
  })

  it('updates only changed keys, deleting reset ones', () => {
    const current = job({ schedule: '*/5', rate: 10, comment: 'x', digest: 'abc' })
    expect(updateJobParams(current, jobToForm(current))).toBeNull()
    expect(updateJobParams(current, { ...jobToForm(current), schedule: '*/15', rate: undefined, comment: '' })).toEqual({
      delete: 'schedule,rate,comment',
      digest: 'abc',
    })
    expect(updateJobParams(current, { ...jobToForm(current), rate: 20, enabled: false })).toEqual({ rate: 20, disable: 1, digest: 'abc' })
    expect(updateJobParams(job({ disable: 1 }), { ...jobToForm(job({ disable: 1 })), enabled: true })).toEqual({ delete: 'disable' })
  })

  it('sends skip-freeze-fs only when checked, deleting it when cleared', () => {
    const form = { ...emptyJobForm(100), target: 'b' }
    expect(createJobParams(form, [])).not.toHaveProperty('skip-freeze-fs', 1)
    expect(createJobParams({ ...form, skipFreezeFs: true }, [])).toMatchObject({ 'skip-freeze-fs': 1 })
    expect(jobToForm(job()).skipFreezeFs).toBe(false)
    const skipping = job({ 'skip-freeze-fs': 1, digest: 'abc' })
    expect(jobToForm(skipping).skipFreezeFs).toBe(true)
    expect(updateJobParams(skipping, jobToForm(skipping))).toBeNull()
    expect(updateJobParams(skipping, { ...jobToForm(skipping), skipFreezeFs: false })).toEqual({ delete: 'skip-freeze-fs', digest: 'abc' })
    expect(updateJobParams(job(), { ...jobToForm(job()), skipFreezeFs: true })).toEqual({ 'skip-freeze-fs': 1 })
    // An explicit 0 is the default: unchanged, nothing sent.
    expect(updateJobParams(job({ 'skip-freeze-fs': 0 }), jobToForm(job({ 'skip-freeze-fs': 0 })))).toBeNull()
  })

  it('maps delete modes', () => {
    expect(deleteOptions('full')).toEqual({})
    expect(deleteOptions('keep')).toEqual({ keep: true })
    expect(deleteOptions('force')).toEqual({ force: true })
  })
})
