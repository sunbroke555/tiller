// Pure helpers of the replication screens: schedule presets and wording, job
// state, display formatting and form → API parameters.

import type { ReplicationJob, ReplicationStatus } from '@/api/replication'
import type { Params } from '@/api/client'
import { DASH, formatDateTime, formatDuration } from '@/lib/format'

// --------------------------------------------------------------- schedule

/** PVE's default when `schedule` is not set. */
export const DEFAULT_SCHEDULE = '*/15'

export interface SchedulePreset {
  value: string
  label: string
}

/**
 * Presets of the schedule field: the official calendar-event examples, plus
 * the short intervals that suit replication.
 */
export const SCHEDULE_PRESETS: readonly SchedulePreset[] = [
  { value: '*/5', label: '每 5 分钟' },
  { value: '*/15', label: '每 15 分钟（默认）' },
  { value: '*/30', label: '每 30 分钟' },
  { value: '*/1:00', label: '每小时' },
  { value: '*/2:00', label: '每 2 小时' },
  { value: '21:00', label: '每天 21:00' },
  { value: '2,22:30', label: '每天 02:30 和 22:30' },
  { value: 'mon..fri 00:00', label: '周一至周五 00:00' },
  { value: 'mon..fri */1:00', label: '周一至周五 每小时' },
  { value: 'mon..fri 7..18:00/15', label: '周一至周五 07:00–18:45 每 15 分钟' },
  { value: 'sun 01:00', label: '每周日 01:00' },
  { value: 'monthly', label: '每月 1 日 00:00' },
  { value: 'sat *-1..7 15:00', label: '每月第一个周六 15:00' },
  { value: 'yearly', label: '每年 1 月 1 日 00:00' },
]

const WEEKDAY: Record<string, string> = { mon: '周一', tue: '周二', wed: '周三', thu: '周四', fri: '周五', sat: '周六', sun: '周日' }
const pad2 = (n: number | string) => String(n).padStart(2, '0')

/** Chinese wording of a weekday spec ("mon..fri" → "周一至周五", "sat,sun" → "周六、周日"). */
function describeWeekdays(spec: string): string | null {
  const parts = spec.split(',').map((part) => {
    const range = /^([a-z]{3})\.\.([a-z]{3})$/.exec(part)
    if (range) {
      const a = WEEKDAY[range[1]!]
      const b = WEEKDAY[range[2]!]
      return a && b ? `${a}至${b}` : null
    }
    return WEEKDAY[part] ?? null
  })
  return parts.every(Boolean) ? parts.join('、') : null
}

/** Time part without weekdays: "*\/15", "*\/2:00", "21:00", "2,22:30". */
function describeTime(spec: string): string | null {
  let m = /^\*\/(\d+)$/.exec(spec)
  if (m) return Number(m[1]) === 1 ? '每分钟' : `每 ${Number(m[1])} 分钟`
  m = /^\*\/(\d+):00$/.exec(spec)
  if (m) return Number(m[1]) === 1 ? '每小时' : `每 ${Number(m[1])} 小时`
  m = /^(\d{1,2}):(\d{2})$/.exec(spec)
  if (m) return `${pad2(m[1]!)}:${m[2]}`
  m = /^(\d{1,2}(?:,\d{1,2})+):(\d{2})$/.exec(spec)
  if (m) return m[1]!.split(',').map((h) => `${pad2(h)}:${m![2]}`).join('、')
  return null
}

/**
 * Plain-language schedule for the job list ("每 15 分钟", "每天 21:00",
 * "周一至周五 00:00"). Unknown forms come back null: show the raw event.
 */
export function describeSchedule(schedule: string | undefined | null): string | null {
  const s = (schedule ?? '').trim().replace(/\s+/g, ' ') || DEFAULT_SCHEDULE
  const preset = SCHEDULE_PRESETS.find((p) => p.value === s)
  if (preset) return preset.label.replace('（默认）', '')
  if (s === 'hourly') return '每小时'
  if (s === 'daily') return '每天 00:00'
  if (s === 'weekly') return '每周一 00:00'
  const words = s.split(' ')
  if (words.length === 1) {
    const t = describeTime(s)
    if (!t) return null
    return /^\d/.test(s) ? `每天 ${t}` : t
  }
  if (words.length === 2 && /^[a-z]/.test(words[0]!)) {
    const days = describeWeekdays(words[0]!)
    const t = describeTime(words[1]!)
    return days && t ? `${days} ${t}` : null
  }
  return null
}

