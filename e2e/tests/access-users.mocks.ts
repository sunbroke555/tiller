// Mocked users / groups / tokens / TFA API for the phone layout tests and the
// screenshots (access-users.spec.ts, access-users.visual.spec.ts). Read-only:
// writes are not mocked (the phone project refuses them anyway).

import type { Page } from '@playwright/test'

const NOW = Math.floor(Date.now() / 1000)

export const MOCK_USERS = [
  {
    userid: 'root@pam',
    enable: 1,
    expire: 0,
    email: 'root@localhost',
    'realm-type': 'pam',
    groups: '',
    keys: 'x',
    tokens: [{ tokenid: 'monitoring', privsep: 1, expire: 0, comment: 'Prometheus 导出器' }],
  },
  {
    userid: 'e2e-au-alice@pve',
    enable: 1,
    expire: NOW + 5 * 86400,
    firstname: 'Alice',
    lastname: 'Zhang',
    email: 'alice@example.com',
    comment: '运维值班',
    'realm-type': 'pve',
    groups: 'e2e-au-ops,e2e-au-admins',
    keys: 'x',
    'tfa-locked-until': NOW + 3600,
    tokens: [
      { tokenid: 'ci', privsep: 1, expire: NOW + 90 * 86400, comment: 'GitLab 部署' },
      { tokenid: 'backup', privsep: 0, expire: 0 },
    ],
  },
  {
    userid: 'e2e-au-bob@pve',
    enable: 0,
    expire: NOW - 86400,
    firstname: 'Bob',
    'realm-type': 'pve',
    groups: 'e2e-au-ops',
    tokens: null,
  },
  { userid: 'e2e-au-carol@ldap', enable: 1, expire: 0, email: 'carol@corp.example', 'realm-type': 'ldap', groups: '', tokens: null },
]

export const MOCK_GROUPS = [
  { groupid: 'e2e-au-admins', comment: '管理员', users: 'e2e-au-alice@pve' },
  { groupid: 'e2e-au-ops', comment: '运维', users: 'e2e-au-alice@pve,e2e-au-bob@pve' },
  { groupid: 'e2e-au-empty' },
]

export const MOCK_TFA = [
  {
    userid: 'root@pam',
    entries: [
      { id: 'totp-1', type: 'totp', description: 'iPhone 验证器', created: NOW - 200 * 86400 },
      { id: 'recovery', type: 'recovery', created: NOW - 200 * 86400 },
    ],
  },
  {
    userid: 'e2e-au-alice@pve',
    'tfa-locked-until': NOW + 3600,
    entries: [
      { id: 'webauthn-1', type: 'webauthn', description: 'YubiKey 5C', created: NOW - 30 * 86400 },
      { id: 'totp-2', type: 'totp', description: '旧手机', created: NOW - 400 * 86400, enable: 0 },
    ],
  },
]

const ok = (data: unknown) => ({ json: { data } })

export async function mockAccessApi(page: Page) {
  await page.route(/\/api2\/json\/access\/users(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? route.fulfill(ok(MOCK_USERS)) : route.fallback(),
  )
  await page.route(/\/api2\/json\/access\/users\/([^/?]+)(\?.*)?$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const id = decodeURIComponent(/\/access\/users\/([^/?]+)/.exec(route.request().url())![1]!)
    const u = MOCK_USERS.find((x) => x.userid === id)
    if (!u) return route.fulfill({ status: 404, json: { data: null, message: 'no such user' } })
    const { tokens, groups, userid: _id, 'realm-type': _rt, ...rest } = u
    return route.fulfill(
      ok({ ...rest, groups: groups ? groups.split(',') : [], tokens: Object.fromEntries((tokens ?? []).map(({ tokenid, ...t }) => [tokenid, t])) }),
    )
  })
  await page.route(/\/api2\/json\/access\/groups(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? route.fulfill(ok(MOCK_GROUPS)) : route.fallback(),
  )
  await page.route(/\/api2\/json\/access\/groups\/([^/?]+)$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const id = decodeURIComponent(/\/access\/groups\/([^/?]+)/.exec(route.request().url())![1]!)
    const g = MOCK_GROUPS.find((x) => x.groupid === id)
    return route.fulfill(ok({ comment: g?.comment, members: (g?.users ?? '').split(',').filter(Boolean) }))
  })
  await page.route(/\/api2\/json\/access\/tfa(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? route.fulfill(ok(MOCK_TFA)) : route.fallback(),
  )
  await page.route(/\/api2\/json\/access\/domains(\?.*)?$/, (route) =>
    route.fulfill(
      ok([
        { realm: 'pve', type: 'pve', comment: 'Proxmox VE authentication server' },
        { realm: 'pam', type: 'pam', comment: 'Linux PAM standard authentication' },
        { realm: 'ldap', type: 'ldap', comment: '公司目录' },
      ]),
    ),
  )
  await page.route(/\/api2\/json\/access\/permissions\?.*userid=/, (route) =>
    route.fulfill(
      ok({
        '/': { 'Sys.Audit': 1, 'Datastore.Audit': 1 },
        '/vms': { 'VM.Audit': 1, 'VM.PowerMgmt': 1, 'VM.Console': 1 },
        '/vms/100': { 'VM.Snapshot': 0 },
      }),
    ),
  )
}
