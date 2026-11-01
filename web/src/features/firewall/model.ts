// Pure firewall logic shared by every scope: what a scope offers, rule
// summaries, rule form ↔ API params, reordering, option definitions, log
// rate limit and log line parsing. Field rules follow the official UI
// (pvemanagerlib.js: PVE.FirewallRulePanel, PVE.FirewallOptions).

import type { Params } from '@/api/client'
import type { FirewallRef, FirewallRule, FirewallScope, LogLevel, Policy, RuleType } from '@/api/firewall'

// ------------------------------------------------------------- scopes

export type FirewallView = 'rules' | 'groups' | 'aliases' | 'ipset' | 'options' | 'log'

export interface ScopeFeatures {
  views: FirewallView[]
  /** Directions a plain rule may have here. */
  directions: Exclude<RuleType, 'group'>[]
  /** Rules may name an interface. */
  iface: boolean
  /** Security groups can be inserted as rules. */
  groups: boolean
}

export function scopeFeatures(scope: FirewallScope): ScopeFeatures {
  switch (scope.kind) {
    case 'dc':
      return { views: ['rules', 'groups', 'aliases', 'ipset', 'options'], directions: ['in', 'out', 'forward'], iface: true, groups: true }
    case 'node':
      return { views: ['rules', 'options', 'log'], directions: ['in', 'out', 'forward'], iface: true, groups: true }
    case 'guest':
      return { views: ['rules', 'aliases', 'ipset', 'options', 'log'], directions: ['in', 'out'], iface: true, groups: true }
    case 'vnet':
      return { views: ['rules', 'options'], directions: ['forward'], iface: false, groups: true }
    case 'group':
      return { views: ['rules'], directions: ['in', 'out', 'forward'], iface: false, groups: false }
  }
}

export const VIEW_LABEL: Record<FirewallView, string> = {
  rules: '规则',
  groups: '安全组',
  aliases: '别名',
  ipset: 'IPSet',
  options: '选项',
  log: '日志',
}

// ------------------------------------------------------------- labels

export const DIRECTION_LABEL: Record<RuleType, string> = {
  in: '入站',
  out: '出站',
  forward: '转发',
  group: '安全组',
}

export const ACTION_LABEL: Record<Policy, string> = {
  ACCEPT: '允许',
  REJECT: '拒绝',
  DROP: '丢弃',
}

/** Actions a direction allows (forward cannot REJECT). */
export function actionsFor(type: RuleType): Policy[] {
  return type === 'forward' ? ['ACCEPT', 'DROP'] : ['ACCEPT', 'REJECT', 'DROP']
}

export const LOG_LEVELS: LogLevel[] = ['nolog', 'emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']

export const LOG_LEVEL_LABEL: Record<LogLevel, string> = {
  nolog: '不记录',
  emerg: 'emerg',
  alert: 'alert',
  crit: 'crit',
  err: 'err',
  warning: 'warning',
  notice: 'notice',
  info: 'info',
  debug: 'debug',
}

export function isIcmpProto(proto: string | undefined): 'v4' | 'v6' | null {
  const p = (proto ?? '').trim().toLowerCase()
  if (p === 'icmp' || p === '1') return 'v4'
  if (p === 'icmpv6' || p === 'ipv6-icmp' || p === '58') return 'v6'
  return null
}

// ------------------------------------------------------------- summary

export type ActionTone = 'accept' | 'reject' | 'drop' | 'group'

export function actionTone(rule: Pick<FirewallRule, 'type' | 'action'>): ActionTone {
  if (rule.type === 'group') return 'group'
  if (rule.action === 'ACCEPT') return 'accept'
  if (rule.action === 'REJECT') return 'reject'
  return 'drop'
}

/** "+dc/web" → "web（IPSet）"; "dc/host1" → "host1"; empty → "任意". */
export function formatAddress(value: string | undefined): string {
  const v = (value ?? '').trim()
  if (!v) return '任意'
  return v
    .split(',')
    .map((part) => {
      const s = part.trim()
      const m = /^(\+)?(?:(dc|guest|sdn)\/)?([A-Za-z][A-Za-z0-9_-]*)$/.exec(s)
      if (!m) return s
      return m[1] ? `${m[3]}（IPSet）` : m[2] ? m[3] : s
    })
    .join(', ')
}

