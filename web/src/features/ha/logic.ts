// Pure helpers of the HA screens: status parsing, labels, form → API params.

import type { Params } from '@/api/client'
import type {
  HaArmedState,
  HaManagerStatus,
  HaRequestState,
  HaResourceConfig,
  HaRule,
  HaRuleType,
  HaStatusEntry,
} from '@/api/ha'
import { tryParsePropertyString } from '@/lib/propstring'

export type Tone = 'ok' | 'running' | 'warning' | 'error' | 'muted'

export interface Labelled {
  label: string
  tone: Tone
}

// -------------------------------------------------------------------- sid

export type HaGuestKind = 'vm' | 'ct'

/** "vm:100" → { kind: 'vm', vmid: 100 }; other resource types → null. */
export function parseSid(sid: string): { kind: HaGuestKind; vmid: number } | null {
  const m = /^(vm|ct):(\d+)$/.exec(sid.trim())
  return m ? { kind: m[1] as HaGuestKind, vmid: Number(m[2]) } : null
}

export function sidFor(type: 'qemu' | 'lxc', vmid: number): string {
  return `${type === 'qemu' ? 'vm' : 'ct'}:${vmid}`
}

/** "vm:100, ct:101" → ['vm:100', 'ct:101'] */
export function parseResourceList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------- status

/**
 * The part inside the parentheses of an HA status line, split at ", ":
 * "pvelab-c1 (active, watchdog active, Sun Nov  1 17:35:44 2026)"
 *   → ['active', 'watchdog active', 'Sun Nov  1 17:35:44 2026']
 */
export function statusParts(status: string | undefined): string[] {
  const m = /\((.*)\)\s*$/.exec(status ?? '')
  return m?.[1] ? m[1].split(/,\s*/) : []
}

export type LrmKind = 'active' | 'idle' | 'maintenance' | 'dead' | 'unknown'

export interface LrmState extends Labelled {
  node: string
  kind: LrmKind
  /** "watchdog active" / "watchdog standby" → true / false. */
  watchdog?: boolean
  timestamp?: number
  /** CRM view of the node (online, maintenance, fence, unknown, gone). */
  crmNode?: string
  /** Maintenance requested (ha-manager crm-command node-maintenance enable). */
  maintenance: boolean
  /** Raw status text (for unknown states). */
  raw: string
}

const LRM_LABEL: Record<LrmKind, Labelled> = {
  active: { label: '活动', tone: 'ok' },
  idle: { label: '空闲', tone: 'muted' },
  maintenance: { label: '维护模式', tone: 'warning' },
  dead: { label: '无响应', tone: 'error' },
  unknown: { label: '未知', tone: 'muted' },
}

export function lrmKind(first: string | undefined): LrmKind {
  const s = (first ?? '').toLowerCase()
  if (s === 'active') return 'active'
  if (s === 'idle') return 'idle'
  if (s.startsWith('maintenance')) return 'maintenance'
  if (s.includes('dead') || s.includes('unable') || s.includes('lost')) return 'dead'
  return 'unknown'
}

export type ArmedKind = HaArmedState | 'unknown'

export const ARMED_LABEL: Record<ArmedKind, Labelled & { hint: string }> = {
  armed: { label: '已启用', tone: 'ok', hint: '有 HA 资源在运行，看门狗已激活，节点失联时会被隔离并在其他节点恢复。' },
  standby: { label: '待命', tone: 'muted', hint: '没有活动的 HA 资源，看门狗处于待命状态。' },
  disarming: { label: '正在解除', tone: 'running', hint: '正在释放各节点的看门狗。' },
  disarmed: { label: '已解除', tone: 'warning', hint: 'HA 已解除，不会自动恢复故障。维护结束后请重新启用。' },
  unknown: { label: '未知', tone: 'muted', hint: '' },
}

export interface HaOverview {
  quorate: boolean | undefined
  quorumText: string | undefined
  /** Node of the active CRM master, undefined while there is none. */
  master: string | undefined
  masterText: string | undefined
  masterTimestamp: number | undefined
  armed: ArmedKind
  fencingText: string | undefined
  lrms: LrmState[]
  services: HaStatusEntry[]
}

