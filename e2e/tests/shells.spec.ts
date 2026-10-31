import { expect, test } from '../fixtures'

// Page shells and registries (guest / node / storage pages, area routes,
// command palette). Read-only against the lab.

test.describe('page shells', () => {
  test('guest page renders registry tabs and switches them by URL', async ({ page, pve }) => {
    const vm = (await pve.guests()).find((g) => g.type === 'qemu' && g.template !== 1)
    test.skip(!vm, '实验机里没有虚拟机')
    const base = `/guest/${vm!.node}/qemu/${vm!.vmid}`
    await page.goto(base)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(vm!.name ?? `VM ${vm!.vmid}`)

    const tabs = page.getByRole('navigation', { name: '页面标签' })
    for (const name of ['概要', '硬件', 'Cloud-Init', '选项', '任务历史', '备份', '快照']) {
      await expect(tabs.getByRole('link', { name, exact: true })).toBeAttached()
    }
    await expect(tabs.getByRole('link', { name: 'DNS' })).toHaveCount(0) // LXC only

    await tabs.getByRole('link', { name: '选项', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${base}/options$`))
    await expect(page.getByRole('tabpanel', { name: '选项' })).toContainText('qemu-config')

    await tabs.getByRole('link', { name: '防火墙' }).click()
    await expect(page.getByRole('tabpanel', { name: '防火墙' })).toContainText('第 2 阶段提供')

    // Unknown tab → default tab.
    await page.goto(`${base}/nope`)
    await expect(page).toHaveURL(new RegExp(`${base}$`))
    await expect(page.getByRole('tabpanel', { name: '概要' })).toBeVisible()
  })

  test('container page has LXC tabs', async ({ page, pve }) => {
    const ct = (await pve.guests()).find((g) => g.type === 'lxc' && g.template !== 1)
    test.skip(!ct, '实验机里没有容器')
    await page.goto(`/guest/${ct!.node}/lxc/${ct!.vmid}/dns`)
    await expect(page.getByRole('tabpanel', { name: 'DNS' })).toContainText('lxc-config')
    const tabs = page.getByRole('navigation', { name: '页面标签' })
    await expect(tabs.getByRole('link', { name: '资源' })).toBeAttached()
    await expect(tabs.getByRole('link', { name: '硬件' })).toHaveCount(0)
  })

  test('a guest link with the wrong node follows the guest', async ({ page, pve }) => {
    const g = (await pve.guests())[0]
    test.skip(!g, '实验机里没有客户机')
    await page.goto(`/guest/not-a-node/${g!.type}/${g!.vmid}/tasks`)
    await expect(page).toHaveURL(new RegExp(`/guest/${g!.node}/${g!.type}/${g!.vmid}/tasks$`))
  })

  test('running guest offers the console action', async ({ page, pve, mobile }) => {
    const vm = (await pve.guests()).find((g) => g.status === 'running' && g.template !== 1)
    test.skip(!vm, '没有运行中的客户机')
    await page.goto(`/guest/${vm!.node}/${vm!.type}/${vm!.vmid}`)
    const bar = mobile ? page.getByRole('toolbar', { name: '操作' }) : page.locator('header')
    await bar.getByRole('button', { name: '控制台' }).click()
    await expect(page).toHaveURL(new RegExp(`/console/${vm!.node}/${vm!.type}/${vm!.vmid}$`))
    await expect(page.getByText('console', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: '返回' }).click()
    await expect(page).toHaveURL(new RegExp(`/guest/${vm!.node}/${vm!.type}/${vm!.vmid}$`))
  })

  test('node page and node shell route', async ({ page, pve }) => {
    await page.goto(`/node/${pve.node}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(pve.node)
    const tabs = page.getByRole('navigation', { name: '页面标签' })
    await tabs.getByRole('link', { name: '服务' }).click()
    await expect(page.getByRole('tabpanel', { name: '服务' })).toContainText('node-summary')
    await page.goto(`/console/${pve.node}/shell`)
    await expect(page.getByText(`节点 ${pve.node} 的 Shell`, { exact: false })).toBeVisible()
  })

  test('storage list opens the storage page', async ({ page, pve }) => {
    await page.goto('/storage')
    const card = page.getByRole('link', { name: /local/ }).first()
    await card.click()
    await expect(page).toHaveURL(new RegExp(`/storage/${pve.node}/local`))
    await expect(page.getByRole('tabpanel', { name: '概要' })).toContainText('storage-browser')
  })

  test('area routes render', async ({ page }) => {
    for (const [path, text] of [
      ['/tasks', '任务'],
      ['/create/qemu', '创建虚拟机'],
      ['/create/lxc', '创建容器'],
    ] as const) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(text)
    }
  })

  test('command palette runs registered commands', async ({ page, mobile }) => {
    await page.goto('/')
    if (mobile) await page.getByRole('button', { name: '搜索' }).click()
    else await page.keyboard.press('Control+K')
    const input = page.getByPlaceholder('搜索资源、页面或操作…')
    await expect(input).toBeVisible()
    await input.fill('创建虚拟机')
    await page.getByRole('option', { name: '创建虚拟机' }).click()
    await expect(page).toHaveURL(/\/create\/qemu$/)
  })
})
