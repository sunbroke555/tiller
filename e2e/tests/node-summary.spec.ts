import type { Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'

// Area node-summary: node summary (status, charts, package versions, system
// report, repository status), notes, services, system log and node power.
//
// Lab writes are limited to: node notes (restored afterwards), stopping and
// starting the harmless `ksmtuned` service, restarting `cron`. Reboot and
// shutdown are intercepted in the browser and never reach the lab.

const summaryPanel = (page: Page) => page.getByRole('tabpanel', { name: '概要' })

async function openActionMenu(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('toolbar', { name: '操作' }).getByRole('button', { name: '更多' }).click()
  else await page.locator('header').getByRole('button', { name: '更多操作' }).click()
}

async function ensureServiceRunning(pve: PveApi, service: string) {
  const st = await pve.get<{ state: string }>(`/nodes/${pve.node}/services/${service}/state`)
  if (st.state !== 'running') await pve.run('POST', `/nodes/${pve.node}/services/${service}/start`)
}

test.describe('node summary', () => {
  test('status, system info, repository status and charts', async ({ page, pve }) => {
    const status = await pve.get<{ 'current-kernel': { release: string }; pveversion: string }>(`/nodes/${pve.node}/status`)
    await page.goto(`/node/${pve.node}`)
    const panel = summaryPanel(page)

    const resources = panel.getByRole('region', { name: '资源使用' })
    await expect(resources.getByText('CPU', { exact: true })).toBeVisible()
    await expect(resources.getByRole('meter', { name: '内存' })).toBeVisible()
    await expect(resources.getByRole('meter', { name: '根分区 /' })).toBeVisible()

    const info = panel.getByRole('region', { name: '系统信息' })
    await expect(info).toContainText(status['current-kernel'].release)
    await expect(info).toContainText(status.pveversion.split('/')[1]!)
    await expect(info).toContainText(/Legacy BIOS|EFI/)

    // The lab uses the no-subscription repository and has no subscription.
    const repo = panel.getByRole('region', { name: '软件源与订阅' })
    await expect(repo).toContainText('已启用非生产软件源')
    await expect(repo).toContainText('无订阅')

    for (const title of ['CPU 使用率', '服务器负载', '内存', '网络流量', 'IO 压力（PSI）']) {
      await expect(panel.getByRole('figure', { name: title, exact: true })).toBeVisible()
    }
    const cpuChart = panel.getByRole('figure', { name: 'CPU 使用率' })
    await expect(cpuChart.locator('.recharts-area').first()).toBeVisible()
    await expect(cpuChart.getByRole('list', { name: '图例' })).toContainText('%')

    // Timeframe and consolidation go to the API.
    const day = page.waitForRequest((r) => r.url().includes('/rrddata') && r.url().includes('timeframe=day') && r.url().includes('cf=AVERAGE'))
    await panel.getByRole('radio', { name: '最近一天' }).click()
    await day
    const max = page.waitForRequest((r) => r.url().includes('/rrddata') && r.url().includes('timeframe=day') && r.url().includes('cf=MAX'))
    await panel.getByRole('radio', { name: '最大' }).click()
    await max
    // Remembered on this device.
    await page.reload()
    await expect(summaryPanel(page).getByRole('radio', { name: '最近一天' })).toBeChecked()
    await summaryPanel(page).getByRole('radio', { name: '最近一小时' }).click()
    await summaryPanel(page).getByRole('radio', { name: '平均' }).click()
  })

  test('package versions and system report', async ({ page, pve }) => {
    await page.goto(`/node/${pve.node}`)
    await summaryPanel(page).getByRole('button', { name: '软件包版本' }).click()
    const dialog = page.getByRole('dialog', { name: '软件包版本' })
    const packages = dialog.getByRole('list', { name: '软件包' })
    await expect(packages).toContainText('pve-manager')
    await expect(packages).toContainText('proxmox-ve')
    const total = await packages.getByRole('listitem').count()
    await dialog.getByLabel('筛选软件包').fill('qemu-server')
    await expect(packages.getByRole('listitem').first()).toContainText('qemu-server')
    expect(await packages.getByRole('listitem').count()).toBeLessThan(total)
    await dialog.getByRole('button', { name: '关闭' }).first().click()
    await expect(dialog).toBeHidden()

    await summaryPanel(page).getByRole('button', { name: '系统报告' }).click()
    const report = page.getByRole('dialog', { name: '系统报告' })
    await expect(report.getByLabel('系统报告内容')).toContainText('==== general system info ====', { timeout: 60_000 })
    await expect(report.getByRole('button', { name: '下载' })).toBeEnabled()
    const download = page.waitForEvent('download')
    await report.getByRole('button', { name: '下载' }).click()
    expect((await download).suggestedFilename()).toMatch(new RegExp(`^${pve.node}-report-\\d{8}-\\d{4}\\.txt$`))
  })

  test('notes: edit, preview, render markdown', async ({ page, pve, cleanup }) => {
    const before = await pve.get<{ description?: string }>(`/nodes/${pve.node}/config`)
    cleanup.add(() =>
      before.description
        ? pve.put(`/nodes/${pve.node}/config`, { description: before.description })
        : pve.put(`/nodes/${pve.node}/config`, { delete: 'description' }),
    )
    await page.goto(`/node/${pve.node}`)
    const notes = summaryPanel(page).getByRole('region', { name: '备注' })
    await notes.getByRole('button', { name: '编辑备注' }).click()
    const dialog = page.getByRole('dialog', { name: '编辑备注' })
    const text = `## e2e-node-summary 备注\n\n- 机柜 A3\n- [文档](https://pve.proxmox.com/)`
    await dialog.getByLabel('备注').fill(text)
    await dialog.getByRole('radio', { name: '预览' }).click()
    await expect(dialog.getByRole('heading', { name: 'e2e-node-summary 备注' })).toBeVisible()
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toBeHidden()
    await expect(notes.getByRole('heading', { name: 'e2e-node-summary 备注' })).toBeVisible()
    await expect(notes.getByRole('link', { name: '文档' })).toHaveAttribute('target', '_blank')
    expect((await pve.get<{ description?: string }>(`/nodes/${pve.node}/config`)).description?.trimEnd()).toBe(text)

    // Clearing deletes the key.
    await notes.getByRole('button', { name: '编辑备注' }).click()
    await dialog.getByLabel('备注').fill('')
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toBeHidden()
    await expect(notes).toContainText('还没有备注')
    expect((await pve.get<{ description?: string }>(`/nodes/${pve.node}/config`)).description).toBeUndefined()
  })

  test('reboot and shutdown need the node name (requests intercepted)', async ({ page, pve, mobile }) => {
    const posted: string[] = []
    await page.route(`**/api2/json/nodes/${pve.node}/status`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      posted.push(route.request().postData() ?? '')
      await route.fulfill({ json: { data: null } })
    })
    await page.goto(`/node/${pve.node}`)

    await openActionMenu(page, mobile)
    await page.getByRole('menuitem', { name: '重启节点' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText(`重启节点 ${pve.node}？`)
    const ok = confirm.getByRole('button', { name: '重启' })
    await expect(ok).toBeDisabled()
    await confirm.getByRole('textbox').fill('wrong')
    await expect(ok).toBeDisabled()
    await confirm.getByRole('textbox').fill(pve.node)
    await ok.click()
    await expect(confirm).toBeHidden()
    await expect(page.getByText(`已向 ${pve.node} 发送重启命令`)).toBeVisible()
    expect(posted).toEqual(['command=reboot'])

    await openActionMenu(page, mobile)
    await page.getByRole('menuitem', { name: '关闭节点' }).click()
    await expect(confirm).toContainText(`关闭节点 ${pve.node}？`)
    await confirm.getByRole('button', { name: '取消' }).click()
    await expect(confirm).toBeHidden()
    expect(posted).toEqual(['command=reboot'])
  })

  test('services: list, stop / start, restart, service log', async ({ page, pve, cleanup }) => {
    cleanup.add(() => ensureServiceRunning(pve, 'ksmtuned'))
    await ensureServiceRunning(pve, 'ksmtuned')
    await page.goto(`/node/${pve.node}/services`)
    const panel = page.getByRole('tabpanel', { name: '服务' })
    const list = panel.getByRole('list', { name: '服务' })
    await expect(list).toContainText('pveproxy')
    // Not installed services are hidden until asked for.
    await expect(list.getByText('systemd-timesyncd', { exact: true })).toHaveCount(0)
    await panel.getByLabel('显示未安装的服务').click()
    await expect(list.getByText('systemd-timesyncd', { exact: true })).toBeVisible()
    await panel.getByLabel('搜索服务').fill('ksm')
    await expect(list.getByRole('listitem')).toHaveCount(1)

    await list.getByRole('button', { name: /^ksmtuned，/ }).click()
    const sheet = page.getByRole('dialog', { name: 'ksmtuned' })
    await expect(sheet).toContainText('运行中')
    // pveproxy-style protection is not applied to ordinary services: stop is offered.
    await sheet.getByRole('button', { name: '停止 ksmtuned' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('停止服务 ksmtuned？')
    await confirm.getByRole('button', { name: '停止' }).click()
    await expect(sheet).toContainText('已停止', { timeout: 30_000 })
    await expect.poll(async () => (await pve.get<{ state: string }>(`/nodes/${pve.node}/services/ksmtuned/state`)).state).toBe('dead')

    await sheet.getByRole('button', { name: '启动 ksmtuned' }).click()
    await expect(sheet).toContainText('运行中', { timeout: 30_000 })
    // The service log shows the stop we just did.
    await expect(sheet.getByTestId('journal')).toContainText(/ksmtuned/i, { timeout: 30_000 })
    await sheet.press('Escape')
    await expect(sheet).toBeHidden()

    // pveproxy cannot be stopped (only reload / restart), like the official UI.
    await panel.getByLabel('搜索服务').fill('pveproxy')
    await list.getByRole('button', { name: /^pveproxy，/ }).click()
    const proxy = page.getByRole('dialog', { name: 'pveproxy' })
    await expect(proxy.getByRole('button', { name: '重新加载 pveproxy' })).toBeVisible()
    await expect(proxy.getByRole('button', { name: '停止 pveproxy' })).toHaveCount(0)
    await proxy.press('Escape')

    // Restart without confirmation for ordinary services; the task shows up.
    await panel.getByLabel('搜索服务').fill('cron')
    await list.getByRole('button', { name: /^cron，/ }).click()
    const cron = page.getByRole('dialog', { name: 'cron' })
    const restarted = page.waitForResponse((r) => r.url().endsWith('/services/cron/restart') && r.request().method() === 'POST')
    await cron.getByRole('button', { name: '重启 cron' }).click()
    const res = await restarted
    expect(res.ok()).toBe(true)
    const { data: upid } = (await res.json()) as { data: string }
    await pve.waitTask(upid)
  })

  test('system log: live tail, follow, older entries, time range', async ({ page, pve }) => {
    await page.goto(`/node/${pve.node}/syslog`)
    const panel = page.getByRole('tabpanel', { name: '系统日志' })
    const log = panel.getByTestId('journal')
    await expect(log).toContainText(pve.node, { timeout: 20_000 })

    // A new task logs its UPID to the journal; live mode picks it up.
    const upid = await pve.post<string>(`/nodes/${pve.node}/services/cron/restart`)
    await pve.waitTask(upid)
    await expect(log).toContainText(upid.split(':').slice(0, 4).join(':'), { timeout: 30_000 })

    // Older entries are prepended.
    const count = async () => Number((await panel.getByText(/^\d+ 行/).textContent())?.match(/^(\d+)/)?.[1] ?? 0)
    const before = await count()
    const older = panel.getByRole('button', { name: /加载更早/ })
    if (await older.isVisible()) {
      await older.click()
      await expect.poll(count).toBeGreaterThan(before)
    }

    // Pause stops polling.
    await panel.getByRole('button', { name: '暂停' }).click()
    await expect(panel).toContainText('已暂停')
    await panel.getByRole('button', { name: '继续' }).click()

    // Time range (today).
    await panel.getByRole('radio', { name: '时间范围' }).click()
    const range = page.waitForRequest((r) => r.url().includes('/journal') && r.url().includes('since=') && r.url().includes('until='))
    await panel.getByRole('button', { name: '查询' }).click()
    await range
    await expect(log).toContainText(pve.node)
  })

  test('system log: structured journal with filters (PVE ≥ 9.2.x, mocked)', async ({ page, pve }) => {
    const seen: URLSearchParams[] = []
    const now = Date.now() * 1000
    await page.route(`**/api2/json/nodes/${pve.node}/journal?*`, async (route) => {
      const qs = new URL(route.request().url()).searchParams
      seen.push(qs)
      if (qs.has('startcursor')) return route.fulfill({ json: { data: [] } })
      await route.fulfill({
        json: {
          data: [
            { ty: 'cursor', c: 'c-first' },
            { ty: 'host', h: pve.node },
            { ty: 'identifiers', ids: ['pveproxy', 'kernel', 'systemd'] },
            { ty: 'units', names: ['pveproxy.service', 'cron.service'] },
            { id: 'systemd', pid: 1, p: 6, t: now - 3e6, msg: 'e2e-structured info line' },
            { ty: 'reboot', t: now - 2e6 },
            { id: 'kernel', p: 3, t: now - 1e6, msg: 'e2e-structured error line' },
            { ty: 'cursor', c: 'c-last' },
          ],
        },
      })
    })
    await page.goto(`/node/${pve.node}/syslog`)
    const panel = page.getByRole('tabpanel', { name: '系统日志' })
    const log = panel.getByTestId('journal')
    await expect(log).toContainText('e2e-structured info line')
    await expect(log.locator('[data-priority="3"]')).toContainText('kernel: e2e-structured error line')
    expect(seen[0]!.get('structured')).toBe('1')
    expect(seen[0]!.get('identifiers')).toBe('1')

    await panel.getByRole('button', { name: '筛选', exact: true }).click()
    await panel.getByRole('combobox', { name: '最低优先级' }).click()
    const filtered = page.waitForRequest((r) => r.url().includes('/journal') && r.url().includes('priority=3'))
    await page.getByRole('option', { name: '错误 及以上' }).click()
    await filtered
    const unit = page.waitForRequest((r) => r.url().includes('/journal') && r.url().includes('unit=pveproxy'))
    await panel.getByLabel('systemd 单元').fill('pveproxy')
    await panel.getByLabel('systemd 单元').press('Enter')
    await unit
    const kernel = page.waitForRequest((r) => r.url().includes('/journal') && r.url().includes('kernel=1') && !r.url().includes('unit='))
    await panel.getByText('仅内核').click()
    await kernel
    await panel.getByRole('button', { name: '重置' }).click()
    await expect(panel.getByRole('button', { name: '筛选', exact: true })).not.toContainText(/\d/)
  })

  test('palette offers node commands', async ({ page, pve, mobile }) => {
    await page.goto(`/node/${pve.node}`)
    if (mobile) await page.getByRole('button', { name: /搜索/ }).first().click()
    else await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog')
    await palette.getByRole('combobox').fill('系统日志')
    await palette.getByRole('option', { name: new RegExp(`系统日志.*${pve.node}`) }).first().click()
    await expect(page).toHaveURL(new RegExp(`/node/${pve.node}/syslog$`))
  })
})

// Screenshots for visual QA (not a test of behaviour): NS_SHOTS=1.
test.describe('node summary screenshots', () => {
  test.skip(!process.env.NS_SHOTS, 'NS_SHOTS=1 to capture screenshots')
  for (const theme of ['dark', 'light', 'paper'] as const) {
    test(`screens in ${theme}`, async ({ page, pve }, info) => {
      test.setTimeout(120_000)
      await page.addInitScript((mode) => {
        localStorage.setItem('pve-web:appearance', JSON.stringify({ mode, accent: 'indigo', glass: true, density: 'comfortable' }))
      }, theme)
      const dir = `test-results/ns-shots/${info.project.name}-${theme}`
      await page.goto(`/node/${pve.node}`)
      await expect(page.getByRole('figure', { name: 'CPU 使用率' }).locator('.recharts-area').first()).toBeVisible()
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${dir}-summary.png`, fullPage: true })
      await page.getByRole('button', { name: '软件包版本' }).click()
      await expect(page.getByRole('list', { name: '软件包' })).toContainText('pve-manager')
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${dir}-packages.png` })
      await page.keyboard.press('Escape')
      await page.goto(`/node/${pve.node}/services`)
      await expect(page.getByRole('list', { name: '服务' })).toContainText('pveproxy')
      await page.screenshot({ path: `${dir}-services.png`, fullPage: true })
      await page.getByRole('button', { name: /^pveproxy，/ }).click()
      await expect(page.getByTestId('journal')).not.toContainText('正在读取', { timeout: 20_000 })
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${dir}-service-sheet.png` })
      await page.keyboard.press('Escape')
      await page.goto(`/node/${pve.node}/syslog`)
      await expect(page.getByTestId('journal')).toContainText(pve.node, { timeout: 20_000 })
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${dir}-syslog.png` })
      await page.goto(`/node/${pve.node}`)
      await page.getByRole('region', { name: '备注' }).getByRole('button', { name: '编辑备注' }).click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${dir}-notes.png` })
    })
  }
})
