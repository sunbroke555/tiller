// Pure logic of the notifications / metric servers section: labels, the
// per-type target and metric-server forms (form → API params, like the
// official edit panels), and the matcher rule list (match-field /
// match-severity / match-calendar ↔ rules).

import type { Params } from '@/api/client'
import type {
  MetricServer,
  MetricType,
  NotificationEndpoint,
  NotificationMatcher,
  Origin,
  TargetType,
} from '@/api/notifications-metrics'
import { parsePropertyString } from '@/lib/propstring'

// ------------------------------------------------------------------ shared

export const asList = (v: string[] | string | undefined | null): string[] =>
  v == null ? [] : (Array.isArray(v) ? v : v.split(/[\n]/)).map((s) => s.trim()).filter(Boolean)

export const isOn = (v: unknown): boolean => v === 1 || v === '1' || v === true

/** Proxmox.Utils.safeIdRegex. */
export const SAFE_ID = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/

export function nameError(name: string): string | undefined {
  const n = name.trim()
  if (!n) return '必填'
  if (!SAFE_ID.test(n)) return '只能用字母、数字、_ . -，且不能以 . 或 - 开头'
  return undefined
}

export const ORIGIN_LABEL: Record<Origin, string> = {
  'user-created': '自定义',
  builtin: '内置',
  'modified-builtin': '内置（已修改）',
}

export const isBuiltin = (origin: Origin | undefined) => origin === 'builtin' || origin === 'modified-builtin'

