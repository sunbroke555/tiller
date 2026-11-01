import type { Browser, Page } from '@playwright/test'

import { env, expect, splitUser, test } from '../fixtures'

// The limited lab account tester@pve (PVEAuditor on /, PVEVMUser on
// /vms/100): edit affordances it cannot use are hidden or disabled, per
// guest, and nothing crashes. Read-only: it never changes the lab.

async function testerPage(browser: Browser): Promise<Page> {
  test.skip(!env.testerPassword, '缺少 PVE_LAB_TESTER_PASSWORD')
  const ctx = await browser.newContext({ baseURL: env.baseURL, locale: 'zh-CN', storageState: { cookies: [], origins: [] } })
  const page = await ctx.newPage()
  const { username, realm } = splitUser(env.testerUser)
  await page.goto('/login')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码', { exact: true }).fill(env.testerPassword)
  const realmBox = page.getByRole('combobox', { name: '认证域' })
  await expect(realmBox).toBeEnabled()
  if (!(await realmBox.textContent())?.includes(`@${realm}`)) {
    await realmBox.click()
    await page.getByRole('option', { name: new RegExp(`@${realm}$`) }).click()
  }
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  return page
}

test('tester@pve: read-only where it lacks privileges, per guest', async ({ browser, pve }) => {
  const guests = await pve.guests()
  const ct = guests.find((g) => g.type === 'lxc' && g.template !== 1 && g.vmid < 1000)
  test.skip(!guests.some((g) => g.vmid === 100) || !guests.some((g) => g.vmid === 101) || !ct, '实验机缺少 100 / 101 / 示例容器')
  const page = await testerPage(browser)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    const node = pve.node

    // Container: auditor only → config tabs are read-only.
    await page.goto(`/guest/${node}/lxc/${ct!.vmid}/options`)
    await expect(page.getByRole('note').filter({ hasText: '只读' })).toBeVisible()
    await expect(page.getByRole('switch', { name: '开机自启' })).toBeDisabled()
    await page.goto(`/guest/${node}/lxc/${ct!.vmid}/network`)
    await expect(page.getByRole('tabpanel')).toBeVisible()
    await expect(page.getByRole('button', { name: '添加网卡' })).toHaveCount(0)
    await page.goto(`/guest/${node}/lxc/${ct!.vmid}/resources`)
    await expect(page.getByRole('note').filter({ hasText: '只读' })).toBeVisible()
    await expect(page.getByRole('button', { name: '添加挂载点' })).toHaveCount(0)

    // VM 101: no console tab, no notes/tags editing, snapshots disabled.
    await page.goto(`/guest/${node}/qemu/101`)
    const tabs = page.getByRole('navigation', { name: '页面标签' })
    await expect(tabs.getByRole('link', { name: '概要' })).toBeVisible()
    await expect(tabs.getByRole('link', { name: '控制台' })).toHaveCount(0)
    await expect(tabs.getByRole('link', { name: '监视器' })).toHaveCount(0)
    await expect(page.getByText('标签', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: '添加备注' })).toHaveCount(0)
    await page.goto(`/guest/${node}/qemu/101/snapshots`)
    await expect(page.getByRole('button', { name: '创建快照' })).toBeDisabled()
    await page.goto(`/guest/${node}/qemu/101/backup`)
    await expect(page.getByRole('button', { name: '立即备份' }).first()).toBeDisabled()

    // VM 100 (PVEVMUser): console tab and backup are allowed.
    await page.goto(`/guest/${node}/qemu/100`)
    await expect(page.getByRole('navigation', { name: '页面标签' }).getByRole('link', { name: '控制台' })).toBeVisible()
    await page.goto(`/guest/${node}/qemu/100/backup`)
    await expect(page.getByRole('button', { name: '立即备份' }).first()).toBeEnabled()

    // Node: no shell or syslog tab, notes read-only.
    await page.goto(`/node/${node}`)
    const nodeTabs = page.getByRole('navigation', { name: '页面标签' })
    await expect(nodeTabs.getByRole('link', { name: '服务' })).toBeVisible()
    await expect(nodeTabs.getByRole('link', { name: 'Shell' })).toHaveCount(0)
    await expect(nodeTabs.getByRole('link', { name: '系统日志' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '编辑备注' })).toHaveCount(0)

    expect(errors).toEqual([])
  } finally {
    await page.context().close()
  }
})
