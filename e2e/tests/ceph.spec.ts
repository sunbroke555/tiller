import { appPath, expect, mockRootPamInstance, test, type PveApi } from '../fixtures'

// Area ceph: status, monitors / managers, OSDs, pools, CephFS + MDS,
// configuration, log, the node tab and the install wizard.
//
// @lab (desktop): needs the 3-node lab cluster (lab-cluster.env) with Ceph
// installed and initialised (docs/LAB.md). Missing monitors and OSDs (one per
// node: sdc on the first two nodes, sdb on the third) are created through the
// UI and left in place; everything else the tests create is named e2e-ceph-*
// and removed again (pool, CephFS with its pools, MDS, a second manager, the
// noout flag). Without the cluster or without Ceph the suite is skipped.
//
// The other tests mock the Ceph API with page.route(): the install wizard
// (termproxy and init are intercepted, nothing runs) and the phone layout.

const labNodes = (process.env.PVE_LAB_NODES ?? '').split(',').filter(Boolean)
/** OSD disk per lab node (sdb of the first two nodes holds the replication pool). */
const OSD_DISKS = ['/dev/sdc', '/dev/sdc', '/dev/sdb']

const POOL = 'e2e-ceph-pool'
const FS = 'e2e-ceph-fs'
const MDS = 'e2e-ceph-mds'

interface OsdTreeNode {
  id: string
  name: string
  type: string
  status?: string
  children?: OsdTreeNode[]
}

async function cephAvailable(pve: PveApi): Promise<boolean> {
  try {
    await pve.get('/cluster/ceph/status')
    return true
  } catch {
    return false
  }
}

async function osdHostsOf(pve: PveApi): Promise<Map<string, OsdTreeNode[]>> {
  const tree = await pve.get<{ root: { children?: OsdTreeNode[] } }>(`/nodes/${pve.node}/ceph/osd`)
  const out = new Map<string, OsdTreeNode[]>()
  const walk = (nodes: OsdTreeNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === 'host') out.set(n.name, (n.children ?? []).filter((c) => c.type === 'osd'))
      else walk(n.children)
    }
  }
  walk(tree.root.children)
  return out
}

async function cleanup(pve: PveApi, second: string | undefined) {
  // MDS first: Ceph removes a file system only when no MDS serves it.
  const mds = await pve.get<{ name: string; host?: string }[]>(`/nodes/${pve.node}/ceph/mds`).catch(() => [])
  for (const m of mds.filter((x) => x.name === MDS)) await pve.run('DELETE', `/nodes/${m.host ?? pve.node}/ceph/mds/${MDS}`).catch(() => undefined)
  const fsList = await pve.get<{ name: string }[]>(`/nodes/${pve.node}/ceph/fs`).catch(() => [])
  if (fsList.some((f) => f.name === FS)) {
    await pve.run('DELETE', `/nodes/${pve.node}/ceph/fs/${FS}`, { 'remove-pools': 1, 'remove-storages': 1 }).catch(() => undefined)
  }
  const pools = await pve.get<{ pool_name: string }[]>(`/nodes/${pve.node}/ceph/pool`).catch(() => [])
  for (const p of pools.filter((x) => x.pool_name.startsWith('e2e-ceph'))) {
    await pve.run('DELETE', `/nodes/${pve.node}/ceph/pool/${p.pool_name}`, { remove_storages: 1, force: 1 }).catch(() => undefined)
  }
  if (second) {
    const mgrs = await pve.get<{ name: string }[]>(`/nodes/${pve.node}/ceph/mgr`).catch(() => [])
    if (mgrs.some((m) => m.name === second) && mgrs.length > 1) await pve.run('DELETE', `/nodes/${second}/ceph/mgr/${second}`).catch(() => undefined)
  }
  await pve.put('/cluster/ceph/flags/noout', { value: 0 }).catch(() => undefined)
}

