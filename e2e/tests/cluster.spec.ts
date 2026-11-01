import type { Page, Route } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'

// Area cluster: overview, join information, create / join, node removal guide.
//
// SAFETY: creating or joining a cluster cannot be undone, so nothing here ever
// writes to PVE. The @lab tests only read the 3-node lab cluster
// (lab-cluster.env) and skip on a standalone lab. Create and join run against
// page.route() mocks that capture the POSTs; a guard registered first answers
// any other write below /cluster/config with 500 and fails the test.

const FP = Array.from({ length: 32 }, (_, i) => ((i * 37 + 11) % 256).toString(16).padStart(2, '0').toUpperCase()).join(':')

interface StatusEntry {
  type: string
  name: string
  [key: string]: unknown
}

const fakeUpid = (node: string, type: string) => `UPID:${node}:0000E2E0:0000E2E1:6A000000:${type}:e2e-cluster:root@pam:`

/** Every POST/PUT/DELETE below /cluster/config that no mock handled. Registered first, so mocks win. */
async function guardWrites(page: Page): Promise<string[]> {
  const leaked: string[] = []
  await page.route(
    (url) => url.pathname.startsWith('/api2/json/cluster/config'),
    (route) => {
      if (route.request().method() === 'GET') return route.fallback()
      leaked.push(`${route.request().method()} ${route.request().url()}`)
      return route.fulfill({ status: 500, json: { data: null, message: 'e2e：集群写操作必须被模拟' } })
    },
  )
  return leaked
}

/** Fake tasks of this spec finish OK at once. */
async function mockTasks(page: Page) {
  await page.route(
    (url) => url.pathname.includes('/tasks/UPID') && decodeURIComponent(url.pathname).includes(':e2e-cluster:'),
    (route) => {
      const url = route.request().url()
      const upid = decodeURIComponent(url.split('/tasks/')[1]!.split('/')[0]!)
      if (url.includes('/status')) {
        return route.fulfill({
          json: { data: { upid, node: upid.split(':')[1], status: 'stopped', exitstatus: 'OK', type: upid.split(':')[5], id: '', user: 'root@pam', starttime: 1, pid: 1 } },
        })
      }
      return route.fulfill({ json: { data: [{ n: 1, t: 'TASK OK' }], total: 1 } })
    },
  )
}

const json = (route: Route, data: unknown) => route.fulfill({ json: { data } })

/** Standalone node: no cluster entry, empty corosync node list, interfaces to pick link addresses from. */
async function mockStandalone(page: Page, node: string) {
  await page.route('**/api2/json/cluster/status', (route) =>
    json(route, [{ type: 'node', id: `node/${node}`, name: node, nodeid: 0, online: 1, local: 1, ip: '192.168.0.240', level: '' }]),
  )
  await page.route('**/api2/json/cluster/config/nodes', (route) => json(route, []))
  await page.route(/\/api2\/json\/cluster\/config\/join(\?|$)/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 424, json: { data: null, message: 'node is not in a cluster, no join info available!' } })
      : route.fallback(),
  )
  await page.route(`**/api2/json/nodes/${node}/network`, (route) =>
    json(route, [
      { iface: 'eno1', type: 'eth', active: 1 },
      { iface: 'vmbr0', type: 'bridge', active: 1, address: '192.168.0.240', cidr: '192.168.0.240/24' },
      { iface: 'vmbr1', type: 'bridge', active: 1, address: '10.10.10.40', address6: 'fd00:10::40' },
    ]),
  )
}

/** 3-node cluster, one node offline, two links (link 1 with priority 20), QDevice configured. */
async function mockCluster(page: Page, local: string) {
  const names = [local, 'e2e-c2', 'e2e-c3']
  await page.route('**/api2/json/cluster/status', (route) =>
    json(route, [
      { type: 'cluster', id: 'cluster', name: 'e2e-prod', nodes: 3, quorate: 1, version: 7 },
      { type: 'node', id: `node/${names[0]}`, name: names[0], nodeid: 1, online: 1, local: 1, ip: '192.168.0.240' },
      { type: 'node', id: `node/${names[1]}`, name: names[1], nodeid: 2, online: 0, ip: '192.168.0.241' },
      { type: 'node', id: `node/${names[2]}`, name: names[2], nodeid: 3, online: 1, ip: '192.168.0.242' },
    ]),
  )
  const corosync = names.map((name, i) => ({
    name,
    node: name,
    nodeid: String(i + 1),
    quorum_votes: '1',
    ring0_addr: `192.168.0.24${i}`,
    ring1_addr: `10.10.10.4${i}`,
  }))
  const totem = {
    cluster_name: 'e2e-prod',
    config_version: '7',
    interface: { '0': { linknumber: '0' }, '1': { linknumber: '1', knet_link_priority: '20' } },
    ip_version: 'ipv4-6',
    link_mode: 'passive',
    secauth: 'on',
    version: '2',
  }
  await page.route('**/api2/json/cluster/config/nodes', (route) => json(route, corosync))
  await page.route(/\/api2\/json\/cluster\/config\/join(\?|$)/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const want = new URL(route.request().url()).searchParams.get('node') ?? local
    return json(route, {
      config_digest: 'e2e',
      preferred_node: want,
      totem,
      nodelist: corosync.map((n, i) => ({ ...n, pve_addr: `192.168.0.24${i}`, pve_fp: FP })),
    })
  })
  await page.route('**/api2/json/cluster/config/qdevice', (route) =>
    json(route, { State: 'Connected', Algorithm: 'Fifty-Fifty split', 'Tie-breaker': 'Node with lowest node ID', 'QNetd host': '192.168.0.9:5403' }),
  )
}