/**
 * Server message for an unparsable schedule, shortened: "invalid format -
 * invalid calendar event 'x' - unable to parse calendar event at 'x' -
 * Context(…)" → "无法识别的计划格式（unable to parse calendar event at 'x'）".
 */
export function scheduleErrorText(detail: string): string {
  const why = detail
    .split(' - ')
    .map((s) => s.trim())
    .filter((s) => s && !/^invalid format$/i.test(s) && !/^invalid calendar event/i.test(s) && !/^Context\(/.test(s))
    .join(' - ')
  return why ? `无法识别的计划格式（${why}）` : '无法识别的计划格式'
}

// ------------------------------------------------------------------ state

export type JobTone = 'ok' | 'running' | 'warning' | 'error' | 'muted'

export interface JobState {
  kind: 'syncing' | 'removing' | 'error' | 'disabled' | 'never' | 'ok' | 'unknown'
  label: string
  tone: JobTone
}

/**
 * The state shown for a job. `status` is the node's view of it; without one
 * (datacenter list, node offline) only the configuration is known.
 */
export function jobState(job: ReplicationJob, status?: ReplicationStatus | null): JobState {
  const s = status ?? undefined
  if (s?.pid) return { kind: 'syncing', label: '同步中', tone: 'running' }
  if (job.remove_job || s?.remove_job) return { kind: 'removing', label: '等待删除', tone: 'warning' }
  if (s?.error) {
    const n = s.fail_count ?? 0
    return { kind: 'error', label: n > 1 ? `失败（${n} 次）` : '失败', tone: 'error' }
  }
  if (job.disable) return { kind: 'disabled', label: '已停用', tone: 'muted' }
  if (!s) return { kind: 'unknown', label: '状态未知', tone: 'muted' }
  if (!s.last_sync) return { kind: 'never', label: '尚未同步', tone: 'muted' }
  return { kind: 'ok', label: '正常', tone: 'ok' }
}

/** "上次同步": "—" when never, "同步中" while running (as the official UI). */
export function formatLastSync(s: Pick<ReplicationStatus, 'last_sync' | 'pid'> | undefined): string {
  if (!s?.last_sync) return DASH
  if (s.pid) return '同步中'
  return formatDateTime(s.last_sync)
}

/** "下次同步": a time in the past means the job is due ("即将开始"). */
export function formatNextSync(
  s: Pick<ReplicationStatus, 'next_sync' | 'pid' | 'disable'> | undefined,
  nowMs = Date.now(),
): string {
  if (!s?.next_sync || s.disable) return DASH
  if (s.pid) return '同步中'
  if (s.next_sync * 1000 < nowMs) return '即将开始'
  return formatDateTime(s.next_sync)
}

/** Duration of the last run: "0.4 秒", "12 秒", "2 分 5 秒". */
export function formatSyncDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return DASH
  if (seconds < 10) return `${(Math.round(seconds * 10) / 10).toFixed(1)} 秒`
  return formatDuration(Math.round(seconds))
}

export function formatRateLimit(rate: number | null | undefined): string {
  return rate ? `${rate} MB/s` : '不限速'
}

// ------------------------------------------------------------------- jobs

/** "100-2" → { guest: 100, jobnum: 2 }. */
export function parseJobId(id: string): { guest: number; jobnum: number } | null {
  const m = /^(\d+)-(\d+)$/.exec(id)
  return m ? { guest: Number(m[1]), jobnum: Number(m[2]) } : null
}

/** Next free job id of a guest: one above its highest job number (as the official UI). */
export function nextJobId(jobs: readonly Pick<ReplicationJob, 'id'>[], guest: number): string {
  let highest = -1
  for (const j of jobs) {
    const parsed = parseJobId(j.id)
    if (parsed && parsed.guest === guest && parsed.jobnum > highest) highest = parsed.jobnum
  }
  return `${guest}-${highest + 1}`
}

/** Targets a new job of `guest` cannot use: its own node and nodes it already replicates to. */
export function takenTargets(jobs: readonly ReplicationJob[], guest: number, source: string | undefined, exceptId?: string): string[] {
  const out = new Set<string>(source ? [source] : [])
  for (const j of jobs) if (j.guest === guest && j.id !== exceptId && !j.remove_job) out.add(j.target)
  return [...out]
}