/** What traffic a rule matches: "HTTPS", "tcp 22", "icmp echo-request", "所有流量". */
export function formatService(rule: Pick<FirewallRule, 'macro' | 'proto' | 'dport' | 'sport' | 'icmp-type'>): string {
  const parts: string[] = []
  if (rule.macro) parts.push(rule.macro)
  if (rule.proto) parts.push(rule.proto)
  if (rule.dport) parts.push(rule.dport)
  if (rule.sport) parts.push(`源端口 ${rule.sport}`)
  if (rule['icmp-type']) parts.push(rule['icmp-type'])
  return parts.length ? parts.join(' ') : '所有流量'
}

/** One-line description, used for screen readers and confirmations. */
export function describeRule(rule: FirewallRule): string {
  if (rule.type === 'group') return `安全组 ${rule.action}${rule.iface ? `（${rule.iface}）` : ''}`
  const dir = DIRECTION_LABEL[rule.type]
  const act = ACTION_LABEL[rule.action as Policy] ?? rule.action
  return `${dir}${act} ${formatService(rule)}：${formatAddress(rule.source)} → ${formatAddress(rule.dest)}`
}

// ---------------------------------------------------------- rule form

export interface RuleForm {
  type: Exclude<RuleType, 'group'>
  action: Policy
  enable: boolean
  iface: string
  macro: string
  proto: string
  source: string
  dest: string
  sport: string
  dport: string
  icmpType: string
  log: LogLevel
  comment: string
}

export function emptyRuleForm(features: Pick<ScopeFeatures, 'directions'>): RuleForm {
  return {
    type: features.directions[0] ?? 'in',
    action: 'ACCEPT',
    enable: false,
    iface: '',
    macro: '',
    proto: '',
    source: '',
    dest: '',
    sport: '',
    dport: '',
    icmpType: '',
    log: 'nolog',
    comment: '',
  }
}

export function ruleToForm(rule: FirewallRule): RuleForm {
  const type = rule.type === 'group' ? 'in' : rule.type
  const actions = actionsFor(type)
  return {
    type,
    action: (actions as string[]).includes(rule.action) ? (rule.action as Policy) : 'ACCEPT',
    enable: !!rule.enable,
    iface: rule.iface ?? '',
    macro: rule.macro ?? '',
    proto: rule.proto ?? '',
    source: rule.source ?? '',
    dest: rule.dest ?? '',
    sport: rule.sport ?? '',
    dport: rule.dport ?? '',
    icmpType: rule['icmp-type'] ?? '',
    log: rule.log ?? 'nolog',
    comment: rule.comment ?? '',
  }
}

/**
 * The API values a form stands for, after the official dependencies: a macro
 * defines protocol and ports itself; ICMP has a type instead of ports; the
 * interface only where the scope has one. Empty = not set.
 */
export function ruleFormValues(form: RuleForm, opts: { iface: boolean }): Record<string, string> {
  const icmp = isIcmpProto(form.proto)
  const macro = form.macro.trim()
  const values: Record<string, string> = {
    type: form.type,
    action: actionsFor(form.type).includes(form.action) ? form.action : 'ACCEPT',
    iface: opts.iface ? form.iface.trim() : '',
    macro,
    proto: macro ? '' : form.proto.trim(),
    source: form.source.trim(),
    dest: form.dest.trim(),
    sport: macro ? '' : form.sport.trim(),
    dport: macro || icmp ? '' : form.dport.trim(),
    'icmp-type': !macro && icmp ? form.icmpType.trim() : '',
    log: form.log === 'nolog' ? '' : form.log,
    comment: form.comment.trim(),
  }
  return values
}

const RULE_KEYS = ['type', 'action', 'iface', 'macro', 'proto', 'source', 'dest', 'sport', 'dport', 'icmp-type', 'log', 'comment'] as const

/** POST params for a new rule. */
export function createRuleParams(form: RuleForm, opts: { iface: boolean }): Params {
  const values = ruleFormValues(form, opts)
  const params: Params = { enable: form.enable ? 1 : 0 }
  for (const k of RULE_KEYS) if (values[k]) params[k] = values[k]
  return params
}

/**
 * PUT params for an edited rule: changed keys, cleared ones in `delete`,
 * the digest of the list the rule was loaded from. null = nothing changed.
 */
