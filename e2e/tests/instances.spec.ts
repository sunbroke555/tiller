import { test, expect, type Page } from '@playwright/test'
import { env, splitUser } from '../fixtures'

// Writes only Tiller's connection registry; PVE calls are login and reads.
// Run against an isolated TILLER_INSTANCES_FILE, never a shared preview file.
const endpoint = '/api2/tiller/instances'
const headers = { 'X-Tiller-Ticket': 'cookie' }

async function login(page: Page) {
  const { username, realm } = splitUser(env.user)
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码', { exact: true }).fill(env.password)
  const realmBox = page.getByRole('combobox', { name: '认证域' })
  await expect(realmBox).toBeEnabled()
  if (!(await realmBox.textContent())?.includes(`@${realm}`)) {
    await realmBox.click()
    await page.getByRole('option', { name: new RegExp(`@${realm}$`) }).click()
  }
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test('页面管理实例、独立登录和跨标签页隔离', async ({ page, context }, testInfo) => {
  test.setTimeout(120_000)
  const name = `e2e-instance-${testInfo.project.name}-${Date.now()}`
  let id = ''
  try {
    await page.goto('/instances')
    await expect(page.getByRole('button', { name: '添加实例', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: '登录默认实例' }).click()
    await login(page)
    await expect(page.getByRole('heading', { name: '实例管理', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '添加实例', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('实例名称', { exact: true }).fill(name)
    await dialog.getByLabel('PVE 地址', { exact: true }).fill(process.env.PVE_LAB_URL!)
    await dialog.getByLabel('SHA-256 证书指纹', { exact: true }).fill(process.env.PVE_LAB_FINGERPRINT!)
    await page.screenshot({ path: testInfo.outputPath('instance-form.png'), fullPage: true })
    const created = page.waitForResponse((r) => new URL(r.url()).pathname === endpoint && r.request().method() === 'POST')
    await dialog.getByRole('button', { name: '添加实例', exact: true }).click()
    const response = await created
    expect(response.status()).toBe(201)
    const instance = await response.json() as { id: string; version: string }
    id = instance.id
    const prefix = `/i/${id}/${instance.version}`
    const apiPrefix = `/api/instances/${id}/${instance.version}`
    const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) })
    await expect(dialog).toBeHidden()
    await expect(row).toContainText('使用固定证书指纹')
    await page.screenshot({ path: testInfo.outputPath('instances.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    // A second tab uses a separate URL namespace within the same browser.
    const other = await context.newPage()
    await other.goto(prefix + '/')
    await expect(other).toHaveURL(new RegExp(prefix + '/login$'))
    await expect(other.getByRole('combobox', { name: 'PVE 实例' })).toContainText(name)
    await expect(other.getByLabel('用户名')).toHaveValue('')
    await other.screenshot({ path: testInfo.outputPath('instance-login.png'), fullPage: true })
    await login(other)
    await expect(other.getByRole('heading', { level: 1 })).toHaveText('概览')
    const cookies = await context.cookies()
    expect(cookies.some((c) => c.name === 'PVEAuthCookie' && c.httpOnly)).toBe(true)
    expect(cookies.some((c) => c.name === `tiller-pve-${id}-${instance.version}` && c.httpOnly && c.path === apiPrefix + '/')).toBe(true)
    expect((await context.request.get(apiPrefix + '/api2/json/nodes')).ok()).toBe(true)

    // A fresh browser with only the added PVE cookie cannot manage Tiller.
    const unprivileged = await context.browser()!.newContext({ storageState: { cookies: cookies.filter((c) => c.name.startsWith('tiller-pve-')), origins: [] } })
    try {
      const catalog = await unprivileged.request.get(env.baseURL + endpoint + '?manage=1')
      expect((await catalog.json()).canManage).toBe(false)
    } finally { await unprivileged.close() }

    await other.getByRole('button', { name: '账户菜单' }).filter({ visible: true }).click()
    await other.getByRole('menuitem', { name: '退出登录' }).click()
    await expect(other).toHaveURL(new RegExp(prefix + '/login'))
    expect((await context.request.get('/api2/json/nodes')).ok()).toBe(true)
    expect((await context.request.get(apiPrefix + '/api2/json/nodes')).status()).toBe(401)
    await page.reload()
    await expect(page.getByRole('button', { name: '添加实例', exact: true })).toBeVisible()

    // Renaming keeps the namespace, changing trust settings rotates it.
    await page.getByRole('button', { name: `编辑 ${name}`, exact: true }).click()
    await dialog.getByLabel('实例名称', { exact: true }).fill(name + '-renamed')
    const renamed = page.waitForResponse((r) => r.url().endsWith(endpoint + '/' + id) && r.request().method() === 'PUT')
    await dialog.getByRole('button', { name: '保存连接' }).click()
    expect((await (await renamed).json()).version).toBe(instance.version)
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: `编辑 ${name}-renamed`, exact: true }).click()
    await dialog.getByRole('switch', { name: '跳过证书校验' }).click()
    const changed = page.waitForResponse((r) => r.url().endsWith(endpoint + '/' + id) && r.request().method() === 'PUT')
    await dialog.getByRole('button', { name: '保存连接' }).click()
    const updated = await (await changed).json() as { version: string }
    expect(updated.version).not.toBe(instance.version)
    await expect(dialog).toBeHidden()
    await other.reload()
    await expect(other.getByRole('heading')).toHaveText('实例连接已变更')
    expect((await context.request.get(apiPrefix + '/api2/json/nodes')).status()).toBe(409)

    const updatedRow = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: name + '-renamed', exact: true }) })
    await updatedRow.getByRole('link', { name: '切换到此实例' }).click()
    await expect(page).toHaveURL(new RegExp(`/i/${id}/${updated.version}/login$`))
    // The selector switches with a new document and retains the default login.
    await page.getByRole('combobox', { name: 'PVE 实例' }).click()
    await page.getByRole('option', { name: '默认 PVE', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('概览')
    await page.goto('/instances')
    await page.getByRole('button', { name: `删除 ${name}-renamed`, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '删除连接', exact: true }).click()
    await expect(page.getByRole('heading', { name: name + '-renamed', exact: true })).toHaveCount(0)
    await other.goto(`/i/${id}/${updated.version}/`)
    await expect(other.getByRole('heading')).toHaveText('实例连接已变更')
    await other.close()
  } finally {
    if (id) await context.request.delete(endpoint + '/' + id, { headers })
  }
})