test.describe('ceph (lab cluster)', { tag: '@lab' }, () => {
  test.describe.configure({ mode: 'serial' })
  let nodes: string[] = []

  test.beforeAll(async ({ pve }) => {
    test.setTimeout(120_000)
    const online = (await pve.get<{ node: string; status: string }[]>('/nodes')).filter((n) => n.status === 'online').map((n) => n.node)
    nodes = (labNodes.length ? labNodes : online).filter((n) => online.includes(n)).sort()
    test.skip(nodes.length < 3, '需要 3 节点实验集群（lab-cluster.env）')
    test.skip(!(await cephAvailable(pve)), '实验集群上没有安装 / 初始化 Ceph（docs/LAB.md）')
    await cleanup(pve, nodes[1])
  })

  test.afterAll(async ({ pve }) => {
    test.setTimeout(180_000)
    if (nodes.length >= 3 && (await cephAvailable(pve))) await cleanup(pve, nodes[1])
  })

  test('状态：健康、PG、OSD 和服务', async ({ page, pve }) => {
    await page.goto('/datacenter/ceph')
    await expect(page.getByRole('navigation', { name: 'Ceph' })).toBeVisible()
    await expect(page.getByTestId('ceph-health-status')).toContainText(/HEALTH_(OK|WARN|ERR)/)
    await expect(page.getByTestId('ceph-services').locator(`[data-service="mon.${pve.node}"]`)).toBeVisible()
    await expect(page.getByTestId('ceph-osds')).toBeVisible()
    await expect(page.getByTestId('ceph-usage')).toContainText('已用')
  })

  test('监视器：用界面创建缺少的监视器（每个节点一个）', async ({ page, pve }) => {
    test.setTimeout(300_000)
    await page.goto('/datacenter/ceph/services')
    const list = page.getByTestId('ceph-mon-list')
    await expect(list.locator('[data-service]').first()).toBeVisible()
    const mons = await pve.get<{ name: string }[]>(`/nodes/${pve.node}/ceph/mon`)
    for (const node of nodes.filter((n) => !mons.some((m) => m.name === n))) {
      await list.getByRole('button', { name: '创建' }).click()
      const dialog = page.getByRole('dialog', { name: '创建监视器' })
      await dialog.getByRole('combobox').first().click()
      await page.getByRole('option', { name: new RegExp(`^${node}`) }).click()
      await dialog.getByRole('button', { name: '创建', exact: true }).click()
      await expect(dialog).toBeHidden({ timeout: 30_000 })
      await expect(list.locator(`[data-service="mon.${node}"]`).getByTestId('service-state')).toHaveText('运行中 · 法定人数', { timeout: 150_000 })
    }
    await expect(list.locator('[data-service]')).toHaveCount(nodes.length)
  })

  test('管理器：创建备用管理器，再销毁', async ({ page }) => {
    test.setTimeout(180_000)
    const node = nodes[1]!
    await page.goto('/datacenter/ceph/services')
    const list = page.getByTestId('ceph-mgr-list')
    await list.getByRole('button', { name: '创建' }).click()
    const dialog = page.getByRole('dialog', { name: '创建管理器' })
    await dialog.getByRole('combobox').first().click()
    await page.getByRole('option', { name: new RegExp(`^${node}`) }).click()
    await dialog.getByRole('button', { name: '创建', exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })
    const row = list.locator(`[data-service="mgr.${node}"]`)
    await expect(row.getByTestId('service-state')).toHaveText('备用', { timeout: 90_000 })

    await row.getByRole('button', { name: `mgr.${node} 操作` }).click()
    await page.getByRole('menuitem', { name: '销毁' }).click()
    const confirm = page.getByRole('alertdialog')
    await confirm.getByRole('textbox').fill(node)
    await confirm.getByRole('button', { name: '销毁' }).click()
    await expect(row).toBeHidden({ timeout: 90_000 })
  })

  test('OSD：用界面在每个节点创建一个 OSD（缺少时）', async ({ page, pve }) => {
    test.setTimeout(480_000)
    const hosts = await osdHostsOf(pve)
    await page.goto('/datacenter/ceph/osd')
    await expect(page.getByRole('button', { name: '创建 OSD' }).first()).toBeVisible()
    for (const [i, node] of nodes.entries()) {
      if ((hosts.get(node) ?? []).length > 0) continue
      const disk = OSD_DISKS[i]!
      await page.getByRole('button', { name: '创建 OSD' }).first().click()
      const dialog = page.getByRole('dialog', { name: '创建 OSD' })
      await dialog.getByRole('combobox').first().click()
      await page.getByRole('option', { name: new RegExp(`^${node}`) }).click()
      await dialog.getByRole('combobox', { name: '磁盘', exact: true }).click()
      await page.getByRole('option', { name: new RegExp(`^${disk}`) }).click()
      await dialog.getByRole('button', { name: '创建', exact: true }).click()
      await expect(dialog).toBeHidden({ timeout: 30_000 })
      await expect(page.getByTestId(`osd-host-${node}`).locator('[data-osd]').first().getByTestId('osd-up')).toHaveText('up', { timeout: 180_000 })
    }
    for (const node of nodes) await expect(page.getByTestId(`osd-host-${node}`).locator('[data-osd]')).not.toHaveCount(0)
  })

  test('OSD：详情、清洗、全局标志 noout', async ({ page, pve }) => {
    test.setTimeout(150_000)
    const osd = (await osdHostsOf(pve)).get(pve.node)?.[0]
    expect(osd, `${pve.node} 上应有 OSD`).toBeTruthy()
    const id = Number(osd!.id)
    await page.goto('/datacenter/ceph/osd')
    const row = page.locator(`[data-osd="${id}"]`)
    await row.getByRole('button', { name: new RegExp(`osd\\.${id}`) }).first().click()
    const details = page.getByRole('dialog', { name: `osd.${id}` })
    await expect(details.locator('[data-device="block"]')).toContainText('/dev/')
    await page.keyboard.press('Escape')

    await row.getByRole('button', { name: `osd.${id} 操作` }).click()
    await page.getByRole('menuitem', { name: '清洗', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '清洗' }).click()
    await expect(page.getByText(`已要求 osd.${id} 清洗`)).toBeVisible()

    // noout on, then off again.
    await page.getByRole('button', { name: '全局标志', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: '全局 OSD 标志' })
    await dialog.getByRole('checkbox', { name: /noout/ }).click()
    await dialog.getByRole('button', { name: '应用' }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })
    await expect(page.getByTestId('osd-flags')).toContainText('noout', { timeout: 30_000 })
    expect((await pve.get<{ name: string; value: number }[]>('/cluster/ceph/flags')).find((f) => f.name === 'noout')?.value).toBe(1)

    await page.getByRole('button', { name: '全局标志', exact: true }).click()
    dialog = page.getByRole('dialog', { name: '全局 OSD 标志' })
    await expect(dialog.getByRole('checkbox', { name: /noout/ })).toBeChecked()
    await dialog.getByRole('checkbox', { name: /noout/ }).click()
    await dialog.getByRole('button', { name: '应用' }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })
    await expect(page.getByTestId('osd-flags')).toBeHidden({ timeout: 30_000 })
  })

  test('存储池：创建（添加为存储）、编辑、销毁', async ({ page, pve }) => {
    test.setTimeout(240_000)
    await page.goto('/datacenter/ceph/pools')
    await page.getByRole('button', { name: /^创建/ }).first().click()
    let dialog = page.getByRole('dialog', { name: '创建存储池' })
    await dialog.getByLabel('名称').fill(POOL)
    await expect(dialog.getByLabel('副本数', { exact: true })).toHaveValue('3')
    await dialog.getByLabel('PG 数', { exact: true }).fill('16')
    // min_size 1 warns.
    await dialog.getByLabel('最小副本数', { exact: true }).fill('1')
    await expect(dialog.getByText(/min_size 为 1/)).toBeVisible()
    await dialog.getByLabel('最小副本数', { exact: true }).fill('2')
    await dialog.getByRole('button', { name: '创建', exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 60_000 })
    const row = page.locator(`[data-pool="${POOL}"]`)
    await expect(row).toBeVisible({ timeout: 60_000 })
    await expect(row.getByTestId('pool-size')).toHaveText('3/2')
    const storages = await pve.get<{ storage: string; type: string; pool?: string }[]>('/storage')
    expect(storages.find((s) => s.storage === POOL)).toMatchObject({ type: 'rbd', pool: POOL })

    await row.getByRole('button', { name: `${POOL} 操作` }).click()
    await page.getByRole('menuitem', { name: '编辑' }).click()
    dialog = page.getByRole('dialog', { name: `编辑存储池 ${POOL}` })
    await expect(dialog.getByLabel('名称')).toBeDisabled()
    await dialog.getByRole('combobox', { name: 'PG 自动伸缩' }).click()
    await page.getByRole('option', { name: /^warn/ }).click()
    await dialog.getByRole('button', { name: '自动伸缩目标' }).click()
    await dialog.getByLabel('目标比例').fill('0.2')
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toBeHidden({ timeout: 60_000 })
    // The PUT is a task that applies the settings one after another.
    await expect
      .poll(
        async () => {
          const st = await pve.get<{ pg_autoscale_mode: string; target_size_ratio?: number | null }>(`/nodes/${pve.node}/ceph/pool/${POOL}/status`)
          return [st.pg_autoscale_mode, st.target_size_ratio]
        },
        { timeout: 60_000 },
      )
      .toEqual(['warn', 0.2])

    await row.getByRole('button', { name: `${POOL} 操作` }).click()
    await page.getByRole('menuitem', { name: '销毁' }).click()
    dialog = page.getByRole('dialog', { name: `销毁存储池 ${POOL}` })
    await expect(dialog.getByRole('button', { name: '销毁' })).toBeDisabled()
    await dialog.getByLabel('确认名称').fill(POOL)
    // PVE 9.2 with Ceph 19.2.6 rejects the copied admin keyring (new key format) in the
    // "RBD images left?" check, so a plain destroy fails on the lab: destroy with force.
    await dialog.getByRole('checkbox', { name: '强制销毁' }).click()
    await dialog.getByRole('button', { name: '销毁' }).click()
    await expect(row).toBeHidden({ timeout: 90_000 })
    expect((await pve.get<{ storage: string }[]>('/storage')).some((s) => s.storage === POOL)).toBe(false)
  })

  test('CephFS：创建 MDS 和文件系统，再销毁', async ({ page, pve }) => {
    test.setTimeout(360_000)
    await page.goto('/datacenter/ceph/cephfs')
    const mdsList = page.getByTestId('ceph-mds-list')
    await mdsList.getByRole('button', { name: '创建' }).click()
    let dialog = page.getByRole('dialog', { name: '创建元数据服务器' })
    await dialog.getByRole('combobox').first().click()
    await page.getByRole('option', { name: new RegExp(`^${pve.node}`) }).click()
    await expect(dialog.getByLabel('MDS ID')).toHaveValue(pve.node)
    await dialog.getByLabel('MDS ID').fill(MDS)
    await dialog.getByRole('button', { name: '创建', exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 60_000 })
    const mdsRow = mdsList.locator(`[data-service="mds.${MDS}"]`)
    await expect(mdsRow.getByTestId('service-state')).toHaveText('备用', { timeout: 90_000 })

    await page.getByRole('button', { name: '创建 CephFS' }).click()
    dialog = page.getByRole('dialog', { name: '创建 CephFS' })
    await dialog.getByLabel('名称').fill(FS)
    await dialog.getByLabel('PG 数').fill('16')
    await dialog.getByRole('switch', { name: /添加为存储/ }).click()
    await dialog.getByRole('button', { name: '创建', exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 120_000 })
    const fsRow = page.locator(`[data-cephfs="${FS}"]`)
    await expect(fsRow).toContainText(`${FS}_data`, { timeout: 60_000 })
    await expect(mdsRow.getByTestId('service-state')).toHaveText('活动', { timeout: 90_000 })

    await fsRow.getByRole('button', { name: `${FS} 操作` }).click()
    await page.getByRole('menuitem', { name: '销毁' }).click()
    dialog = page.getByRole('dialog', { name: `销毁 CephFS ${FS}` })
    await expect(dialog.getByRole('checkbox', { name: '先停止元数据服务器' })).toBeChecked()
    await expect(dialog).toContainText(`mds.${MDS}`)
    await dialog.getByLabel('确认名称').fill(FS)
    await dialog.getByRole('button', { name: '销毁' }).click()
    await expect(fsRow).toBeHidden({ timeout: 120_000 })
    await expect(mdsRow.getByTestId('service-state')).toHaveText(/已停止|未知/, { timeout: 60_000 })
    const pools = await pve.get<{ pool_name: string }[]>(`/nodes/${pve.node}/ceph/pool`)
    expect(pools.filter((p) => p.pool_name.startsWith(FS))).toEqual([])

    await mdsRow.getByRole('button', { name: `mds.${MDS} 操作` }).click()
    await page.getByRole('menuitem', { name: '销毁' }).click()
    const confirm = page.getByRole('alertdialog')
    await confirm.getByRole('textbox').fill(MDS)
    await confirm.getByRole('button', { name: '销毁' }).click()
    await expect(mdsRow).toBeHidden({ timeout: 90_000 })
  })

  test('配置、CRUSH 映射和日志', async ({ page }) => {
    await page.goto('/datacenter/ceph/config')
    await expect(page.getByLabel('ceph.conf 内容')).toContainText('fsid')
    await page.getByRole('tab', { name: '配置数据库' }).click()
    await expect(page.locator('[data-config="osd_memory_target"]')).toBeVisible()
    await page.getByLabel('筛选配置').fill('memory')
    await expect(page.locator('[data-config]')).toHaveCount(1)
    await page.getByRole('tab', { name: 'CRUSH 映射' }).click()
    await expect(page.getByLabel('CRUSH 映射内容')).toContainText('begin crush map')

    await page.getByRole('navigation', { name: 'Ceph' }).getByRole('link', { name: '日志' }).click()
    await expect(page.getByLabel('日志内容')).toContainText('cluster')
  })

  test('节点页 Ceph 标签', async ({ page, pve }) => {
    await page.goto(`/node/${pve.node}/ceph`)
    await expect(page.getByTestId('node-ceph-health')).toBeVisible()
    await expect(page.getByTestId('ceph-mon-list').locator(`[data-service="mon.${pve.node}"]`)).toBeVisible()
    await expect(page.getByTestId(`osd-host-${pve.node}`)).toBeVisible()
    await expect(page.getByRole('link', { name: /集群 Ceph/ })).toHaveAttribute('href', appPath('/datacenter/ceph'))
  })
})

