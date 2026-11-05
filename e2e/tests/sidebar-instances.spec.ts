import { expect, test, type Page } from '@playwright/test'

const a = { id: 'a'.repeat(24), version: '1'.repeat(24), name: '机房 A', hasCredential: true }
const b = { id: 'b'.repeat(24), version: '2'.repeat(24), name: '机房 B', hasCredential: true }
const appPath = (instance = a) => `/i/${instance.id}/${instance.version}`
const apiPath = (instance = a) => `/api/instances/${instance.id}/${instance.version}/api2/json`

async function mockInstances(page: Page, instances = [a, b]) {
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (!path.startsWith('/api')) return route.fallback()
    if (path === '/api/auth/session') return route.fulfill({ json: { setupRequired: false, session: {
      username: 'admin', csrfToken: 'mock-csrf', ticketIssuedAt: Date.now(), expiresAt: Date.now() + 3600_000,
    } } })
    if (path === '/api2/tiller/instances') return route.fulfill({ json: { canManage: true, instances } })
    if (path.endsWith('/cluster/resources')) return route.fulfill({ json: { data: [
      { id: 'node/pve', type: 'node', node: 'pve', status: 'online', maxcpu: 4, cpu: 0.1, mem: 1024, maxmem: 4096 },
      ...Array.from({ length: 18 }, (_, i) => ({
        id: `qemu/${100 + i}`, type: 'qemu', vmid: 100 + i, node: 'pve',
        name: i === 0 ? 'DNS01' : `guest-${100 + i}`, status: i % 3 ? 'running' : 'stopped',
        tags: i === 0 ? 'prod;dns' : '', pool: 'services',
      })),
      ...[200, 201].map((vmid) => ({ id: `lxc/${vmid}`, type: 'lxc', vmid, node: 'pve', name: `container-${vmid}`, status: 'running' })),
      { id: 'qemu/9000', type: 'qemu', vmid: 9000, node: 'pve', name: 'debian-template', template: 1, status: 'stopped' },
      { id: 'storage/pve/local', type: 'storage', node: 'pve', storage: 'local', status: 'available' },
    ] } })
    if (path.endsWith('/cluster/status')) return route.fulfill({ json: { data: [{ type: 'cluster', name: 'pve' }] } })
    if (path.endsWith('/version')) return route.fulfill({ json: { data: { version: '9.2.21' } } })
    if (path.endsWith('/cluster/options')) return route.fulfill({ json: { data: {
      'tag-style': `color-map=prod:${path.includes(b.id) ? 'ff0000' : '0000ff'}`,
    } } })
    if (path.endsWith('/api/config')) return route.fulfill({ json: {} })
    return route.fulfill({ json: { data: [] } })
  })
}

test('home resumes the last valid instance and falls back after removal', async ({ page }) => {
  await mockInstances(page)
  await page.goto('/')
  await expect(page).toHaveURL(new RegExp(appPath(a) + '/$'))
  await page.goto(appPath(b) + '/tasks')
  await expect(page.getByRole('heading', { name: '任务', exact: true })).toBeVisible()
  await page.goto('/')
  await expect(page).toHaveURL(new RegExp(appPath(b) + '/$'))
  await page.route('**/api2/tiller/instances', (route) => route.fulfill({ json: { canManage: true, instances: [a] } }))
  await page.goto('/')
  await expect(page).toHaveURL(new RegExp(appPath(a) + '/$'))
  await page.route('**/api2/tiller/instances', (route) => route.fulfill({ json: { canManage: true, instances: [] } }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '实例管理', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '添加实例', exact: true })).toBeVisible()
})

