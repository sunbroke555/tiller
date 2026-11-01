import type { Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'
import { mockSdn } from './sdn.mocks'

// Areas sdn + sdn-fabrics: /datacenter/sdn.
//
// @lab (desktop, 3-node lab cluster, app server on pvelab-c1): only objects
// named e2e* — zones e2esz1 (simple) and e2esz2 (VLAN on vmbr0), VNets e2ev1 /
// e2ev2 (VLAN tag 3901), fabric e2ef1, route map e2erm, prefix list e2epl,
// controller e2ectl. Fabrics, route maps, prefix lists and controllers are
// created and deleted without applying. Zones / VNets are applied once, then
// removed and applied again so the running SDN config is empty; every node
// must stay reachable. External IPAM / DNS plugins are created against
// page.route() mocks (PVE would contact the servers). The suite skips when
// the lab does not have the three nodes, or when someone else has pending
// SDN changes (apply would push them too).
//
// @mobile: layout and navigation with the SDN API mocked.

const NODES = ['pvelab-c1', 'pvelab-c2', 'pvelab-c3']

interface Pending {
  state?: string
  pending?: Record<string, unknown>
  [key: string]: unknown
}

const idOf = (o: Pending, key: string) => String(o[key] ?? o.pending?.[key] ?? '')
const isE2e = (id: string) => id.startsWith('e2e')

async function sdnLists(pve: PveApi) {
  const [zones, vnets, controllers, fabrics, routeMaps, prefixLists] = await Promise.all([
    pve.get<Pending[]>('/cluster/sdn/zones', { pending: 1 }),
    pve.get<Pending[]>('/cluster/sdn/vnets', { pending: 1 }),
    pve.get<Pending[]>('/cluster/sdn/controllers', { pending: 1 }),
    pve.get<{ fabrics: Pending[]; nodes: Pending[] }>('/cluster/sdn/fabrics/all', { pending: 1 }),
    pve.get<Pending[]>('/cluster/sdn/route-maps/entries', { pending: 1 }),
    pve.get<Pending[]>('/cluster/sdn/prefix-lists', { pending: 1, verbose: 1 }),
  ])
  const subnets = (await Promise.all(vnets.map((v) => pve.get<Pending[]>(`/cluster/sdn/vnets/${idOf(v, 'vnet')}/subnets`, { pending: 1 })))).flat()
  return { zones, vnets, subnets, controllers, fabrics: fabrics.fabrics, fabricNodes: fabrics.nodes, routeMaps, prefixLists }
}

/** Pending changes on objects that are not ours (apply would push them too). */
async function foreignPending(pve: PveApi): Promise<string[]> {
  const l = await sdnLists(pve)
  const out: string[] = []
  const check = (list: Pending[], key: string) => {
    for (const o of list) if (o.state && !isE2e(idOf(o, key))) out.push(`${key} ${idOf(o, key)}`)
  }
  check(l.zones, 'zone')
  check(l.vnets, 'vnet')
  check(l.subnets, 'vnet')
  check(l.controllers, 'controller')
  check(l.fabrics, 'id')
  check(l.fabricNodes, 'fabric_id')
  check(l.routeMaps, 'route-map-id')
  check(l.prefixLists, 'id')
  return out
}

/** Delete every e2e* SDN object; apply when running config was touched. Returns whether it applied. */
async function cleanupSdn(pve: PveApi): Promise<boolean> {
  const l = await sdnLists(pve)
  let applyNeeded = false
  const del = async (o: Pending, path: string) => {
    if (o.state === 'deleted') {
      applyNeeded = true
      return
    }
    if (o.state !== 'new') applyNeeded = true
    await pve.del(path)
  }
  for (const s of l.subnets) if (isE2e(idOf(s, 'vnet'))) await del(s, `/cluster/sdn/vnets/${idOf(s, 'vnet')}/subnets/${idOf(s, 'subnet')}`)
  for (const v of l.vnets) if (isE2e(idOf(v, 'vnet'))) await del(v, `/cluster/sdn/vnets/${idOf(v, 'vnet')}`)
  for (const z of l.zones) if (isE2e(idOf(z, 'zone'))) await del(z, `/cluster/sdn/zones/${idOf(z, 'zone')}`)
  for (const c of l.controllers) if (isE2e(idOf(c, 'controller'))) await del(c, `/cluster/sdn/controllers/${idOf(c, 'controller')}`)
  for (const n of l.fabricNodes) if (isE2e(idOf(n, 'fabric_id'))) await del(n, `/cluster/sdn/fabrics/node/${idOf(n, 'fabric_id')}/${idOf(n, 'node_id')}`)
  for (const f of l.fabrics) if (isE2e(idOf(f, 'id'))) await del(f, `/cluster/sdn/fabrics/fabric/${idOf(f, 'id')}`)
  for (const r of l.routeMaps) if (isE2e(idOf(r, 'route-map-id'))) await del(r, `/cluster/sdn/route-maps/entries/${idOf(r, 'route-map-id')}/entry/${idOf(r, 'order')}`)
  for (const p of l.prefixLists) if (isE2e(idOf(p, 'id'))) await del(p, `/cluster/sdn/prefix-lists/${idOf(p, 'id')}`)
  if (applyNeeded) await pve.run('PUT', '/cluster/sdn', undefined, 180_000)
  return applyNeeded
}

/** All three nodes online and answering. */
async function expectNodesReachable(pve: PveApi) {
  await expect
    .poll(async () => (await pve.get<{ node: string; status: string }[]>('/nodes')).filter((n) => NODES.includes(n.node) && n.status === 'online').length, {
      timeout: 60_000,
    })
    .toBe(3)
  for (const n of NODES) expect((await pve.get<{ uptime: number }>(`/nodes/${n}/status`)).uptime).toBeGreaterThan(0)
}

async function pick(page: Page, label: string | RegExp, option: string | RegExp, scope = page.getByRole('dialog')) {
  await scope.getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: option }).first().click()
}