// ------------------------------------------------------------------ mocked

const NOT_INSTALLED = { status: 500, json: { data: null, message: 'binary not installed: /usr/bin/ceph-mon\n' } }
const NOT_INITIALIZED = { status: 500, json: { data: null, message: "pveceph configuration not initialized - missing '/etc/pve/ceph.conf'\n" } }

test('安装向导：版本、安装 Shell 的参数、初始配置', async ({ page, pve }) => {
  const node = pve.node
  let installed = false
  let termproxy: URLSearchParams | null = null
  let init: URLSearchParams | null = null
  let mon = ''
  // Only root@pam may run the install shell; the lab connection is a root@pam
  // API token. termproxy and init are intercepted, nothing runs as root.
  await mockRootPamInstance(page)
  await page.route('**/api2/json/cluster/ceph/**', (route) => route.fulfill(NOT_INSTALLED))
  await page.route(`**/api2/json/nodes/*/ceph/status`, (route) => route.fulfill(installed ? NOT_INITIALIZED : NOT_INSTALLED))
  await page.route(`**/api2/json/nodes/${node}/subscription`, (route) => route.fulfill({ json: { data: { status: 'notfound' } } }))
  await page.route(`**/api2/json/nodes/${node}/termproxy`, (route) => {
    termproxy = new URLSearchParams(route.request().postData() ?? '')
    return route.fulfill({ status: 500, json: { data: null, message: 'mocked' } })
  })
  await page.route(`**/api2/json/nodes/${node}/ceph/init`, (route) => {
    init = new URLSearchParams(route.request().postData() ?? '')
    return route.fulfill({ json: { data: null } })
  })
  const upid = `UPID:${node}:0000AAAA:0000BBBB:6740A000:cephcreatemon:mon.${node}:root@pam:`
  await page.route(`**/api2/json/nodes/${node}/ceph/mon/*`, (route) => {
    mon = route.request().url()
    return route.fulfill({ json: { data: upid } })
  })
  await page.route(`**/api2/json/nodes/${node}/tasks/*/status`, (route) =>
    route.fulfill({ json: { data: { upid, node, status: 'stopped', exitstatus: 'OK', type: 'cephcreatemon', id: `mon.${node}`, user: 'root@pam', starttime: 1, pid: 1 } } }),
  )
  await page.route(`**/api2/json/nodes/${node}/tasks/*/log*`, (route) => route.fulfill({ json: { data: [{ n: 1, t: 'TASK OK' }], total: 1 } }))

  await page.goto('/datacenter/ceph')
  await expect(page.getByRole('heading', { name: 'Ceph 尚未安装' })).toBeVisible()
  await page.getByTestId('ceph-install').click()
  await expect(page).toHaveURL(/\/datacenter\/ceph\/install$/)

  const wizard = page.getByTestId('ceph-install-wizard')
  await wizard.getByRole('combobox').first().click()
  await page.getByRole('option', { name: new RegExp(`^${node}`) }).click()
  await wizard.getByRole('combobox', { name: 'Ceph 版本' }).click()
  await page.getByRole('option', { name: /^squid/ }).click()
  // No subscription: no-subscription is preselected, with its hint.
  await expect(wizard.getByRole('combobox', { name: '软件源' })).toContainText('无订阅')
  await expect(wizard.getByText('无订阅软件源不适合生产环境。')).toBeVisible()
  await page.getByTestId('ceph-install-start').click()

  await expect.poll(() => termproxy?.get('cmd')).toBe('ceph_install')
  expect(termproxy!.get('cmd-opts')).toBe('--version\0squid\0--repository\0no-subscription')
  await expect(page.getByTestId('ceph-install-next')).toBeDisabled()

  installed = true
  await expect(page.getByTestId('ceph-install-next')).toBeEnabled({ timeout: 15_000 })
  await page.getByTestId('ceph-install-next').click()

  // The node's own network is preselected.
  await expect(page.getByLabel('公共网络')).toHaveValue(/^\d+\.\d+\.\d+\.0\/\d+$/)
  await page.getByLabel('公共网络').fill('10.99.0.0/24')
  await page.getByLabel('集群网络').fill('bad')
  await expect(page.getByText('应为 CIDR', { exact: true })).toBeVisible()
  await expect(page.getByTestId('ceph-init-submit')).toBeDisabled()
  await page.getByLabel('集群网络').fill('10.98.0.0/24')
  await page.getByTestId('ceph-init-submit').click()
  await expect(page.getByRole('heading', { name: '安装完成' })).toBeVisible()
  expect(Object.fromEntries(init!.entries())).toEqual({ network: '10.99.0.0/24', 'cluster-network': '10.98.0.0/24' })
  expect(mon).toContain(`/nodes/${node}/ceph/mon/${node}`)
})

