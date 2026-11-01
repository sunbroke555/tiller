import { env, expect, splitUser, test } from '../fixtures'

// Smoke subset (`make e2e-smoke`, a couple of minutes): login, overview, guest
// summary, console, storage list and tasks, in both layouts. Read-only against
// the lab's sample guests (VM 100 stopped, VM 101 running).

const RUNNING_VM = 101

test.describe('smoke', { tag: '@smoke' }, () => {
  test.describe('login', () => {
    test.use({ storageState: { cookies: [], origins: [] } })

    test('logs in through the login page', async ({ page }) => {
      const { username, realm } = splitUser(env.user)
      await page.goto('/')
      await expect(page).toHaveURL(/\/login/)
      await expect(page.getByRole('heading', { name: 'PVE Web' })).toBeVisible()
      await page.getByLabel('用户名').fill(username)
      await page.getByLabel('密码', { exact: true }).fill(env.password)
      const realmBox = page.getByRole('combobox', { name: '认证域' })
      await expect(realmBox).toBeEnabled()
      if (!(await realmBox.textContent())?.includes(`@${realm}`)) {
        await realmBox.click()
        await page.getByRole('option', { name: new RegExp(`@${realm}$`) }).click()
      }
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('概览', { timeout: 20_000 })
    })
  })

  test('overview lists the guests', async ({ page, pve }) => {
    const samples = (await pve.guests()).filter((g) => g.vmid === 100 || g.vmid === RUNNING_VM)
    test.skip(samples.length < 2, '实验机缺少示例客户机 100 / 101')
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('概览')
    const list = page.locator('section[aria-labelledby="guests-heading"]')
    for (const g of samples) await expect(list.getByText(g.name!, { exact: true })).toBeVisible()
  })

  test('guest summary of a running VM', async ({ page, pve }) => {
    const vm = (await pve.guests()).find((g) => g.vmid === RUNNING_VM && g.status === 'running')
    test.skip(!vm, `VM ${RUNNING_VM} 未运行`)
    await page.goto(`/guest/${vm!.node}/qemu/${RUNNING_VM}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(vm!.name!)
    await expect(page.getByRole('region', { name: '资源使用' })).toContainText('CPU')
    await expect(page.locator('[data-slot=glass-card]', { has: page.getByRole('heading', { name: '状态', exact: true }) })).toContainText(
      '运行中',
    )
  })

  test('console opens and connects', async ({ page, pve }) => {
    const vm = (await pve.guests()).find((g) => g.vmid === RUNNING_VM && g.status === 'running')
    test.skip(!vm, `VM ${RUNNING_VM} 未运行`)
    await page.goto(`/console/${vm!.node}/qemu/${RUNNING_VM}`)
    await expect(page.getByTestId('console-status').first()).toHaveText('已连接', { timeout: 30_000 })
    await expect(page.getByTestId('vnc-console').locator('canvas')).toBeVisible()
  })

  test('storage list opens a storage', async ({ page, pve }) => {
    await page.goto('/storage')
    const local = page.getByRole('main').getByRole('link', { name: '存储 local', exact: true })
    await expect(local).toContainText('目录')
    await local.click()
    await expect(page).toHaveURL(new RegExp(`/storage/${pve.node}/local$`))
    await expect(page.getByRole('tabpanel', { name: '概要' })).toContainText('已用空间')
  })

  test('tasks list opens a task log', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('任务')
    const first = page.getByRole('list', { name: '任务列表' }).getByRole('listitem').first().getByRole('button')
    await expect(first).toBeVisible({ timeout: 20_000 })
    await first.click()
    const log = page.getByRole('dialog')
    await expect(log.getByTestId('task-log')).not.toBeEmpty({ timeout: 15_000 })
    await log.getByRole('button', { name: '关闭' }).last().click()
    await expect(log).toBeHidden()
  })
})
