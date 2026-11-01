import type { Page, Route } from '@playwright/test'

import { expect, test } from '../fixtures'

// Visual QA of the cluster screens (not a regression test), dark theme, with
// the cluster API mocked (never writes). Runs only with E2E_SCREENSHOTS=1;
// images land in e2e/test-results/cluster-shots/.

const FP = Array.from({ length: 32 }, (_, i) => ((i * 37 + 11) % 256).toString(16).padStart(2, '0').toUpperCase()).join(':')
const json = (route: Route, data: unknown) => route.fulfill({ json: { data } })

async function mockCommon(page: Page, node: string) {
  // Never let a write through.
  await page.route(
    (url) => url.pathname.startsWith('/api2/json/cluster/config'),
    (route) => (route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 500, json: { data: null } })),
  )
  await page.route(`**/api2/json/nodes/${node}/network`, (route) =>
    json(route, [
      { iface: 'vmbr0', type: 'bridge', address: '192.168.0.240' },
      { iface: 'vmbr1', type: 'bridge', address: '10.10.10.40', address6: 'fd00:10::40' },
    ]),
  )
}

async function mockStandalone(page: Page, node: string) {
  await page.route('**/api2/json/cluster/status', (route) => json(route, [{ type: 'node', id: `node/${node}`, name: node, nodeid: 0, online: 1, local: 1 }]))
  await page.route('**/api2/json/cluster/config/nodes', (route) => json(route, []))
}

async function mockCluster(page: Page, local: string) {
  const names = [local, 'pve-node-02', 'pve-node-03']
  await page.route('**/api2/json/cluster/status', (route) =>
    json(route, [
      { type: 'cluster', id: 'cluster', name: 'homelab', nodes: 3, quorate: 1, version: 7 },
      ...names.map((name, i) => ({ type: 'node', id: `node/${name}`, name, nodeid: i + 1, online: i === 1 ? 0 : 1, local: i === 0 ? 1 : 0, ip: `192.168.0.24${i}` })),
    ]),
  )
  const corosync = names.map((name, i) => ({ name, node: name, nodeid: String(i + 1), quorum_votes: '1', ring0_addr: `192.168.0.24${i}`, ring1_addr: `10.10.10.4${i}` }))
  const totem = {
    cluster_name: 'homelab',
    config_version: '7',
    interface: { '0': { linknumber: '0' }, '1': { linknumber: '1', knet_link_priority: '20' } },
    ip_version: 'ipv4-6',
    link_mode: 'passive',
    secauth: 'on',
    token_coefficient: '125',
    version: '2',
  }
  await page.route('**/api2/json/cluster/config/nodes', (route) => json(route, corosync))
  await page.route(/\/api2\/json\/cluster\/config\/join(\?|$)/, (route) =>
    json(route, { config_digest: 'x', preferred_node: local, totem, nodelist: corosync.map((n, i) => ({ ...n, pve_addr: `192.168.0.24${i}`, pve_fp: FP })) }),
  )
  await page.route('**/api2/json/cluster/config/qdevice', (route) => json(route, {}))
}

test('cluster screens (dark)', async ({ page, pve }, info) => {
  test.setTimeout(120_000)
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('tiller:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
  })
  const dir = `test-results/cluster-shots/${info.project.name}`
  const shot = async (name: string, fullPage = false) => {
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${dir}-${name}.png`, fullPage })
  }
  await mockCommon(page, pve.node)

  // Cluster view
  await mockCluster(page, pve.node)
  await page.goto('/datacenter/cluster')
  await expect(page.getByTestId('cluster-name')).toHaveText('homelab')
  await shot('cluster', true)

  await page.getByRole('button', { name: '加入信息' }).click()
  const infoDialog = page.getByRole('dialog', { name: '加入信息' })
  await expect(infoDialog.getByTestId('join-info-text')).not.toHaveValue('')
  await shot('join-info')
  await infoDialog.getByRole('button', { name: '二维码' }).click()
  await shot('join-info-qr')
  await page.keyboard.press('Escape')
  await expect(infoDialog).toBeHidden()

  await page.getByRole('button', { name: 'pve-node-02 的操作' }).click()
  await page.getByRole('menuitem', { name: '移除节点…' }).click()
  await expect(page.getByRole('dialog', { name: '移除节点 pve-node-02' })).toBeVisible()
  await shot('remove-node')

  // Standalone view (new page so the cluster mocks are gone)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await mockCommon(page, pve.node)
  await mockStandalone(page, pve.node)
  await page.goto('/datacenter/cluster')
  await expect(page.getByTestId('cluster-standalone')).toBeVisible()
  await shot('standalone', true)

  await page.getByRole('button', { name: '创建集群' }).click()
  const create = page.getByRole('dialog', { name: '创建集群' })
  await create.getByRole('textbox', { name: /集群名称/ }).fill('homelab')
  await create.getByRole('button', { name: '添加链路' }).click()
  await create.getByLabel('链路 1 优先级').fill('20')
  await shot('create')
  await create.getByRole('button', { name: '取消' }).click()
  await expect(create).toBeHidden()

  await page.getByRole('button', { name: '加入集群' }).click()
  const joinDialog = page.getByRole('dialog', { name: '加入集群' })
  const encoded = Buffer.from(
    JSON.stringify({
      ipAddress: '192.168.0.240',
      fingerprint: FP,
      peerLinks: { 0: '192.168.0.240', 1: '10.10.10.40' },
      ring_addr: ['192.168.0.240', '10.10.10.40'],
      totem: { cluster_name: 'homelab', interface: { 0: { linknumber: '0' }, 1: { linknumber: '1' } } },
    }),
  ).toString('base64')
  await joinDialog.getByRole('textbox', { name: '加入信息' }).fill(encoded)
  await shot('join')
})