/** Split /cluster/ha/status/current (+ manager_status for maintenance requests). */
export function parseHaStatus(entries: readonly HaStatusEntry[], manager?: HaManagerStatus | null): HaOverview {
  const quorum = entries.find((e) => e.type === 'quorum')
  const master = entries.find((e) => e.type === 'master')
  const fencing = entries.find((e) => e.type === 'fencing')
  const nodeStatus = manager?.manager_status?.node_status ?? {}
  const nodeRequest = manager?.manager_status?.node_request ?? {}
  const lrmStatus = manager?.lrm_status ?? {}

  const lrms = entries
    .filter((e) => e.type === 'lrm')
    .map((e): LrmState => {
      const node = e.node ?? e.id.replace(/^lrm:/, '')
      const parts = statusParts(e.status)
      let kind = lrmKind(parts[0])
      const crmNode = nodeStatus[node]
      const maintenance = !!nodeRequest[node]?.maintenance || crmNode === 'maintenance' || lrmStatus[node]?.mode === 'maintenance'
      if (maintenance && kind !== 'dead') kind = 'maintenance'
      const wd = parts.find((p) => p.startsWith('watchdog'))
      const base = LRM_LABEL[kind]
      return {
        node,
        kind,
        label: kind === 'unknown' && parts[0] ? parts[0] : base.label,
        tone: base.tone,
        watchdog: wd ? wd.includes('active') : undefined,
        timestamp: e.timestamp,
        crmNode,
        maintenance,
        raw: e.status ?? '',
      }
    })
    .sort((a, b) => a.node.localeCompare(b.node))

  const masterParts = statusParts(master?.status)
  const masterDead = masterParts.some((p) => p.includes('dead'))
  return {
    quorate: quorum ? !!Number(quorum.quorate) : undefined,
    quorumText: quorum?.status,
    master: master && !masterDead ? master.node : undefined,
    masterText: master?.status,
    masterTimestamp: master?.timestamp,
    armed: (fencing?.['armed-state'] as ArmedKind | undefined) ?? 'unknown',
    fencingText: fencing?.status,
    lrms,
    services: entries.filter((e) => e.type === 'service'),
  }
}

// -------------------------------------------------------------- services

const SERVICE_STATE: Record<string, Labelled> = {
  started: { label: '运行中', tone: 'ok' },
  stopped: { label: '已停止', tone: 'muted' },
  request_start: { label: '正在启动', tone: 'running' },
  request_start_balance: { label: '正在启动', tone: 'running' },
  request_stop: { label: '正在停止', tone: 'running' },
  starting: { label: '正在启动', tone: 'running' },
  stopping: { label: '正在停止', tone: 'running' },
  migrate: { label: '迁移中', tone: 'running' },
  relocate: { label: '重定位中', tone: 'running' },
  queued: { label: '排队中', tone: 'running' },
  deleting: { label: '正在移除', tone: 'running' },
  freeze: { label: '已冻结', tone: 'warning' },
  recovery: { label: '恢复中', tone: 'warning' },
  fence: { label: '等待隔离', tone: 'error' },
  error: { label: '错误', tone: 'error' },
  disabled: { label: '已禁用', tone: 'muted' },
  ignored: { label: '已忽略', tone: 'muted' },
}

export function serviceState(state: string | undefined): Labelled & { state: string } {
  const s = state ?? ''
  return { state: s, ...(SERVICE_STATE[s] ?? { label: s || '未知', tone: 'muted' as Tone }) }
}

export const REQUEST_STATES: { value: Exclude<HaRequestState, 'enabled'>; label: string; description: string }[] = [
  { value: 'started', label: '启动', description: '保持运行，故障时自动恢复' },
  { value: 'stopped', label: '停止', description: '保持停止，仍由 HA 管理' },
  { value: 'disabled', label: '禁用', description: '停止且不再恢复' },
  { value: 'ignored', label: '忽略', description: '暂时不由 HA 管理，可手动操作' },
]

