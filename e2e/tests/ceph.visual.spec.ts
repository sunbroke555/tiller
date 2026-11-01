import { expect, test } from '../fixtures'

// Visual QA of the Ceph screens (not a regression test), dark theme. Status,
// pools and the install wizard are mocked for richer content; the rest reads
// the lab cluster. Runs only with E2E_SCREENSHOTS=1; images land in
// e2e/test-results/ceph-shots/.

const STATUS = {
  fsid: 'ce2a7d9a-f288-4a35-b3e5-350a58c654e4',
  health: {
    status: 'HEALTH_WARN',
    checks: {
      OSD_DOWN: { severity: 'HEALTH_WARN', summary: { message: '1 osds down' }, detail: [{ message: 'osd.2 (root=default,host=pvelab-c3) is down' }] },
      PG_DEGRADED: {
        severity: 'HEALTH_WARN',
        summary: { message: 'Degraded data redundancy: 120/360 objects degraded (33.333%), 13 pgs degraded, 13 pgs undersized' },
        detail: [{ message: 'pg 2.0 is stuck undersized for 5m, current state active+undersized+degraded, last acting [0,1]' }],
      },
      POOL_NO_REDUNDANCY: { severity: 'HEALTH_ERR', summary: { message: '1 pool(s) have no replicas configured' }, detail: [], muted: true },
    },
  },
  quorum_names: ['pvelab-c1', 'pvelab-c2', 'pvelab-c3'],
  mgrmap: { active_name: 'pvelab-c1', standbys: [{ name: 'pvelab-c2' }] },
  fsmap: { by_rank: [{ name: 'pvelab-c1', rank: 0, status: 'up:active' }] },
  osdmap: { num_osds: 3, num_up_osds: 2, num_in_osds: 3 },
  pgmap: {
    pgs_by_state: [
      { state_name: 'active+clean', count: 52 },
      { state_name: 'active+undersized+degraded', count: 13 },
      { state_name: 'active+clean+scrubbing+deep', count: 1 },
    ],
    num_pgs: 66,
    num_pools: 3,
    num_objects: 360,
    bytes_used: 6.2 * 1024 ** 3,
    bytes_total: 48 * 1024 ** 3,
    data_bytes: 1.9 * 1024 ** 3,
    read_bytes_sec: 1.5 * 1024 * 1024,
    write_bytes_sec: 6 * 1024 * 1024,
    read_op_per_sec: 31,
    write_op_per_sec: 118,
    degraded_objects: 120,
    degraded_total: 360,
    recovering_objects_per_sec: 2,
    recovering_bytes_per_sec: 8 * 1024 * 1024,
  },
}

const nodes = ['pvelab-c1', 'pvelab-c2', 'pvelab-c3']
const META = {
  mon: Object.fromEntries(nodes.map((n, i) => [`${n}@${n}`, { name: n, addr: `192.168.0.${246 + i}`, ceph_version_short: '19.2.6', service: true }])),
  mgr: Object.fromEntries(nodes.slice(0, 2).map((n, i) => [`${n}@${n}`, { name: n, addr: `192.168.0.${246 + i}`, ceph_version_short: '19.2.6', service: true }])),
  mds: { 'pvelab-c1@pvelab-c1': { name: 'pvelab-c1', addr: '192.168.0.246', ceph_version_short: '19.2.3', service: true } },
  osd: [0, 1, 2].map((id) => ({ id, ceph_version_short: '19.2.6' })),
  node: Object.fromEntries(nodes.map((n) => [n, { version: { str: '19.2.6', parts: ['19', '2', '6'] } }])),
}

const POOLS = [
  { pool: 1, pool_name: '.mgr', type: 'replicated', size: 3, min_size: 2, pg_num: 1, pg_num_final: 1, pg_autoscale_mode: 'on', crush_rule: 0, crush_rule_name: 'replicated_rule', bytes_used: 1.2 * 1024 ** 2, percent_used: 0.0001, application_metadata: { mgr: {} } },
  { pool: 2, pool_name: 'vm-pool', type: 'replicated', size: 3, min_size: 2, pg_num: 32, pg_num_final: 64, pg_autoscale_mode: 'on', crush_rule: 0, crush_rule_name: 'replicated_rule', bytes_used: 5.4 * 1024 ** 3, percent_used: 0.12, target_size_ratio: 0.8, application_metadata: { rbd: {} } },
  { pool: 3, pool_name: 'cephfs_data', type: 'replicated', size: 2, min_size: 1, pg_num: 16, pg_autoscale_mode: 'warn', crush_rule: 0, crush_rule_name: 'replicated_rule', bytes_used: 0.4 * 1024 ** 3, percent_used: 0.02, application_metadata: { cephfs: {} } },
]

