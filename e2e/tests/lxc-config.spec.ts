import type { Locator, Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'

// Container configuration tabs (area lxc-config) against the lab. Every @lab
// test (desktop) creates its own tiny Alpine CT in the VMID range 3500–3599
// and destroys it afterwards. On phones the editors open as sheets on the
// sample CT 200 and are cancelled.

const VMID_MIN = 3500
const VMID_MAX = 3599

let templateVolid: string | null = null

async function alpineTemplate(pve: PveApi): Promise<string> {
  if (templateVolid) return templateVolid
  const list = await pve.get<{ volid: string }[]>(`/nodes/${pve.node}/storage/local/content`, { content: 'vztmpl' })
  const t = list.map((x) => x.volid).find((v) => /alpine.*amd64/.test(v))
  if (!t) throw new Error('实验机上没有 alpine amd64 模板')
  templateVolid = t
  return t
}

async function createCt(pve: PveApi, name: string, params: Record<string, string | number> = {}): Promise<number> {
  const used = new Set((await pve.guests()).map((g) => g.vmid))
  let vmid = VMID_MIN
  while (used.has(vmid) && vmid <= VMID_MAX) vmid++
  if (vmid > VMID_MAX) throw new Error('VMID 3500–3599 已用完')
  await pve.run('POST', `/nodes/${pve.node}/lxc`, {
    vmid,
    hostname: name,
    ostemplate: await alpineTemplate(pve),
    memory: 64,
    swap: 0,
    rootfs: 'local-lvm:0.5',
    unprivileged: 1,
    net0: 'name=eth0,bridge=vmbr0,ip=manual',
    ...params,
  })
  await pve.waitForGuest(vmid, (g) => g.name === name)
  return vmid
}

type Config = Record<string, string | number | undefined>

function parseNet(v: string): Record<string, string> {
  return Object.fromEntries(v.split(',').map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]))
}

function configOf(pve: PveApi, vmid: number) {
  return () => pve.get<Config>(`/nodes/${pve.node}/lxc/${vmid}/config`)
}

/** The open dialog / bottom sheet. */
function dialog(page: Page): Locator {
  return page.getByRole('dialog')
}

async function submit(page: Page, name = '保存') {
  const d = dialog(page)
  await d.getByRole('button', { name, exact: true }).click()
  await expect(d).toBeHidden({ timeout: 20_000 })
}

/** A config row (the button that opens its editor), within a page or tab panel. */
function row(scope: Page | Locator, label: string | RegExp): Locator {
  return scope.getByRole('button', { name: typeof label === 'string' ? new RegExp(`^${label}`) : label })
}

async function menu(page: Page, label: string, item: string) {
  // Let the previous menu finish its exit animation first, so the click opens
  // a fresh one. (Reopening during the animation used to close the new menu
  // right away: Radix handed focus back to the trigger late. Fixed in the
  // app, see lib/focus.ts.)
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.getByRole('button', { name: `更多操作：${label}`, exact: true }).click()
  await page.getByRole('menuitem', { name: new RegExp(`^${item}`) }).click()
}

