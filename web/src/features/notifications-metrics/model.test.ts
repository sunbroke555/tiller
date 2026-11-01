import { describe, expect, it } from 'vitest'

import type { MetricServer, NotificationEndpoint, NotificationMatcher } from '@/api/notifications-metrics'

import {
  base64ToUtf8,
  describeMatcher,
  initialMatcherForm,
  initialMetricForm,
  initialTargetForm,
  matcherParams,
  metricParams,
  metricToggleParams,
  newRule,
  parseMatchField,
  switchFieldMode,
  targetParams,
  targetSummary,
  utf8ToBase64,
  validateMatcher,
  validateMetric,
  validateTarget,
  type MatcherForm,
  type MetricForm,
  type TargetForm,
} from './model'

const target = (type: TargetForm['type'], patch: Partial<TargetForm> = {}): TargetForm => ({ ...initialTargetForm(type), ...patch })

describe('base64', () => {
  it('round-trips UTF-8', () => {
    expect(utf8ToBase64('Bearer 令牌')).toBe('QmVhcmVyIOS7pOeJjA==')
    expect(base64ToUtf8('QmVhcmVyIOS7pOeJjA==')).toBe('Bearer 令牌')
  })
})

describe('target params per type', () => {
  it('sendmail: users + split addresses, optional author / from', () => {
    const f = target('sendmail', { name: 'e2e-nm-mail', mailtoUser: ['root@pam'], mailto: 'a@x.invalid, b@x.invalid;c@x.invalid', author: 'Lab' })
    expect(targetParams(f, true)).toEqual({
      name: 'e2e-nm-mail',
      'mailto-user': ['root@pam'],
      mailto: ['a@x.invalid', 'b@x.invalid', 'c@x.invalid'],
      author: 'Lab',
    })
  })

  it('sendmail update: disabled, emptied fields deleted, digest', () => {
    const before: NotificationEndpoint = { name: 'm', mailto: ['a@x.invalid'], author: 'A', comment: 'c', digest: 'd1' }
    const f = { ...initialTargetForm('sendmail', before), enable: false, author: '', comment: '' }
    expect(targetParams(f, false, 'd1')).toEqual({
      disable: 1,
      mailto: ['a@x.invalid'],
      digest: 'd1',
      delete: ['comment', 'mailto-user', 'author', 'from-address'],
    })
  })

  it('smtp: server, mode, port, auth', () => {
    const f = target('smtp', {
      name: 's',
      server: '127.0.0.1',
      mode: 'starttls',
      port: 2525,
      username: 'u',
      password: 'p',
      fromAddress: 'pve@x.invalid',
      mailto: 'ops@x.invalid',
    })
    expect(targetParams(f, true)).toEqual({
      name: 's',
      mailto: ['ops@x.invalid'],
      'from-address': 'pve@x.invalid',
      server: '127.0.0.1',
      mode: 'starttls',
      port: 2525,
      username: 'u',
      password: 'p',
    })
  })

  it('smtp update: auth off deletes username/password; unchanged password is not sent', () => {
    const before: NotificationEndpoint = { name: 's', server: 'h', mode: 'tls', username: 'u', 'from-address': 'f@x', mailto: ['a@x'] }
    const keep = initialTargetForm('smtp', before)
    expect(keep.auth).toBe(true)
    expect(targetParams(keep, false).password).toBeUndefined()
    expect(validateTarget(keep, false)).toEqual({})
    const off = { ...keep, auth: false }
    expect(targetParams(off, false).delete).toEqual(expect.arrayContaining(['username', 'password', 'port']))
  })

  it('smtp validation: from, server, password when enabling auth', () => {
    const f = target('smtp', { name: 's', auth: true, username: 'u' })
    expect(validateTarget(f, true)).toMatchObject({ server: '必填', 'from-address': '必填', password: '必填', mailto: expect.any(String) })
  })

  it('gotify: token only when typed', () => {
    expect(targetParams(target('gotify', { name: 'g', server: 'http://127.0.0.1:1', token: 't' }), true)).toEqual({ name: 'g', server: 'http://127.0.0.1:1', token: 't' })
    const edit = initialTargetForm('gotify', { name: 'g', server: 'http://h' })
    expect(targetParams(edit, false)).toEqual({ server: 'http://h', delete: ['disable', 'comment'] })
    expect(validateTarget(target('gotify', { name: 'g', server: 'x' }), true).token).toBe('必填')
  })

  it('webhook: method, url, base64 headers / body / secrets', () => {
    const f = target('webhook', {
      name: 'w',
      method: 'put',
      url: 'http://127.0.0.1:9/{{ secrets.path }}',
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      body: '{"t":"{{ title }}"}',
      secrets: [{ name: 'path', value: 'abc' }],
    })
    expect(targetParams(f, true)).toEqual({
      name: 'w',
      method: 'put',
      url: 'http://127.0.0.1:9/{{ secrets.path }}',
      header: [`name=Content-Type,value=${utf8ToBase64('application/json')}`],
      body: utf8ToBase64('{"t":"{{ title }}"}'),
      secret: [`name=path,value=${utf8ToBase64('abc')}`],
    })
  })

  it('webhook edit: stored secrets keep their value; removed headers / body deleted', () => {
    const before: NotificationEndpoint = {
      name: 'w',
      method: 'post',
      url: 'https://h/x',
      header: [`name=X-A,value=${utf8ToBase64('1')}`],
      secret: ['name=token'],
      body: utf8ToBase64('hi'),
    }
    const f = initialTargetForm('webhook', before)
    expect(f.headers).toEqual([{ name: 'X-A', value: '1' }])
    expect(f.secrets).toEqual([{ name: 'token', value: '', stored: true }])
    expect(f.body).toBe('hi')
    expect(validateTarget(f, false)).toEqual({})
    const p = targetParams({ ...f, headers: [], body: '' }, false)
    expect(p.secret).toEqual(['name=token'])
    expect(p.delete).toEqual(expect.arrayContaining(['header', 'body']))
  })

  it('webhook validation', () => {
    const f = target('webhook', { name: 'w', url: 'ftp://x', secrets: [{ name: 'k', value: '' }] })
    expect(validateTarget(f, true)).toMatchObject({ url: expect.any(String), secret: expect.any(String) })
    expect(validateTarget(target('webhook', { name: '-bad', url: 'http://x' }), true).name).toBeTruthy()
  })

  it('summary', () => {
    expect(targetSummary('sendmail', { name: 'mail-to-root', 'mailto-user': ['root@pam'] })).toBe('root@pam')
    expect(targetSummary('smtp', { name: 's', server: 'h', mode: 'starttls', mailto: ['a@x'] })).toBe('h:587 → a@x')
    expect(targetSummary('webhook', { name: 'w', url: 'http://u', method: 'get' })).toBe('GET http://u')
  })
})

