import type { Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'

// Area node-system: node DNS, /etc/hosts, time zone and node options
// (/node/:node/system).
//
// Lab writes (@lab, desktop) go to pvelab-c3 of the 3-node lab cluster only
// and every value is restored afterwards (cleanup runs even when a test
// fails): DNS keeps 192.168.0.2, the hosts entry of pvelab-c3 stays. Without
// that node (single-node lab) the write tests are skipped. Phone tests only
// read, with page.route() mocks for permissions and odd hosts files.

const WRITE_NODE = 'pvelab-c3'

const panel = (page: Page) => page.getByRole('tabpanel', { name: '系统' })
const dialog = (page: Page) => page.getByRole('dialog')
const row = (page: Page, label: string) => panel(page).getByRole('button', { name: new RegExp(`^${label}`) })

async function needWriteNode(pve: PveApi) {
  const nodes = await pve.get<{ node: string; status: string }[]>('/nodes')
  test.skip(!nodes.some((n) => n.node === WRITE_NODE && n.status === 'online'), `实验集群里没有在线的 ${WRITE_NODE}`)
}

interface Dns {
  search?: string
  dns1?: string
  dns2?: string
  dns3?: string
}

type OptionKey = 'startall-onboot-delay' | 'ballooning-target' | 'wakeonlan' | 'location'
const OPTION_KEYS: OptionKey[] = ['startall-onboot-delay', 'ballooning-target', 'wakeonlan', 'location']

test.describe('node system settings', { tag: '@lab' }, () => {
  test.beforeEach(async ({ pve }) => needWriteNode(pve))

  test('DNS: edit search domain and servers', async ({ page, pve, cleanup }) => {
    const path = `/nodes/${WRITE_NODE}/dns`
    const before = await pve.get<Dns>(path)
    expect(before.dns1, 'DNS 必须保持 192.168.0.2').toBe('192.168.0.2')
    cleanup.add(() => pve.put(path, { search: before.search, dns1: before.dns1, dns2: before.dns2, dns3: before.dns3 }))

    await page.goto(`/node/${WRITE_NODE}/system`)
    await expect(row(page, 'DNS 服务器 1')).toContainText('192.168.0.2')
    await row(page, '搜索域').click()
    const dns = dialog(page)
    await expect(dns.getByLabel('搜索域')).toHaveValue(before.search ?? '')
    await expect(dns.getByLabel('DNS 服务器 1')).toHaveValue('192.168.0.2')

    // Validation stays in the form.
    await dns.getByLabel('DNS 服务器 3').fill('dns.example')
    await dns.getByRole('button', { name: '保存' }).click()
    await expect(dns.getByText('不是有效的 IPv4 / IPv6 地址')).toBeVisible()

    // One search domain only (PVE reads back the first word).
    await dns.getByLabel('DNS 服务器 3').fill('')
    await dns.getByLabel('搜索域').fill('lan example.com')
    await dns.getByRole('button', { name: '保存' }).click()
    await expect(dns.getByText('只能填一个域名')).toBeVisible()

    // Another search domain and an extra (documentation range) server in slot 3: moved up to dns2.
    await dns.getByLabel('搜索域').fill('e2e-node-system.invalid')
    await dns.getByLabel('DNS 服务器 3').fill('192.0.2.53')
    await dns.getByRole('button', { name: '保存' }).click()
    await expect(dns).toBeHidden()
    expect(await pve.get<Dns>(path)).toMatchObject({ search: 'e2e-node-system.invalid', dns1: '192.168.0.2', dns2: '192.0.2.53' })
    await expect(row(page, 'DNS 服务器 2')).toContainText('192.0.2.53')

    // Clearing it removes the server again.
    await row(page, 'DNS 服务器 2').click()
    await dialog(page).getByLabel('DNS 服务器 2').fill('')
    await dialog(page).getByLabel('搜索域').fill(before.search ?? 'lan')
    await dialog(page).getByRole('button', { name: '保存' }).click()
    await expect(dialog(page)).toBeHidden()
    const after = await pve.get<Dns>(path)
    expect(after).toMatchObject({ dns1: '192.168.0.2' })
    expect(after.dns2).toBeUndefined()
    await expect(row(page, 'DNS 服务器 2')).toHaveCount(0)
  })

  test('time zone: search, change, clock follows', async ({ page, pve, cleanup }) => {
    const path = `/nodes/${WRITE_NODE}/time`
    const before = await pve.get<{ timezone: string }>(path)
    cleanup.add(() => pve.put(path, { timezone: before.timezone }))
    const target = before.timezone === 'Asia/Tokyo' ? 'Europe/Vienna' : 'Asia/Tokyo'
    const search = target === 'Asia/Tokyo' ? '东京' : 'vienna'

    await page.goto(`/node/${WRITE_NODE}/system`)
    await expect(panel(page).getByTestId('node-localtime')).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    await row(page, '时区').click()
    const tz = dialog(page)
    await expect(tz.getByRole('radio', { name: before.timezone })).toHaveAttribute('aria-checked', 'true')
    await tz.getByRole('textbox', { name: '搜索时区' }).fill(search)
    await expect(tz.getByRole('radio')).toHaveCount(1)
    await tz.getByRole('radio', { name: target }).click()
    await tz.getByRole('button', { name: '保存' }).click()
    await expect(tz).toBeHidden()
    await expect(row(page, '时区')).toContainText(target)
    expect((await pve.get<{ timezone: string }>(path)).timezone).toBe(target)
  })

  test('node options: delay, ballooning, Wake-on-LAN, location', async ({ page, pve, cleanup }) => {
    const path = `/nodes/${WRITE_NODE}/config`
    const before = await pve.get<Partial<Record<OptionKey, string | number>>>(path)
    cleanup.add(async () => {
      const set: Record<string, string | number> = {}
      const del: string[] = []
      for (const k of OPTION_KEYS) {
        if (before[k] !== undefined) set[k] = before[k]
        else del.push(k)
      }
      await pve.put(path, { ...set, ...(del.length ? { delete: del.join(',') } : {}) })
    })
    await pve.put(path, { delete: OPTION_KEYS.join(',') })

    await page.goto(`/node/${WRITE_NODE}/system`)
    await expect(row(page, '开机启动延迟')).toContainText('默认（0 秒）')

    await row(page, '开机启动延迟').click()
    await dialog(page).getByRole('textbox', { name: '延迟' }).fill('15')
    await dialog(page).getByRole('button', { name: '保存' }).click()
    await expect(dialog(page)).toBeHidden()
    await expect(row(page, '开机启动延迟')).toContainText('15 秒')

    await row(page, 'Ballooning 目标').click()
    await dialog(page).getByRole('textbox', { name: '内存使用目标' }).fill('70')
    await dialog(page).getByRole('button', { name: '保存' }).click()
    await expect(dialog(page)).toBeHidden()
    await expect(row(page, 'Ballooning 目标')).toContainText('70%')

    await row(page, 'Wake-on-LAN').click()
    const wol = dialog(page)
    await wol.getByLabel('MAC 地址').fill('aa:bb:cc')
    await wol.getByRole('button', { name: '保存' }).click()
    await expect(wol.getByText('格式：01:23:45:67:89:ab')).toBeVisible()
    await wol.getByLabel('MAC 地址').fill('02:00:5e:10:00:01')
    await wol.getByLabel('广播地址').fill('192.168.0.255')
    await wol.getByRole('button', { name: '保存' }).click()
    await expect(wol).toBeHidden()
    await expect(row(page, 'Wake-on-LAN')).toContainText('02:00:5e:10:00:01')

    await row(page, '位置').click()
    const loc = dialog(page)
    await loc.getByLabel('名称').fill('机房')
    await loc.getByRole('textbox', { name: '纬度' }).fill('31.2304')
    await loc.getByRole('textbox', { name: '经度' }).fill('121.4737')
    await loc.getByRole('button', { name: '保存' }).click()
    await expect(loc.getByText('PVE 无法正确保存')).toBeVisible()
    await loc.getByLabel('名称').fill('e2e rack')
    await expect(loc.getByRole('link', { name: '在 OpenStreetMap 上查看' })).toHaveAttribute('href', /mlat=31.2304&mlon=121.4737/)
    await loc.getByRole('button', { name: '保存' }).click()
    await expect(loc).toBeHidden()
    await expect(row(page, '位置')).toContainText('e2e rack · 31.2304°, 121.4737°')

    let cfg = await pve.get<Record<string, string | number>>(path)
    // PVE answers the integers as strings.
    expect(cfg).toMatchObject({
      'startall-onboot-delay': expect.stringMatching(/^15$/),
      'ballooning-target': expect.stringMatching(/^70$/),
      wakeonlan: expect.stringMatching(/^(mac=)?02:00:5e:10:00:01,broadcast-address=192\.168\.0\.255$/),
      location: expect.stringContaining('latitude=31.2304'),
    })

    // Clearing a value deletes the key (back to the default).
    await row(page, '开机启动延迟').click()
    await expect(dialog(page).getByRole('textbox', { name: '延迟' })).toHaveValue('15')
    await dialog(page).getByRole('textbox', { name: '延迟' }).fill('')
    await dialog(page).getByRole('button', { name: '保存' }).click()
    await expect(dialog(page)).toBeHidden()
    await row(page, '位置').click()
    await dialog(page).getByRole('button', { name: '清空' }).click()
    await dialog(page).getByRole('button', { name: '保存' }).click()
    await expect(dialog(page)).toBeHidden()
    await expect(row(page, '位置')).toContainText('使用数据中心设置')
    cfg = await pve.get<Record<string, string | number>>(path)
    expect(cfg['startall-onboot-delay']).toBeUndefined()
    expect(cfg.location).toBeUndefined()
  })

  test('hosts: edit with digest, node entry guard', async ({ page, pve, cleanup }) => {
    const path = `/nodes/${WRITE_NODE}/hosts`
    const before = await pve.get<{ data: string; digest: string }>(path)
    expect(before.data, `hosts 里必须有 ${WRITE_NODE}`).toMatch(new RegExp(`\\s${WRITE_NODE}(\\s|$)`, 'm'))
    cleanup.add(async () => {
      const now = await pve.get<{ data: string }>(path)
      if (now.data !== before.data) await pve.post(path, { data: before.data })
    })

    await page.goto(`/node/${WRITE_NODE}/system`)
    const hosts = panel(page).getByRole('region', { name: /Hosts/ })
    await expect(hosts.getByLabel('hosts 文件内容')).toContainText(`${WRITE_NODE}.`)
    await hosts.getByRole('button', { name: '编辑 Hosts' }).click()
    const editor = dialog(page)
    const text = editor.getByRole('textbox', { name: '文件内容' })
    await expect(text).toHaveValue(before.data)
    await expect(editor.getByRole('button', { name: '保存' })).toBeDisabled()

    // Dropping the node's own entry needs an explicit acknowledgement.
    await text.fill(before.data.replace(new RegExp(`^.*\\s${WRITE_NODE}(\\s.*)?$`, 'm'), ''))
    await expect(editor.getByRole('alert')).toContainText(`没有指向本节点 ${WRITE_NODE} 的条目`)
    await expect(editor.getByRole('button', { name: '保存' })).toBeDisabled()

    const added = `${before.data}192.0.2.10 e2e-node-system.invalid e2e-node-system\n`
    await text.fill(added)
    await expect(editor.getByRole('alert')).toHaveCount(0)
    await editor.getByRole('button', { name: '保存' }).click()
    await expect(editor).toBeHidden()
    await expect(hosts.getByLabel('hosts 文件内容')).toContainText('e2e-node-system.invalid')
    expect((await pve.get<{ data: string }>(path)).data).toBe(added)

    // Restore through the UI as well (cleanup double-checks).
    await hosts.getByRole('button', { name: '编辑 Hosts' }).click()
    await dialog(page).getByRole('textbox', { name: '文件内容' }).fill(before.data)
    await dialog(page).getByRole('button', { name: '保存' }).click()
    await expect(dialog(page)).toBeHidden()
    expect((await pve.get<{ data: string }>(path)).data).toBe(before.data)
  })
})

test.describe('node system on phones', { tag: '@mobile' }, () => {
  test('sections render and editors open as sheets (cancelled)', async ({ page, pve }) => {
    await page.goto(`/node/${pve.node}/system`)
    for (const name of ['时间', 'DNS', '节点选项']) await expect(panel(page).getByRole('region', { name })).toBeVisible()
    await expect(panel(page).getByLabel('hosts 文件内容')).toContainText(pve.node)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, '页面不应横向滚动').toBeLessThanOrEqual(0)

    await row(page, '时区').click()
    await dialog(page).getByRole('textbox', { name: '搜索时区' }).fill('上海')
    await expect(dialog(page).getByRole('radio')).toHaveCount(1)
    await expect(dialog(page).getByRole('radio', { name: 'Asia/Shanghai' })).toContainText('UTC+08:00')
    await dialog(page).getByRole('button', { name: '取消' }).click()
    await expect(dialog(page)).toBeHidden()

    await row(page, 'Wake-on-LAN').click()
    await expect(dialog(page).getByLabel('MAC 地址')).toBeVisible()
    await dialog(page).getByRole('button', { name: '取消' }).click()
    await expect(dialog(page)).toBeHidden()
  })

  test('read-only without Sys.Modify (permissions mocked)', async ({ page, pve }) => {
    await page.route('**/api2/json/access/permissions*', (route) =>
      route.fulfill({ json: { data: { '/': { 'Sys.Audit': 1 }, [`/nodes/${pve.node}`]: { 'Sys.Audit': 1 } } } }),
    )
    await page.goto(`/node/${pve.node}/system`)
    await expect(panel(page).getByRole('note')).toContainText('只读')
    await expect(panel(page).getByRole('region', { name: 'DNS' })).toBeVisible()
    await expect(panel(page).getByRole('button', { name: /编辑/ })).toHaveCount(0)
    await expect(panel(page).getByRole('button', { name: /^时区/ })).toHaveCount(0)
  })

  test('hosts without the node entry are flagged (hosts mocked)', async ({ page, pve }) => {
    await page.route(`**/api2/json/nodes/${pve.node}/hosts`, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { data: { data: '127.0.0.1 localhost\n# nothing else\n', digest: 'e2e' } } })
        : route.fallback(),
    )
    await page.goto(`/node/${pve.node}/system`)
    const hosts = panel(page).getByRole('region', { name: /Hosts/ })
    await expect(hosts.getByRole('alert')).toContainText(`没有指向本节点 ${pve.node} 的条目`)
    await hosts.getByRole('button', { name: '编辑 Hosts' }).click()
    await expect(dialog(page).getByRole('checkbox', { name: '我了解风险，仍然保存' })).toBeVisible()
    await expect(dialog(page).getByRole('button', { name: '保存' })).toBeDisabled()
    await dialog(page).getByRole('button', { name: '取消' }).click()
  })
})