export function updateRuleParams(original: FirewallRule, form: RuleForm, opts: { iface: boolean }): Params | null {
  const values = ruleFormValues(form, opts)
  const params: Params = {}
  const remove: string[] = []
  for (const k of RULE_KEYS) {
    const before = String(original[k] ?? '')
    const after = values[k] ?? ''
    if (before === after) continue
    if (after) params[k] = after
    else if (before) remove.push(k)
  }
  if (!!original.enable !== form.enable) params.enable = form.enable ? 1 : 0
  if (remove.length) params.delete = remove.join(',')
  if (Object.keys(params).length === 0) return null
  params.digest = original.digest
  return params
}

/** Copy of a rule as a new-rule form (the copy starts disabled, like the official "复制"). */
export function copyRuleForm(rule: FirewallRule): RuleForm {
  return { ...ruleToForm(rule), enable: false }
}

// Port lists: "22", "80:85", "http", "22,80:85,https".
const PORT_ITEM = /^(?:\d{1,5}(?::\d{1,5})?|[A-Za-z][\w.+-]*)$/

export function validatePorts(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  for (const item of v.split(',')) {
    const s = item.trim()
    if (!PORT_ITEM.test(s)) return `“${s}”不是有效的端口或端口范围（例如 22、80:85、https）`
    const nums = s.split(':').map(Number)
    if (nums.some((n) => !Number.isNaN(n) && n > 65535)) return `端口不能超过 65535：${s}`
    if (nums.length === 2 && nums[0]! > nums[1]!) return `范围起点不能大于终点：${s}`
  }
  return null
}

export function validateAddress(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  if (v.length > 512) return '太长了，考虑改用 IPSet'
  if (/\s/.test(v.replace(/,\s+/g, ','))) return '不能包含空格；多个地址用逗号分隔'
  return null
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]+$/

/** Alias, IPSet and security group names (at least two characters, starts with a letter). */
export function validateName(value: string): string | null {
  const v = value.trim()
  if (!v) return '必填'
  if (!NAME_RE.test(v)) return '以字母开头，只能包含字母、数字、- 和 _，至少 2 个字符'
  return null
}

export function validateRuleForm(form: RuleForm, opts: { iface: boolean; guest: boolean }): Record<string, string> {
  const errors: Record<string, string> = {}
  const values = ruleFormValues(form, opts)
  const sport = validatePorts(values.sport ?? '')
  if (sport) errors.sport = sport
  const dport = validatePorts(values.dport ?? '')
  if (dport) errors.dport = dport
  const source = validateAddress(values.source ?? '')
  if (source) errors.source = source
  const dest = validateAddress(values.dest ?? '')
  if (dest) errors.dest = dest
  if (opts.guest && values.iface && !/^net\d+$/.test(values.iface)) errors.iface = '客户机的接口要写网卡键名，例如 net0'
  if ((values.sport || values.dport) && !values.proto) errors.proto = '指定端口时需要选择协议（tcp 或 udp）'
  return errors
}

// ------------------------------------------------- security group rules

export interface GroupRuleForm {
  group: string
  iface: string
  enable: boolean
  comment: string
}

export function groupRuleParams(form: GroupRuleForm, opts: { iface: boolean }): Params {
  const params: Params = { type: 'group', action: form.group, enable: form.enable ? 1 : 0 }
  if (opts.iface && form.iface.trim()) params.iface = form.iface.trim()
  if (form.comment.trim()) params.comment = form.comment.trim()
  return params
}

export function updateGroupRuleParams(original: FirewallRule, form: GroupRuleForm, opts: { iface: boolean }): Params | null {
  const params: Params = {}
  const remove: string[] = []
  if (form.group !== original.action) params.action = form.group
  const pairs: [string, string, string][] = [
    ['iface', original.iface ?? '', opts.iface ? form.iface.trim() : original.iface ?? ''],
    ['comment', original.comment ?? '', form.comment.trim()],
  ]
  for (const [k, before, after] of pairs) {
    if (before === after) continue
    if (after) params[k] = after
    else remove.push(k)
  }
  if (!!original.enable !== form.enable) params.enable = form.enable ? 1 : 0
  if (remove.length) params.delete = remove.join(',')
  if (Object.keys(params).length === 0) return null
  params.digest = original.digest
  return params
}

// ------------------------------------------------------------ reorder

/**
 * PVE's moveto: the rule is taken out and inserted before the rule that was
 * at index `moveto` in the old list (moveto ≥ length appends). To land at
 * final index `to`, moving down needs to + 1.
 */
export function moveToParam(from: number, to: number): number {
  return to > from ? to + 1 : to
}