/** The encoded join information exactly as the official UI makes it. */
function encodedJoinInfo() {
  const info = {
    ipAddress: '10.20.0.1',
    fingerprint: FP,
    peerLinks: { 0: '10.20.0.1', 1: '10.30.0.1' },
    ring_addr: ['10.20.0.1', '10.30.0.1'],
    totem: { cluster_name: 'e2e-prod', config_version: '7', interface: { 0: { linknumber: '0' }, 1: { linknumber: '1' } } },
  }
  return Buffer.from(JSON.stringify(info)).toString('base64')
}

// ------------------------------------------------------------- lab cluster

async function labCluster(pve: PveApi) {
  const status = await pve.get<StatusEntry[]>('/cluster/status')
  return status.find((e) => e.type === 'cluster')
}

test.describe('cluster (lab cluster, read-only)', { tag: '@lab' }, () => {
  test('概况和节点与 API 一致', async ({ page, pve }) => {
    const cluster = await labCluster(pve)
    test.skip(!cluster, '实验机不是集群（需要 lab-cluster.env）')
    const leaked = await guardWrites(page)
    const nodes = await pve.get<{ name: string; nodeid: string; ring0_addr: string }[]>('/cluster/config/nodes')

    await page.goto('/datacenter')
    await page.getByRole('link', { name: /创建、加入、节点管理/ }).click()
    await expect(page).toHaveURL(/\/datacenter\/cluster$/)
    await expect(page.getByTestId('cluster-name')).toHaveText(cluster!.name)
    await expect(page.getByTestId('cluster-overview')).toContainText('法定人数正常')
    await expect(page.getByTestId('cluster-overview')).toContainText(`配置版本 ${cluster!.version}`)
    await expect(page.getByTestId('cluster-node')).toHaveCount(nodes.length)
    for (const n of nodes) {
      const row = page.locator(`[data-testid="cluster-node"][data-node="${n.name}"]`)
      await expect(row).toContainText(n.ring0_addr)
      await expect(row).toContainText(n.nodeid)
    }
    await expect(page.locator(`[data-testid="cluster-node"][data-node="${pve.node}"]`)).toContainText('本节点')
    await expect(page.locator('[data-testid="corosync-link"][data-link="0"]')).toBeVisible()
    await expect(page.getByTestId('totem-facts')).toContainText('被动')
    expect(leaked).toEqual([])
  })

  test('加入信息：地址、指纹和编码串', async ({ page, pve }) => {
    test.skip(!(await labCluster(pve)), '实验机不是集群（需要 lab-cluster.env）')
    const leaked = await guardWrites(page)
    const join = await pve.get<{ preferred_node: string; totem: { cluster_name: string }; nodelist: { name: string; pve_addr: string; pve_fp: string }[] }>(
      '/cluster/config/join',
    )
    const me = join.nodelist.find((n) => n.name === join.preferred_node)!

    await page.goto('/datacenter/cluster')
    await page.getByRole('button', { name: '加入信息' }).click()
    const dialog = page.getByRole('dialog', { name: '加入信息' })
    await expect(dialog).toContainText(me.pve_addr)
    await expect(dialog).toContainText(me.pve_fp)
    const encoded = await dialog.getByTestId('join-info-text').inputValue()
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
    expect(decoded).toMatchObject({ ipAddress: me.pve_addr, fingerprint: me.pve_fp, totem: { cluster_name: join.totem.cluster_name } })
    expect(Object.keys(decoded)).toEqual(['ipAddress', 'fingerprint', 'peerLinks', 'ring_addr', 'totem'])

    // Another node's information: its own address.
    const other = join.nodelist.find((n) => n.name !== join.preferred_node)!
    await dialog.getByRole('combobox', { name: '通过节点' }).click()
    await page.getByRole('option', { name: other.name }).click()
    await expect(dialog).toContainText(other.pve_addr)

    await dialog.getByRole('button', { name: '二维码' }).click()
    await expect(dialog.getByRole('img', { name: '加入信息二维码' })).toBeVisible()
    expect(leaked).toEqual([])
  })
})

