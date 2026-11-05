import { expect, test, type Page } from '@playwright/test'

async function mockAPI(page: Page, authenticated = false) {
  await page.route('**/api/auth/session', (route) => route.fulfill({ json: { setupRequired: false, session: authenticated ? { username: 'admin', csrfToken: 'mock', ticketIssuedAt: Date.now(), expiresAt: Date.now() + 3600000 } : null } }))
  await page.route('**/api2/tiller/instances*', (route) => route.fulfill({ json: { canManage: true, instances: [{ id: 'a'.repeat(24), version: 'b'.repeat(24), name: 'Docs demo', hasCredential: true }] } }))
  await page.route('**/api/config', (route) => route.fulfill({ json: { consentText: '' } }))
  await page.route('**/api2/json/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith('/access/domains') ? [{ realm: 'pam', type: 'pam', default: 1 }]
      : path.endsWith('/version') ? { version: '9.2' }
      : path.endsWith('/access/permissions') ? {} : []
    return route.fulfill({ json: { data } })
  })
}

test('无需登录，章节直达和刷新均可用，脚本符合 CSP', async ({ page, baseURL }, testInfo) => {
  const errors: string[] = []
  const unexpectedRequests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== baseURL || url.pathname.startsWith('/api')) unexpectedRequests.push(url.href)
  })
  await page.goto('/docs')
  await expect(page).toHaveURL(`${baseURL}/docs/`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tiller 使用手册')
  await page.goto('/docs/guide/configuration')
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('连接与安全配置')
  await expect(page.getByRole('button', { name: '搜索文档' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: testInfo.outputPath('documentation.png'), fullPage: true })
  expect(errors).toEqual([])
  expect(unexpectedRequests).toEqual([])
})

test('中文和配置名可搜索，空结果可恢复', async ({ page }) => {
  await page.goto('/docs/')
  await page.getByRole('button', { name: '搜索文档' }).click()
  const input = page.locator('#localsearch-input')
  await input.fill('备份')
  await expect(page.locator('.VPLocalSearchBox .result').first()).toBeVisible()
  await input.fill('zzzzzzzzzzzzzzzzzz')
  await expect(page.getByText('没有找到相关内容')).toBeVisible()
  await input.fill('PVE_TLS_FINGERPRINT')
  const result = page.locator('.VPLocalSearchBox .result').first()
  await expect(result).toBeVisible()
  await result.click()
  await expect(input).toBeHidden()
  await expect(page).toHaveURL(/\/docs\/guide\/(configuration|docker|install|troubleshooting)/)
})

test('手机目录可以跳转章节 @mobile', async ({ page }) => {
  await page.goto('/docs/')
  await page.getByRole('button', { name: '文档目录' }).click()
  await page.locator('.VPSidebar').getByRole('link', { name: '虚拟机与容器', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('虚拟机与容器')
  await expect(page.locator('.VPSidebar')).not.toHaveClass(/open/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('深浅色切换在刷新后保留 @desktop', async ({ page }) => {
  await page.goto('/docs/')
  await page.getByRole('switch', { name: '切换深色' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByRole('switch', { name: '切换浅色' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})

test('PWA 接管后登录页仍能打开文档，并返回 Tiller', async ({ page, context }) => {
  await mockAPI(page)
  await page.goto('/login')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  const popupPromise = context.waitForEvent('page')
  await page.getByRole('link', { name: '使用文档' }).click()
  const docs = await popupPromise
  await expect(docs.getByRole('heading', { level: 1 })).toHaveText('Tiller 使用手册')
  await mockAPI(docs)
  await docs.getByRole('link', { name: '返回 Tiller' }).click()
  await expect(docs.getByRole('heading', { name: '登录 Tiller' })).toBeVisible()
})

test('账户菜单有可用的文档入口', async ({ page, context }) => {
  await mockAPI(page, true)
  await page.goto(`/i/${'a'.repeat(24)}/${'b'.repeat(24)}/`)
  await page.getByRole('button', { name: '账户菜单' }).click()
  const popupPromise = context.waitForEvent('page')
  await page.getByRole('menuitem', { name: '使用文档' }).click()
  const docs = await popupPromise
  await expect(docs.getByRole('heading', { level: 1 })).toHaveText('Tiller 使用手册')
})

test('所有目录、正文链接和锚点可达，缺失章节返回 404 @desktop', async ({ page, request, baseURL }) => {
  const pending = ['/docs/']
  const visited = new Map<string, Set<string>>()
  const links = new Set<string>()
  while (pending.length) {
    const path = pending.shift()!
    if (visited.has(path)) continue
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(200)
    const ids = await page.locator('[id]').evaluateAll((elements) => elements.map((el) => el.id))
    visited.set(path, new Set(ids))
    const hrefs = await page.locator('a[href]').evaluateAll((elements) => elements.map((el) => (el as HTMLAnchorElement).href))
    for (const href of hrefs) {
      const url = new URL(href)
      if (url.origin !== baseURL || !url.pathname.startsWith('/docs/')) continue
      links.add(href)
      if (!visited.has(url.pathname)) pending.push(url.pathname)
    }
  }
  expect(visited.size).toBe(14)
  for (const href of links) {
    const url = new URL(href)
    if (url.hash) expect(visited.get(url.pathname)?.has(decodeURIComponent(url.hash.slice(1))), href).toBe(true)
  }
  for (const path of ['/docs/missing', '/docs/assets/missing.js', '/docs/ARCHITECTURE', '/docs/LAB']) {
    expect((await request.get(path)).status(), path).toBe(404)
  }
})
