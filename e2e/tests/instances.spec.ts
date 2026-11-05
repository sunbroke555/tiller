import { test, expect, type Page } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// A fresh, isolated Tiller per project. Only a disposable API Token is created
// on the lab; guests and host configuration are never modified.
const initialPassword = 'e2e-Tiller-first-password'
const newPassword = 'e2e-Tiller-new-password'
const endpoint = '/api2/tiller/instances'
// Real PVE passwords must not be captured in Playwright network traces.
test.use({ trace: 'off' })

async function login(page: Page, password: string) {
  await page.getByLabel('用户名', { exact: true }).fill('admin')
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible()
}

test('首次设置管理员、多实例导航、控制台、改密和重启持久化', async ({ page, context, browser }, testInfo) => {
  test.setTimeout(180_000)
  const labURL = process.env.PVE_LAB_URL
  if (!labURL) throw new Error('需要测试服务器的 PVE_LAB_URL')
  const host = new URL(labURL).hostname
  if (host === '192.168.0.6') throw new Error('拒绝对生产 PVE 创建测试 Token')
  const tokenName = `e2e-tiller-admin-${process.pid}-${testInfo.workerIndex}`
  const ssh = (command: string) => execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `root@${host}`, command], { encoding: 'utf8' })
  const dir = mkdtempSync(path.join(tmpdir(), 'tiller-admin-e2e-'))
  const port = 8165 + testInfo.workerIndex
  const base = `http://127.0.0.1:${port}`
  let proc: ChildProcess | undefined
  let tokenCreated = false
  let logs = ''
  const launch = async () => {
    proc = spawn(path.resolve('../server/tiller'), { env: { ...process.env, LISTEN: `127.0.0.1:${port}`, PVE_URL: '', TILLER_AUTH_FILE: path.join(dir, 'auth.json'), TILLER_INSTANCES_FILE: path.join(dir, 'instances.json') }, stdio: ['ignore', 'ignore', 'pipe'] })
    proc.on('error', (e) => { logs += e.message })
    proc.stderr?.on('data', (data: Buffer) => { logs += data.toString() })
    await expect.poll(async () => { try { return (await context.request.get(base + '/healthz')).status() } catch { return 0 } }).toBe(200)
  }
  const stop = async () => { if (proc?.pid && proc.exitCode === null) { const exit = once(proc, 'exit'); proc.kill('SIGTERM'); await exit } }
  try {
    const token = JSON.parse(ssh(`pveum user token add root@pam ${tokenName} --privsep 0 --output-format json`)) as { value: string; 'full-tokenid': string }
    tokenCreated = true
    await launch()
    expect((await context.request.get(base + endpoint)).status()).toBe(401)
    expect((await context.request.get(base + '/api2/json/nodes')).status()).toBe(401)
    await page.goto(base)
    await expect(page.getByRole('heading', { name: '设置管理员' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('first-setup.png'), fullPage: true })
    await page.getByLabel('管理员用户名').fill('admin')
    await page.getByLabel('密码', { exact: true }).fill(initialPassword)
    await page.getByLabel('确认密码', { exact: true }).fill('different-password')
    await page.getByRole('button', { name: '创建管理员' }).click()
    await expect(page.getByRole('alert')).toHaveText('两次输入的密码不一致')
    await page.getByLabel('确认密码', { exact: true }).fill(initialPassword)
    await page.getByRole('button', { name: '创建管理员' }).click()
    await expect(page.getByRole('heading', { name: '实例管理', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '添加实例', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: '实例名称', exact: true }).fill('实验 PVE A')
    await dialog.getByRole('textbox', { name: 'PVE 地址', exact: true }).fill(labURL)
    await expect(dialog.getByRole('combobox', { name: '认证方式', exact: true })).toHaveText('账号密码')
    await dialog.getByRole('textbox', { name: 'PVE 用户名', exact: true }).fill(process.env.PVE_LAB_USER ?? 'root@pam')
    await dialog.getByLabel('PVE 密码').fill('deliberately-wrong-password')
    await dialog.getByRole('textbox', { name: 'SHA-256 证书指纹', exact: true }).fill(process.env.PVE_LAB_FINGERPRINT!)
    await dialog.getByRole('button', { name: '添加实例', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('PVE 用户名、密码或认证域不正确')
    const labPassword = process.env.PVE_LAB_PASSWORD!
    await dialog.getByLabel('PVE 密码').fill(labPassword)
    const created = page.waitForResponse((r) => r.url().endsWith(endpoint) && r.request().method() === 'POST')
    await dialog.getByRole('button', { name: '添加实例', exact: true }).click()
    const createdResponse = await created
    expect(createdResponse.status()).toBe(201)
    const first = await createdResponse.json() as { id: string; version: string }
    await expect(dialog).toBeHidden()
    const csrf = await page.evaluate(() => JSON.parse(localStorage.getItem('tiller:admin-session')!).csrfToken as string)
    const headers = { CSRFPreventionToken: csrf }
    const added = await context.request.post(base + endpoint, { headers, data: { name: '实验 PVE B', url: labURL, fingerprint: process.env.PVE_LAB_FINGERPRINT, tokenId: token['full-tokenid'], tokenSecret: token.value } })
    expect(added.status()).toBe(201)
    const second = await added.json() as { id: string; version: string }
    const apiPrefix = (i: typeof first) => `/api/instances/${i.id}/${i.version}/api2/json`
    const appPrefix = (i: typeof first) => `/i/${i.id}/${i.version}`
    const raw = readFileSync(path.join(dir, 'instances.json'), 'utf8')
    expect(raw).not.toContain(token.value)
    expect(raw.includes(labPassword)).toBe(false)
    expect(statSync(path.join(dir, 'instances.json')).mode & 0o777).toBe(0o600)
    expect(readFileSync(path.join(dir, 'auth.json'), 'utf8')).not.toContain(initialPassword)
    const catalog = await context.request.get(base + endpoint)
    const publicCatalog = await catalog.text()
    expect(publicCatalog).not.toContain('encryptedToken')
    expect(publicCatalog).not.toContain('encryptedPassword')
    expect(publicCatalog.includes(labPassword)).toBe(false)
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(token.value)
    expect((await page.evaluate(() => JSON.stringify(localStorage))).includes(labPassword)).toBe(false)
    expect((await context.cookies()).some((cookie) => cookie.name.includes('PVEAuth'))).toBe(false)

    const resources = await context.request.get(base + apiPrefix(first) + '/cluster/resources')
    expect(resources.status()).toBe(200)
    const { data: all } = await resources.json() as { data: { id: string; type: string; node: string; vmid?: number; name?: string; status: string }[] }
    const guests = all.filter((r) => r.type === 'qemu' || r.type === 'lxc')
    await page.goto(base)
    await expect(page).toHaveURL(base + appPrefix(first) + '/')
    await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible()
    if (testInfo.project.name === 'desktop') {
      const tree = page.getByRole('tree', { name: '资源树' })
      const branchA = tree.getByRole('treeitem', { name: '实例 实验 PVE A', exact: true })
      const branchB = tree.getByRole('treeitem', { name: '实例 实验 PVE B', exact: true })
      await expect(branchA.locator('a[href*="/guest/"]')).toHaveCount(guests.length)
      await expect(branchB.locator('a[href*="/guest/"]')).toHaveCount(guests.length)
      for (const link of await branchB.locator('a[href*="/guest/"]').all()) {
        expect(await link.getAttribute('href')).toMatch(new RegExp('^' + appPrefix(second) + '/guest/'))
      }
      await page.getByLabel('过滤资源树').fill('101')
      await expect(branchA.locator('a[href*="/guest/"]')).toHaveCount(guests.filter((g) => g.vmid === 101).length)
      await expect(branchB.locator('a[href*="/guest/"]')).toHaveCount(guests.filter((g) => g.vmid === 101).length)
      await page.getByLabel('过滤资源树').fill('')
      // One unavailable instance does not block another branch or log out Tiller.
      await page.route('**' + apiPrefix(second) + '/cluster/resources', (route) => route.fulfill({ status: 503, json: { message: '模拟断线' } }))
      await page.reload()
      await expect(branchB.getByRole('button', { name: '连接异常，点击重试' })).toBeVisible()
      await expect(branchA.locator('a[href*="/guest/"]')).toHaveCount(guests.length)
      await page.unrouteAll()
      await branchB.getByRole('button', { name: '连接异常，点击重试' }).click()
      await expect(branchB.locator('a[href*="/guest/"]')).toHaveCount(guests.length)
    } else {
      await page.getByRole('combobox', { name: 'PVE 实例' }).click()
      await page.getByRole('option', { name: '实验 PVE B', exact: true }).click()
      await expect(page).toHaveURL(base + appPrefix(second) + '/')
    }
    for (const theme of ['dark', 'light', 'paper']) {
      await page.evaluate((mode) => localStorage.setItem('tiller:appearance', JSON.stringify({ mode })), theme)
      await page.reload()
      await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`instances-${theme}.png`), fullPage: true, animations: 'disabled' })
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

    const vm = guests.find((g) => g.vmid === 101 && g.type === 'qemu' && g.status === 'running')
    if (vm) {
      for (const instance of [first, second]) {
        await page.goto(base + appPrefix(instance) + `/guest/${vm.node}/qemu/101`)
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(vm.name!)
        await page.goto(base + appPrefix(instance) + `/console/${vm.node}/qemu/101`)
        await expect(page.getByTestId('console-status').first()).toHaveText('已连接', { timeout: 30_000 })
        await expect(page.getByTestId('vnc-console').locator('canvas')).toBeVisible()
      }
    }
    await page.goto(base + appPrefix(first) + '/account/permissions')
    await expect(page.getByRole('main')).toContainText(process.env.PVE_LAB_USER ?? 'root@pam')
    const other = await browser.newContext()
    try {
      const otherPage = await other.newPage()
      await otherPage.goto(base + '/login')
      await login(otherPage, initialPassword)
      await page.goto(base + '/account')
      await page.getByLabel('当前密码').fill(initialPassword)
      await page.getByLabel('新密码', { exact: true }).fill(newPassword)
      await page.getByLabel('确认新密码').fill(newPassword)
      await page.getByRole('button', { name: '保存新密码' }).click()
      await expect(page.getByRole('heading', { name: '登录 Tiller' })).toBeVisible()
      expect((await other.request.get(base + endpoint)).status()).toBe(401)
      await page.getByLabel('用户名', { exact: true }).fill('admin')
      await page.getByLabel('密码', { exact: true }).fill(initialPassword)
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await expect(page.getByRole('alert')).toHaveText('用户名或密码不正确')
      await login(page, newPassword)
    } finally { await other.close() }
    await stop()
    await launch()
    await page.reload()
    await expect(page.getByRole('heading', { name: '登录 Tiller' })).toBeVisible()
    await login(page, newPassword)
    await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible()
    await page.goto(base + '/instances')
    await page.getByRole('button', { name: '编辑 实验 PVE A', exact: true }).click()
    await expect(dialog.getByLabel('PVE 密码')).toHaveValue('')
    await dialog.getByRole('textbox', { name: '实例名称', exact: true }).fill('实验 PVE A 已改名')
    const renamed = page.waitForResponse((r) => r.url().endsWith(endpoint + '/' + first.id) && r.request().method() === 'PUT')
    await dialog.getByRole('button', { name: '保存连接', exact: true }).click()
    expect((await (await renamed).json()).version).toBe(first.version)
    await expect(dialog).toBeHidden()
    // Existing Token connections remain usable and can switch to passwords.
    await page.getByRole('button', { name: '编辑 实验 PVE B', exact: true }).click()
    await expect(dialog.getByRole('combobox', { name: '认证方式', exact: true })).toHaveText('API Token')
    await expect(dialog.getByLabel('Token Secret')).toHaveValue('')
    await dialog.getByRole('combobox', { name: '认证方式', exact: true }).click()
    await page.getByRole('option', { name: '账号密码', exact: true }).click()
    await dialog.getByRole('textbox', { name: 'PVE 用户名', exact: true }).fill(process.env.PVE_LAB_USER ?? 'root@pam')
    await dialog.getByLabel('PVE 密码').fill(labPassword)
    const switched = page.waitForResponse((r) => r.url().endsWith(endpoint + '/' + second.id) && r.request().method() === 'PUT')
    await dialog.getByRole('button', { name: '保存连接', exact: true }).click()
    const switchedResponse = await switched
    expect(switchedResponse.status()).toBe(200)
    const changed = await switchedResponse.json()
    expect(changed.version).not.toBe(second.version)
    await expect(dialog).toBeHidden()
    expect((await context.request.get(base + apiPrefix(second) + '/nodes')).status()).toBe(409)
    expect((await context.request.get(base + apiPrefix(changed) + '/nodes')).status()).toBe(200)
    await page.getByRole('button', { name: '删除 实验 PVE B', exact: true }).click()
    await page.getByRole('button', { name: '删除连接', exact: true }).click()
    await expect(page.getByRole('heading', { name: '实验 PVE B', exact: true })).toHaveCount(0)
    await page.goto(base + appPrefix(second) + '/')
    await expect(page.getByRole('heading')).toHaveText('实例连接已变更')
    await page.goto(base + '/account')
    await page.getByRole('button', { name: '退出 Tiller' }).click()
    await expect(page.getByRole('heading', { name: '登录 Tiller' })).toBeVisible()
    expect((await context.request.get(base + apiPrefix(first) + '/nodes')).status()).toBe(401)
  } finally {
    await stop()
    if (tokenCreated) ssh(`pveum user token remove root@pam ${tokenName}`)
    await testInfo.attach('server-log', { body: logs, contentType: 'text/plain' })
    rmSync(dir, { recursive: true, force: true })
  }
})