// --------------------------------------------------------- mocked: create

test.describe('cluster (mocked standalone node)', () => {
  let leaked: string[] = []
  let posted: URLSearchParams[] = []

  test.beforeEach(async ({ page, pve }) => {
    leaked = await guardWrites(page)
    posted = []
    await mockStandalone(page, pve.node)
    await mockTasks(page)
    await page.route('**/api2/json/cluster/config', (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      posted.push(new URLSearchParams(route.request().postData() ?? ''))
      return json(route, fakeUpid(pve.node, 'clustercreate'))
    })
    await page.route('**/api2/json/cluster/config/join', (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      posted.push(new URLSearchParams(route.request().postData() ?? ''))
      return json(route, fakeUpid(pve.node, 'clusterjoin'))
    })
  })

  test.afterEach(() => {
    expect(leaked, '集群写请求没有被模拟').toEqual([])
  })

  test('独立节点：创建集群（名称校验、两条链路和优先级）', async ({ page, pve }) => {
    await page.goto('/datacenter/cluster')
    await expect(page.getByTestId('cluster-standalone')).toContainText(`${pve.node} 还没有加入集群`)
    await page.getByRole('button', { name: '创建集群' }).click()
    const dialog = page.getByRole('dialog', { name: '创建集群' })
    // Link 0 is pre-filled with the node's first address.
    await expect(dialog.getByLabel('链路 0 地址')).toHaveValue('192.168.0.240')

    await dialog.getByRole('textbox', { name: /集群名称/ }).fill('bad_name')
    await dialog.getByRole('button', { name: '创建集群' }).click()
    await expect(dialog).toContainText('只能包含字母、数字和 -')
    expect(posted).toHaveLength(0)

    await dialog.getByRole('textbox', { name: /集群名称/ }).fill('e2e-prod')
    await dialog.getByRole('button', { name: '添加链路' }).click()
    await expect(dialog.getByLabel('链路 1 地址')).toHaveValue('10.10.10.40')
    await dialog.getByRole('button', { name: '链路 1 使用 fd00:10::40' }).click()
    await expect(dialog.getByLabel('链路 1 地址')).toHaveValue('fd00:10::40')
    await dialog.getByLabel('链路 1 优先级').fill('20')
    await dialog.getByRole('button', { name: '创建集群' }).click()

    await expect(dialog).toBeHidden()
    expect(posted).toHaveLength(1)
    expect(Object.fromEntries(posted[0]!)).toEqual({ clustername: 'e2e-prod', link0: '192.168.0.240', link1: 'address=fd00:10::40,priority=20' })
  })

  test('独立节点：辅助加入（粘贴加入信息、填写链路和密码）', async ({ page }) => {
    await page.goto('/datacenter/cluster')
    await page.getByRole('button', { name: '加入集群' }).click()
    const dialog = page.getByRole('dialog', { name: '加入集群' })
    await expect(dialog).toContainText(/还有 \d+ 台客户机/) // the lab node has the sample guests

    await dialog.getByRole('textbox', { name: '加入信息' }).fill('not a join string')
    await dialog.getByRole('button', { name: '加入', exact: true }).click()
    await expect(dialog).toContainText('这不是有效的加入信息')

    const encoded = encodedJoinInfo()
    await dialog.getByRole('textbox', { name: '加入信息' }).fill(encoded.replace(/(.{64})/g, '$1\n'))
    await expect(dialog.getByRole('status')).toContainText('集群 e2e-prod · 2 条链路')
    await expect(dialog.getByRole('textbox', { name: /对端地址/ })).toHaveValue('10.20.0.1')
    await expect(dialog.getByRole('textbox', { name: /对端证书指纹/ })).toHaveValue(FP)
    await expect(dialog).toContainText('对端在这条链路上的地址：10.30.0.1')
    // Join links have fixed numbers and no priority.
    await expect(dialog.getByLabel('链路 1 优先级')).toHaveCount(0)

    await dialog.getByRole('button', { name: '链路 0 使用 192.168.0.240' }).click()
    await dialog.getByLabel('链路 1 地址').fill('10.30.0.40')
    await dialog.getByLabel(/对端 root 密码/).fill('e2e-secret')
    await dialog.getByRole('button', { name: '加入 e2e-prod' }).click()

    await expect(page.getByRole('dialog', { name: '已加入集群' })).toBeVisible()
    expect(posted).toHaveLength(1)
    expect(Object.fromEntries(posted[0]!)).toEqual({
      hostname: '10.20.0.1',
      fingerprint: FP,
      password: 'e2e-secret',
      link0: '192.168.0.240',
      link1: '10.30.0.40',
    })
  })

  test('独立节点：手动加入校验指纹格式', async ({ page }) => {
    await page.goto('/datacenter/cluster')
    await page.getByRole('button', { name: '加入集群' }).click()
    const dialog = page.getByRole('dialog', { name: '加入集群' })
    await dialog.getByRole('switch', { name: '辅助加入' }).click()
    await dialog.getByRole('textbox', { name: /对端地址/ }).fill('10.20.0.1')
    await dialog.getByRole('textbox', { name: /对端证书指纹/ }).fill('AA:BB:CC')
    await dialog.getByLabel(/对端 root 密码/).fill('x')
    await dialog.getByRole('button', { name: '加入', exact: true }).click()
    await expect(dialog).toContainText('32 组两位十六进制数')
    expect(posted).toHaveLength(0)
    await dialog.getByRole('textbox', { name: /对端证书指纹/ }).fill(FP.toLowerCase())
    await dialog.getByRole('button', { name: '加入', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '已加入集群' })).toBeVisible()
    expect(Object.fromEntries(posted[0]!)).toMatchObject({ hostname: '10.20.0.1', fingerprint: FP, link0: '192.168.0.240' })
  })
})