async function addByType(page: Page, card: string, type: RegExp) {
  await page.getByTestId(card).getByRole('button', { name: '添加', exact: true }).click()
  await page.getByRole('menuitem', { name: type }).click()
}

async function rowMenu(page: Page, row: ReturnType<Page['locator']>, item: string) {
  await row.getByRole('button', { name: /的操作$/ }).first().click()
  await page.getByRole('menuitem', { name: item }).click()
}

async function confirm(page: Page, label: string) {
  await page.getByRole('alertdialog').getByRole('button', { name: label, exact: true }).click()
  await expect(page.getByRole('alertdialog')).toBeHidden()
}

test.describe('SDN (lab cluster)', { tag: '@lab' }, () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ pve }) => {
    test.setTimeout(240_000)
    const nodes = (await pve.get<{ node: string; status: string }[]>('/nodes')).filter((n) => n.status === 'online').map((n) => n.node)
    test.skip(!NODES.every((n) => nodes.includes(n)), '需要 3 节点实验集群（lab-cluster.env）')
    await cleanupSdn(pve)
    const foreign = await foreignPending(pve)
    test.skip(foreign.length > 0, `实验集群上有别人未应用的 SDN 改动：${foreign.join(', ')}`)
  })

  test.afterAll(async ({ pve }) => {
    test.setTimeout(240_000)
    const nodes = (await pve.get<{ node: string }[]>('/nodes')).map((n) => n.node)
    if (!NODES.every((n) => nodes.includes(n))) return
    await cleanupSdn(pve)
    const l = await sdnLists(pve)
    expect([...l.zones, ...l.vnets].filter((o) => isE2e(idOf(o, 'zone') || idOf(o, 'vnet')))).toEqual([])
    await expectNodesReachable(pve)
  })

  test('前缀列表、Route Map、Fabric、控制器：添加和删除（不应用）', async ({ page, pve }) => {
    test.setTimeout(150_000)

    // Prefix list with a first entry, then a second entry.
    await page.goto('/datacenter/sdn/prefix-lists')
    await page.getByTestId('sdn-prefix-lists').getByRole('button', { name: '添加', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: '添加前缀列表' })
    await dialog.getByLabel('名称').fill('e2epl')
    await dialog.getByLabel('前缀').fill('10.0.0.0/8')
    await dialog.getByLabel('掩码 ≤ (le)').fill('24')
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()
    const pl = page.locator('[data-testid="sdn-prefix-list"][data-id="e2epl"]')
    await expect(pl).toContainText('10.0.0.0/8 le 24')
    await pl.getByRole('button', { name: '条目' }).click()
    dialog = page.getByRole('dialog', { name: '给 e2epl 添加条目' })
    await dialog.getByLabel('前缀').fill('192.168.0.0/16')
    await dialog.getByRole('radio', { name: '拒绝' }).click()
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(pl.getByTestId('sdn-prefix-entry')).toHaveCount(2)
    const list = await pve.get<{ entries: string[] }>('/cluster/sdn/prefix-lists/e2epl')
    expect(list.entries).toEqual(['action=permit,prefix=10.0.0.0/8,le=24,seq=5', 'action=deny,prefix=192.168.0.0/16,seq=10'])

    // Route map entry matching the prefix list.
    await page.goto('/datacenter/sdn/route-maps')
    await page.getByTestId('sdn-route-maps').getByRole('button', { name: '添加条目' }).click()
    dialog = page.getByRole('dialog', { name: '添加 Route Map 条目' })
    await dialog.getByLabel('Route Map').fill('e2erm')
    await dialog.getByRole('button', { name: '添加条件' }).click()
    await pick(page, '条件 1 属性', 'IPv4 前缀列表', dialog)
    await pick(page, '条件 1 值', 'e2epl', dialog)
    await dialog.getByRole('button', { name: '添加设置项' }).click()
    await pick(page, '设置项 1 属性', 'Metric', dialog)
    await dialog.getByLabel('设置项 1 值').fill('50')
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()
    const entry = page.locator('[data-testid="sdn-route-map-entry"][data-key="e2erm/10"]')
    await expect(entry).toContainText('匹配 IPv4 前缀列表 = e2epl')
    await expect(entry.getByTestId('sdn-pending')).toHaveText('待新增')
    const rm = await pve.get<{ match: string[]; set: string[]; action: string }>('/cluster/sdn/route-maps/entries/e2erm/entry/10')
    expect(rm).toMatchObject({ action: 'permit', match: ['key=ip-address-prefix-list,value=e2epl'], set: ['key=metric,value=50'] })

    // OpenFabric fabric with one node.
    await page.goto('/datacenter/sdn/fabrics')
    await addByType(page, 'sdn-fabrics', /^OpenFabric/)
    dialog = page.getByRole('dialog', { name: '添加 OpenFabric Fabric' })
    await dialog.getByLabel('名称').fill('e2ef1')
    await dialog.getByLabel('IPv4 前缀').fill('10.251.0.0/24')
    await dialog.getByLabel('Hello 间隔（秒）').fill('4')
    await pick(page, '路由过滤', 'e2epl', dialog)
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()
    await page.locator('[data-testid="sdn-fabric-row"][data-key="e2ef1"]').getByRole('link').click()
    await expect(page.getByTestId('sdn-fabric-detail')).toContainText('10.251.0.0/24')
    await page.getByRole('button', { name: '添加节点' }).click()
    dialog = page.getByRole('dialog', { name: '给 e2ef1 添加节点' })
    await pick(page, '节点', /pvelab-c1/, dialog)
    await dialog.getByLabel('路由器 IPv4').fill('10.251.0.1')
    await dialog.getByRole('button', { name: '添加接口' }).click()
    await pick(page, '接口 1', /^vmbr0/, dialog)
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()
    const nodeRow = page.locator('[data-testid="sdn-fabric-node-row"][data-key="pvelab-c1"]')
    await expect(nodeRow).toContainText('10.251.0.1')
    const fabric = await pve.get<{ fabrics: Pending[]; nodes: Pending[] }>('/cluster/sdn/fabrics/all', { pending: 1 })
    expect(fabric.fabrics.find((f) => idOf(f, 'id') === 'e2ef1')?.pending).toMatchObject({ hello_interval: 4, route_filter: 'e2epl' })
    expect(fabric.nodes.find((n) => idOf(n, 'fabric_id') === 'e2ef1')?.pending).toMatchObject({ ip: '10.251.0.1', interfaces: ['name=vmbr0'] })
    await rowMenu(page, nodeRow, '移除')
    await confirm(page, '删除')
    await expect(nodeRow).toBeHidden()
    await page.getByRole('button', { name: '删除 Fabric' }).click()
    await confirm(page, '删除')
    await expect(page.getByText('没有 Fabric e2ef1')).toBeVisible()

    // Route map and prefix list removed again.
    await page.goto('/datacenter/sdn/route-maps')
    await rowMenu(page, entry, '删除')
    await confirm(page, '删除')
    await expect(entry).toBeHidden()
    await page.goto('/datacenter/sdn/prefix-lists')
    await rowMenu(page, pl, '删除前缀列表')
    await confirm(page, '删除')
    await expect(pl).toBeHidden()

    // EVPN controller.
    await page.goto('/datacenter/sdn/options')
    await addByType(page, 'sdn-controllers', /^EVPN/)
    dialog = page.getByRole('dialog', { name: '添加 EVPN 控制器' })
    await dialog.getByLabel('ID').fill('e2ectl')
    await dialog.getByLabel('对等体').fill('192.0.2.1, 192.0.2.2')
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()
    const ctl = page.locator('[data-testid="sdn-controller-row"][data-key="e2ectl"]')
    await expect(ctl).toContainText('ASN 65000')
    const ctlCfg = await pve.get<Pending>('/cluster/sdn/controllers/e2ectl', { pending: 1 })
    expect(ctlCfg.pending).toMatchObject({ asn: 65000, peers: '192.0.2.1,192.0.2.2' })
    await rowMenu(page, ctl, '删除')
    await confirm(page, '删除')
    await expect(ctl).toBeHidden()

    expect(await foreignPending(pve)).toEqual([])
    const left = await sdnLists(pve)
    expect([...left.controllers, ...left.fabrics, ...left.routeMaps, ...left.prefixLists].filter((o) => o.state)).toEqual([])
  })

  test('外部 IPAM 和 DNS 插件（写请求用 page.route 模拟）', async ({ page }) => {
    const posts: { path: string; body: URLSearchParams }[] = []
    await page.route('**/api2/json/cluster/sdn/{ipams,dns}', (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      posts.push({ path: new URL(route.request().url()).pathname, body: new URLSearchParams(route.request().postData() ?? '') })
      return route.fulfill({ json: { data: null } })
    })
    await page.goto('/datacenter/sdn/options')
    await addByType(page, 'sdn-ipams', /^NetBox/)
    let dialog = page.getByRole('dialog', { name: '添加 NetBox IPAM' })
    await dialog.getByLabel('ID').fill('e2enb')
    await dialog.getByLabel('URL').fill('https://netbox.example/api')
    await dialog.getByLabel('令牌').fill('secret')
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()
    await addByType(page, 'sdn-dns', /^PowerDNS/)
    dialog = page.getByRole('dialog', { name: '添加 PowerDNS' })
    await dialog.getByLabel('ID').fill('e2edns')
    await dialog.getByLabel('URL').fill('http://pdns.example:8081/api/v1/servers/localhost')
    await dialog.getByLabel('API 密钥').fill('key')
    await dialog.getByLabel('TTL').fill('300')
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(posts.map((p) => [p.path, Object.fromEntries(p.body)])).toEqual([
      ['/api2/json/cluster/sdn/ipams', { type: 'netbox', ipam: 'e2enb', url: 'https://netbox.example/api', token: 'secret' }],
      ['/api2/json/cluster/sdn/dns', { type: 'powerdns', dns: 'e2edns', url: 'http://pdns.example:8081/api/v1/servers/localhost', key: 'key', ttl: '300' }],
    ])
  })

  test('Zone、VNet、子网：添加、差异预览、应用、运行状态、丢弃改动、清理', async ({ page, pve }) => {
    test.setTimeout(300_000)

    // Simple zone.
    await page.goto('/datacenter/sdn/zones')
    await addByType(page, 'sdn-zones', /^Simple/)
    let dialog = page.getByRole('dialog', { name: '添加 Simple Zone' })
    await dialog.getByLabel('ID').fill('e2esz1')
    // Automatic DHCP stays off: the lab nodes have no dnsmasq (apply would fail).
    await expect(dialog.getByRole('switch', { name: '自动 DHCP' })).not.toBeChecked()
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()
    const z1 = page.locator('[data-testid="sdn-zone-row"][data-key="e2esz1"]')
    await expect(z1.getByTestId('sdn-pending')).toHaveText('待新增')

    // VLAN zone on vmbr0.
    await addByType(page, 'sdn-zones', /^VLAN/)
    dialog = page.getByRole('dialog', { name: '添加 VLAN Zone' })
    await dialog.getByLabel('ID').fill('e2esz2')
    await dialog.getByLabel('网桥').fill('vmbr0')
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('[data-testid="sdn-zone-row"][data-key="e2esz2"]')).toContainText('网桥 vmbr0')
    await expect(page.getByTestId('sdn-pending-bar')).toContainText('Zone 2')

    // VNets: one per zone (VLAN tag ≥ 3900).
    await page.goto('/datacenter/sdn/vnets')
    for (const [vnet, zone, tag] of [
      ['e2ev1', 'e2esz1', ''],
      ['e2ev2', 'e2esz2', '3901'],
    ] as const) {
      await page.getByTestId('sdn-vnets').getByRole('button', { name: '添加', exact: true }).click()
      dialog = page.getByRole('dialog', { name: '添加 VNet' })
      await dialog.getByLabel('名称').fill(vnet)
      await pick(page, 'Zone', new RegExp(`^${zone}`), dialog)
      if (tag) await dialog.getByLabel('VLAN 标签').fill(tag)
      else await expect(dialog.getByLabel('VLAN 标签')).toBeDisabled()
      await dialog.getByRole('button', { name: '添加', exact: true }).click()
      await expect(dialog).toBeHidden()
    }
    await expect(page.locator('[data-testid="sdn-vnet-row"][data-key="e2ev2"]')).toContainText('VLAN 标签 3901')
    expect(await pve.get<Pending>('/cluster/sdn/vnets/e2ev2', { pending: 1 })).toMatchObject({ pending: { zone: 'e2esz2', tag: 3901 } })

    // Subnet with gateway, SNAT and a DHCP range.
    await page.locator('[data-testid="sdn-vnet-row"][data-key="e2ev1"]').getByRole('link').click()
    await page.getByRole('button', { name: '添加子网' }).click()
    dialog = page.getByRole('dialog', { name: '给 e2ev1 添加子网' })
    await dialog.getByLabel('子网').fill('10.250.1.0/24')
    await dialog.getByLabel('网关').fill('10.250.1.1')
    await dialog.getByRole('switch', { name: 'SNAT' }).click()
    await dialog.getByRole('button', { name: '添加范围' }).click()
    await dialog.getByLabel('范围 1 起始地址').fill('10.250.1.100')
    await dialog.getByLabel('范围 1 结束地址').fill('10.250.1.150')
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()
    const subnet = page.locator('[data-testid="sdn-subnet-row"][data-key="10.250.1.0/24"]')
    await expect(subnet).toContainText('DHCP 10.250.1.100–10.250.1.150')
    const sub = await pve.get<Pending>('/cluster/sdn/vnets/e2ev1/subnets/e2esz1-10.250.1.0-24')
    expect(sub).toMatchObject({ gateway: '10.250.1.1', snat: 1, 'dhcp-range': [{ 'start-address': '10.250.1.100', 'end-address': '10.250.1.150' }] })
    await expect(page.getByTestId('sdn-vnet-detail')).toContainText('应用 SDN 配置后才能给新的 VNet 配置防火墙')

    // Dry run shows the new bridges.
    await page.getByTestId('sdn-pending-bar').getByRole('button', { name: '差异预览' }).click()
    dialog = page.getByRole('dialog', { name: '待应用的 SDN 改动' })
    await dialog.getByRole('combobox').click()
    await page.getByRole('option', { name: /pvelab-c1/ }).click()
    await expect(dialog).toContainText('auto e2ev1', { timeout: 30_000 })
    await expect(dialog).toContainText('e2ev2')
    await dialog.getByRole('button', { name: '关闭' }).first().click()

    // Apply.
    expect(await foreignPending(pve)).toEqual([])
    await page.getByTestId('sdn-pending-bar').getByRole('button', { name: '应用', exact: true }).click()
    await confirm(page, '应用')
    await expect
      .poll(async () => (await sdnLists(pve)).zones.filter((z) => isE2e(idOf(z, 'zone')) && z.state).length, { timeout: 120_000 })
      .toBe(0)
    await expect(page.getByTestId('sdn-pending-bar')).toBeHidden({ timeout: 30_000 })
    await expect
      .poll(
        async () =>
          (await pve.get<{ type: string; network?: string; status?: string }[]>('/cluster/resources')).filter(
            (r) => r.type === 'network' && r.network === 'e2esz1' && (r.status === 'ok' || r.status === 'available'),
          ).length,
        { timeout: 90_000 },
      )
      .toBe(3)
    await expectNodesReachable(pve)

    // Overview status, runtime of the zone on a node, VNet firewall, IPAM.
    await page.goto('/datacenter/sdn')
    await expect(page.locator('[data-testid="sdn-status-row"][data-name="e2esz1"]')).toContainText('pvelab-c3')
    await page.goto('/datacenter/sdn/zones/e2esz1')
    await expect(page.getByTestId('sdn-zone-runtime')).toContainText('e2ev1', { timeout: 30_000 })
    await expect(page.getByTestId('sdn-zone-runtime')).toContainText('可用')
    await page.goto('/datacenter/sdn/vnets/e2ev1')
    await expect(page.getByRole('navigation', { name: '防火墙' })).toBeVisible()
    // PVE lists IPAM entries only for zones with automatic DHCP (not possible here: no dnsmasq).
    await page.goto('/datacenter/sdn/ipam')
    await expect(page.getByTestId('sdn-ipam')).toContainText('自动 DHCP')

    // A pending change, then discarded with rollback.
    await page.goto('/datacenter/sdn/zones')
    await rowMenu(page, z1, '编辑')
    dialog = page.getByRole('dialog', { name: '编辑 Zone e2esz1' })
    await dialog.getByLabel('MTU').fill('1400')
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toBeHidden()
    await expect(z1.getByTestId('sdn-pending')).toHaveText('待修改')
    await page.getByTestId('sdn-pending-bar').getByRole('button', { name: '更多 SDN 操作' }).click()
    await page.getByRole('menuitem', { name: '丢弃未应用的改动' }).click()
    await confirm(page, '丢弃')
    await expect(z1.getByTestId('sdn-pending')).toBeHidden()
    expect((await pve.get<Pending>('/cluster/sdn/zones/e2esz1', { pending: 1 })).mtu).toBeUndefined()

    // Remove everything and apply again (running config clean, nodes reachable).
    expect(await cleanupSdn(pve)).toBe(true)
    const left = await sdnLists(pve)
    expect([...left.zones, ...left.vnets, ...left.subnets].filter((o) => isE2e(idOf(o, 'zone') || idOf(o, 'vnet')))).toEqual([])
    await expectNodesReachable(pve)
  })
})

