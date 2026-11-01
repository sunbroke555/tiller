// Shared page.route() mocks of the certificates-acme specs: a node (pvelab-c3)
// with an ACME account, two domains, an ACME-issued certificate and one DNS
// plugin; fake ACME tasks finish OK at once. Nothing here reaches the lab.

import type { Page, Route } from '@playwright/test'

/** Certificate writes only ever go to this node (never c1, whose fingerprint is pinned). */
export const NODE = process.env.PVE_LAB_CERT_NODE ?? 'pvelab-c3'
export const NAME = 'e2e-certificates-acme'
export const CUSTOM = 'pveproxy-ssl.pem'

export const FAKE_UPID = (type: string) => `UPID:${NODE}:0000E2E0:0000E2E1:6A000000:${type}::root@pam:`

/** Node with an account, two domains and an ACME-issued certificate; one DNS plugin. */
export async function mockAcmeState(page: Page) {
  const json = (route: Route, data: unknown) => route.fulfill({ json: { data } })
  await page.route(`**/api2/json/nodes/${NODE}/config`, (route) =>
    route.request().method() === 'GET'
      ? json(route, {
          acme: `account=${NAME},domains=pve.e2e.example.com`,
          acmedomain0: `domain=dns.e2e.example.com,plugin=${NAME},alias=_acme-challenge.alias.example.net`,
          digest: 'e2e',
        })
      : route.fallback(),
  )
  await page.route('**/api2/json/cluster/acme/account', (route) =>
    route.request().method() === 'GET' ? json(route, [{ name: NAME }, { name: 'default' }]) : route.fallback(),
  )
  await page.route('**/api2/json/cluster/acme/plugins', (route) =>
    route.request().method() === 'GET'
      ? json(route, [
          { plugin: 'standalone', type: 'standalone' },
          { plugin: NAME, type: 'dns', api: 'cf', data: 'CF_Token=abc\n', nodes: NODE, 'validation-delay': 60, digest: 'e2e' },
        ])
      : route.fallback(),
  )
  await page.route(`**/api2/json/cluster/acme/plugins/${NAME}`, (route) =>
    route.request().method() === 'GET'
      ? json(route, { plugin: NAME, type: 'dns', api: 'cf', data: 'CF_Token=abc=def\nCF_Account_ID=42\nEXTRA=1\n', nodes: NODE, digest: 'e2e' })
      : route.fallback(),
  )
  await page.route(`**/api2/json/nodes/${NODE}/certificates/info`, async (route) => {
    const res = await route.fetch()
    const body = (await res.json()) as { data: { filename: string; notafter?: number }[] }
    const now = Math.floor(Date.now() / 1000)
    const acme = {
      filename: CUSTOM,
      fingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
      issuer: "/C=US/O=(STAGING) Let's Encrypt/CN=(STAGING) Ersatz Edamame E1",
      subject: '/CN=pve.e2e.example.com',
      notbefore: now - 60 * 86400,
      notafter: now + 20 * 86400,
      san: ['pve.e2e.example.com', 'dns.e2e.example.com'],
      'public-key-type': 'id-ecPublicKey',
      'public-key-bits': 256,
      pem: '-----BEGIN CERTIFICATE-----\nMIIBmock\n-----END CERTIFICATE-----\n',
    }
    await route.fulfill({ json: { data: [...body.data.filter((c) => c.filename !== CUSTOM), acme] } })
  })
  // Fake task: finished OK at once.
  await page.route((url) => url.pathname.includes(`/nodes/${NODE}/tasks/UPID`), (route) => {
    const url = route.request().url()
    const upid = decodeURIComponent(url.split('/tasks/')[1]!.split('/')[0]!)
    if (url.includes('/status')) {
      return json(route, { upid, node: NODE, status: 'stopped', exitstatus: 'OK', type: upid.split(':')[5], id: '', user: 'root@pam', starttime: 1, pid: 1 })
    }
    return route.fulfill({ json: { data: [{ n: 1, t: 'TASK OK' }], total: 1 } })
  })
}

