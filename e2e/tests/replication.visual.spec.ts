import { expect, test } from '../fixtures'

// Visual QA of the replication screens (not a regression test), dark theme,
// with the replication API mocked. Runs only with E2E_SCREENSHOTS=1; images
// land in e2e/test-results/repl-shots/.

const now = () => Math.floor(Date.now() / 1000)

test('replication screens (dark)', async ({ page, pve }, info) => {
  test.setTimeout(120_000)
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('pve-web:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
  })
  const jobs = [
    { id: '100-0', guest: 100, jobnum: 0, target: 'pvelab-c2', type: 'local', schedule: '*/15', source: pve.node },
    { id: '100-1', guest: 100, jobnum: 1, target: 'pvelab-c3', type: 'local', schedule: '*/2:00', source: pve.node, disable: 1 },
    { id: '200-0', guest: 200, jobnum: 0, target: 'pvelab-c3', type: 'local', schedule: 'mon..fri 00:00', rate: 20, source: pve.node, comment: '夜间同步' },
    { id: '9000-0', guest: 9000, jobnum: 0, target: 'pvelab-c2', type: 'local', source: pve.node },
  ]
  const states = [
    { ...jobs[0], last_sync: now() - 300, duration: 2.4, next_sync: now() + 600, fail_count: 0 },
    { ...jobs[1], last_sync: now() - 86400, duration: 31.2, next_sync: now() + 3600, fail_count: 0 },
    { ...jobs[2], last_sync: now() - 7200, duration: 1.1, next_sync: now() + 3600, fail_count: 3, error: 'command \'zfs send -Rpv -- e2erep/vm-200-disk-0@__replicate_200-0__\' failed: exit code 1' },
    { ...jobs[3], last_sync: now() - 900, duration: 0.8, next_sync: 1800, fail_count: 0, pid: 4242 },
  ]
  const log = [
    'start replication job',
    'guest => VM 100, running => 0',
    'volumes => e2e-rep:vm-100-disk-0',
    "create snapshot '__replicate_100-0_1793514360__' on e2e-rep:vm-100-disk-0",
    'using secure transmission, rate limit: none',
    "incremental sync 'e2e-rep:vm-100-disk-0' (__replicate_100-0_1793514060__ => __replicate_100-0_1793514360__)",
    "successfully imported 'e2e-rep:vm-100-disk-0'",
    'end replication job',
  ].map((t, i) => ({ n: i + 1, t: `2026-11-01 14:26:0${i} 100-0: ${t}` }))
  await page.route('**/api2/json/cluster/replication', (route) => route.fulfill({ json: { data: jobs } }))
  await page.route('**/api2/json/cluster/replication/*', (route) =>
    route.fulfill({ json: { data: { ...jobs.find((j) => route.request().url().endsWith(`/${j.id}`)), digest: 'x' } } }),
  )
  await page.route('**/api2/json/nodes/*/replication?*', (route) => route.fulfill({ json: { data: states.filter((s) => route.request().url().includes(`guest=${s.guest}`)) } }))
  await page.route('**/api2/json/nodes/*/replication', (route) =>
    route.fulfill({ json: { data: route.request().url().includes(`/nodes/${pve.node}/`) ? states : [] } }),
  )
  await page.route('**/api2/json/nodes/*/replication/*/log?*', (route) => route.fulfill({ json: { data: log } }))

  const dir = `test-results/repl-shots/${info.project.name}`
  const shot = async (name: string, fullPage = false) => {
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${dir}-${name}.png`, fullPage })
  }

  await page.goto('/datacenter/replication')
  await expect(page.locator('[data-job="200-0"]')).toContainText('失败')
  await shot('dc', true)

  await page.locator('[data-job="200-0"]').getByRole('button', { name: /复制任务 200-0/ }).click()
  await expect(page.getByRole('dialog', { name: '复制任务 200-0' })).toBeVisible()
  await shot('detail')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '添加', exact: true }).click()
  const add = page.getByRole('dialog', { name: '添加复制任务' })
  await add.getByRole('button', { name: '常用计划' }).click()
  await shot('presets')
  await page.getByRole('menuitem', { name: /周一至周五 00:00/ }).click()
  await expect(add.getByText(/接下来/)).toBeVisible()
  await shot('add')
  await add.getByRole('button', { name: '取消' }).click()

  await page.goto(`/guest/${pve.node}/qemu/100/replication`)
  await expect(page.locator('[data-job="100-1"]')).toContainText('已停用')
  await shot('guest', true)

  await page.goto(`/node/${pve.node}/replication`)
  await expect(page.locator('[data-job="9000-0"]')).toContainText('同步中')
  await shot('node', true)

  await page.locator('[data-job="100-0"]').getByRole('button', { name: /复制任务 100-0/ }).click()
  const detail = page.getByRole('dialog', { name: '复制任务 100-0' })
  await detail.getByRole('button', { name: '日志' }).click()
  await expect(page.getByTestId('replication-log')).toContainText('end replication job')
  await shot('log')
  await page.keyboard.press('Escape')

  await page.locator('[data-job="100-0"]').getByRole('button', { name: /复制任务 100-0/ }).click()
  await page.getByRole('dialog', { name: '复制任务 100-0' }).getByRole('button', { name: '编辑' }).click()
  await expect(page.getByRole('dialog', { name: '编辑复制任务 100-0' })).toBeVisible()
  await shot('edit')
  await page.keyboard.press('Escape')

  await page.locator('[data-job="100-0"]').getByRole('button', { name: /复制任务 100-0/ }).click()
  await page.getByRole('dialog', { name: '复制任务 100-0' }).getByRole('button', { name: '删除' }).click()
  await expect(page.getByRole('dialog', { name: '删除复制任务 100-0？' })).toBeVisible()
  await shot('delete')
})