/** Optimistic reorder: the rule at `from` ends up at `to`; positions renumbered. */
export function reorderRules<T extends { pos: number }>(rules: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= rules.length) return [...rules]
  const next = [...rules]
  const [moved] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved!)
  return next.map((r, i) => ({ ...r, pos: i }))
}

/**
 * Stable React keys for rules (they have no id, and `pos` changes when they
 * move): the rule's content plus an occurrence counter for duplicates. Keeps
 * focus on a rule's drag handle while it moves with the keyboard.
 */
export function ruleKeys(rules: readonly FirewallRule[]): string[] {
  const seen = new Map<string, number>()
  return rules.map((r) => {
    const sig = [r.type, r.action, r.macro, r.iface, r.proto, r.source, r.dest, r.sport, r.dport, r['icmp-type'], r.log, r.comment].join('|')
    const n = seen.get(sig) ?? 0
    seen.set(sig, n + 1)
    return `${sig}#${n}`
  })
}

/** Final index when dropping onto row `target` (before or after it). */
export function dropIndex(from: number, target: number, after: boolean): number {
  let to = after ? target + 1 : target
  if (to > from) to -= 1
  return to
}

// -------------------------------------------------------------- refs

export interface RefOption {
  /** What goes into source/dest: "+dc/name" for IPSets, "dc/name" for aliases. */
  value: string
  name: string
  type: 'alias' | 'ipset'
  scope: string
  comment?: string
}

export const REF_SCOPE_LABEL: Record<string, string> = { dc: '数据中心', guest: '客户机', sdn: 'SDN' }

/** Refs as the official selector stores them (scoped). */
export function refOptions(refs: readonly FirewallRef[] | undefined, type?: 'alias' | 'ipset'): RefOption[] {
  return (refs ?? [])
    .filter((r) => !type || r.type === type)
    .map((r) => {
      const scope = r.scope ?? 'dc'
      const value = r.type === 'ipset' ? `+${scope}/${r.name}` : r.type === 'alias' ? `${scope}/${r.name}` : r.ref
      return { value, name: r.name, type: r.type, scope, comment: r.comment }
    })
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
}

// ------------------------------------------------------------ options

export type OptionKind = 'bool' | 'policy' | 'log' | 'int' | 'ratelimit' | 'helpers'

export interface OptionDef {
  key: string
  label: string
  kind: OptionKind
  /** Default as the official UI shows it ("1"/"0" for booleans). */
  default: string
  hint?: string
  min?: number
  max?: number
  /** Policies offered (forward: ACCEPT/DROP). */
  policies?: Policy[]
  /** Section heading. */
  section: string
}

const BASIC = '基本'
const LOGS = '日志'
const FILTER = '过滤'
const CONNTRACK = '连接跟踪'
const SYNFLOOD = 'SYN flood 保护'

const POLICY_IN: OptionDef = { key: 'policy_in', label: '入站策略', kind: 'policy', default: 'DROP', policies: ['ACCEPT', 'REJECT', 'DROP'], section: BASIC, hint: '没有规则匹配时对入站流量的处理' }
const POLICY_OUT: OptionDef = { key: 'policy_out', label: '出站策略', kind: 'policy', default: 'ACCEPT', policies: ['ACCEPT', 'REJECT', 'DROP'], section: BASIC, hint: '没有规则匹配时对出站流量的处理' }
const POLICY_FWD: OptionDef = { key: 'policy_forward', label: '转发策略', kind: 'policy', default: 'ACCEPT', policies: ['ACCEPT', 'DROP'], section: BASIC, hint: '仅 nftables 后端生效' }
const logRow = (key: string, label: string): OptionDef => ({ key, label, kind: 'log', default: 'nolog', section: LOGS })

export const NF_CONNTRACK_HELPERS = ['amanda', 'ftp', 'irc', 'netbios-ns', 'pptp', 'sane', 'sip', 'snmp', 'tftp'] as const