/** UTF-8 → base64 (webhook body, header and secret values; OTel JSON). */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function base64ToUtf8(b64: string): string {
  try {
    const bin = atob(b64)
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch {
    return b64
  }
}

type Errors = Partial<Record<string, string>>

/** Collects params of an update: set values, and `delete` for emptied optional keys. */
class ParamBuilder {
  readonly params: Params = {}
  private readonly deletes: string[] = []
  constructor(private readonly create: boolean) {}
  /** Optional value: sent when set; on update an empty value deletes the key. */
  opt(key: string, value: string | number | undefined | null | readonly string[]) {
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
    if (!empty) this.params[key] = value as Params[string]
    else if (!this.create) this.deletes.push(key)
  }
  set(key: string, value: Params[string]) {
    this.params[key] = value
  }
  del(key: string) {
    if (!this.create) this.deletes.push(key)
  }
  /** disable=1, or on update delete=disable when enabled (like the official panels). */
  enable(on: boolean) {
    if (!on) this.params.disable = 1
    else this.del('disable')
  }
  done(deleteAsString: boolean): Params {
    if (this.deletes.length) this.params.delete = deleteAsString ? this.deletes.join(',') : [...this.deletes]
    return this.params
  }
}

// ------------------------------------------------------------------ targets

export const TARGET_INFO: Record<TargetType, { label: string; description: string }> = {
  sendmail: { label: 'Sendmail', description: '用本机的 sendmail 发邮件（需要节点能投递邮件）' },
  smtp: { label: 'SMTP', description: '直接连 SMTP 服务器发邮件，支持 TLS / STARTTLS 和认证' },
  gotify: { label: 'Gotify', description: '推送到自建的 Gotify 服务器' },
  webhook: { label: 'Webhook', description: '按模板向任意 HTTP 地址发请求（Slack、Discord、ntfy…）' },
}

export const SMTP_MODES = [
  { value: 'tls', label: 'TLS', port: 465 },
  { value: 'starttls', label: 'STARTTLS', port: 587 },
  { value: 'insecure', label: '不加密（不安全）', port: 25 },
] as const
export type SmtpMode = (typeof SMTP_MODES)[number]['value']
export const smtpDefaultPort = (mode: SmtpMode) => SMTP_MODES.find((m) => m.value === mode)!.port

export const WEBHOOK_METHODS = ['post', 'put', 'get'] as const
export type WebhookMethod = (typeof WEBHOOK_METHODS)[number]

export const DEFAULT_MAIL_AUTHOR = 'Proxmox VE'

/** One header or secret row. Secrets of a saved target come back without value (`stored`). */
export interface KeyValue {
  name: string
  value: string
  /** Existing secret: an empty value keeps the stored one. */
  stored?: boolean
}

export interface TargetForm {
  type: TargetType
  name: string
  enable: boolean
  comment: string
  // sendmail / smtp
  mailtoUser: string[]
  mailto: string
  author: string
  fromAddress: string
  // smtp / gotify
  server: string
  // smtp
  mode: SmtpMode
  port: number | undefined
  auth: boolean
  /** The saved target had authentication (password then may stay empty = unchanged). */
  hadAuth: boolean
  username: string
  password: string
  // gotify
  token: string
  // webhook
  method: WebhookMethod
  url: string
  headers: KeyValue[]
  body: string
  secrets: KeyValue[]
}

function parseKv(list: string[] | string | undefined, secret: boolean): KeyValue[] {
  return asList(list).map((item) => {
    const props = parsePropertyString(item)
    const name = String(props.name ?? '')
    if (secret) return { name, value: '', stored: true }
    return { name, value: props.value ? base64ToUtf8(String(props.value)) : '' }
  })
}

export function initialTargetForm(type: TargetType, e?: NotificationEndpoint): TargetForm {
  return {
    type,
    name: e?.name ?? '',
    enable: !isOn(e?.disable),
    comment: e?.comment ?? '',
    mailtoUser: asList(e?.['mailto-user']),
    mailto: asList(e?.mailto).join(', '),
    author: e?.author ?? '',
    fromAddress: e?.['from-address'] ?? '',
    server: e?.server ?? '',
    mode: e?.mode ?? 'tls',
    port: e?.port,
    auth: e ? !!e.username : true,
    hadAuth: !!e?.username,
    username: e?.username ?? '',
    password: '',
    token: '',
    method: e?.method ?? 'post',
    url: e?.url ?? '',
    headers: parseKv(e?.header, false),
    body: e?.body ? base64ToUtf8(e.body) : '',
    secrets: parseKv(e?.secret, true),
  }
}

export const splitMailto = (s: string) => s.split(/[\s,;]+/).filter(Boolean)

const HTTP_URL = /^https?:\/\/\S+$/i

export function validateTarget(f: TargetForm, create: boolean): Errors {
  const e: Errors = {}
  if (create) {
    const n = nameError(f.name)
    if (n) e.name = n
  }
  if (f.type === 'sendmail' || f.type === 'smtp') {
    if (!f.mailtoUser.length && !splitMailto(f.mailto).length) e.mailto = '至少选一个用户或填一个邮箱地址'
  }
  if (f.type === 'smtp') {
    if (!f.server.trim()) e.server = '必填'
    if (!f.fromAddress.trim()) e['from-address'] = '必填'
    if (f.port !== undefined && (f.port < 1 || f.port > 65535)) e.port = '1–65535'
    if (f.auth) {
      if (!f.username.trim()) e.username = '必填'
      if (!f.password && (create || !f.hadAuth)) e.password = '必填'
    }
  }
  if (f.type === 'gotify') {
    if (!f.server.trim()) e.server = '必填'
    if (create && !f.token) e.token = '必填'
  }
  if (f.type === 'webhook') {
    if (!f.url.trim()) e.url = '必填'
    // Templates ({{ secrets.x }}) may contain spaces.
    else if (!HTTP_URL.test(f.url.trim().replace(/\{\{[^}]*\}\}/g, 'x'))) e.url = '需要 http:// 或 https:// 开头的地址'
    if (f.headers.some((h) => !h.name.trim() || !h.value)) e.header = '名称和值都不能为空'
    if (f.secrets.some((s) => !s.name.trim() || (!s.value && !s.stored))) e.secret = '名称和值都不能为空'
  }
  return e
}

const kvParam = (list: KeyValue[]) =>
  list.map((kv) => (kv.value ? `name=${kv.name.trim()},value=${utf8ToBase64(kv.value)}` : `name=${kv.name.trim()}`))

/** POST/PUT params of a target (arrays are sent as repeated keys; `delete` is an array). */
export function targetParams(f: TargetForm, create: boolean, digest?: string): Params {
  const b = new ParamBuilder(create)
  if (create) b.set('name', f.name.trim())
  b.enable(f.enable)
  b.opt('comment', f.comment.trim())
  if (f.type === 'sendmail' || f.type === 'smtp') {
    b.opt('mailto-user', f.mailtoUser)
    b.opt('mailto', splitMailto(f.mailto))
    b.opt('author', f.author.trim())
    if (f.type === 'sendmail') b.opt('from-address', f.fromAddress.trim())
    else b.set('from-address', f.fromAddress.trim())
  }
  if (f.type === 'smtp') {
    b.set('server', f.server.trim())
    b.set('mode', f.mode)
    b.opt('port', f.port)
    if (f.auth) {
      b.set('username', f.username.trim())
      if (f.password) b.set('password', f.password)
    } else {
      b.del('username')
      b.del('password')
    }
  }
  if (f.type === 'gotify') {
    b.set('server', f.server.trim())
    if (f.token) b.set('token', f.token)
  }
  if (f.type === 'webhook') {
    b.set('method', f.method)
    b.set('url', f.url.trim())
    b.opt('header', kvParam(f.headers))
    b.opt('body', f.body ? utf8ToBase64(f.body) : '')
    b.opt('secret', kvParam(f.secrets))
  }
  if (!create && digest) b.set('digest', digest)
  return b.done(false)
}