/** Request state as shown in lists ("enabled" is an alias of "started"). */
export function requestStateLabel(state: string | undefined): string {
  const s = !state || state === 'enabled' ? 'started' : state
  return REQUEST_STATES.find((r) => r.value === s)?.label ?? s
}

export function normalizeRequestState(state: string | undefined): Exclude<HaRequestState, 'enabled'> {
  const s = !state || state === 'enabled' ? 'started' : state
  return (REQUEST_STATES.some((r) => r.value === s) ? s : 'started') as Exclude<HaRequestState, 'enabled'>
}

/** One row of the resource list: live service status merged with its config. */
export interface ServiceRow {
  sid: string
  kind: HaGuestKind | undefined
  vmid: number | undefined
  node: string | undefined
  state: Labelled & { state: string }
  requestState: Exclude<HaRequestState, 'enabled'>
  crmState: string | undefined
  maxRestart: number
  maxRelocate: number
  failback: boolean
  autoRebalance: boolean
  comment: string | undefined
  config: HaResourceConfig | undefined
}

export function serviceRows(services: readonly HaStatusEntry[], configs: readonly HaResourceConfig[] | undefined): ServiceRow[] {
  const bySid = new Map((configs ?? []).map((c) => [c.sid, c]))
  const rows = services
    .filter((s) => !!s.sid)
    .map((s): ServiceRow => {
      const sid = s.sid!
      const cfg = bySid.get(sid)
      const parsed = parseSid(sid)
      return {
        sid,
        kind: parsed?.kind,
        vmid: parsed?.vmid,
        node: s.node,
        state: serviceState(s.state),
        requestState: normalizeRequestState(s.request_state ?? cfg?.state),
        crmState: s.crm_state,
        maxRestart: s.max_restart ?? cfg?.max_restart ?? 1,
        maxRelocate: s.max_relocate ?? cfg?.max_relocate ?? 1,
        failback: (s.failback ?? cfg?.failback ?? 1) !== 0,
        autoRebalance: (s['auto-rebalance'] ?? cfg?.['auto-rebalance'] ?? 1) !== 0,
        comment: s.comment ?? cfg?.comment,
        config: cfg,
      }
    })
  // Configured but not yet picked up by the CRM.
  const seen = new Set(rows.map((r) => r.sid))
  for (const cfg of configs ?? []) {
    if (seen.has(cfg.sid)) continue
    const parsed = parseSid(cfg.sid)
    rows.push({
      sid: cfg.sid,
      kind: parsed?.kind,
      vmid: parsed?.vmid,
      node: undefined,
      state: { state: 'queued', label: '等待 CRM', tone: 'running' },
      requestState: normalizeRequestState(cfg.state),
      crmState: undefined,
      maxRestart: cfg.max_restart ?? 1,
      maxRelocate: cfg.max_relocate ?? 1,
      failback: (cfg.failback ?? 1) !== 0,
      autoRebalance: (cfg['auto-rebalance'] ?? 1) !== 0,
      comment: cfg.comment,
      config: cfg,
    })
  }
  return rows.sort((a, b) => (a.vmid ?? 0) - (b.vmid ?? 0) || a.sid.localeCompare(b.sid))
}

// ------------------------------------------------------------- resources

export interface ResourceForm {
  /** Only on create. */
  sid?: string
  state: Exclude<HaRequestState, 'enabled'>
  maxRestart: number | undefined
  maxRelocate: number | undefined
  failback: boolean
  autoRebalance: boolean
  comment: string
}

export const RESOURCE_DEFAULTS: ResourceForm = {
  state: 'started',
  maxRestart: 1,
  maxRelocate: 1,
  failback: true,
  autoRebalance: true,
  comment: '',
}

export function resourceForm(cfg: HaResourceConfig | null | undefined): ResourceForm {
  if (!cfg) return { ...RESOURCE_DEFAULTS }
  return {
    state: normalizeRequestState(cfg.state),
    maxRestart: cfg.max_restart ?? 1,
    maxRelocate: cfg.max_relocate ?? 1,
    failback: (cfg.failback ?? 1) !== 0,
    autoRebalance: (cfg['auto-rebalance'] ?? 1) !== 0,
    comment: cfg.comment ?? '',
  }
}