describe('matcher rules', () => {
  const m: NotificationMatcher = {
    name: 'e2e-nm-m',
    mode: 'any',
    'invert-match': 1,
    'match-field': ['exact:type=vzdump,replication', 'regex:hostname=^pve-.*$'],
    'match-severity': ['warning,error'],
    'match-calendar': ['mon..fri 8-17'],
    target: ['mail-to-root'],
    comment: 'c',
  }

  it('parses statements into rules (not any = any + invert)', () => {
    const f = initialMatcherForm(m)
    expect(f.mode).toBe('notany')
    expect(f.rules.map((r) => r.kind)).toEqual(['field', 'field', 'severity', 'calendar'])
    expect(f.rules[0]).toMatchObject({ fieldMode: 'exact', field: 'type', values: ['vzdump', 'replication'] })
    expect(f.rules[1]).toMatchObject({ fieldMode: 'regex', field: 'hostname', regex: '^pve-.*$' })
    expect(f.rules[2]!.severities).toEqual(['warning', 'error'])
    expect(f.targets).toEqual(['mail-to-root'])
  })

  it('round-trips to the same params', () => {
    expect(matcherParams(initialMatcherForm(m), true)).toEqual({
      name: 'e2e-nm-m',
      comment: 'c',
      mode: 'any',
      'invert-match': 1,
      'match-field': ['exact:type=vzdump,replication', 'regex:hostname=^pve-.*$'],
      'match-severity': ['warning,error'],
      'match-calendar': ['mon..fri 8-17'],
      target: ['mail-to-root'],
    })
  })

  it('field without prefix means exact', () => {
    expect(parseMatchField('job-id=backup-1')).toMatchObject({ fieldMode: 'exact', field: 'job-id', values: ['backup-1'] })
  })

  it('update: removed rules and invert are deleted', () => {
    const f: MatcherForm = { ...initialMatcherForm(m), mode: 'all', rules: [], enable: false }
    expect(matcherParams(f, false, 'dg')).toEqual({
      disable: 1,
      comment: 'c',
      mode: 'all',
      target: ['mail-to-root'],
      digest: 'dg',
      delete: ['invert-match', 'match-field', 'match-severity', 'match-calendar'],
    })
  })

  it('severity order follows the official list', () => {
    const f: MatcherForm = { ...initialMatcherForm(), name: 'x', targets: ['t'], rules: [{ ...newRule('severity'), severities: ['error', 'info'] }] }
    expect(matcherParams(f, true)['match-severity']).toEqual(['info,error'])
  })

  it('switching exact → regex builds an alternation', () => {
    const r = { ...newRule('field'), field: 'type', values: ['vzdump', 'fencing'] }
    expect(switchFieldMode(r, 'regex').regex).toBe('^(vzdump|fencing)$')
  })

  it('validation: incomplete rules and no target', () => {
    const f: MatcherForm = { ...initialMatcherForm(), name: 'x', rules: [newRule('field'), newRule('calendar'), { ...newRule('severity'), severities: [] }] }
    const e = validateMatcher(f, true)
    expect(e).toMatchObject({ rule0: '选择字段', rule1: '填写时间范围', rule2: '至少选一个级别', target: expect.any(String), rules: expect.any(String) })
    const bad = { ...f, rules: [{ ...newRule('field'), field: 'type', fieldMode: 'regex' as const, regex: '(' }] }
    expect(validateMatcher(bad, true).rule0).toBe('正则表达式无效')
  })

  it('describes matchers', () => {
    expect(describeMatcher({ name: 'default-matcher', mode: 'all', target: ['mail-to-root'] })).toBe('匹配所有通知')
    expect(describeMatcher({ name: 'x', 'match-severity': ['error'], 'match-field': ['exact:type=vzdump'] })).toBe('通知类型 是 备份 且 级别是 错误')
  })
})