/** One line under the target's name: recipients, server or URL. */
export function targetSummary(type: string, e: NotificationEndpoint | undefined): string {
  if (!e) return ''
  switch (type) {
    case 'sendmail':
    case 'smtp': {
      const to = [...asList(e['mailto-user']), ...asList(e.mailto)].join(', ')
      if (type === 'sendmail') return to
      const port = e.port ?? smtpDefaultPort(e.mode ?? 'tls')
      return [`${e.server ?? ''}:${port}`, to].filter(Boolean).join(' → ')
    }
    case 'gotify':
      return e.server ?? ''
    case 'webhook':
      return `${(e.method ?? 'post').toUpperCase()} ${e.url ?? ''}`
    default:
      return ''
  }
}

/** Webhook body templates (handlebars). */
export const WEBHOOK_TEMPLATE_VARS = [
  ['{{ title }}', '标题'],
  ['{{ message }}', '正文'],
  ['{{ severity }}', '严重级别'],
  ['{{ timestamp }}', '时间戳'],
  ['{{ fields.<名称> }}', '元数据字段，如 fields.type、fields.hostname'],
  ['{{ secrets.<名称> }}', '下方的机密值'],
  ['{{ json <值> }}', '转成 JSON（如 {{ json fields }}）'],
  ['{{ escape <值> }}', '按 JSON 字符串转义'],
  ['{{ url-encode <值> }}', 'URL 编码'],
] as const

export const WEBHOOK_BODY_EXAMPLE = `{
  "title": "{{ escape title }}",
  "message": "{{ escape message }}",
  "severity": "{{ severity }}",
  "fields": {{ json fields }}
}`

// ------------------------------------------------------------------ matchers

export const SEVERITIES = ['info', 'notice', 'warning', 'error', 'unknown'] as const
export type Severity = (typeof SEVERITIES)[number]
export const SEVERITY_LABEL: Record<Severity, string> = {
  info: '信息',
  notice: '提示',
  warning: '警告',
  error: '错误',
  unknown: '未知',
}
export const severityLabel = (s: string) => SEVERITY_LABEL[s as Severity] ?? s

export const FIELD_LABEL: Record<string, string> = {
  type: '通知类型',
  hostname: '主机名',
  'job-id': '任务 ID',
}
export const fieldLabel = (f: string) => FIELD_LABEL[f] ?? f

export const FIELD_VALUE_LABEL: Record<string, string> = {
  'package-updates': '有可用的软件包更新',
  vzdump: '备份',
  replication: '存储复制',
  fencing: '节点隔离',
  'system-mail': '转发给本机 root 的系统邮件',
}

export const CALENDAR_EXAMPLES = ['mon..fri 8-17', 'mon 8-12', 'tue..fri,sun 0:00-23:59', 'sat,sun'] as const

/** "Match if" of the official rule tree root: mode + invert-match. */
export const MATCH_MODES = [
  { value: 'all', label: '全部规则都满足' },
  { value: 'any', label: '任一规则满足' },
  { value: 'notall', label: '至少一条规则不满足' },
  { value: 'notany', label: '没有规则满足' },
] as const
export type MatchMode = (typeof MATCH_MODES)[number]['value']

export type RuleKind = 'field' | 'severity' | 'calendar'
export const RULE_KIND_LABEL: Record<RuleKind, string> = { field: '匹配字段', severity: '匹配严重级别', calendar: '匹配时间' }

export interface MatchRule {
  kind: RuleKind
  /** field: exact (one of `values`) or regex (`regex`). */
  fieldMode: 'exact' | 'regex'
  field: string
  values: string[]
  regex: string
  severities: string[]
  calendar: string
}

export const newRule = (kind: RuleKind): MatchRule => ({
  kind,
  fieldMode: 'exact',
  field: '',
  values: [],
  regex: '',
  // Like the official tree: a new severity rule starts with every level.
  severities: kind === 'severity' ? [...SEVERITIES] : [],
  calendar: '',
})