export function optionDefs(scope: FirewallScope): OptionDef[] {
  switch (scope.kind) {
    case 'dc':
      return [
        { key: 'enable', label: '防火墙', kind: 'bool', default: '0', section: BASIC, hint: '集群范围启用防火墙；默认入站策略会立即生效' },
        { key: 'ebtables', label: 'ebtables', kind: 'bool', default: '1', section: BASIC, hint: '集群范围启用 ebtables 规则（MAC 过滤等）' },
        POLICY_IN,
        POLICY_OUT,
        POLICY_FWD,
        { key: 'log_ratelimit', label: '日志限速', kind: 'ratelimit', default: 'enable=1,rate=1/second,burst=5', section: LOGS },
      ]
    case 'node':
      return [
        { key: 'enable', label: '防火墙', kind: 'bool', default: '1', section: BASIC, hint: '节点规则；数据中心级防火墙启用后才生效' },
        { key: 'nftables', label: 'nftables 后端（技术预览）', kind: 'bool', default: '0', section: BASIC, hint: '改用 proxmox-firewall；转发规则只在此后端生效' },
        { key: 'nosmurfs', label: 'SMURFS 过滤', kind: 'bool', default: '1', section: FILTER },
        { key: 'tcpflags', label: 'TCP flags 过滤', kind: 'bool', default: '0', section: FILTER, hint: '过滤非法的 TCP 标志组合' },
        { key: 'ndp', label: 'NDP', kind: 'bool', default: '1', section: FILTER, hint: 'IPv6 邻居发现' },
        { key: 'nf_conntrack_max', label: 'nf_conntrack_max', kind: 'int', default: '262144', min: 32768, section: CONNTRACK, hint: '最大跟踪连接数' },
        { key: 'nf_conntrack_tcp_timeout_established', label: 'established 超时', kind: 'int', default: '432000', min: 7875, section: CONNTRACK, hint: '秒' },
        { key: 'nf_conntrack_tcp_timeout_syn_recv', label: 'syn_recv 超时', kind: 'int', default: '60', min: 30, max: 60, section: CONNTRACK, hint: '秒（30–60）' },
        { key: 'nf_conntrack_allow_invalid', label: '允许无效包', kind: 'bool', default: '0', section: CONNTRACK, hint: '连接跟踪中标为 invalid 的包也放行' },
        { key: 'nf_conntrack_helpers', label: '连接跟踪 helper', kind: 'helpers', default: '', section: CONNTRACK, hint: '为这些协议启用 conntrack helper' },
        { key: 'log_nf_conntrack', label: '记录连接跟踪信息', kind: 'bool', default: '0', section: CONNTRACK },
        { key: 'protection_synflood', label: 'SYN flood 保护', kind: 'bool', default: '0', section: SYNFLOOD },
        { key: 'protection_synflood_rate', label: '速率', kind: 'int', default: '200', min: 1, section: SYNFLOOD, hint: '每个源 IP 每秒 SYN 数' },
        { key: 'protection_synflood_burst', label: '突发', kind: 'int', default: '1000', min: 1, section: SYNFLOOD, hint: '每个源 IP 的突发上限' },
        logRow('log_level_in', '入站日志级别'),
        logRow('log_level_out', '出站日志级别'),
        logRow('log_level_forward', '转发日志级别'),
        logRow('tcp_flags_log_level', 'TCP flags 日志级别'),
        logRow('smurf_log_level', 'SMURFS 日志级别'),
      ]
    case 'guest':
      return [
        { key: 'enable', label: '防火墙', kind: 'bool', default: '0', section: BASIC, hint: '网卡还需要勾选“防火墙”才会生效' },
        POLICY_IN,
        POLICY_OUT,
        { key: 'dhcp', label: 'DHCP', kind: 'bool', default: '1', section: FILTER, hint: '允许 DHCP 流量' },
        { key: 'ndp', label: 'NDP', kind: 'bool', default: '1', section: FILTER, hint: 'IPv6 邻居发现' },
        { key: 'radv', label: '路由通告', kind: 'bool', default: '0', section: FILTER, hint: '允许客户机发送 Router Advertisement' },
        { key: 'macfilter', label: 'MAC 过滤', kind: 'bool', default: '1', section: FILTER, hint: '只允许网卡自己的 MAC 地址发包' },
        { key: 'ipfilter', label: 'IP 过滤', kind: 'bool', default: '0', section: FILTER, hint: '只允许 ipfilter-netX 集合中的地址（容器自动包含配置的 IP）' },
        logRow('log_level_in', '入站日志级别'),
        logRow('log_level_out', '出站日志级别'),
      ]
    case 'vnet':
      return [
        { key: 'enable', label: '防火墙', kind: 'bool', default: '0', section: BASIC },
        POLICY_FWD,
        logRow('log_level_forward', '转发日志级别'),
      ]
    case 'group':
      return []
  }
}

/** The configured value as a string, or undefined when it is unset (default applies). */
export function optionValue(options: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = options?.[key]
  if (v === undefined || v === null || v === '') return undefined
  return String(v)
}