/**
 * POST /cluster/ha/resources or PUT …/{sid}, like the official editor:
 * values equal to the default are left out on create and deleted on edit.
 */
export function resourceParams(f: ResourceForm, existing: HaResourceConfig | null | undefined): Params {
  const params: Params = {}
  const remove: string[] = []
  const isCreate = !existing
  if (isCreate && f.sid) params.sid = f.sid
  params.state = f.state
  const opt = (key: string, value: number, def: number) => {
    if (value !== def) params[key] = value
    else if (!isCreate) remove.push(key)
  }
  opt('max_restart', f.maxRestart ?? 1, 1)
  opt('max_relocate', f.maxRelocate ?? 1, 1)
  opt('failback', f.failback ? 1 : 0, 1)
  opt('auto-rebalance', f.autoRebalance ? 1 : 0, 1)
  const comment = f.comment.trim()
  if (comment) params.comment = comment
  else if (!isCreate && existing?.comment) remove.push('comment')
  if (remove.length) params.delete = remove.join(',')
  if (existing?.digest) params.digest = existing.digest
  return params
}

// ------------------------------------------------------------------ rules

export interface RuleNode {
  node: string
  /** undefined = default priority (0). */
  priority?: number | undefined
}

/** "n1:2,n2" → [{ node: 'n1', priority: 2 }, { node: 'n2' }] */
export function parseRuleNodes(value: string | undefined): RuleNode[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [node = '', pri] = s.split(':')
      const n = pri === undefined || pri === '' ? undefined : Number(pri)
      return { node, priority: Number.isFinite(n) ? n : undefined }
    })
}

export function stringifyRuleNodes(nodes: readonly RuleNode[]): string {
  return nodes.map((n) => (n.priority ? `${n.node}:${n.priority}` : n.node)).join(',')
}

export interface RuleForm {
  /** Rule id; only set on create. */
  rule?: string
  type: HaRuleType
  enabled: boolean
  resources: string[]
  comment: string
  /** node-affinity */
  nodes: RuleNode[]
  strict: boolean
  /** resource-affinity */
  affinity: 'positive' | 'negative'
}

export function ruleForm(type: HaRuleType, rule?: HaRule | null): RuleForm {
  return {
    type: rule?.type ?? type,
    enabled: !rule?.disable,
    resources: parseResourceList(rule?.resources),
    comment: rule?.comment ?? '',
    nodes: parseRuleNodes(rule?.nodes),
    strict: !!rule?.strict,
    affinity: rule?.affinity ?? 'negative',
  }
}

/** pve-configid: letter first, then letters, digits, "-" and "_". */
export const RULE_ID_RE = /^[a-z][a-z0-9_-]+$/i

export function ruleFormErrors(f: RuleForm, isCreate: boolean): Partial<Record<'rule' | 'resources' | 'nodes', string>> {
  const out: Partial<Record<'rule' | 'resources' | 'nodes', string>> = {}
  if (isCreate && !RULE_ID_RE.test(f.rule ?? '')) out.rule = '以字母开头，只能包含字母、数字、- 和 _，至少 2 个字符'
  if (f.type === 'resource-affinity' && f.resources.length < 2) out.resources = '至少选择 2 个 HA 资源'
  else if (f.resources.length < 1) out.resources = '至少选择 1 个 HA 资源'
  if (f.type === 'node-affinity' && f.nodes.length < 1) out.nodes = '至少选择 1 个节点'
  return out
}

/** POST /cluster/ha/rules or PUT …/{rule}. */
export function ruleParams(f: RuleForm, existing: HaRule | null | undefined): Params {
  const isCreate = !existing
  const params: Params = { type: f.type, resources: f.resources.join(',') }
  const remove: string[] = []
  if (isCreate && f.rule) params.rule = f.rule
  if (f.type === 'node-affinity') {
    params.nodes = stringifyRuleNodes(f.nodes)
    if (f.strict) params.strict = 1
    else if (!isCreate && existing?.strict) params.strict = 0
  } else {
    params.affinity = f.affinity
  }
  if (!f.enabled) params.disable = 1
  else if (!isCreate && existing?.disable) remove.push('disable')
  const comment = f.comment.trim()
  if (comment) params.comment = comment
  else if (!isCreate && existing?.comment) remove.push('comment')
  if (remove.length) params.delete = remove.join(',')
  if (existing?.digest) params.digest = existing.digest
  return params
}