test('ceph screens (dark)', async ({ page, pve }, info) => {
  test.setTimeout(240_000)
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('tiller:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
  })
  const dir = `test-results/ceph-shots/${info.project.name}`
  const shot = async (name: string, fullPage = true) => {
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${dir}-${name}.png`, fullPage })
  }

  // Status (mocked).
  await page.route('**/api2/json/cluster/ceph/status', (route) => route.fulfill({ json: { data: STATUS } }))
  await page.route('**/api2/json/cluster/ceph/metadata?*', (route) => route.fulfill({ json: { data: META } }))
  await page.goto('/datacenter/ceph')
  await expect(page.getByTestId('ceph-health-status')).toBeVisible()
  await page.locator('[data-check="PG_DEGRADED"]').getByRole('button').first().click()
  await shot('status')
  await page.unrouteAll({ behavior: 'ignoreErrors' })

  // Real lab data.
  await page.goto('/datacenter/ceph/services')
  await expect(page.getByTestId('ceph-mon-list').locator('[data-service]').first()).toBeVisible()
  await shot('services')
  await page.getByTestId('ceph-mon-list').getByRole('button', { name: '创建' }).click()
  await shot('service-create', false)
  await page.keyboard.press('Escape')

  await page.goto('/datacenter/ceph/osd')
  await expect(page.locator('[data-osd]').first()).toBeVisible()
  await shot('osd')
  await page.getByRole('button', { name: '创建 OSD' }).first().click()
  await shot('osd-create', false)
  await page.keyboard.press('Escape')
  await page.locator('[data-osd]').first().getByRole('button').first().click()
  await expect(page.locator('[data-device="block"]')).toBeVisible()
  await shot('osd-details', false)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '全局标志', exact: true }).click()
  await shot('osd-flags', false)
  await page.keyboard.press('Escape')

  await page.route('**/api2/json/nodes/*/ceph/pool', (route) => route.fulfill({ json: { data: POOLS } }))
  await page.goto('/datacenter/ceph/pools')
  await expect(page.locator('[data-pool="vm-pool"]')).toBeVisible()
  await shot('pools')
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.getByRole('button', { name: /^创建/ }).first().click()
  await page.getByRole('dialog').getByLabel('最小副本数', { exact: true }).fill('1')
  await shot('pool-create', false)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '放弃' }).click().catch(() => undefined)

  await page.goto('/datacenter/ceph/cephfs')
  await expect(page.getByTestId('cephfs-list')).toBeVisible()
  await shot('cephfs')

  await page.goto('/datacenter/ceph/config')
  await expect(page.getByLabel('ceph.conf 内容')).toBeVisible()
  await shot('config')
  await page.getByRole('tab', { name: '配置数据库' }).click()
  await shot('config-db')

  await page.goto('/datacenter/ceph/log')
  await expect(page.getByLabel('日志内容')).toBeVisible()
  await shot('log', false)

  await page.goto(`/node/${pve.node}/ceph`)
  await expect(page.getByTestId('node-ceph-health')).toBeVisible()
  await shot('node-tab')

  // Install wizard (mocked: not installed, then not initialised).
  let installed = false
  await page.route('**/api2/json/nodes/*/ceph/status', (route) =>
    route.fulfill({ status: 500, json: { data: null, message: installed ? 'pveceph configuration not initialized\n' : 'binary not installed: /usr/bin/ceph-mon\n' } }),
  )
  await page.route('**/api2/json/nodes/*/subscription', (route) => route.fulfill({ json: { data: { status: 'notfound' } } }))
  await page.goto(`/datacenter/ceph/install/${pve.node}`)
  await expect(page.getByTestId('ceph-install-start')).toBeVisible()
  await shot('wizard-1')
  installed = true
  await expect(page.getByTestId('ceph-install-start')).toHaveText('下一步', { timeout: 15_000 })
  await page.getByTestId('ceph-install-start').click()
  await page.getByTestId('ceph-install-next').click()
  await expect(page.getByTestId('ceph-init-submit')).toBeVisible()
  await shot('wizard-3')
})
