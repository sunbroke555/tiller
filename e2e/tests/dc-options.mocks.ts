// Mocked datacenter options and node subscription for the phone layout tests
// and the screenshots (dc-options.spec.ts, dc-options.visual.spec.ts).

import type { Page, Request } from '@playwright/test'

/** /cluster/options in the shapes PVE 9.2 returns (objects, arrays, a few strings). */
export const MOCK_OPTIONS = {
  'allowed-tags': ['demo', 'prod', 'test'],
  keyboard: 'de',
  console: 'xtermjs',
  http_proxy: 'http://proxy.lan:3128/',
  email_from: 'pve@example.com',
  mac_prefix: 'BC:24:11',
  description: '实验集群，周末维护。',
  'consent-text': Buffer.from('仅限授权人员使用，所有操作均被记录。').toString('base64'),
  migration: { type: 'secure', network: '10.10.0.0/24' },
  bwlimit: 'default=102400,restore=51200',
  max_workers: 8,
  'next-id': { lower: '1000', upper: '9000' },
  ha: { shutdown_policy: 'migrate' },
  crs: { ha: 'static', 'ha-rebalance-on-start': 1, 'ha-auto-rebalance': 1, 'ha-auto-rebalance-method': 'topsis' },
  webauthn: { rp: 'pve.example.com', id: 'pve.example.com', origin: 'https://pve.example.com:8006' },
  'tag-style': { 'color-map': 'prod:D92D20:FFFFFF;test:12B76A', shape: 'full', ordering: 'config' },
  'user-tag-access': { 'user-allow': 'existing', 'user-allow-list': ['demo', 'web'] },
  'registered-tags': ['prod'],
  location: 'latitude=31.2304,longitude=121.4737,name=Shanghai',
}

export const MOCK_SUBSCRIPTION = {
  status: 'active',
  level: 'c',
  productname: 'Proxmox VE Community Subscription 1 CPU/year',
  key: 'pve1c-0123456789',
  serverid: 'FAC0B9201BBD4F98A875A4F1730951F3',
  sockets: 1,
  checktime: Math.floor(Date.now() / 1000) - 3600,
  nextduedate: '2027-10-31',
  regdate: '2026-10-31 00:00:00',
  url: 'https://www.proxmox.com/en/proxmox-virtual-environment/pricing',
}

const json = (data: unknown) => ({ status: 200, contentType: 'application/json', json: { data } })

/** GET /cluster/options returns MOCK_OPTIONS; writes are recorded and answered with success. */
export async function mockOptions(page: Page, options: Record<string, unknown> = MOCK_OPTIONS): Promise<Request[]> {
  const writes: Request[] = []
  await page.route('**/api2/json/cluster/options', (route) => {
    if (route.request().method() === 'GET') return route.fulfill(json(options))
    writes.push(route.request())
    return route.fulfill(json(null))
  })
  return writes
}

/** The node's subscription; PUT/POST/DELETE are recorded, never sent to the lab. */
export async function mockSubscription(page: Page, node: string, sub: Record<string, unknown> = MOCK_SUBSCRIPTION): Promise<Request[]> {
  const writes: Request[] = []
  await page.route(`**/api2/json/nodes/${node}/subscription`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill(json(sub))
    writes.push(route.request())
    return route.fulfill(json(null))
  })
  await page.route(`**/api2/json/nodes/${node}/report`, (route) =>
    route.fulfill(json(`==== general system info ====\n\n# hostname\n${node}\n\n# pveversion --verbose\nproxmox-ve: 9.2.0\npve-manager: 9.2.21\n`)),
  )
  return writes
}
