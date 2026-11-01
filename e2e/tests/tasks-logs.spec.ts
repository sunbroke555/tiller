import { expect, test, type PveApi } from '../fixtures'

// Area tasks-logs: /tasks, task log sheet (follow, stop), guest/node task
// history tabs, /cluster/log and the running-task indicators.
// Guests are created (@lab, desktop) in this area's VMID range 3000–3099 and
// destroyed after each test. The phone check mocks a running task.

const VMID_MIN = 3000
const VMID_MAX = 3099

async function freeVmid(pve: PveApi): Promise<number> {
  const used = new Set((await pve.guests()).map((g) => g.vmid))
  for (let id = VMID_MIN; id <= VMID_MAX; id++) if (!used.has(id)) return id
  throw new Error('VMID 3000–3099 已用完')
}

/** UPID of the newest task of `type` for a guest (VMIDs are reused, so match tasks by UPID, not by name). */
async function lastTask(pve: PveApi, vmid: number, type: string): Promise<string> {
  const [task] = await pve.get<{ upid: string }[]>(`/nodes/${pve.node}/tasks`, { vmid, typefilter: type, limit: 1 })
  if (!task) throw new Error(`找不到 ${vmid} 的 ${type} 任务`)
  return task.upid
}

test.describe('tasks-logs', () => {
  test('任务页列出任务，按状态和类型筛选，打开日志', { tag: '@lab' }, async ({ page, pve, cleanup }) => {
    const vmid = await freeVmid(pve)
    const name = `e2e-tasks-list-${vmid}`
    cleanup.guest(vmid)
    await pve.createTestVm({ vmid, name })
    const upid = await lastTask(pve, vmid, 'qmcreate')

    await page.goto('/tasks')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('任务')
    const item = page.locator(`li[data-upid="${upid}"]`)
    const row = item.getByRole('button')
    await expect(row).toBeVisible({ timeout: 20_000 })
    await expect(row).toContainText(`创建 VM ${vmid}（${name}）`)
    await expect(item).toHaveAttribute('data-state', 'ok')

    // Status: the create task succeeded, so "失败" hides it and "成功" shows it.
    const status = page.getByRole('radiogroup', { name: '任务状态' })
    await status.getByRole('radio', { name: '失败' }).click()
    await expect(page).toHaveURL(/status=error/)
    await expect(row).toHaveCount(0)
    await status.getByRole('radio', { name: '成功' }).click()
    await expect(row).toBeVisible()

    // Type + VMID filters in the sheet, shown as chips.
    await page.getByRole('button', { name: /^筛选/ }).click()
    const sheet = page.getByRole('dialog', { name: '筛选任务' })
    await sheet.getByRole('combobox', { name: '任务类型' }).click()
    await page.getByRole('option', { name: '创建（VM）' }).click()
    await sheet.getByLabel('VMID').fill(String(vmid))
    await sheet.getByRole('button', { name: '应用' }).click()
    await expect(sheet).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`type=qmcreate.*vmid=${vmid}|vmid=${vmid}.*type=qmcreate`))
    await expect(page.getByText('类型：创建（VM）')).toBeVisible()
    await expect(page.getByText(`VMID ${vmid}`, { exact: true })).toBeVisible()
    // Only qmcreate rows of this VMID are left (it may have been created by earlier runs, too).
    const rows = page.getByRole('list', { name: '任务列表' }).getByRole('listitem')
    await expect(rows.first()).toBeVisible()
    for (const text of await rows.allTextContents()) expect(text).toContain(`创建 VM ${vmid}`)
    await expect(item).toBeVisible()

    // Log sheet with the full log.
    await row.click()
    const log = page.getByRole('dialog', { name: new RegExp(`创建 VM ${vmid}`) })
    await expect(log).toBeVisible()
    await expect(log.getByTestId('task-log')).toContainText('TASK OK', { timeout: 15_000 })
    await expect(log.getByText('完成', { exact: true })).toBeVisible()
    await expect(log.getByText(/耗时/)).toBeVisible()
    const download = page.waitForEvent('download')
    await log.getByRole('button', { name: '下载日志' }).click()
    expect((await download).suggestedFilename()).toMatch(new RegExp(`^qmcreate-${vmid}-\\d+\\.log$`))
    await log.getByRole('button', { name: '关闭' }).last().click()
    await expect(log).toBeHidden()

    // Removing a chip drops that filter.
    await page.getByRole('button', { name: `移除筛选：VMID ${vmid}` }).click()
    await expect(page).not.toHaveURL(/vmid=/)
  })

  test('运行中的任务：指示器、实时日志与停止', { tag: '@lab' }, async ({ page, pve, cleanup }) => {
    const vmid = await freeVmid(pve)
    const name = `e2e-tasks-stop-${vmid}`
    cleanup.guest(vmid)
    await pve.createTestVm({ vmid, name })
    await pve.run('POST', `/nodes/${pve.node}/qemu/${vmid}/status/start`)
    // No OS answers ACPI, so this shutdown waits for its timeout: a long-running task.
    const upid = await pve.post<string>(`/nodes/${pve.node}/qemu/${vmid}/status/shutdown`, { timeout: 180 })
    cleanup.add(async () => {
      const st = await pve.get<{ status: string }>(`/nodes/${pve.node}/tasks/${encodeURIComponent(upid)}/status`)
      if (st.status === 'running') await pve.del(`/nodes/${pve.node}/tasks/${encodeURIComponent(upid)}`)
    })

    await page.goto('/tasks?status=running')
    await expect(page.getByRole('region', { name: '任务状态栏' })).toContainText('个运行中', { timeout: 20_000 })
    const item = page.locator(`li[data-upid="${upid}"]`)
    const row = item.getByRole('button')
    await expect(row).toBeVisible({ timeout: 20_000 })
    await expect(row).toContainText(`关机 VM ${vmid}（${name}）`)
    await expect(item).toHaveAttribute('data-state', 'running')

    await row.click()
    const log = page.getByRole('dialog', { name: new RegExp(`关机 VM ${vmid}`) })
    await expect(log.getByText('运行中', { exact: true })).toBeVisible()
    await expect(log.getByText(/已运行/)).toBeVisible()
    // Stopping asks first; 关闭 stays in place the whole time.
    await expect(log.getByRole('button', { name: '关闭' }).last()).toBeVisible()
    await log.getByRole('button', { name: '停止', exact: true }).click()
    const ask = page.getByRole('alertdialog', { name: '停止任务？' })
    await ask.getByRole('button', { name: '停止任务' }).click()
    await expect(log.getByText('失败', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(log.getByRole('button', { name: '停止', exact: true })).toHaveCount(0)

    const st = await pve.get<{ status: string; exitstatus?: string }>(`/nodes/${pve.node}/tasks/${encodeURIComponent(upid)}/status`)
    expect(st.status).toBe('stopped')
    expect(st.exitstatus).not.toBe('OK')
    await log.getByRole('button', { name: '关闭' }).last().click()

    // It leaves the running list and shows up under "失败".
    await expect(page.locator(`li[data-upid="${upid}"]`)).toHaveCount(0, { timeout: 20_000 })
    await page.getByRole('radiogroup', { name: '任务状态' }).getByRole('radio', { name: '失败' }).click()
    await expect(item).toHaveAttribute('data-state', 'error', { timeout: 20_000 })
    await expect(item).toContainText('received interrupt')
  })

  test('客户机与节点的任务历史标签', { tag: '@lab' }, async ({ page, pve, cleanup }) => {
    const vmid = await freeVmid(pve)
    cleanup.guest(vmid)
    await pve.createTestVm({ vmid, name: `e2e-tasks-tab-${vmid}` })
    const upid = await lastTask(pve, vmid, 'qmcreate')

    await page.goto(`/guest/${pve.node}/qemu/${vmid}/tasks`)
    const panel = page.getByRole('tabpanel', { name: '任务历史' })
    // Inside the guest's tab the rows drop the subject: just "创建".
    const row = panel.locator(`li[data-upid="${upid}"]`).getByRole('button')
    await expect(row).toBeVisible({ timeout: 20_000 })
    await expect(row).toContainText('创建')
    await expect(row).not.toContainText(`VM ${vmid}`)
    await expect(panel.getByText(/已显示 \d+ \/ 共 \d+ 个任务/)).toBeVisible()
    // Only this guest's tasks (the URL cannot widen it).
    for (const text of await panel.getByRole('listitem').allTextContents()) expect(text).not.toMatch(/VM \d+/)
    // No VMID filter in a guest tab.
    await panel.getByRole('button', { name: /^筛选/ }).click()
    await expect(page.getByRole('dialog', { name: '筛选任务' }).getByLabel('VMID')).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.goto(`/node/${pve.node}/tasks`)
    const nodePanel = page.getByRole('tabpanel', { name: '任务历史' })
    await expect(nodePanel.locator(`li[data-upid="${upid}"]`)).toContainText(`创建 VM ${vmid}`, { timeout: 20_000 })
    const footnote = nodePanel.getByText(/已显示 \d+ \/ 共 \d+ 个任务/)
    await expect(footnote).toBeVisible()
    const more = nodePanel.getByRole('button', { name: '加载更多' })
    if (await more.isVisible()) {
      await more.click()
      await expect(footnote).toHaveText(/已显示 (5[1-9]|[6-9]\d|\d{3,}) \//)
    }
  })

  test('集群日志：实时列表、筛选和任务链接', { tag: '@lab' }, async ({ page, pve, cleanup }) => {
    const vmid = await freeVmid(pve)
    cleanup.guest(vmid)
    await pve.createTestVm({ vmid, name: `e2e-tasks-log-${vmid}` })
    const upid = await lastTask(pve, vmid, 'qmcreate')

    await page.goto('/tasks')
    await page.getByRole('navigation', { name: '任务与日志' }).getByRole('link', { name: '集群日志' }).click()
    await expect(page).toHaveURL(/\/cluster\/log$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('集群日志')
    const list = page.getByRole('list', { name: '集群日志' })
    await expect(list.getByRole('listitem').first()).toBeVisible({ timeout: 20_000 })
    await expect(list).toContainText('successful auth')

    // "starting task UPID:…" links to the task. The cluster log drops lines
    // when several tasks start in the same second (other spec files run in
    // parallel), so use ours if it made it in, else the newest logged task.
    const logged = async () =>
      (await pve.get<{ msg: string }[]>('/cluster/log', { max: 200 }))
        .map((e) => /^starting task (UPID:\S+)/.exec(e.msg)?.[1])
        .filter((u): u is string => !!u)
    let target = upid
    await expect
      .poll(async () => (await logged()).includes(upid), { timeout: 10_000 })
      .toBe(true)
      .catch(async () => {
        target = (await logged())[0] ?? upid
      })
    await page.getByRole('searchbox', { name: '搜索日志' }).fill(target)
    const link = target === upid ? list.getByRole('button', { name: `创建 VM ${vmid}` }).first() : list.getByRole('button').first()
    await expect(link).toBeVisible({ timeout: 20_000 })
    await link.click()
    const log = page.getByRole('dialog')
    await expect(log.getByTestId('task-log')).not.toBeEmpty({ timeout: 15_000 })
    if (target === upid) await expect(log.getByTestId('task-log')).toContainText('TASK OK')
    await log.getByRole('button', { name: '关闭' }).last().click()

    await page.getByRole('searchbox', { name: '搜索日志' }).fill('')
    await page.getByRole('radiogroup', { name: '级别' }).getByRole('radio', { name: '错误' }).click()
    await expect(page).toHaveURL(/level=error/)
    // Only errors (pri ≤ 3) or the empty state.
    await expect(list.or(page.getByText('没有符合条件的日志'))).toBeVisible()
    for (const pri of await list.getByRole('listitem').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-pri'))))) {
      expect(pri).toBeLessThanOrEqual(3)
    }

    await page.getByRole('radiogroup', { name: '级别' }).getByRole('radio', { name: '全部' }).click()
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    await expect(page.getByText('已暂停更新')).toBeVisible()
    await page.getByRole('button', { name: '继续', exact: true }).click()
    await expect(page.getByText('每 5 秒自动更新')).toBeVisible()
  })

  test('桌面任务状态栏展开最近任务与集群日志', { tag: '@desktop' }, async ({ page }) => {
    await page.goto('/')
    const bar = page.getByRole('region', { name: '任务状态栏' })
    await expect(bar).toBeVisible()
    await bar.getByRole('button', { name: '任务', exact: true }).click()
    const panel = page.getByRole('region', { name: '最近任务与集群日志' })
    await expect(panel.getByRole('list', { name: '任务列表' })).toBeVisible({ timeout: 15_000 })
    await panel.getByRole('button', { name: '集群日志' }).click()
    await expect(panel.getByRole('list', { name: '集群日志' })).toBeVisible({ timeout: 15_000 })
    await panel.getByRole('button', { name: '收起' }).click()
    await expect(panel).toBeHidden()
    await bar.getByRole('link', { name: '全部任务' }).click()
    await expect(page).toHaveURL(/\/tasks$/)
  })

  test('手机：底部导航显示运行中的任务数，筛选面板可打开', { tag: '@mobile' }, async ({ page, pve }) => {
    // One running task, mocked into /cluster/tasks (nothing runs on the lab).
    const start = Math.floor(Date.now() / 1000)
    const upid = `UPID:${pve.node}:0000E2E0:00000001:${start.toString(16).toUpperCase().padStart(8, '0')}:qmstart:100:root@pam:`
    await page.route('**/api2/json/cluster/tasks', async (route) => {
      const res = await route.fetch()
      const json = (await res.json()) as { data: Record<string, unknown>[] }
      json.data.unshift({ upid, node: pve.node, pid: 57568, pstart: 1, starttime: start, type: 'qmstart', id: '100', user: 'root@pam' })
      await route.fulfill({ response: res, json })
    })
    await page.goto('/tasks')
    await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('status', { name: '1 个任务运行中' })).toBeVisible({
      timeout: 20_000,
    })
    await page.getByRole('button', { name: /^筛选/ }).click()
    const sheet = page.getByRole('dialog', { name: '筛选任务' })
    await expect(sheet.getByRole('combobox', { name: '任务类型' })).toBeVisible()
    await expect(sheet.getByLabel('VMID')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
  })
})