describe('metric server params', () => {
  const metric = (type: MetricForm['type'], patch: Partial<MetricForm> = {}): MetricForm => ({ ...initialMetricForm(type), ...patch })

  it('graphite UDP (default) and TCP', () => {
    expect(metricParams(metric('graphite', { id: 'g', server: '127.0.0.1', path: 'lab' }), true)).toEqual({
      type: 'graphite',
      server: '127.0.0.1',
      port: 2003,
      disable: 0,
      path: 'lab',
    })
    expect(metricParams(metric('graphite', { id: 'g', server: 'h', proto: 'tcp', timeout: 3, enable: false }), true)).toEqual({
      type: 'graphite',
      server: 'h',
      port: 2003,
      disable: 1,
      proto: 'tcp',
      timeout: 3,
    })
  })

  it('graphite update back to UDP deletes proto', () => {
    const before: MetricServer = { id: 'g', type: 'graphite', server: 'h', port: 2003, proto: 'tcp', timeout: 2, path: 'p' }
    const f = { ...initialMetricForm('graphite', before), proto: 'udp' as const, path: '' }
    expect(metricParams(f, false)).toEqual({ server: 'h', port: 2003, disable: 0, delete: 'path,proto,mtu' })
  })

  it('influxdb UDP default, HTTPS with org / bucket / token / verify', () => {
    expect(metricParams(metric('influxdb', { id: 'i', server: 'h' }), true)).toEqual({ type: 'influxdb', server: 'h', port: 8089, disable: 0 })
    const f = metric('influxdb', {
      id: 'i',
      server: 'influx.invalid',
      port: 8086,
      influxdbproto: 'https',
      organization: 'org',
      bucket: 'b',
      token: 'tok',
      maxBodySize: 1000,
      verifyCertificate: false,
    })
    expect(metricParams(f, true)).toEqual({
      type: 'influxdb',
      server: 'influx.invalid',
      port: 8086,
      disable: 0,
      influxdbproto: 'https',
      organization: 'org',
      bucket: 'b',
      token: 'tok',
      'max-body-size': 1000,
      'verify-certificate': 0,
    })
  })

  it('influxdb update: empty token unchanged, verify default deleted', () => {
    const before: MetricServer = { id: 'i', type: 'influxdb', server: 'h', port: 8086, influxdbproto: 'https', organization: 'o', bucket: 'b', 'verify-certificate': 0 }
    const f = { ...initialMetricForm('influxdb', before), verifyCertificate: true }
    const p = metricParams(f, false, 'dg')
    expect(p.token).toBeUndefined()
    expect(p).toMatchObject({ influxdbproto: 'https', organization: 'o', bucket: 'b', digest: 'dg' })
    expect(String(p.delete).split(',')).toEqual(expect.arrayContaining(['verify-certificate', 'api-path-prefix', 'timeout', 'max-body-size']))
  })

  it('opentelemetry: JSON headers / attributes as base64', () => {
    const f = metric('opentelemetry', { id: 'o', server: 'h', otelHeaders: '{ "Authorization": "Bearer x" }' })
    const p = metricParams(f, true)
    expect(p).toMatchObject({ type: 'opentelemetry', port: 4318, 'otel-protocol': 'https', 'otel-path': '/v1/metrics', 'otel-verify-ssl': 1, 'otel-compression': 'gzip' })
    expect(base64ToUtf8(String(p['otel-headers']))).toBe('{"Authorization":"Bearer x"}')
    expect(p['otel-resource-attributes']).toBeUndefined()
    expect(validateMetric({ ...f, otelResourceAttributes: '[1]' }, true)['otel-resource-attributes']).toBeTruthy()
  })

  it('validation and toggle', () => {
    expect(validateMetric(metric('graphite', { port: undefined }), true)).toMatchObject({ id: '必填', server: '必填', port: '必填' })
    expect(metricToggleParams({ id: 'g', type: 'graphite', server: 'h', port: 1 }, false)).toEqual({ server: 'h', port: 1, disable: 1 })
  })
})