test.describe('lxc-config', { tag: '@lab' }, () => {
  test.beforeAll(async ({ pve }) => {
    // Leftovers of crashed runs.
    for (const g of await pve.guests()) {
      if (g.vmid >= VMID_MIN && g.vmid <= VMID_MAX && g.name?.startsWith('e2e-lxc')) await pve.destroyGuest(g.vmid)
    }
  })

  test.beforeEach(({ page }) => {
    // Failed API writes in the test log (the toast is gone by the time a test fails).
    page.on('response', async (r) => {
      if (r.status() >= 400 && r.request().method() !== 'GET' && r.url().includes('/api2/')) {
        console.log(`API ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}: ${(await r.text().catch(() => '')).slice(0, 300)}`)
      }
    })
  })

  test('资源：内存、处理器', async ({ page, pve, cleanup }) => {
    const vmid = await createCt(pve, 'e2e-lxc-res')
    cleanup.guest(vmid)
    const cfg = configOf(pve, vmid)
    await page.goto(`/guest/${pve.node}/lxc/${vmid}/resources`)
    const panel = page.getByRole('tabpanel', { name: '资源' })
    await expect(panel.getByText('64 MiB')).toBeVisible()

    await row(panel, '内存').click()
    await expect(dialog(page)).toContainText('内存与交换分区')
    await dialog(page).getByRole('textbox', { name: '内存', exact: true }).fill('96')
    await dialog(page).getByLabel('交换分区').fill('32')
    await submit(page)
    await expect.poll(async () => (await cfg()).memory).toBe(96)
    expect((await cfg()).swap).toBe(32)
    await expect(panel.getByText('96 MiB')).toBeVisible()

    await row(panel, '核心数').click()
    await dialog(page).getByLabel('核心数').fill('1')
    await dialog(page).getByLabel('CPU 限制').fill('0.5')
    await dialog(page).getByLabel('CPU 权重').fill('200')
    await submit(page)
    await expect.poll(async () => (await cfg()).cpulimit).toBe('0.5')
    expect((await cfg()).cpuunits).toBe(200)

    // Clearing the limit deletes the key.
    await row(panel, 'CPU 限制').click()
    await dialog(page).getByLabel('CPU 限制').fill('')
    await submit(page)
    await expect.poll(async () => (await cfg()).cpulimit).toBeUndefined()
    await expect(row(panel, 'CPU 限制')).toContainText('不限')
  })

  test('磁盘：添加挂载点、扩容、分离、重新挂载、删除', async ({ page, pve, cleanup }) => {
    test.setTimeout(180_000) // resize task, then the config lock
    const vmid = await createCt(pve, 'e2e-lxc-disk')
    cleanup.guest(vmid)
    const cfg = configOf(pve, vmid)
    await page.goto(`/guest/${pve.node}/lxc/${vmid}/resources`)
    const panel = page.getByRole('tabpanel', { name: '资源' })

    // Add a 0.1 GiB volume at /data.
    await panel.getByRole('button', { name: '添加挂载点' }).click()
    const d = dialog(page)
    await expect(d.getByRole('combobox').first()).toContainText('local-lvm')
    await d.getByLabel('大小').fill('0.1')
    await d.getByLabel('容器内路径').fill('/data')
    await submit(page, '添加')
    await expect.poll(async () => String((await cfg()).mp0 ?? ''), { timeout: 30_000 }).toMatch(/^local-lvm:vm-\d+-disk-1,mp=\/data,backup=1/)
    await expect(row(panel, /^挂载点 mp0/)).toContainText('/data')

    // Edit: read-only + noatime.
    await row(panel, /^挂载点 mp0/).click()
    await dialog(page).getByRole('button', { name: '高级选项' }).click()
    await dialog(page).getByText('只读', { exact: true }).click()
    await dialog(page).getByRole('button', { name: 'noatime' }).click()
    await submit(page)
    await expect.poll(async () => String((await cfg()).mp0)).toMatch(/ro=1/)
    expect(String((await cfg()).mp0)).toMatch(/mountoptions=noatime/)

    // Resize rootfs by 1 GiB (a task).
    await menu(page, '根磁盘', '扩容')
    await expect(dialog(page)).toContainText('512 MiB')
    await submit(page, '扩容')
    await expect.poll(async () => String((await cfg()).rootfs), { timeout: 60_000 }).toMatch(/size=(1536M|1610612736)(,|$)/)
    await expect(row(panel, '根磁盘')).toContainText('1.5 GiB', { timeout: 15_000 })
    // The config shows the new size while the resize task still holds the config lock.
    await expect
      .poll(async () => (await pve.get<unknown[]>(`/nodes/${pve.node}/tasks`, { vmid, source: 'active' })).length, { timeout: 90_000 })
      .toBe(0)

    // Detach mp0 → unused0.
    await menu(page, '挂载点 mp0', '分离')
    await page.getByRole('alertdialog').getByRole('button', { name: '分离' }).click()
    await expect(page.getByRole('alertdialog')).toBeHidden({ timeout: 20_000 })
    await expect.poll(async () => (await cfg()).unused0, { timeout: 30_000 }).toMatch(/^local-lvm:vm-\d+-disk-1$/)
    await expect(row(panel, /^未使用的磁盘 0/)).toBeVisible()

    // Mount it again at /again.
    await row(panel, /^未使用的磁盘 0/).click()
    await dialog(page).getByLabel('容器内路径').fill('/again')
    await submit(page, '挂载')
    await expect.poll(async () => String((await cfg()).mp0 ?? ''), { timeout: 30_000 }).toMatch(/mp=\/again/)
    expect((await cfg()).unused0).toBeUndefined()

    // Detach and delete for good (type-to-confirm).
    await menu(page, '挂载点 mp0', '分离')
    await page.getByRole('alertdialog').getByRole('button', { name: '分离' }).click()
    await expect(page.getByRole('alertdialog')).toBeHidden({ timeout: 20_000 })
    await expect(row(panel, /^未使用的磁盘 0/)).toBeVisible({ timeout: 30_000 })
    await menu(page, '未使用的磁盘 0', '删除')
    const alert = page.getByRole('alertdialog')
    await alert.getByRole('textbox').fill('unused0')
    await alert.getByRole('button', { name: '永久删除' }).click()
    await expect.poll(async () => Object.keys(await cfg()).filter((k) => /^(mp|unused)\d/.test(k))).toEqual([])
  })

  test('磁盘：转移所有者', async ({ page, pve, cleanup }) => {
    test.setTimeout(150_000) // two containers
    const a = await createCt(pve, 'e2e-lxc-own-a', { mp0: 'local-lvm:0.1,mp=/data' })
    cleanup.guest(a)
    const b = await createCt(pve, 'e2e-lxc-own-b')
    cleanup.guest(b)
    await page.goto(`/guest/${pve.node}/lxc/${a}/resources`)
    await menu(page, '挂载点 mp0', '转移所有者')
    const d = dialog(page)
    await d.getByRole('combobox').first().click()
    await page.getByRole('option', { name: new RegExp(`^${b} · e2e-lxc-own-b`) }).click()
    await expect(d.getByText(`将写入目标容器的 mp0`)).toBeVisible()
    await submit(page, '转移')
    await expect.poll(async () => String((await configOf(pve, b)()).mp0 ?? ''), { timeout: 60_000 }).toMatch(
      new RegExp(`^local-lvm:vm-${b}-disk-\\d+,mp=/data`),
    )
    expect((await configOf(pve, a)()).mp0).toBeUndefined()
  })

  test('设备直通', async ({ page, pve, cleanup }) => {
    const vmid = await createCt(pve, 'e2e-lxc-dev')
    cleanup.guest(vmid)
    const cfg = configOf(pve, vmid)
    await page.goto(`/guest/${pve.node}/lxc/${vmid}/resources`)
    await page.getByRole('button', { name: '添加设备' }).click()
    await dialog(page).getByLabel('设备路径').fill('/dev/null')
    await dialog(page).getByLabel('容器内 GID').fill('104')
    await dialog(page).getByLabel('访问权限').fill('0666')
    await submit(page, '添加')
    await expect.poll(async () => (await cfg()).dev0).toBe('/dev/null,gid=104,mode=0666')
    await menu(page, '设备 dev0', '删除')
    await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click()
    await expect.poll(async () => (await cfg()).dev0).toBeUndefined()
  })

  test('网络：添加、编辑、断开、删除网卡', async ({ page, pve, cleanup }) => {
    const vmid = await createCt(pve, 'e2e-lxc-net')
    cleanup.guest(vmid)
    const cfg = configOf(pve, vmid)
    await page.goto(`/guest/${pve.node}/lxc/${vmid}/network`)
    const panel = page.getByRole('tabpanel', { name: '网络' })
    await expect(panel.getByRole('button', { name: '编辑网卡 eth0' })).toContainText('vmbr0')
    await expect(panel).toContainText('手动')

    await panel.getByRole('button', { name: '添加网卡' }).click()
    const d = dialog(page)
    await expect(d.getByLabel('名称')).toHaveValue('eth1')
    await expect(d.getByRole('combobox').first()).toContainText('vmbr0')
    await d.getByLabel('VLAN 标签').fill('10')
    await d.getByRole('radiogroup', { name: 'IPv4 配置方式' }).getByRole('radio', { name: '静态' }).click()
    await d.getByLabel('地址/前缀').first().fill('10.99.0.5')
    await d.getByLabel('网关').first().fill('10.99.0.1')
    await d.getByRole('button', { name: '添加', exact: true }).click()
    await expect(d.getByText('格式为 IPv4/前缀长度')).toBeVisible()
    await d.getByLabel('地址/前缀').first().fill('10.99.0.5/24')
    await d.getByRole('radiogroup', { name: 'IPv6 配置方式' }).getByRole('radio', { name: 'SLAAC' }).click()
    await submit(page, '添加')
    await expect.poll(async () => String((await cfg()).net1 ?? ''), { timeout: 30_000 }).toMatch(/name=eth1/)
    const added = parseNet(String((await cfg()).net1))
    expect(added).toMatchObject({ bridge: 'vmbr0', ip: '10.99.0.5/24', gw: '10.99.0.1', ip6: 'auto', tag: '10', firewall: '1' })
    expect(added.hwaddr).toMatch(/^[0-9A-F:]{17}$/)
    const card = panel.getByRole('button', { name: '编辑网卡 eth1' })
    await expect(card).toContainText('VLAN 10')

    // Edit: DHCP, no firewall, MTU.
    await card.click()
    await dialog(page).getByRole('radiogroup', { name: 'IPv4 配置方式' }).getByRole('radio', { name: 'DHCP' }).click()
    await dialog(page).getByRole('switch', { name: '防火墙' }).click()
    await dialog(page).getByRole('button', { name: '高级选项' }).click()
    await dialog(page).getByLabel('MTU').fill('1400')
    await submit(page)
    await expect.poll(async () => String((await cfg()).net1)).toMatch(/ip=dhcp/)
    const net1 = String((await cfg()).net1)
    expect(net1).not.toMatch(/firewall|gw=/)
    expect(net1).toMatch(/mtu=1400/)

    // Disconnect from the menu.
    await menu(page, '网卡 eth1', '断开链路')
    await expect.poll(async () => String((await cfg()).net1)).toMatch(/link_down=1/)
    await expect(card).toContainText('已断开')

    await menu(page, '网卡 eth1', '删除')
    await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click()
    await expect.poll(async () => (await cfg()).net1).toBeUndefined()
    await expect(panel.getByRole('button', { name: '编辑网卡 eth1' })).toHaveCount(0)
  })

  test('DNS：主机名、DNS 域和服务器', async ({ page, pve, cleanup }) => {
    const vmid = await createCt(pve, 'e2e-lxc-dns')
    cleanup.guest(vmid)
    const cfg = configOf(pve, vmid)
    await page.goto(`/guest/${pve.node}/lxc/${vmid}/dns`)
    const panel = page.getByRole('tabpanel', { name: 'DNS' })
    await expect(row(panel, 'DNS 服务器')).toContainText('使用主机设置')

    await row(panel, 'DNS 服务器').click()
    await dialog(page).getByLabel('DNS 域').fill('lab.example')
    await dialog(page).getByLabel('DNS 服务器').fill('1.1.1.1, nope')
    await dialog(page).getByRole('button', { name: '保存' }).click()
    await expect(dialog(page)).toContainText('不是有效的 IP 地址：nope')
    await dialog(page).getByLabel('DNS 服务器').fill('1.1.1.1, 2606:4700:4700::1111')
    await submit(page)
    await expect.poll(async () => (await cfg()).nameserver).toBe('1.1.1.1 2606:4700:4700::1111')
    expect((await cfg()).searchdomain).toBe('lab.example')
    await expect(row(panel, 'DNS 服务器')).toContainText('2606:4700:4700::1111')

    // Clear both: back to host settings.
    await row(panel, 'DNS 域').click()
    await dialog(page).getByLabel('DNS 域').fill('')
    await dialog(page).getByLabel('DNS 服务器').fill('')
    await submit(page)
    await expect.poll(async () => (await cfg()).nameserver).toBeUndefined()
    expect((await cfg()).searchdomain).toBeUndefined()

    await row(panel, '主机名').click()
    await dialog(page).getByLabel('主机名').fill('e2e-lxc-dns-renamed')
    await submit(page)
    await expect.poll(async () => (await cfg()).hostname).toBe('e2e-lxc-dns-renamed')
    await pve.waitForGuest(vmid, (g) => g.name === 'e2e-lxc-dns-renamed')
  })

  test('选项：开关、启动顺序、特性、环境变量', async ({ page, pve, cleanup }) => {
    const vmid = await createCt(pve, 'e2e-lxc-opt')
    cleanup.guest(vmid)
    const cfg = configOf(pve, vmid)
    await page.goto(`/guest/${pve.node}/lxc/${vmid}/options`)
    const panel = page.getByRole('tabpanel', { name: '选项' })
    await expect(row(panel, '非特权容器')).toHaveCount(0) // read-only: not a button
    await expect(panel.getByText('非特权容器')).toBeVisible()

    await panel.getByRole('switch', { name: '开机自启' }).click()
    await expect.poll(async () => (await cfg()).onboot).toBe(1)
    await panel.getByRole('switch', { name: '控制台设备' }).click()
    await expect.poll(async () => (await cfg()).console).toBe(0)
    await panel.getByRole('switch', { name: '控制台设备' }).click()
    await expect.poll(async () => (await cfg()).console).toBeUndefined()

    await row(panel, '启动/关机顺序').click()
    await dialog(page).getByLabel('启动顺序').fill('3')
    await dialog(page).getByLabel('启动延迟').fill('15')
    await submit(page)
    await expect.poll(async () => (await cfg()).startup).toBe('order=3,up=15')

    await row(panel, '控制台模式').click()
    await dialog(page).getByRole('combobox').click()
    await page.getByRole('option', { name: 'shell（不登录）' }).click()
    await submit(page)
    await expect.poll(async () => (await cfg()).cmode).toBe('shell')

    await row(panel, '特性').click()
    await dialog(page).getByText('嵌套（nesting）').click()
    await dialog(page).getByText('keyctl', { exact: true }).click()
    await submit(page)
    await expect.poll(async () => (await cfg()).features).toBe('keyctl=1,nesting=1')
    await expect(row(panel, '特性')).toContainText('嵌套、keyctl')

    await row(panel, '环境变量').click()
    await dialog(page).getByLabel('第 1 个变量的名称').fill('APP_MODE')
    await dialog(page).getByLabel('第 1 个变量的值').fill('test')
    await dialog(page).getByRole('button', { name: '添加变量' }).click()
    await dialog(page).getByLabel('第 2 个变量的名称').fill('TZ')
    await dialog(page).getByLabel('第 2 个变量的值').fill('UTC')
    await submit(page)
    await expect.poll(async () => (await cfg()).env).toBe('APP_MODE=test\0TZ=UTC')
    await expect(row(panel, '环境变量')).toContainText('2 个变量')

    await row(panel, '时区').click()
    await dialog(page).getByRole('button', { name: '跟随主机' }).click()
    await submit(page)
    await expect.poll(async () => (await cfg()).timezone).toBe('host')
  })

  test('运行中：待生效的更改可以撤销', async ({ page, pve, cleanup }) => {
    test.setTimeout(150_000) // starts the container
    const vmid = await createCt(pve, 'e2e-lxc-pend')
    cleanup.guest(vmid)
    await pve.run('POST', `/nodes/${pve.node}/lxc/${vmid}/status/start`)
    await pve.waitForGuest(vmid, (g) => g.status === 'running')
    await page.goto(`/guest/${pve.node}/lxc/${vmid}/options`)
    const panel = page.getByRole('tabpanel', { name: '选项' })

    await row(panel, '特性').click()
    await dialog(page).getByText('FUSE', { exact: true }).click()
    await submit(page)
    const banner = panel.getByRole('status')
    await expect(banner).toContainText('1 项更改将在容器重启后生效')
    await expect(banner).toContainText('特性')
    await expect(row(panel, '特性')).toContainText('重启后生效')

    await banner.getByRole('button', { name: '全部撤销' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '全部撤销' }).click()
    await expect(banner).toBeHidden({ timeout: 15_000 })
    await expect
      .poll(async () =>
        (await pve.get<{ key: string; pending?: string }[]>(`/nodes/${pve.node}/lxc/${vmid}/pending`)).filter((p) => p.pending !== undefined),
      )
      .toEqual([])

    // Memory is hot-applied: no pending entry.
    await page.goto(`/guest/${pve.node}/lxc/${vmid}/resources`)
    const res = page.getByRole('tabpanel', { name: '资源' })
    await row(res, '内存').click()
    await dialog(page).getByRole('textbox', { name: '内存', exact: true }).fill('80')
    await submit(page)
    await expect(res.getByText('80 MiB')).toBeVisible()
    await expect(res.getByRole('status')).toHaveCount(0)
  })
})