/** Switch a rule's field mode the official way: exact values → "^(a|b)$". */
export function switchFieldMode(r: MatchRule, mode: 'exact' | 'regex'): MatchRule {
  if (mode === r.fieldMode) return r
  if (mode === 'regex') return { ...r, fieldMode: 'regex', regex: r.values.length ? `^(${r.values.join('|')})$` : '^$', values: [] }
  return { ...r, fieldMode: 'exact', regex: '', values: [] }
}

const FIELD_RE = /^(?:(regex|exact):)?([A-Za-z0-9_][A-Za-z0-9._-]*)=(.+)$/

export function parseMatchField(stmt: string): MatchRule {
  const m = FIELD_RE.exec(stmt.trim())
  if (!m) return { ...newRule('field'), fieldMode: 'regex', regex: stmt }
  const [, type = 'exact', field = '', value = ''] = m
  if (type === 'regex') return { ...newRule('field'), fieldMode: 'regex', field, regex: value }
  return { ...newRule('field'), field, values: value.split(',').map((v) => v.trim()).filter(Boolean) }
}

export interface MatcherForm {
  name: string
  enable: boolean
  comment: string
  mode: MatchMode
  rules: MatchRule[]
  targets: string[]
}

export function initialMatcherForm(m?: NotificationMatcher): MatcherForm {
  const invert = isOn(m?.['invert-match'])
  const mode = m?.mode ?? 'all'
  return {
    name: m?.name ?? '',
    enable: !isOn(m?.disable),
    comment: m?.comment ?? '',
    mode: invert ? (mode === 'all' ? 'notall' : 'notany') : mode,
    rules: [
      ...asList(m?.['match-field']).map(parseMatchField),
      ...asList(m?.['match-severity']).map((s) => ({ ...newRule('severity'), severities: s.split(',').map((x) => x.trim()).filter(Boolean) })),
      ...asList(m?.['match-calendar']).map((c) => ({ ...newRule('calendar'), calendar: c })),
    ],
    targets: asList(m?.target),
  }
}

export function ruleError(r: MatchRule): string | undefined {
  switch (r.kind) {
    case 'field':
      if (!r.field.trim()) return '选择字段'
      if (!/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(r.field.trim())) return '字段名无效'
      if (r.fieldMode === 'exact' && !r.values.length) return '至少选一个值'
      if (r.fieldMode === 'regex') {
        if (!r.regex) return '填写正则表达式'
        try {
          new RegExp(r.regex)
        } catch {
          return '正则表达式无效'
        }
      }
      return undefined
    case 'severity':
      return r.severities.length ? undefined : '至少选一个级别'
    case 'calendar':
      return r.calendar.trim() ? undefined : '填写时间范围'
  }
}

/** match-field / match-severity / match-calendar statements of the rules. */
export function ruleStatements(rules: readonly MatchRule[]) {
  const field: string[] = []
  const severity: string[] = []
  const calendar: string[] = []
  for (const r of rules) {
    if (r.kind === 'field') {
      const value = r.fieldMode === 'regex' ? r.regex : r.values.join(',')
      field.push(`${r.fieldMode}:${r.field.trim()}=${value}`)
    } else if (r.kind === 'severity') {
      const known = SEVERITIES.filter((s) => r.severities.includes(s))
      const other = r.severities.filter((s) => !(SEVERITIES as readonly string[]).includes(s))
      severity.push([...known, ...other].join(','))
    } else {
      calendar.push(r.calendar.trim())
    }
  }
  return { field, severity, calendar }
}

export function validateMatcher(f: MatcherForm, create: boolean): Errors {
  const e: Errors = {}
  if (create) {
    const n = nameError(f.name)
    if (n) e.name = n
  }
  f.rules.forEach((r, i) => {
    const err = ruleError(r)
    if (err) e[`rule${i}`] = err
  })
  if (f.rules.some((r) => ruleError(r))) e.rules = '有规则没填完整'
  if (!f.targets.length) e.target = '至少选一个通知目标'
  return e
}

export function matcherParams(f: MatcherForm, create: boolean, digest?: string): Params {
  const b = new ParamBuilder(create)
  if (create) b.set('name', f.name.trim())
  b.enable(f.enable)
  b.opt('comment', f.comment.trim())
  const invert = f.mode === 'notall' || f.mode === 'notany'
  b.set('mode', f.mode === 'any' || f.mode === 'notany' ? 'any' : 'all')
  if (invert) b.set('invert-match', 1)
  else b.del('invert-match')
  const s = ruleStatements(f.rules)
  b.opt('match-field', s.field)
  b.opt('match-severity', s.severity)
  b.opt('match-calendar', s.calendar)
  b.set('target', [...f.targets])
  if (!create && digest) b.set('digest', digest)
  return b.done(false)
}