const STATUS = {
  fsid: 'ce2a7d9a-f288-4a35-b3e5-350a58c654e4',
  health: {
    status: 'HEALTH_WARN',
    checks: {
      OSD_DOWN: { severity: 'HEALTH_WARN', summary: { message: '1 osds down' }, detail: [{ message: 'osd.2 (root=default,host=c3) is down' }] },
      PG_DEGRADED: { severity: 'HEALTH_WARN', summary: { message: 'Degraded data redundancy: 30/90 objects degraded' }, detail: [{ message: 'pg 1.0 is active+undersized+degraded' }] },
    },
  },
  quorum_names: ['c1', 'c2', 'c3'],
  mgrmap: { active_name: 'c1', standbys: [{ name: 'c2' }] },
  fsmap: { by_rank: [] },
  osdmap: { num_osds: 3, num_up_osds: 2, num_in_osds: 3 },
  pgmap: {
    pgs_by_state: [
      { state_name: 'active+clean', count: 20 },
      { state_name: 'active+undersized+degraded', count: 13 },
    ],
    num_pgs: 33,
    num_pools: 2,
    num_objects: 30,
    bytes_used: 3 * 1024 ** 3,
    bytes_total: 48 * 1024 ** 3,
    data_bytes: 1024 ** 3,
    read_bytes_sec: 1024 * 1024,
    write_bytes_sec: 4 * 1024 * 1024,
    read_op_per_sec: 12,
    write_op_per_sec: 40,
  },
}