test.describe('SDN on phones', { tag: '@mobile' }, () => {
  test.beforeEach(async ({ page }) => mockSdn(page))

  test('概览、Zone 列表与待应用标记、添加表单', async ({ page }) => {
    await page.goto('/datacenter/sdn')
    await expect(page.getByTestId('sdn-apply-card')).toContainText('项改动未应用')
    await expect(page.locator('[data-testid="sdn-status-row"][data-name="evpn1"]')).toContainText('错误')
    await page.getByRole('navigation', { name: 'SDN' }).getByRole('link', { name: 'Zone' }).click()
    await expect(page.getByTestId('sdn-pending-bar')).toBeVisible()
    await expect(page.locator('[data-testid="sdn-zone-row"][data-key="tenants"]').getByTestId('sdn-pending')).toHaveText('待新增')
    await expect(page.locator('[data-testid="sdn-zone-row"][data-key="evpn1"]').getByTestId('sdn-pending')).toHaveText('待修改')
    await addByType(page, 'sdn-zones', /^EVPN/)
    const dialog = page.getByRole('dialog', { name: '添加 EVPN Zone' })
    await expect(dialog.getByRole('combobox', { name: '控制器' })).toBeVisible()
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
  })

  test('VNet 详情（子网、防火墙）、IPAM 与 Fabric 详情（节点、路由）', async ({ page }) => {
    await page.goto('/datacenter/sdn/vnets')
    await page.locator('[data-testid="sdn-vnet-row"][data-key="labnet"]').getByRole('link').click()
    await expect(page.locator('[data-testid="sdn-subnet-row"][data-key="10.20.0.0/24"]')).toContainText('DHCP 10.20.0.100–10.20.0.199')
    await expect(page.getByRole('heading', { name: /防火墙/ })).toBeVisible()
    await page.getByRole('navigation', { name: 'SDN' }).getByRole('link', { name: 'IPAM' }).click()
    await expect(page.locator('[data-testid="sdn-ipam-entry"][data-ip="10.20.0.1"]')).toContainText('网关')
    await expect(page.locator('[data-testid="sdn-ipam-entry"][data-ip="10.20.0.101"]')).toContainText('tiny-vm')
    await page.goto('/datacenter/sdn/fabrics/under')
    await expect(page.getByTestId('sdn-fabric-nodes').getByTestId('sdn-fabric-node-row')).toHaveCount(3)
    // Runtime rows need the mocked member nodes to be online (lab cluster); a single-node lab shows the offline note.
    await expect(page.getByTestId('sdn-fabric-runtime')).toContainText(/10\.10\.0\.2\/32|都不在线/)
    const box = await page.getByTestId('sdn-fabric-runtime').boundingBox()
    expect(box!.width).toBeLessThanOrEqual(390)
  })
})
