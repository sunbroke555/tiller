// Pure helpers of the backup job screens (unit tested in logic.test.ts).
// Field rules follow the official PVE.dc.BackupEdit / BackupAdvancedOptions /
// BackupJobPrune panels (pvemanagerlib.js) and PVE/API2/Backup.pm.

import type { Params } from '@/api/client'
import type { BackupJob, PropObject } from '@/api/backup-jobs'
import { DASH, formatDateTime } from '@/lib/format'
import { stringifyPropertyString, tryParsePropertyString } from '@/lib/propstring'
import {
  RETENTION_KEYS,
  describeRetention,
  escapeNotesTemplate,
  parseRetention,
  unescapeNotesTemplate,
  type BackupCompress,
  type BackupMode,
  type NotificationMode,
  type PbsChangeDetection,
} from '@/features/guest-backup/logic'

export { RETENTION_KEYS }

// ---------------------------------------------------------------- generic

/** A property option as the API returns it (object) or as typed (string) → string map. */
export function propMap(value: PropObject | string | null | undefined): Record<string, string> {
  if (value === undefined || value === null || value === '') return {}
  if (typeof value === 'string') return tryParsePropertyString(value)
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]))
}

/** 1 / "1" / true → true. */
export function flag(value: unknown): boolean {
  return value === 1 || value === '1' || value === true
}

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/** "100,200 300" → [100, 200, 300] (sorted, unique, valid VMIDs only). */
export function parseVmidList(value: string | null | undefined): number[] {
  const out = new Set<number>()
  for (const part of (value ?? '').split(/[\s,;]+/)) {
    if (!/^\d+$/.test(part)) continue
    out.add(Number(part))
  }
  return [...out].sort((a, b) => a - b)
}

export function isJobEnabled(job: Pick<BackupJob, 'enabled'>): boolean {
  // The API default is enabled=1.
  return job.enabled === undefined || flag(job.enabled)
}

// --------------------------------------------------------------- schedule