/** Sort like the official grid: guest, then job number. */
export function compareJobs(a: Pick<ReplicationJob, 'guest' | 'jobnum'>, b: Pick<ReplicationJob, 'guest' | 'jobnum'>): number {
  return a.guest - b.guest || a.jobnum - b.jobnum
}

// ------------------------------------------------------------------- form

export interface JobForm {
  guest: number | undefined
  target: string | undefined
  /** Raw calendar event; "" = default (*\/15). */
  schedule: string
  /** MB/s; undefined = unlimited. */
  rate: number | undefined
  comment: string
  enabled: boolean
  /** skip-freeze-fs (newer PVE only; the control is hidden otherwise, so it stays false). */
  skipFreezeFs: boolean
}

export function emptyJobForm(guest?: number): JobForm {
  return { guest, target: undefined, schedule: '', rate: undefined, comment: '', enabled: true, skipFreezeFs: false }
}

export function jobToForm(job: ReplicationJob): JobForm {
  return {
    guest: job.guest,
    target: job.target,
    schedule: job.schedule ?? '',
    rate: job.rate,
    comment: job.comment ?? '',
    enabled: !job.disable,
    skipFreezeFs: !!Number(job['skip-freeze-fs'] ?? 0),
  }
}

/** Field errors of the form (beyond what the server checks); empty = valid. */
export function validateJobForm(form: JobForm, isCreate: boolean): Partial<Record<'guest' | 'target' | 'rate', string>> {
  const errors: Partial<Record<'guest' | 'target' | 'rate', string>> = {}
  if (isCreate && !form.guest) errors.guest = '请选择客户机'
  if (isCreate && !form.target) errors.target = '请选择目标节点'
  if (form.rate !== undefined && !(form.rate >= 1)) errors.rate = '至少 1 MB/s，留空表示不限速'
  return errors
}

/** Values compared and sent; undefined = PVE default (left out / deleted). */
function normalized(form: Pick<JobForm, 'schedule' | 'rate' | 'comment' | 'enabled' | 'skipFreezeFs'>) {
  const schedule = form.schedule.trim().replace(/\s+/g, ' ')
  return {
    schedule: schedule === '' || schedule === DEFAULT_SCHEDULE ? undefined : schedule,
    rate: form.rate === undefined || !Number.isFinite(form.rate) ? undefined : form.rate,
    comment: form.comment.trim() === '' ? undefined : form.comment.trim(),
    disable: form.enabled ? undefined : 1,
    // Default 0: only ever sent when checked, so older PVE never sees the key.
    'skip-freeze-fs': form.skipFreezeFs ? 1 : undefined,
  }
}

/**
 * POST /cluster/replication parameters. Defaults are left out, as the
 * official dialog does (schedule *\/15, unlimited rate, enabled, no comment).
 */
export function createJobParams(form: JobForm, jobs: readonly Pick<ReplicationJob, 'id'>[]): Params {
  if (!form.guest || !form.target) throw new Error('请选择客户机和目标节点')
  const v = normalized(form)
  return {
    id: nextJobId(jobs, form.guest),
    type: 'local',
    target: form.target,
    schedule: v.schedule,
    rate: v.rate,
    comment: v.comment,
    disable: v.disable,
    'skip-freeze-fs': v['skip-freeze-fs'],
  }
}

/**
 * PUT /cluster/replication/{id} parameters: only changed keys, keys reset to
 * their default go to `delete`, with the digest. null when nothing changed.
 */
export function updateJobParams(job: ReplicationJob, form: JobForm): Params | null {
  const before = normalized(jobToForm(job))
  const after = normalized(form)
  const params: Params = {}
  const remove: string[] = []
  for (const key of ['schedule', 'rate', 'comment', 'disable', 'skip-freeze-fs'] as const) {
    if (before[key] === after[key]) continue
    if (after[key] === undefined) remove.push(key)
    else params[key] = after[key]
  }
  if (remove.length === 0 && Object.keys(params).length === 0) return null
  if (remove.length) params.delete = remove.join(',')
  if (job.digest) params.digest = job.digest
  return params
}

export type DeleteMode = 'full' | 'keep' | 'force'

/** DELETE options per removal mode. */
export function deleteOptions(mode: DeleteMode): { keep?: boolean; force?: boolean } {
  return mode === 'keep' ? { keep: true } : mode === 'force' ? { force: true } : {}
}