export function formatOption(def: OptionDef, value: string | undefined): string {
  const v = value ?? def.default
  switch (def.kind) {
    case 'bool':
      return v === '1' ? '开启' : '关闭'
    case 'policy':
      return `${v}（${ACTION_LABEL[v as Policy] ?? v}）`
    case 'log':
      return LOG_LEVEL_LABEL[v as LogLevel] ?? v
    case 'ratelimit': {
      const r = parseLogRatelimit(v)
      return r.enable ? `${r.rate}/${RATE_UNIT_LABEL[r.unit]}，突发 ${r.burst}` : '不限速'
    }
    case 'helpers':
      return v ? v.split(',').join('、') : '无'
    case 'int':
      return v
  }
}

// ------------------------------------------------------- log ratelimit

export type RateUnit = 'second' | 'minute' | 'hour' | 'day'
export const RATE_UNIT_LABEL: Record<RateUnit, string> = { second: '秒', minute: '分钟', hour: '小时', day: '天' }

export interface LogRatelimit {
  enable: boolean
  rate: number
  unit: RateUnit
  burst: number
}

/** "enable=1,rate=1/second,burst=5" (enable is the default key). */
export function parseLogRatelimit(value: string | undefined): LogRatelimit {
  const out: LogRatelimit = { enable: true, rate: 1, unit: 'second', burst: 5 }
  for (const part of (value ?? '').split(',')) {
    const s = part.trim()
    if (!s) continue
    const eq = s.indexOf('=')
    const [k, v] = eq < 0 ? ['enable', s] : [s.slice(0, eq), s.slice(eq + 1)]
    if (k === 'enable') out.enable = v !== '0'
    else if (k === 'burst' && /^\d+$/.test(v)) out.burst = Number(v)
    else if (k === 'rate') {
      const m = /^(\d+)(?:\/(second|minute|hour|day))?$/.exec(v)
      if (m) {
        out.rate = Number(m[1])
        out.unit = (m[2] as RateUnit | undefined) ?? 'second'
      }
    }
  }
  return out
}

export function stringifyLogRatelimit(r: LogRatelimit): string {
  return `enable=${r.enable ? 1 : 0},rate=${r.rate}/${r.unit},burst=${r.burst}`
}

// ------------------------------------------------------------ options save

/**
 * PUT params that set one option, or reset it to its default (delete).
 * Booleans are sent as 1/0.
 */
export function optionParams(key: string, value: string | boolean | undefined, digest: string | undefined): Params {
  if (value === undefined || value === '') return { delete: key, digest }
  return { [key]: typeof value === 'boolean' ? (value ? 1 : 0) : value, digest }
}

// --------------------------------------------------------- management access

export interface AccessCheck {
  web: boolean
  ssh: boolean
}

function portsInclude(spec: string | undefined, port: number, names: string[]): boolean {
  if (!spec) return false
  return spec.split(',').some((item) => {
    const s = item.trim().toLowerCase()
    if (names.includes(s)) return true
    const [a, b] = s.split(':').map(Number)
    if (a === undefined || Number.isNaN(a)) return false
    return b === undefined || Number.isNaN(b) ? a === port : a <= port && port <= b
  })
}

/**
 * Do enabled inbound ACCEPT rules open the web UI (8006) and SSH (22)?
 * A heuristic for the "enable firewall" confirmation: groups and the
 * automatic management/localnet rules are not evaluated.
 */
export function managementAccess(rules: readonly FirewallRule[] | undefined): AccessCheck {
  const out: AccessCheck = { web: false, ssh: false }
  for (const r of rules ?? []) {
    if (!r.enable || r.type !== 'in' || r.action !== 'ACCEPT') continue
    const anyTcp = !r.macro && (!r.proto || r.proto === 'tcp') && !r.dport
    if (anyTcp) {
      out.web = true
      out.ssh = true
      continue
    }
    if (r.macro === 'SSH') out.ssh = true
    if (!r.macro && (!r.proto || r.proto === 'tcp')) {
      if (portsInclude(r.dport, 8006, [])) out.web = true
      if (portsInclude(r.dport, 22, ['ssh'])) out.ssh = true
    }
  }
  return out
}

// ------------------------------------------------------------------ log

export interface ParsedLogLine {
  /** VMID, or 0 for the host. */
  vmid: number
  level: string
  chain: string
  time: string
  message: string
  verdict: 'ACCEPT' | 'DROP' | 'REJECT' | null
}