test('instance branches isolate links, folds, grouping and tag styles @desktop', async ({ page }, testInfo) => {
  await mockInstances(page)
  await page.goto(appPath(a) + '/tasks')
  await page.getByRole('button', { name: '资源实例：机房 A', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '全部实例', exact: true }).click()
  const tree = page.getByRole('tree', { name: '资源树' })
  const branchA = tree.getByRole('treeitem', { name: '实例 机房 A', exact: true })
  const branchB = tree.getByRole('treeitem', { name: '实例 机房 B', exact: true })
  const guest = (branch: typeof tree) => branch.getByRole('link', { name: /100 DNS01/ })
  await branchB.getByRole('button', { name: '展开实例 机房 B', exact: true }).click()
  await expect(guest(branchA)).toHaveAttribute('href', appPath(a) + '/guest/pve/qemu/100')
  await expect(guest(branchB)).toHaveAttribute('href', appPath(b) + '/guest/pve/qemu/100')
  const tagA = guest(branchA).getByLabel('标签 prod')
  const tagB = guest(branchB).getByLabel('标签 prod')
  await expect(tagA).toHaveAttribute('style', /0 0 255/)
  await expect(tagB).toHaveAttribute('style', /255 0 0/)
  await branchA.getByRole('button', { name: '折叠 pve', exact: true }).click()
  await expect(guest(branchA)).toHaveCount(0)
  await expect(guest(branchB)).toHaveCount(1)
  await page.reload()
  await expect(branchA.getByRole('button', { name: '展开 pve', exact: true })).toBeVisible()
  await page.getByLabel('过滤资源树').fill('机房 B 100')
  await expect(guest(branchB)).toHaveCount(1)
  await expect(guest(branchA)).toHaveCount(0)
  await page.getByLabel('过滤资源树').press('Escape')
  await page.getByRole('button', { name: /分组方式/ }).click()
  await page.getByRole('menuitemradio', { name: '按资源池' }).click()
  await expect(branchB.getByRole('link', { name: /services/ })).toHaveAttribute('href', appPath(b) + '/pool/services')
  await page.getByRole('button', { name: /分组方式/ }).click()
  await page.getByRole('menuitemradio', { name: '按标签' }).click()
  await expect(branchB.getByRole('treeitem', { name: 'prod', exact: true }).getByRole('link').first()).toHaveAttribute('href', appPath(b) + '/?tag=prod')
  await page.getByRole('button', { name: /分组方式/ }).click()
  await page.getByRole('menuitemradio', { name: '按节点' }).click()
  await guest(branchB).click()
  await expect(page).toHaveURL(new RegExp(appPath(b) + '/guest/pve/qemu/100$'))
  await expect(branchB.getByRole('link', { name: /100 DNS01/ })).toHaveAttribute('aria-current', 'page')
  await expect(branchA.getByRole('link', { name: /100 DNS01/ })).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 711 })
  await page.evaluate(() => localStorage.setItem('tiller:appearance', JSON.stringify({ mode: 'dark' })))
  await page.reload()
  await expect(branchB.getByRole('link', { name: /100 DNS01/ })).toHaveAttribute('aria-current', 'page')
  await page.locator('aside').screenshot({ path: testInfo.outputPath('multi-instance-sidebar.png') })
})

test('an unavailable instance stays isolated and can retry @desktop', async ({ page }) => {
  await mockInstances(page)
  await page.route('**' + apiPath(b) + '/cluster/resources', (route) => route.fulfill({ status: 401, json: { message: '连接异常' } }))
  await page.goto(appPath(a) + '/tasks')
  await page.getByRole('button', { name: '资源实例：机房 A', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '全部实例', exact: true }).click()
  const branchA = page.getByRole('treeitem', { name: '实例 机房 A', exact: true })
  const branchB = page.getByRole('treeitem', { name: '实例 机房 B', exact: true })
  await branchB.getByRole('button', { name: '展开实例 机房 B', exact: true }).click()
  await expect(branchB.getByRole('button', { name: '连接异常，点击重试' })).toBeVisible()
  await expect(branchA.getByRole('link', { name: /100 DNS01/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: '登录 Tiller' })).toHaveCount(0)
  await page.unroute('**' + apiPath(b) + '/cluster/resources')
  await branchB.getByRole('button', { name: '连接异常，点击重试' }).click()
  await expect(branchB.getByRole('link', { name: /100 DNS01/ })).toHaveCount(1)
})

test('short desktop windows retain space for resources and working controls @desktop', async ({ page }, testInfo) => {
  await mockInstances(page)
  await page.goto(appPath(a) + '/tasks')
  const sidebar = page.locator('aside')
  const viewport = sidebar.locator('[data-slot=scroll-area-viewport]')
  await expect(sidebar.getByRole('link', { name: /100 DNS01/ }).first()).toBeVisible()
  for (const height of [600, 711, 900]) {
    await page.setViewportSize({ width: 1280, height })
    const bounds = (await viewport.boundingBox())!
    expect(bounds.height).toBeGreaterThanOrEqual(height * 0.44)
    const visibleGuests = await viewport.locator('a[href*="/guest/"]').evaluateAll((links) => links.filter((link) => {
      const outer = link.closest('[data-slot=scroll-area-viewport]')!.getBoundingClientRect()
      const row = link.getBoundingClientRect()
      return row.top >= outer.top && row.bottom <= outer.bottom
    }).length)
    expect(visibleGuests).toBeGreaterThanOrEqual(height === 600 ? 6 : 9)
    await sidebar.screenshot({ path: testInfo.outputPath(`sidebar-${height}.png`) })
  }
  for (const theme of ['dark', 'light', 'paper']) {
    await page.evaluate((mode) => localStorage.setItem('tiller:appearance', JSON.stringify({ mode })), theme)
    await page.reload()
    await expect(sidebar.getByRole('link', { name: /100 DNS01/ }).first()).toBeVisible()
    await sidebar.screenshot({ path: testInfo.outputPath(`sidebar-${theme}.png`) })
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await sidebar.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.getByPlaceholder('搜索资源、页面或操作…')).toBeVisible()
  await page.keyboard.press('Escape')
  await sidebar.getByRole('button', { name: '账户菜单' }).click()
  await expect(page.getByRole('menuitem', { name: '管理员账户' })).toBeVisible()
  await page.keyboard.press('Escape')
  await sidebar.getByRole('button', { name: '资源实例：机房 A', exact: true }).click()
  await page.getByRole('menuitem', { name: '管理实例' }).click()
  await expect(page.getByRole('heading', { name: '实例管理', exact: true })).toBeVisible()
})

