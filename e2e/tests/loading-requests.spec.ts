import { expect, test, type Page } from '@playwright/test'

const a = { id: 'a'.repeat(24), version: '1'.repeat(24), name: '机房 A', hasCredential: true }
const b = { id: 'b'.repeat(24), version: '2'.repeat(24), name: '机房 B', hasCredential: true }
const app = `/i/${a.id}/${a.version}`
const api = `/api/instances/${a.id}/${a.version}/api2/json`
const resources = [
  { id: 'node/pve', type: 'node', node: 'pve', status: 'online', cpu: 0.1, maxcpu: 4, mem: 1024, maxmem: 4096 },
  { id: 'qemu/100', type: 'qemu', node: 'pve', vmid: 100, name: 'test-vm', status: 'stopped', maxmem: 1024 },
]

async function mockAPI(page: Page) {
  await page.route('**/*', (route) => {
    const path = new URL(route.request().url()).pathname
    if (!path.startsWith('/api')) return route.fallback()
    if (path === '/api/auth/session') return route.fulfill({ json: { setupRequired: false, session: {
      username: 'admin', csrfToken: 'test', ticketIssuedAt: Date.now(), expiresAt: Date.now() + 3600_000,
    } } })
    if (path === '/api2/tiller/instances') return route.fulfill({ json: { canManage: true, instances: [a, b] } })
    if (path.endsWith('/cluster/resources')) return route.fulfill({ json: { data: resources } })
    if (path.endsWith('/access/permissions')) return route.fulfill({ json: { data: { '/': { 'Sys.Audit': 1, 'VM.Audit': 1, 'VM.Backup': 1 } } } })
    if (path.endsWith('/version')) return route.fulfill({ json: { data: { version: '9.2' } } })
    if (path.endsWith('/rrddata')) return route.fulfill({ json: { data: Array.from({ length: 12 }, (_, i) => ({ time: 1800000000 + i * 60, cpu: i / 100, maxcpu: 4, memused: 1024, memtotal: 4096 })) } })
    if (path.endsWith('/nodes')) return route.fulfill({ json: { data: [{ node: 'pve', status: 'online' }] } })
    if (path.endsWith('/nodes/pve/status')) return route.fulfill({ json: { data: { cpu: 0.1, cpuinfo: { cpus: 4 }, memory: { used: 1024, total: 4096 } } } })
    if (path.endsWith('/nodes/pve/storage')) return route.fulfill({ json: { data: ['fast', 'slow'].map((storage) => ({ storage, type: 'dir', content: 'backup', active: 1, enabled: 1 })) } })
    if (path.includes('/api/hardware/')) return route.fulfill({ json: { enabled: false, connected: false, managed: false } })
    if (path.endsWith('/config') || path.endsWith('/cluster/options')) return route.fulfill({ json: { data: {} } })
    return route.fulfill({ json: { data: [] } })
  })
}

test('hidden desktop resource trees do not poll other instances on phones @mobile', async ({ page }) => {
  await mockAPI(page)
  await page.addInitScript(({ id, version }) => localStorage.setItem('tiller:resource-tree', JSON.stringify({ view: 'all', collapsed: { [`instance:${id}:${version}`]: false } })), b)
  await page.clock.install()
  let otherRequests = 0
  page.on('request', (r) => { if (r.url().includes(`/api/instances/${b.id}/`)) otherRequests++ })
  await page.goto(app + '/tasks')
  await expect(page.getByRole('heading', { name: '任务', exact: true })).toBeVisible()
  await page.clock.runFor(11_000)
  expect(otherRequests).toBe(0)
  // Returning to desktop must mount the tree and start its visible queries.
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.locator('aside').getByRole('link', { name: /100 test-vm/ }).last()).toBeVisible()
  await expect.poll(() => otherRequests).toBeGreaterThan(0)
  await page.setViewportSize({ width: 393, height: 852 })
  await expect(page.locator('aside')).toHaveCount(0)
  const count = otherRequests
  await page.clock.runFor(11_000)
  expect(otherRequests).toBe(count)
  await expect(page.getByRole('combobox', { name: 'PVE 实例' })).toBeVisible()
})

test('opening node summary reuses the overview history request', async ({ page }) => {
  await mockAPI(page)
  let rrdRequests = 0
  page.on('request', (r) => { if (r.url().includes('/nodes/pve/rrddata')) rrdRequests++ })
  await page.goto(app + '/')
  await expect(page.getByLabel('最近一小时 CPU 使用率').locator('path').first()).toBeVisible()
  await page.locator(`main a[href="${app}/node/pve"]`).first().click()
  await expect(page.getByRole('region', { name: '资源使用', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'CPU 使用率', exact: true })).toBeVisible()
  expect(rrdRequests).toBe(1)
})

test('a slow backup storage does not hide backups already returned by another storage', async ({ page }) => {
  await mockAPI(page)
  let release!: () => void
  const slow = new Promise<void>((resolve) => { release = resolve })
  await page.route('**' + api + '/nodes/pve/storage/slow/content?*', async (route) => {
    await slow
    await route.fulfill({ json: { data: [] } })
  })
  await page.route('**' + api + '/nodes/pve/storage/fast/content?*', (route) => route.fulfill({ json: { data: [
    { volid: 'fast:backup/vzdump-qemu-100-2026_11_02-00_00_00.vma.zst', format: 'vma.zst', vmid: 100, ctime: 1793577600, size: 4096, notes: '可用备份' },
  ] } }))
  try {
    await page.goto(app + '/guest/pve/qemu/100/backup')
    await expect(page.getByRole('list', { name: '备份列表' })).toContainText('可用备份', { timeout: 2000 })
    await expect(page.getByRole('status').filter({ hasText: 'slow' })).toBeVisible()
    await page.getByRole('button', { name: /^slow/ }).click()
    await expect(page.getByText('slow 上没有备份', { exact: true })).not.toBeVisible()
    release()
    await expect(page.getByText('slow 上没有备份', { exact: true })).toBeVisible()
  } finally { release() }
})

for (const failure of ['storage discovery', 'storage content']) {
  test(`backup ${failure} failure stays distinguishable from an empty list`, async ({ page }) => {
    await mockAPI(page)
    if (failure === 'storage discovery') {
      await page.route('**' + api + '/nodes/pve/storage?*', (route) => route.fulfill({ status: 403, json: { message: '存储权限不足' } }))
    } else {
      await page.route('**' + api + '/nodes/pve/storage/*/content?*', (route) => route.fulfill({ status: 403, json: { message: '备份权限不足' } }))
    }
    await page.goto(app + '/guest/pve/qemu/100/backup')
    await expect(page.getByText('暂时无法确认备份列表', { exact: true })).toBeVisible()
    await expect(page.getByRole('alert').first()).toContainText('权限不足')
    await expect(page.getByText('没有备份存储', { exact: true })).not.toBeVisible()
    await expect(page.getByText('还没有备份', { exact: true })).not.toBeVisible()
  })
}