const META = {
  mon: Object.fromEntries(['c1', 'c2', 'c3'].map((n) => [`${n}@${n}`, { name: n, addr: '10.0.0.1', ceph_version_short: '19.2.6', service: true }])),
  mgr: Object.fromEntries(['c1', 'c2'].map((n) => [`${n}@${n}`, { name: n, addr: '10.0.0.1', ceph_version_short: '19.2.6', service: true }])),
  mds: {},
  osd: [0, 1, 2].map((id) => ({ id, ceph_version_short: '19.2.6' })),
  node: Object.fromEntries(['c1', 'c2', 'c3'].map((n) => [n, { version: { str: '19.2.6', parts: ['19', '2', '6'] } }])),
}

test('手机：状态页、健康检查详情和导航', { tag: '@mobile' }, async ({ page }) => {
  await page.route('**/api2/json/cluster/ceph/status', (route) => route.fulfill({ json: { data: STATUS } }))
  await page.route('**/api2/json/cluster/ceph/metadata?*', (route) => route.fulfill({ json: { data: META } }))
  await page.goto('/datacenter/ceph')
  await expect(page.getByTestId('ceph-health-status')).toContainText('警告')
  const check = page.locator('[data-check="OSD_DOWN"]')
  await check.getByRole('button', { name: /1 osds down/ }).click()
  await expect(check).toContainText('osd.2 (root=default,host=c3) is down')
  await expect(page.locator('[data-pg-state="active+undersized+degraded"]')).toContainText('13')
  await expect(page.getByRole('table', { name: 'OSD 状态' })).toContainText('1')
  // The section nav scrolls sideways instead of widening the page.
  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.getByRole('navigation', { name: 'Ceph' }).getByRole('link', { name: 'OSD' }).click()
  await expect(page).toHaveURL(/\/datacenter\/ceph\/osd$/)
})

test('手机：未安装时的提示，安装向导第一步', { tag: '@mobile' }, async ({ page, pve }) => {
  await mockRootPamInstance(page)
  await page.route('**/api2/json/cluster/ceph/**', (route) => route.fulfill(NOT_INSTALLED))
  await page.route('**/api2/json/nodes/*/ceph/status', (route) => route.fulfill(NOT_INSTALLED))
  await page.goto(`/node/${pve.node}/ceph`)
  await expect(page.getByRole('heading', { name: `${pve.node} 上没有安装 Ceph` })).toBeVisible()
  await page.getByRole('link', { name: '安装 Ceph' }).click()
  await expect(page).toHaveURL(new RegExp(`/datacenter/ceph/install/${pve.node}$`))
  await expect(page.getByTestId('ceph-install-start')).toContainText('开始安装')
  await expect(page.getByRole('combobox', { name: 'Ceph 版本' })).toBeVisible()
})