/** Default id for a new rule (the official UI uses "ha-rule-" + 13 uuid chars). */
export function newRuleId(type: HaRuleType, rand: () => number = Math.random): string {
  const suffix = Array.from({ length: 6 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(rand() * 36)]).join('')
  return `${type === 'node-affinity' ? 'node' : 'res'}-rule-${suffix}`
}

/** Rule errors as "option: message" lines. */
export function ruleErrors(rule: Pick<HaRule, 'errors'>): string[] {
  return Object.entries(rule.errors ?? {}).flatMap(([opt, msgs]) => (Array.isArray(msgs) ? msgs : [String(msgs)]).map((m) => `${opt}: ${m}`))
}

export const AFFINITY_LABEL: Record<'positive' | 'negative', string> = {
  positive: '保持在一起',
  negative: '保持分开',
}

// -------------------------------------------------------------------- CRS

export type CrsMode = 'basic' | 'static' | 'dynamic'
export type CrsMethod = 'bruteforce' | 'topsis'

export interface CrsForm {
  /** undefined = default (basic). */
  mode: CrsMode | undefined
  rebalanceOnStart: boolean
  autoRebalance: boolean
  threshold: number | undefined
  method: CrsMethod | undefined
  holdDuration: number | undefined
  margin: number | undefined
}

export function crsForm(crs: string | undefined): CrsForm {
  const m = tryParsePropertyString(crs)
  const num = (k: string) => (m[k] !== undefined && m[k] !== '' && Number.isFinite(Number(m[k])) ? Number(m[k]) : undefined)
  return {
    mode: (['basic', 'static', 'dynamic'] as const).find((x) => x === m.ha),
    rebalanceOnStart: m['ha-rebalance-on-start'] === '1',
    autoRebalance: m['ha-auto-rebalance'] === '1',
    threshold: num('ha-auto-rebalance-threshold'),
    method: (['bruteforce', 'topsis'] as const).find((x) => x === m['ha-auto-rebalance-method']),
    holdDuration: num('ha-auto-rebalance-hold-duration'),
    margin: num('ha-auto-rebalance-margin'),
  }
}

/** Automatic rebalancing works with the static and dynamic modes only. */
export function canAutoRebalance(mode: CrsMode | undefined): boolean {
  return mode === 'static' || mode === 'dynamic'
}

/** PUT /cluster/options params: { crs } or { delete: 'crs' } when everything is default. */
export function crsParams(f: CrsForm): Params {
  const parts: string[] = []
  if (f.mode) parts.push(`ha=${f.mode}`)
  if (f.rebalanceOnStart) parts.push('ha-rebalance-on-start=1')
  if (canAutoRebalance(f.mode) && f.autoRebalance) {
    parts.push('ha-auto-rebalance=1')
    if (f.threshold !== undefined) parts.push(`ha-auto-rebalance-threshold=${f.threshold}`)
    if (f.method) parts.push(`ha-auto-rebalance-method=${f.method}`)
    if (f.holdDuration !== undefined) parts.push(`ha-auto-rebalance-hold-duration=${f.holdDuration}`)
    if (f.margin !== undefined) parts.push(`ha-auto-rebalance-margin=${f.margin}`)
  }
  return parts.length ? { crs: parts.join(',') } : { delete: 'crs' }
}

export const CRS_MODE_LABEL: Record<CrsMode, string> = {
  basic: '基础（按资源数量）',
  static: '静态负载',
  dynamic: '动态负载',
}

export function describeCrs(crs: string | undefined): string {
  const f = crsForm(crs)
  const parts = [CRS_MODE_LABEL[f.mode ?? 'basic']]
  if (f.rebalanceOnStart) parts.push('启动时均衡')
  if (canAutoRebalance(f.mode) && f.autoRebalance) parts.push('自动均衡')
  return parts.join(' · ')
}