test.describe('container config on phones', { tag: '@mobile' }, () => {
  test('editors open as sheets and row menus list their actions (CT 200, cancelled)', async ({ page, pve }) => {
    test.skip(!(await pve.guests()).some((g) => g.vmid === 200 && g.type === 'lxc'), '实验机里没有 CT 200')
    await page.goto(`/guest/${pve.node}/lxc/200/resources`)
    const res = page.getByRole('tabpanel', { name: '资源' })
    await row(res, '内存').click()
    await expect(dialog(page)).toContainText('内存与交换分区')
    await expect(dialog(page).getByRole('textbox', { name: '内存', exact: true })).toBeVisible()
    await dialog(page).getByRole('button', { name: '取消' }).click()
    await expect(dialog(page)).toBeHidden()

    await page.goto(`/guest/${pve.node}/lxc/200/network`)
    const net = page.getByRole('tabpanel', { name: '网络' })
    await net.getByRole('button', { name: '编辑网卡 eth0' }).click()
    await expect(dialog(page).getByRole('radiogroup', { name: 'IPv4 配置方式' })).toBeVisible()
    await dialog(page).getByRole('button', { name: '取消' }).click()
    await expect(dialog(page)).toBeHidden()

    await page.getByRole('button', { name: '更多操作：网卡 eth0', exact: true }).click()
    for (const item of ['编辑', '(断开|连接)链路', '删除']) await expect(page.getByRole('menuitem', { name: new RegExp(`^${item}`) })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
  })
})