/** Plain-language description of one rule. */
export function describeRule(r: MatchRule): string {
  switch (r.kind) {
    case 'field': {
      const name = r.field ? fieldLabel(r.field) : '（未选字段）'
      if (r.fieldMode === 'regex') return `${name} 匹配正则 ${r.regex || '…'}`
      return `${name} 是 ${r.values.length ? r.values.map((v) => FIELD_VALUE_LABEL[v] ?? v).join(' 或 ') : '…'}`
    }
    case 'severity':
      return `级别是 ${r.severities.length ? r.severities.map(severityLabel).join('、') : '…'}`
    case 'calendar':
      return `时间在 ${r.calendar || '…'}`
  }
}

/** Short summary of a matcher for the list. */
export function describeMatcher(m: NotificationMatcher): string {
  const f = initialMatcherForm(m)
  if (!f.rules.length) return f.mode === 'notall' || f.mode === 'notany' ? '不匹配任何通知' : '匹配所有通知'
  const joiner = f.mode === 'any' || f.mode === 'notany' ? ' 或 ' : ' 且 '
  const text = f.rules.map(describeRule).join(joiner)
  return f.mode === 'notall' || f.mode === 'notany' ? `排除：${text}` : text
}

// ------------------------------------------------------------------ metric servers

export const METRIC_INFO: Record<MetricType, { label: string; description: string; port: number }> = {
  graphite: { label: 'Graphite', description: 'Carbon 协议，UDP 或 TCP', port: 2003 },
  influxdb: { label: 'InfluxDB', description: 'UDP（行协议）或 HTTP(S) v2 API，支持 org / bucket / token', port: 8089 },
  opentelemetry: { label: 'OpenTelemetry', description: 'OTLP/HTTP 推送到 OpenTelemetry Collector', port: 4318 },
}

export const metricTypeLabel = (t: string) => METRIC_INFO[t as MetricType]?.label ?? t

export interface MetricForm {
  type: MetricType
  id: string
  enable: boolean
  server: string
  port: number | undefined
  mtu: number | undefined
  timeout: number | undefined
  // graphite
  path: string
  proto: 'udp' | 'tcp'
  // influxdb
  influxdbproto: 'udp' | 'http' | 'https'
  organization: string
  bucket: string
  token: string
  apiPathPrefix: string
  maxBodySize: number | undefined
  verifyCertificate: boolean
  // opentelemetry
  otelProtocol: 'http' | 'https'
  otelPath: string
  otelTimeout: number | undefined
  otelVerifySsl: boolean
  otelMaxBodySize: number | undefined
  otelCompression: 'gzip' | 'none'
  otelHeaders: string
  otelResourceAttributes: string
}