// -------------------------------------------------------- mocked: cluster

test.describe('cluster (mocked cluster)', () => {
  test('离线节点、两条链路、QDevice 和移除节点说明', async ({ page, pve }) => {
    const leaked = await guardWrites(page)
    await mockCluster(page, pve.node)
    await page.goto('/datacenter/cluster')
    await expect(page.getByTestId('cluster-name')).toHaveText('e2e-prod')
    await expect(page.getByTestId('cluster-facts')).toContainText('2 / 3')
    await expect(page.locator('[data-node="e2e-c2"]')).toContainText('离线')
    await expect(page.locator('[data-testid="corosync-link"][data-link="1"]')).toContainText('优先级 20')
    await expect(page.locator('[data-testid="corosync-link"][data-link="1"]')).toContainText('10.10.10.42')
    await expect(page.getByTestId('qdevice-card')).toContainText('Connected')
    await expect(page.getByRole('button', { name: '创建集群' })).toHaveCount(0)

    await page.getByRole('button', { name: 'e2e-c2 的操作' }).click()
    await page.getByRole('menuitem', { name: '移除节点…' }).click()
    const dialog = page.getByRole('dialog', { name: '移除节点 e2e-c2' })
    await expect(dialog).toContainText('pvecm delnode e2e-c2')
    await expect(dialog).toContainText('先移除 QDevice')
    await expect(dialog.getByRole('link', { name: `打开 ${pve.node} 的 Shell` })).toBeVisible()
    await dialog.getByRole('button', { name: '关闭' }).first().click()
    await expect(dialog).toBeHidden()
    expect(leaked).toEqual([])
  })
})

// ------------------------------------------------------------------ phones

test.describe('cluster on phones', { tag: '@mobile' }, () => {
  test('独立节点：加入集群底部弹层', async ({ page, pve }) => {
    await guardWrites(page)
    await mockStandalone(page, pve.node)
    await page.goto('/datacenter/cluster')
    await page.getByRole('button', { name: '加入集群' }).click()
    const sheet = page.getByRole('dialog', { name: '加入集群' })
    await sheet.getByRole('textbox', { name: '加入信息' }).fill(encodedJoinInfo())
    await expect(sheet.getByLabel('链路 1 地址')).toBeVisible()
    const box = await sheet.getByLabel('链路 0 地址').boundingBox()
    expect(box!.width).toBeGreaterThan(150)
    await sheet.getByRole('button', { name: '取消' }).click()
    await expect(sheet).toBeHidden()
  })

  test('集群：节点列表和加入信息二维码', async ({ page, pve }) => {
    await mockCluster(page, pve.node)
    await page.goto('/datacenter/cluster')
    const row = page.locator('[data-node="e2e-c3"]')
    await expect(row).toContainText('ID 3')
    await expect(row).toContainText('链路1 10.10.10.42')
    await page.getByRole('button', { name: '加入信息' }).click()
    const sheet = page.getByRole('dialog', { name: '加入信息' })
    await sheet.getByRole('button', { name: '二维码' }).click()
    const qr = await sheet.getByRole('img', { name: '加入信息二维码' }).boundingBox()
    expect(qr!.width).toBeGreaterThan(250)
  })
})