/** Examples of PVE.form.CalendarEvent, in the same order. */
export const SCHEDULE_PRESETS: readonly { value: string; label: string }[] = [
  { value: '*/30', label: '每 30 分钟' },
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

/** Chinese label of a preset schedule, or null for a custom one. */
export function describeSchedule(schedule: string | null | undefined): string | null {
  const s = (schedule ?? '').trim()
  return SCHEDULE_PRESETS.find((p) => p.value === s)?.label ?? null
}

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** Unix seconds as "11-07 周六 01:00" (with the year when it is not this year). */
export function formatRunTime(epochSeconds: number, now = new Date()): string {
  const d = new Date(epochSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const year = d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}-`
  return `${year}${date} ${WEEKDAY[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Time until a future moment: "5 分钟后", "3 小时后", "2 天后". */
export function formatTimeUntil(epochSeconds: number, nowMs = Date.now()): string {
  const diff = Math.round(epochSeconds - nowMs / 1000)
  if (diff < 60) return '即将'
  if (diff < 3600) return `${Math.round(diff / 60)} 分钟后`
  if (diff < 86400) return `${Math.round(diff / 3600)} 小时后`
  return `${Math.round(diff / 86400)} 天后`
}

export type NextRun = { kind: 'none' } | { kind: 'pending' } | { kind: 'at'; time: number }

/** Like PVE.Utils.render_next_event: missing → none, in the past → pending. */
export function nextRunState(nextRun: number | null | undefined, nowMs = Date.now()): NextRun {
  if (!nextRun) return { kind: 'none' }
  if (nextRun * 1000 < nowMs) return { kind: 'pending' }
  return { kind: 'at', time: nextRun }
}

export function nextRunLabel(nextRun: number | null | undefined, nowMs = Date.now()): string {
  const s = nextRunState(nextRun, nowMs)
  if (s.kind === 'none') return DASH
  if (s.kind === 'pending') return '等待运行'
  return formatDateTime(s.time)
}

// -------------------------------------------------------------- selection

export type SelectionMode = 'include' | 'all' | 'exclude' | 'pool'

export const SELECTION_LABEL: Record<SelectionMode, string> = {
  include: '包含所选',
  all: '全部',
  exclude: '排除所选',
  pool: '资源池',
}

/** Selection mode of a job (like BackupEdit.prepareValues). */
export function selectionMode(job: Pick<BackupJob, 'all' | 'exclude' | 'pool' | 'vmid'>): SelectionMode {
  if (job.exclude) return 'exclude'
  if (flag(job.all)) return 'all'
  if (job.pool) return 'pool'
  return 'include'
}

/** "全部客户机", "全部，排除 101、102", "100、200", "资源池 lab-pool" (like render_backup_selection). */
export function describeSelection(job: Pick<BackupJob, 'all' | 'exclude' | 'pool' | 'vmid'>): string {
  if (flag(job.all)) {
    const ex = parseVmidList(job.exclude)
    return ex.length ? `全部，排除 ${ex.join('、')}` : '全部客户机'
  }
  const ids = parseVmidList(job.vmid)
  if (ids.length) return ids.join('、')
  if (job.pool) return `资源池 ${job.pool}`
  return DASH
}

// -------------------------------------------------------------- retention

export type KeepKey = (typeof RETENTION_KEYS)[number][0]

/** Retention of a job for display; "按存储配置" when the job sets none. */
export function describeJobRetention(job: Pick<BackupJob, 'prune-backups'>): string {
  const r = parseRetention(job['prune-backups'])
  if (!r) return '按存储配置'
  return describeRetention(r)
}

export interface RetentionForm {
  keepAll: boolean
  keeps: Partial<Record<KeepKey, number>>
}

export function retentionFromJob(value: BackupJob['prune-backups']): RetentionForm {
  const map = propMap(value)
  const keeps: RetentionForm['keeps'] = {}
  for (const [key] of RETENTION_KEYS) {
    const n = num(map[key])
    if (n !== undefined && n > 0) keeps[key] = n
  }
  return { keepAll: map['keep-all'] === '1', keeps }
}

/** prune-backups value: "keep-all=1", "keep-daily=7,keep-last=3", or '' (= fall back to the storage). */
export function retentionString(r: RetentionForm): string {
  if (r.keepAll) return 'keep-all=1'
  const props: Record<string, number> = {}
  for (const [key] of RETENTION_KEYS) {
    const v = r.keeps[key]
    if (v !== undefined && Number.isFinite(v) && v > 0) props[key] = Math.floor(v)
  }
  // The official panel prints the property string sorted.
  return stringifyPropertyString(props, { sort: true })
}

// ------------------------------------------------------------------- form

export type MailNotification = 'always' | 'failure'

export interface JobForm {
  /** Create only; empty = generated by the server. */
  id: string
  /** '' = all nodes. */
  node: string
  storage: string
  schedule: string
  enabled: boolean
  comment: string
  selMode: SelectionMode
  /** Guests for include / exclude. */
  vmids: number[]
  pool: string
  mode: BackupMode
  compress: BackupCompress
  notificationMode: NotificationMode
  mailto: string
  mailnotification: MailNotification
  retention: RetentionForm
  protected: boolean
  /** Unescaped (real newlines). */
  notesTemplate: string
  /** KiB/s; undefined = fallback (vzdump.conf / schema), 0 = unlimited. */
  bwlimit?: number | undefined
  zstd?: number | undefined
  maxWorkers?: number | undefined
  /** Not shown (like the official UI), kept on edit. */
  pbsEntriesMax?: number | undefined
  ionice?: number | undefined
  fleecing: boolean
  fleecingStorage: string
  repeatMissed: boolean
  pbsChangeDetection?: PbsChangeDetection | undefined
  /** One path per line. */
  excludePaths: string
}

export function defaultJobForm(): JobForm {
  return {
    id: '',
    node: '',
    storage: '',
    schedule: '21:00',
    enabled: true,
    comment: '',
    selMode: 'include',
    vmids: [],
    pool: '',
    mode: 'snapshot',
    compress: 'zstd',
    notificationMode: 'notification-system',
    mailto: '',
    mailnotification: 'always',
    retention: { keepAll: false, keeps: {} },
    protected: false,
    notesTemplate: '{{guestname}}',
    fleecing: false,
    fleecingStorage: '',
    repeatMissed: false,
    excludePaths: '',
  }
}

const COMPRESS: readonly BackupCompress[] = ['zstd', 'lzo', 'gzip', '0']

/** Edit form from a job config (GET /cluster/backup/{id}). */
export function jobFormFromJob(job: BackupJob): JobForm {
  const mode = selectionMode(job)
  const perf = propMap(job.performance)
  const fleecing = propMap(job.fleecing)
  const notif = job['notification-mode'] ?? 'auto'
  const compress = job.compress === '1' ? 'lzo' : (job.compress as BackupCompress | undefined)
  const excludePath = job['exclude-path']
  return {
    id: job.id,
    node: job.node ?? '',
    storage: job.storage ?? '',
    schedule: job.schedule ?? '',
    enabled: isJobEnabled(job),
    comment: job.comment ?? '',
    selMode: mode,
    vmids: parseVmidList(mode === 'exclude' ? job.exclude : mode === 'include' ? job.vmid : ''),
    pool: job.pool ?? '',
    mode: job.mode ?? 'snapshot',
    // The schema default is no compression.
    compress: compress && COMPRESS.includes(compress) ? compress : '0',
    // Like BackupNotificationOptions.onSetValues: "auto" without mailto is the notification system.
    notificationMode: (notif === 'auto' && !job.mailto) || notif === 'notification-system' ? 'notification-system' : 'legacy-sendmail',
    mailto: job.mailto ?? '',
    mailnotification: job.mailnotification ?? 'always',
    retention: retentionFromJob(job['prune-backups']),
    protected: flag(job.protected),
    notesTemplate: job['notes-template'] ? unescapeNotesTemplate(job['notes-template']) : '',
    bwlimit: num(job.bwlimit),
    zstd: num(job.zstd),
    maxWorkers: num(perf['max-workers']),
    pbsEntriesMax: num(perf['pbs-entries-max']),
    ionice: num(job.ionice),
    fleecing: fleecing.enabled === '1',
    fleecingStorage: fleecing.storage ?? '',
    repeatMissed: flag(job['repeat-missed']),
    pbsChangeDetection: job['pbs-change-detection-mode'],
    excludePaths: (Array.isArray(excludePath) ? excludePath : excludePath ? [excludePath] : []).join('\n'),
  }
}

/** Job ID: pve-configid (letter first, then letters, digits, - and _). */
export function validateJobId(id: string): string | null {
  const v = id.trim()
  if (!v) return null
  if (!/^[a-z]/i.test(v)) return '需以字母开头'
  if (!/^[a-z][a-z0-9_-]+$/i.test(v)) return '只能包含字母、数字、- 和 _，至少 2 个字符'
  return null
}

/** Field errors that block saving (keys are API parameter names). */
export function validateJobForm(form: JobForm, opts: { create: boolean }): Record<string, string> {
  const errors: Record<string, string> = {}
  if (opts.create) {
    const idError = validateJobId(form.id)
    if (idError) errors.id = idError
  }
  if (!form.storage) errors.storage = '请选择存储'
  if (!form.schedule.trim()) errors.schedule = '请输入计划'
  if ((form.selMode === 'include' || form.selMode === 'exclude') && form.vmids.length === 0) {
    errors.vmid = form.selMode === 'include' ? '至少选择一台客户机' : '至少选择一台要排除的客户机'
  }
  if (form.selMode === 'pool' && !form.pool) errors.pool = '请选择资源池'
  if (form.fleecing && !form.fleecingStorage) errors.fleecing = '请选择 fleecing 存储'
  return errors
}

export interface JobParamsContext {
  /** Editing this job (null = create). Keys it had and the form cleared go to `delete`. */
  original: BackupJob | null
  /** The target storage is a Proxmox Backup Server (compression fixed to zstd). */
  pbs: boolean
}

/**
 * POST /cluster/backup (create) or PUT /cluster/backup/{id} (edit) parameters,
 * like the official edit window: on edit, cleared options are deleted; the
 * server drops the other selection keys itself (vmid ↔ all/exclude ↔ pool).
 */
export function jobParams(form: JobForm, ctx: JobParamsContext): Params {
  const create = !ctx.original
  const orig = ctx.original ?? ({} as Partial<BackupJob>)
  const params: Params = {}
  const remove: string[] = []
  const clear = (key: string) => {
    const v = orig[key]
    if (!create && v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) remove.push(key)
  }

  if (create && form.id.trim()) params.id = form.id.trim()

  // General
  if (form.node) params.node = form.node
  else clear('node')
  params.storage = form.storage
  params.schedule = form.schedule.trim()
  params.enabled = form.enabled ? 1 : 0
  if (form.comment.trim()) params.comment = form.comment.trim()
  else clear('comment')
  params.mode = form.mode
  // PBS always compresses with zstd; the official field is disabled (not sent) then.
  if (!ctx.pbs) params.compress = form.compress

  // Selection
  switch (form.selMode) {
    case 'include':
      params.vmid = form.vmids.join(',')
      break
    case 'all':
      params.all = 1
      clear('exclude')
      break
    case 'exclude':
      params.all = 1
      params.exclude = form.vmids.join(',')
      break
    case 'pool':
      params.pool = form.pool
      break
  }

  // Notifications
  params['notification-mode'] = form.notificationMode
  if (form.notificationMode === 'legacy-sendmail') {
    if (form.mailto.trim()) params.mailto = form.mailto.trim()
    else clear('mailto')
    params.mailnotification = form.mailnotification
  }

  // Retention
  const prune = retentionString(form.retention)
  if (prune) params['prune-backups'] = prune
  else clear('prune-backups')
  if (form.protected) params.protected = 1
  else clear('protected')

  // Notes
  if (form.notesTemplate.trim()) params['notes-template'] = escapeNotesTemplate(form.notesTemplate)
  else clear('notes-template')

  // Advanced
  if (form.bwlimit !== undefined) params.bwlimit = Math.round(form.bwlimit)
  else clear('bwlimit')
  // Zstd threads only apply to zstd (the official field is disabled otherwise and keeps its value).
  if (!ctx.pbs && form.compress === 'zstd') {
    if (form.zstd !== undefined) params.zstd = Math.round(form.zstd)
    else clear('zstd')
  }
  const performance = stringifyPropertyString({ 'max-workers': form.maxWorkers, 'pbs-entries-max': form.pbsEntriesMax })
  if (performance) params.performance = performance
  else clear('performance')
  if (form.ionice !== undefined) params.ionice = Math.round(form.ionice)
  else clear('ionice')
  if (form.fleecing) params.fleecing = stringifyPropertyString({ enabled: 1, storage: form.fleecingStorage || undefined })
  else clear('fleecing')
  if (form.repeatMissed) params['repeat-missed'] = 1
  else clear('repeat-missed')
  if (form.pbsChangeDetection) params['pbs-change-detection-mode'] = form.pbsChangeDetection
  else clear('pbs-change-detection-mode')
  const paths = form.excludePaths
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (paths.length) params['exclude-path'] = paths
  else clear('exclude-path')

  if (remove.length) params.delete = remove.join(',')
  return params
}

// ---------------------------------------------------------------- run now

/** Keys of a job that are not vzdump parameters (removed like the official run_backup_now). */
const SCHEDULING_KEYS = ['enabled', 'starttime', 'dow', 'id', 'schedule', 'type', 'node', 'comment', 'next-run', 'repeat-missed']
const PROPERTY_KEYS = ['performance', 'prune-backups', 'fleecing']

/** POST /nodes/{node}/vzdump parameters that run a job's backup once. */
export function runNowParams(job: BackupJob): Params {
  const params: Params = {}
  for (const [key, value] of Object.entries(job)) {
    if (SCHEDULING_KEYS.includes(key) || value === undefined || value === null) continue
    if (PROPERTY_KEYS.includes(key)) {
      const s = typeof value === 'string' ? value : stringifyPropertyString(propMap(value as PropObject))
      if (s) params[key] = s
      continue
    }
    if (Array.isArray(value)) params[key] = value.map(String)
    else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') params[key] = value
  }
  params.all = flag(job.all) ? 1 : 0
  return params
}

/**
 * Nodes to start the job on: its own node (must be online) or every online
 * node; offline nodes are reported like the official dialog does.
 */
export function runNowTargets(
  job: Pick<BackupJob, 'node'>,
  nodes: readonly { node: string; status?: string }[],
): { nodes: string[]; errors: string[] } {
  const online = nodes
    .filter((n) => n.status === 'online')
    .map((n) => n.node)
    .sort((a, b) => a.localeCompare(b))
  if (job.node) {
    return online.includes(job.node) ? { nodes: [job.node], errors: [] } : { nodes: [], errors: [`节点 ${job.node} 不在线`] }
  }
  return {
    nodes: online,
    errors: nodes.filter((n) => n.status !== 'online').map((n) => `${n.node}：节点离线`),
  }
}

// ----------------------------------------------------------- included disks

/** PVE.Utils.backup_reasons_table, plus the other reasons vzdump reports. */
const REASON_LABEL: Record<string, string> = {
  'backup=yes': '已启用备份',
  'backup=no': '已禁用备份',
  enabled: '已启用',
  disabled: '已禁用',
  'not a volume': '不是存储卷',
  'efidisk but no OVMF BIOS': 'EFI 磁盘但未使用 OVMF',
  rootfs: '根文件系统',
  'mountpoint=yes': '挂载点（已启用备份）',
}

export function includeReasonLabel(reason: string | undefined): string {
  if (!reason) return ''
  return REASON_LABEL[reason] ?? reason
}

/** The disk key of an included_volumes leaf id ("100:scsi0" → "scsi0"). */
export function volumeKey(id: string): string {
  const i = id.indexOf(':')
  return i === -1 ? id : id.slice(i + 1)
}

// ------------------------------------------------------------ notification

export function describeNotification(job: Pick<BackupJob, 'notification-mode' | 'mailto' | 'mailnotification'>): string {
  const mode = job['notification-mode'] ?? 'auto'
  if ((mode === 'auto' && !job.mailto) || mode === 'notification-system') return '使用全局通知设置'
  const when = job.mailnotification === 'failure' ? '失败时' : '总是'
  return `${when}发送邮件${job.mailto ? `到 ${job.mailto}` : '（未设置收件人）'}`
}

export const MODE_LABEL: Record<BackupMode, string> = { snapshot: '快照', suspend: '挂起', stop: '停止' }

export function compressLabel(value: string | undefined): string {
  switch (value) {
    case 'zstd':
      return 'ZSTD'
    case 'lzo':
    case '1':
      return 'LZO'
    case 'gzip':
      return 'GZIP'
    default:
      return '不压缩'
  }
}