const LOG_LINE = /^(\d+) (\d+) (\S+) (\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4}) (.*)$/

/** "0 5 tap100i0-IN 01/Nov/2026:12:00:00 +0800 policy DROP: IN=…" → parts; null for other lines. */
export function parseLogLine(t: string): ParsedLogLine | null {
  const m = LOG_LINE.exec(t)
  if (!m) return null
  const message = m[5]!
  const verdict = /\b(ACCEPT|DROP|REJECT)\b/.exec(message)?.[1] as ParsedLogLine['verdict'] | undefined
  return { vmid: Number(m[1]), level: m[2]!, chain: m[3]!, time: m[4]!, message, verdict: verdict ?? null }
}

/** "2026-11-01T08:30" (datetime-local) → Unix seconds; undefined when empty/invalid. */
export function localToEpoch(value: string): number | undefined {
  if (!value) return undefined
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000)
}

/** Unix seconds → "2026-11-01T08:30" in local time (for datetime-local inputs). */
export function epochToLocal(epoch: number): string {
  const d = new Date(epoch * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------------------------------------------------------- picker data

export const ICMP_TYPES: { type: string; name: string }[] = [
  { type: 'any', name: 'any' },
  { type: '0', name: 'echo-reply' },
  { type: '3', name: 'destination-unreachable' },
  { type: '3/0', name: 'network-unreachable' },
  { type: '3/1', name: 'host-unreachable' },
  { type: '3/2', name: 'protocol-unreachable' },
  { type: '3/3', name: 'port-unreachable' },
  { type: '3/4', name: 'fragmentation-needed' },
  { type: '3/5', name: 'source-route-failed' },
  { type: '3/6', name: 'network-unknown' },
  { type: '3/7', name: 'host-unknown' },
  { type: '3/9', name: 'network-prohibited' },
  { type: '3/10', name: 'host-prohibited' },
  { type: '3/11', name: 'TOS-network-unreachable' },
  { type: '3/12', name: 'TOS-host-unreachable' },
  { type: '3/13', name: 'communication-prohibited' },
  { type: '3/14', name: 'host-precedence-violation' },
  { type: '3/15', name: 'precedence-cutoff' },
  { type: '4', name: 'source-quench' },
  { type: '5', name: 'redirect' },
  { type: '5/0', name: 'network-redirect' },
  { type: '5/1', name: 'host-redirect' },
  { type: '5/2', name: 'TOS-network-redirect' },
  { type: '5/3', name: 'TOS-host-redirect' },
  { type: '8', name: 'echo-request' },
  { type: '9', name: 'router-advertisement' },
  { type: '10', name: 'router-solicitation' },
  { type: '11', name: 'time-exceeded' },
  { type: '11/0', name: 'ttl-zero-during-transit' },
  { type: '11/1', name: 'ttl-zero-during-reassembly' },
  { type: '12', name: 'parameter-problem' },
  { type: '12/0', name: 'ip-header-bad' },
  { type: '12/1', name: 'required-option-missing' },
  { type: '13', name: 'timestamp-request' },
  { type: '14', name: 'timestamp-reply' },
  { type: '17', name: 'address-mask-request' },
  { type: '18', name: 'address-mask-reply' },
]

export const ICMPV6_TYPES: { type: string; name: string }[] = [
  { type: '1', name: 'destination-unreachable' },
  { type: '1/0', name: 'no-route' },
  { type: '1/1', name: 'communication-prohibited' },
  { type: '1/2', name: 'beyond-scope' },
  { type: '1/3', name: 'address-unreachable' },
  { type: '1/4', name: 'port-unreachable' },
  { type: '1/5', name: 'failed-policy' },
  { type: '1/6', name: 'reject-route' },
  { type: '2', name: 'packet-too-big' },
  { type: '3', name: 'time-exceeded' },
  { type: '3/0', name: 'ttl-zero-during-transit' },
  { type: '3/1', name: 'ttl-zero-during-reassembly' },
  { type: '4', name: 'parameter-problem' },
  { type: '4/0', name: 'bad-header' },
  { type: '4/1', name: 'unknown-header-type' },
  { type: '4/2', name: 'unknown-option' },
  { type: '128', name: 'echo-request' },
  { type: '129', name: 'echo-reply' },
  { type: '133', name: 'router-solicitation' },
  { type: '134', name: 'router-advertisement' },
  { type: '135', name: 'neighbour-solicitation' },
  { type: '136', name: 'neighbour-advertisement' },
  { type: '137', name: 'redirect' },
]

/** Protocols offered by the official selector (any /etc/protocols name or number is accepted). */
export const PROTOCOLS: { p: string; n: number; d: string }[] = [
  { p: 'tcp', n: 6, d: 'Transmission Control Protocol' },
  { p: 'udp', n: 17, d: 'User Datagram Protocol' },
  { p: 'icmp', n: 1, d: 'Internet Control Message Protocol' },
  { p: 'ipv6-icmp', n: 58, d: 'ICMP for IPv6' },
  { p: 'igmp', n: 2, d: 'Internet Group Management' },
  { p: 'ggp', n: 3, d: 'gateway-gateway protocol' },
  { p: 'ipencap', n: 4, d: 'IP encapsulated in IP' },
  { p: 'st', n: 5, d: 'ST datagram mode' },
  { p: 'egp', n: 8, d: 'exterior gateway protocol' },
  { p: 'igp', n: 9, d: 'any private interior gateway (Cisco)' },
  { p: 'pup', n: 12, d: 'PARC universal packet protocol' },
  { p: 'hmp', n: 20, d: 'host monitoring protocol' },
  { p: 'xns-idp', n: 22, d: 'Xerox NS IDP' },
  { p: 'rdp', n: 27, d: '"reliable datagram" protocol' },
  { p: 'iso-tp4', n: 29, d: 'ISO Transport Protocol class 4' },
  { p: 'dccp', n: 33, d: 'Datagram Congestion Control Prot.' },
  { p: 'xtp', n: 36, d: 'Xpress Transfer Protocol' },
  { p: 'ddp', n: 37, d: 'Datagram Delivery Protocol' },
  { p: 'idpr-cmtp', n: 38, d: 'IDPR Control Message Transport' },
  { p: 'ipv6', n: 41, d: 'Internet Protocol, version 6' },
  { p: 'ipv6-route', n: 43, d: 'Routing Header for IPv6' },
  { p: 'ipv6-frag', n: 44, d: 'Fragment Header for IPv6' },
  { p: 'idrp', n: 45, d: 'Inter-Domain Routing Protocol' },
  { p: 'rsvp', n: 46, d: 'Reservation Protocol' },
  { p: 'gre', n: 47, d: 'General Routing Encapsulation' },
  { p: 'esp', n: 50, d: 'Encap Security Payload' },
  { p: 'ah', n: 51, d: 'Authentication Header' },
  { p: 'skip', n: 57, d: 'SKIP' },
  { p: 'ipv6-nonxt', n: 59, d: 'No Next Header for IPv6' },
  { p: 'ipv6-opts', n: 60, d: 'Destination Options for IPv6' },
  { p: 'vmtp', n: 81, d: 'Versatile Message Transport' },
  { p: 'eigrp', n: 88, d: 'Enhanced Interior Routing Protocol (Cisco)' },
  { p: 'ospf', n: 89, d: 'Open Shortest Path First IGP' },
  { p: 'ax.25', n: 93, d: 'AX.25 frames' },
  { p: 'ipip', n: 94, d: 'IP-within-IP Encapsulation Protocol' },
  { p: 'etherip', n: 97, d: 'Ethernet-within-IP Encapsulation' },
  { p: 'encap', n: 98, d: 'Yet Another IP encapsulation' },
  { p: 'pim', n: 103, d: 'Protocol Independent Multicast' },
  { p: 'ipcomp', n: 108, d: 'IP Payload Compression Protocol' },
  { p: 'vrrp', n: 112, d: 'Virtual Router Redundancy Protocol' },
  { p: 'l2tp', n: 115, d: 'Layer Two Tunneling Protocol' },
  { p: 'isis', n: 124, d: 'IS-IS over IPv4' },
  { p: 'sctp', n: 132, d: 'Stream Control Transmission Protocol' },
  { p: 'fc', n: 133, d: 'Fibre Channel' },
  { p: 'mobility-header', n: 135, d: 'Mobility Support for IPv6' },
  { p: 'udplite', n: 136, d: 'UDP-Lite' },
  { p: 'mpls-in-ip', n: 137, d: 'MPLS-in-IP' },
  { p: 'hip', n: 139, d: 'Host Identity Protocol' },
  { p: 'shim6', n: 140, d: 'Shim6 Protocol' },
  { p: 'wesp', n: 141, d: 'Wrapped Encapsulating Security Payload' },
  { p: 'rohc', n: 142, d: 'Robust Header Compression' },
]