export function initialMetricForm(type: MetricType, s?: MetricServer): MetricForm {
  return {
    type,
    id: s?.id ?? '',
    enable: !isOn(s?.disable),
    server: s?.server ?? '',
    port: s?.port ?? METRIC_INFO[type].port,
    mtu: s?.mtu,
    timeout: s?.timeout,
    path: s?.path ?? '',
    proto: s?.proto ?? 'udp',
    influxdbproto: s?.influxdbproto ?? 'udp',
    organization: s?.organization ?? '',
    bucket: s?.bucket ?? '',
    token: '',
    apiPathPrefix: s?.['api-path-prefix'] ?? '',
    maxBodySize: s?.['max-body-size'],
    verifyCertificate: s?.['verify-certificate'] === undefined ? true : isOn(s['verify-certificate']),
    otelProtocol: s?.['otel-protocol'] ?? 'https',
    otelPath: s?.['otel-path'] ?? '/v1/metrics',
    otelTimeout: s?.['otel-timeout'] ?? 5,
    otelVerifySsl: s?.['otel-verify-ssl'] === undefined ? true : isOn(s['otel-verify-ssl']),
    otelMaxBodySize: s?.['otel-max-body-size'] ?? 10_000_000,
    otelCompression: s?.['otel-compression'] ?? 'gzip',
    otelHeaders: s?.['otel-headers'] ? prettyJson(base64ToUtf8(s['otel-headers'])) : '',
    otelResourceAttributes: s?.['otel-resource-attributes'] ? prettyJson(base64ToUtf8(s['otel-resource-attributes'])) : '',
  }
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function jsonError(text: string): string | undefined {
  if (!text.trim()) return undefined
  try {
    const v: unknown = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? undefined : '需要一个 JSON 对象'
  } catch {
    return 'JSON 格式不正确'
  }
}

export const influxHttp = (f: MetricForm) => f.type === 'influxdb' && f.influxdbproto !== 'udp'

export function validateMetric(f: MetricForm, create: boolean): Errors {
  const e: Errors = {}
  if (create) {
    const n = nameError(f.id)
    if (n) e.id = n
  }
  if (!f.server.trim()) e.server = '必填'
  if (f.port === undefined) e.port = '必填'
  else if (f.port < 1 || f.port > 65535) e.port = '1–65535'
  if (f.mtu !== undefined && (f.mtu < 512 || f.mtu > 65536)) e.mtu = '512–65536'
  if (f.type === 'opentelemetry') {
    if (!f.otelPath.trim()) e['otel-path'] = '必填'
    if (f.otelTimeout === undefined || f.otelTimeout < 1 || f.otelTimeout > 10) e['otel-timeout'] = '1–10 秒'
    if (f.otelMaxBodySize === undefined || f.otelMaxBodySize < 1024) e['otel-max-body-size'] = '至少 1024'
    const h = jsonError(f.otelHeaders)
    if (h) e['otel-headers'] = h
    const r = jsonError(f.otelResourceAttributes)
    if (r) e['otel-resource-attributes'] = r
  }
  return e
}

/**
 * POST/PUT params of a metric server. Only the fields that apply to the
 * chosen protocol are sent (like the official dialog, which disables the
 * others); `delete` is a comma list here.
 */
export function metricParams(f: MetricForm, create: boolean, digest?: string): Params {
  const b = new ParamBuilder(create)
  if (create) b.set('type', f.type)
  b.set('server', f.server.trim())
  b.set('port', f.port ?? METRIC_INFO[f.type].port)
  b.set('disable', f.enable ? 0 : 1)
  if (f.type === 'graphite') {
    b.opt('path', f.path.trim())
    if (f.proto === 'tcp') {
      b.set('proto', 'tcp')
      b.opt('timeout', f.timeout)
    } else {
      b.del('proto')
      b.opt('mtu', f.mtu)
    }
  } else if (f.type === 'influxdb') {
    if (f.influxdbproto === 'udp') {
      b.del('influxdbproto')
      b.opt('mtu', f.mtu)
    } else {
      b.set('influxdbproto', f.influxdbproto)
      b.opt('organization', f.organization.trim())
      b.opt('bucket', f.bucket.trim())
      if (f.token) b.set('token', f.token)
      b.opt('api-path-prefix', f.apiPathPrefix.trim())
      b.opt('timeout', f.timeout)
      b.opt('max-body-size', f.maxBodySize)
      if (f.influxdbproto === 'https') {
        if (f.verifyCertificate) b.del('verify-certificate')
        else b.set('verify-certificate', 0)
      }
    }
  } else {
    b.set('otel-protocol', f.otelProtocol)
    b.set('otel-path', f.otelPath.trim())
    b.set('otel-timeout', f.otelTimeout ?? 5)
    b.set('otel-verify-ssl', f.otelVerifySsl ? 1 : 0)
    b.set('otel-max-body-size', f.otelMaxBodySize ?? 10_000_000)
    b.set('otel-compression', f.otelCompression)
    b.opt('otel-headers', f.otelHeaders.trim() ? utf8ToBase64(JSON.stringify(JSON.parse(f.otelHeaders))) : '')
    b.opt('otel-resource-attributes', f.otelResourceAttributes.trim() ? utf8ToBase64(JSON.stringify(JSON.parse(f.otelResourceAttributes))) : '')
  }
  if (!create && digest) b.set('digest', digest)
  return b.done(true)
}

/** Enable / disable from the list (PUT needs server and port). */
export function metricToggleParams(s: MetricServer, enable: boolean): Params {
  return { server: s.server, port: s.port, disable: enable ? 0 : 1, ...(s.digest ? { digest: s.digest } : {}) }
}

/** "UDP", "HTTPS", "TCP"… */
export function metricProtocol(s: MetricServer): string {
  if (s.type === 'graphite') return (s.proto ?? 'udp').toUpperCase()
  if (s.type === 'influxdb') return (s.influxdbproto ?? 'udp').toUpperCase()
  if (s.type === 'opentelemetry') return (s['otel-protocol'] ?? 'https').toUpperCase()
  return ''
}
