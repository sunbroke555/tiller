// Mocked notification / metric server API for the phone layout tests and the
// screenshots (notifications-metrics.spec.ts, notifications-metrics.visual.spec.ts).

import type { Page, Route } from '@playwright/test'

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

export const MOCK_ENDPOINTS = {
  sendmail: [
    {
      name: 'mail-to-root',
      origin: 'modified-builtin',
      comment: "Send mails to root@pam's email address",
      'mailto-user': ['root@pam'],
      mailto: ['ops@example.invalid'],
      digest: 'd1',
    },
  ],
  smtp: [
    {
      name: 'e2e-nm-smtp',
      origin: 'user-created',
      disable: 1,
      server: 'smtp.example.invalid',
      mode: 'starttls',
      username: 'pve',
      'from-address': 'pve@example.invalid',
      mailto: ['oncall@example.invalid'],
      comment: '值班邮箱',
      digest: 'd2',
    },
  ],
  gotify: [{ name: 'e2e-nm-gotify', origin: 'user-created', server: 'https://gotify.example.invalid', comment: '手机推送', digest: 'd3' }],
  webhook: [
    {
      name: 'e2e-nm-hook',
      origin: 'user-created',
      method: 'post',
      url: 'https://chat.example.invalid/hooks/{{ secrets.channel }}',
      header: [`name=Content-Type,value=${b64('application/json')}`],
      secret: ['name=channel'],
      body: b64('{\n  "text": "{{ escape title }}",\n  "severity": "{{ severity }}"\n}'),
      digest: 'd4',
    },
  ],
} as const

export const MOCK_MATCHERS = [
  { name: 'default-matcher', origin: 'builtin', mode: 'all', target: ['mail-to-root'], comment: 'Route all notifications to mail-to-root' },
  {
    name: 'e2e-nm-backup',
    origin: 'user-created',
    mode: 'all',
    'match-field': ['exact:type=vzdump,replication'],
    'match-severity': ['warning,error'],
    'match-calendar': ['mon..fri 8-17'],
    target: ['e2e-nm-hook', 'e2e-nm-gotify'],
    comment: '工作时间的备份告警',
    digest: 'm2',
  },
  {
    name: 'e2e-nm-quiet',
    origin: 'user-created',
    mode: 'any',
    'invert-match': 1,
    disable: 1,
    'match-severity': ['info,notice'],
    target: ['e2e-nm-smtp'],
    digest: 'm3',
  },
]

export const MOCK_METRICS = [
  { id: 'e2e-nm-graphite', type: 'graphite', server: 'graphite.example.invalid', port: 2003, path: 'proxmox.lab', proto: 'tcp', timeout: 2 },
  {
    id: 'e2e-nm-influx',
    type: 'influxdb',
    server: 'influx.example.invalid',
    port: 8086,
    influxdbproto: 'https',
    organization: 'lab',
    bucket: 'proxmox',
    'verify-certificate': 0,
  },
  { id: 'e2e-nm-otel', type: 'opentelemetry', server: 'otel.example.invalid', port: 4318, 'otel-protocol': 'https', 'otel-path': '/v1/metrics', disable: 1 },
]

const json = (route: Route, data: unknown, status = 200) =>
  route.fulfill({ status, json: status === 200 ? { data } : { data: null, message: String(data) } })

export async function mockNotificationApi(page: Page) {
  await page.route('**/api2/json/cluster/notifications/**', (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace('/api2/json/cluster/notifications/', '')
    const [first, second, third] = path.split('/')
    if (req.method() === 'POST' && first === 'targets' && third === 'test') {
      return second === 'e2e-nm-gotify'
        ? json(route, 'Could not test target: io: Connection refused (os error 111)\n', 500)
        : json(route, null)
    }
    if (req.method() !== 'GET') return json(route, null)
    if (first === 'targets') {
      return json(
        route,
        Object.entries(MOCK_ENDPOINTS).flatMap(([type, list]) =>
          list.map((e) => ({ name: e.name, type, origin: e.origin, comment: 'comment' in e ? e.comment : undefined, disable: 'disable' in e ? e.disable : undefined })),
        ),
      )
    }
    if (first === 'endpoints' && second && second in MOCK_ENDPOINTS) {
      const list = MOCK_ENDPOINTS[second as keyof typeof MOCK_ENDPOINTS] as readonly { name: string }[]
      return third ? json(route, list.find((e) => e.name === decodeURIComponent(third))) : json(route, list)
    }
    if (first === 'matchers') return second ? json(route, MOCK_MATCHERS.find((m) => m.name === decodeURIComponent(second))) : json(route, MOCK_MATCHERS)
    if (first === 'matcher-fields') return json(route, [{ name: 'type' }, { name: 'hostname' }, { name: 'job-id' }])
    if (first === 'matcher-field-values') {
      return json(route, [
        { field: 'type', value: 'package-updates' },
        { field: 'type', value: 'fencing' },
        { field: 'type', value: 'replication' },
        { field: 'type', value: 'vzdump' },
        { field: 'type', value: 'system-mail' },
        { field: 'hostname', value: 'pve-lab' },
      ])
    }
    return route.fallback()
  })
  await page.route('**/api2/json/cluster/metrics/server**', (route) => {
    const req = route.request()
    if (req.method() !== 'GET') return json(route, null)
    const id = new URL(req.url()).pathname.split('/cluster/metrics/server/')[1]
    return id ? json(route, MOCK_METRICS.find((m) => m.id === decodeURIComponent(id))) : json(route, MOCK_METRICS)
  })
}