test('focused sidebar searches across instances and remembers resource folders and scroll @desktop', async ({ page }, info) => {
  await mockInstances(page)
  const otherRequests: string[] = []
  page.on('request', (request) => { if (request.url().includes(apiPath(b) + '/cluster/resources')) otherRequests.push(request.url()) })
  await page.goto(appPath(a) + '/tasks')
  const sidebar = page.locator('aside')
  const tree = sidebar.getByRole('tree', { name: '资源树' })
  const viewport = sidebar.locator('[data-slot=scroll-area-viewport]')
  await expect(tree.getByRole('link', { name: /100 DNS01/ })).toBeVisible()
  await expect(tree.getByRole('treeitem', { name: /^实例 / })).toHaveCount(0)
  expect(otherRequests).toHaveLength(0)
  await expect(tree.locator('a[href*="/9000"]')).toHaveCount(0)
  await expect(tree.locator('a[href*="/storage/"]')).toHaveCount(0)
  await sidebar.getByRole('button', { name: '容器', exact: true }).click()
  await expect(tree.locator('a[href*="/lxc/"]')).toHaveCount(2)
  await expect(tree.locator('a[href*="/qemu/"]')).toHaveCount(0)
  await sidebar.getByRole('button', { name: '全部', exact: true }).click()
  await sidebar.getByLabel('过滤资源树').fill('机房 B 100')
  await expect(tree.getByRole('link', { name: /100 DNS01/ })).toHaveAttribute('href', appPath(b) + '/guest/pve/qemu/100')
  expect(otherRequests.length).toBeGreaterThan(0)
  await sidebar.getByLabel('过滤资源树').fill('no-such-resource')
  await expect(sidebar.getByText('没有匹配的资源', { exact: true })).toBeVisible()
  await expect(tree.getByRole('link')).toHaveCount(0)
  await sidebar.getByLabel('过滤资源树').press('Escape')
  await expect(tree.getByRole('link', { name: /100 DNS01/ })).toHaveAttribute('href', appPath(a) + '/guest/pve/qemu/100')
  await tree.getByRole('button', { name: '展开模板', exact: true }).click()
  await expect(tree.locator('a[href*="/9000"]')).toHaveCount(1)
  await page.reload()
  await expect(tree.getByRole('button', { name: '折叠模板', exact: true })).toBeVisible()
  await viewport.evaluate((element) => { element.scrollTop = 300 })
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(200)
  const top = await viewport.evaluate((element) => element.scrollTop)
  await page.reload()
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeCloseTo(top, 0)
  await sidebar.getByRole('button', { name: '资源实例：机房 A', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '机房 B', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(appPath(b) + '/$'))
  await expect(sidebar.getByRole('button', { name: '资源实例：机房 B', exact: true })).toBeVisible()
  await sidebar.getByRole('button', { name: '资源实例：机房 B', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '机房 A', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(appPath(a) + '/$'))
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeCloseTo(top, 0)
  await tree.getByRole('button', { name: '折叠模板', exact: true }).click()
  await page.goto(appPath(a) + '/guest/pve/qemu/9000')
  await expect(tree.locator('a[href*="/9000"]')).toHaveAttribute('aria-current', 'page')
  const visible = await tree.locator('a[href*="/9000"]').evaluate((link) => {
    const row = link.getBoundingClientRect(), view = link.closest('[data-slot=scroll-area-viewport]')!.getBoundingClientRect()
    return row.top >= view.top && row.bottom <= view.bottom + 1
  })
  expect(visible).toBe(true)
  await sidebar.screenshot({ path: info.outputPath('focused-sidebar-active-template.png') })
  await sidebar.getByRole('button', { name: '资源实例：机房 A', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '全部实例', exact: true }).click()
  await tree.getByRole('button', { name: '折叠实例 机房 A', exact: true }).click()
  await expect(tree.locator('a[href*="/9000"]')).toHaveCount(0)
  await page.reload()
  await expect(tree.locator('a[href*="/9000"]')).toHaveAttribute('aria-current', 'page')
})

test('phones switch directly between instances without an aggregate screen @mobile', async ({ page }) => {
  await mockInstances(page)
  await page.goto(appPath(a) + '/tasks')
  const switcher = page.getByRole('combobox', { name: 'PVE 实例' })
  await switcher.click()
  await expect(page.getByRole('option')).toHaveCount(2)
  await page.getByRole('option', { name: b.name, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(appPath(b) + '/$'))
  await expect(switcher).toContainText(b.name)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
