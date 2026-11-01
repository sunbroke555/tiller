import type { Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'
import { mockBackupApi } from './backup-jobs.mocks'

// Area backup-jobs: scheduled backup jobs (/datacenter/backup).
//
// Lab tests (@lab, desktop) create jobs with ids "e2e-bj-…" on storage
// `local`, selecting only VM 100 (the 1G sample). "Run now" backs up VM 100
// once; the produced backup is recognised by its notes ("e2e-bj-…") and
// deleted afterwards. Every e2e-bj job is deleted in teardown.
// Phone tests (@mobile) only check layout, with page.route() mocks.

const STORAGE = 'local'
const PREFIX = 'e2e-bj'

interface Job {
  id: string
  schedule?: string
  enabled?: number
  vmid?: string
  mode?: string
  comment?: string
  'prune-backups'?: Record<string, string>
  'notes-template'?: string
}

async function jobs(pve: PveApi): Promise<Job[]> {
  return pve.get<Job[]>('/cluster/backup')
}

async function removeJobs(pve: PveApi) {
  for (const j of await jobs(pve)) if (j.id.startsWith(PREFIX)) await pve.del(`/cluster/backup/${encodeURIComponent(j.id)}`)
}

async function removeBackups(pve: PveApi, vmid: number) {
  const list = await pve.get<{ volid: string; notes?: string; protected?: number }[]>(`/nodes/${pve.node}/storage/${STORAGE}/content`, {
    content: 'backup',
    vmid,
  })
  for (const b of list) {
    if (!b.notes?.startsWith(PREFIX)) continue
    const path = `/nodes/${pve.node}/storage/${STORAGE}/content/${encodeURIComponent(b.volid)}`
    if (b.protected) await pve.put(path, { protected: 0 })
    await pve.run('DELETE', path)
  }
}

test.describe('backup jobs on the lab', { tag: '@lab' }, () => {
  test.beforeAll(async ({ pve }) => {
    await removeJobs(pve)
  })
  test.afterAll(async ({ pve }) => {
    await removeJobs(pve)
    await removeBackups(pve, 100)
  })

  test('create, edit, inspect and delete a job', async ({ page, pve }) => {
    test.setTimeout(150_000)
    const id = `${PREFIX}-ui`
    await page.goto('/datacenter/backup')
    await expect(page.getByRole('heading', { name: '备份计划', level: 1 })).toBeVisible()

    // Create
    await page.getByRole('button', { name: '新建', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: '新建备份计划' })
    await expect(dialog).toBeVisible()
    const schedule = dialog.getByRole('textbox', { name: '计划', exact: true })
    await schedule.fill('sun 01:00')
    await expect(dialog.getByText('每周日 01:00')).toBeVisible()
    await expect(dialog.getByTestId('schedule-runs')).toContainText('01:00')
    // An invalid event is reported by the server's parser.
    await schedule.fill('not a time')
    await expect(dialog.getByTestId('schedule-error')).toBeVisible()
    await schedule.fill('sun 01:00')

    await dialog.getByRole('switch', { name: '启用', exact: true }).click()
    await dialog.getByLabel('说明', { exact: true }).fill(`${PREFIX} 界面测试`)

    // Nothing picked: the form says so instead of sending.
    await dialog.getByRole('button', { name: '创建' }).click()
    await expect(dialog.getByText('至少选择一台客户机')).toBeVisible()
    await dialog.getByLabel('搜索客户机').fill('tiny-vm')
    await dialog.getByRole('checkbox', { name: '100 tiny-vm', exact: true }).click()
    await expect(dialog.getByTestId('guest-picker-count')).toHaveText('已选 1')

    await dialog.getByRole('button', { name: /保留策略/ }).click()
    await dialog.getByLabel('保留最近', { exact: true }).fill('2')
    await dialog.getByRole('button', { name: /高级选项/ }).click()
    await dialog.getByLabel('任务 ID').fill(id)
    await dialog.getByRole('button', { name: '创建' }).click()
    await expect(dialog).toBeHidden()

    let job = await pve.get<Job>(`/cluster/backup/${id}`)
    expect(job).toMatchObject({ schedule: 'sun 01:00', enabled: 0, vmid: '100', comment: `${PREFIX} 界面测试`, mode: 'snapshot' })
    expect(job['prune-backups']).toEqual({ 'keep-last': '2' })
    expect(job['notes-template']).toBe('{{guestname}}')

    const row = page.locator(`[data-job="${id}"]`)
    await expect(row).toContainText('已停用')
    await expect(row).toContainText('每周日 01:00')
    await expect(row).toContainText('保留最近 2 个')

    // Detail: the included guests and disks.
    await row.getByRole('link').first().click()
    await expect(page).toHaveURL(new RegExp(`/datacenter/backup/${id}$`))
    const guest = page.locator('[data-testid="included-guest"][data-vmid="100"]')
    await expect(guest).toContainText('tiny-vm')
    await expect(guest.locator('[data-volume="scsi0"]')).toContainText('备份')

    // Edit: new schedule and mode, retention cleared (→ delete).
    const toolbar = page.getByRole('toolbar', { name: '计划操作' })
    await toolbar.getByRole('button', { name: '编辑' }).click()
    dialog = page.getByRole('dialog', { name: '编辑备份计划' })
    await expect(dialog.getByRole('textbox', { name: '计划', exact: true })).toHaveValue('sun 01:00')
    await dialog.getByRole('textbox', { name: '计划', exact: true }).fill('yearly')
    await dialog.getByRole('radio', { name: /停止/ }).click()
    await dialog.getByLabel('保留最近', { exact: true }).fill('')
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toBeHidden()
    job = await pve.get<Job>(`/cluster/backup/${id}`)
    expect(job).toMatchObject({ schedule: 'yearly', mode: 'stop', vmid: '100', enabled: 0 })
    expect(job['prune-backups']).toBeUndefined()
    await expect(page.getByText('每年 1 月 1 日 00:00')).toBeVisible()

    // Enable and disable again (yearly: it does not fire meanwhile).
    await toolbar.getByRole('button', { name: '启用' }).click()
    await expect.poll(async () => (await pve.get<Job>(`/cluster/backup/${id}`)).enabled ?? 1).toBe(1)
    await toolbar.getByRole('button', { name: '停用' }).click()
    await expect.poll(async () => (await pve.get<Job>(`/cluster/backup/${id}`)).enabled).toBe(0)

    // Delete (type the ID to confirm).
    await toolbar.getByRole('button', { name: '删除' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByRole('button', { name: '删除' })).toBeDisabled()
    await confirm.getByRole('textbox').fill(id)
    await confirm.getByRole('button', { name: '删除' }).click()
    await expect(page).toHaveURL(/\/datacenter\/backup$/)
    await expect(page.locator(`[data-job="${id}"]`)).toHaveCount(0)
    expect((await jobs(pve)).map((j) => j.id)).not.toContain(id)
  })

  test('run now backs up the selected guest', async ({ page, pve }) => {
    test.setTimeout(240_000)
    const id = `${PREFIX}-run`
    await removeBackups(pve, 100)
    await pve.post('/cluster/backup', {
      id,
      vmid: '100',
      storage: STORAGE,
      schedule: 'yearly',
      enabled: 0,
      mode: 'snapshot',
      compress: 'zstd',
      'notes-template': `${id} {{vmid}}`,
      comment: `${PREFIX} 立即运行`,
    })

    await page.goto(`/datacenter/backup/${id}`)
    await page.getByRole('toolbar', { name: '计划操作' }).getByRole('button', { name: '立即运行' }).click()
    const confirm = page.getByRole('alertdialog')
    // The job has no node restriction: like the official UI, it starts on every online node.
    const online = (await pve.get<{ node: string; status: string }[]>('/nodes'))
      .filter((n) => n.status === 'online')
      .map((n) => n.node)
      .sort()
    await expect(confirm).toContainText(`在节点 ${online.join('、')} 上开始备份任务`)
    await confirm.getByRole('button', { name: '立即运行' }).click()
    await expect(confirm).toBeHidden()

    await expect
      .poll(
        async () => {
          const list = await pve.get<{ notes?: string }[]>(`/nodes/${pve.node}/storage/${STORAGE}/content`, { content: 'backup', vmid: 100 })
          return list.some((b) => b.notes === `${id} 100`)
        },
        { timeout: 180_000, intervals: [3000] },
      )
      .toBe(true)
    // Let the vzdump task finish (the archive appears before the log closes).
    await expect
      .poll(
        async () => {
          const tasks = await pve.get<{ type: string; status?: string }[]>(`/nodes/${pve.node}/tasks`, { typefilter: 'vzdump', source: 'active' })
          return tasks.length
        },
        { timeout: 60_000, intervals: [2000] },
      )
      .toBe(0)
    await removeBackups(pve, 100)
  })
})

test('guests without a backup job', { tag: '@desktop' }, async ({ page, pve }) => {
  const uncovered = await pve.get<{ vmid: number; name?: string }[]>('/cluster/backup-info/not-backed-up')
  test.skip(uncovered.length === 0, 'every guest of the lab is covered by a job')
  await page.goto('/datacenter/backup')
  const notice = page.getByTestId('uncovered-notice')
  await expect(notice).toContainText(`有 ${uncovered.length} 台客户机`)
  await notice.getByRole('button', { name: '查看' }).click()
  const dialog = page.getByRole('dialog', { name: '没有备份计划的客户机' })
  const first = uncovered.sort((a, b) => a.vmid - b.vmid)[0]!
  await expect(dialog.locator(`[data-vmid="${first.vmid}"]`)).toContainText(first.name ?? String(first.vmid))
})

test('schedule simulator', async ({ page }) => {
  await page.goto('/datacenter/backup')
  await page.getByRole('button', { name: '计划模拟器' }).click()
  const dialog = page.getByRole('dialog', { name: '计划模拟器' })
  await dialog.getByRole('button', { name: '常用' }).click()
  await page.getByRole('menuitem', { name: /周一至周五 07:00–18:45/ }).click()
  await expect(dialog.getByRole('textbox', { name: '计划', exact: true })).toHaveValue('mon..fri 7..18:00/15')
  await expect(dialog.getByTestId('simulator-runs').getByRole('listitem')).toHaveCount(10)
  await dialog.getByLabel('次数').fill('3')
  await expect(dialog.getByTestId('simulator-runs').getByRole('listitem')).toHaveCount(3)
  await dialog.getByRole('textbox', { name: '计划', exact: true }).fill('bogus')
  await expect(dialog.getByRole('alert')).toContainText('计划格式无效')
})

// ------------------------------------------------------------ phone layout

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

test.describe('phone layout', { tag: '@mobile' }, () => {
  test('job list, uncovered guests and job detail', async ({ page, pve }) => {
    await mockBackupApi(page, pve.node)
    await page.goto('/datacenter/backup')
    const rows = page.getByTestId('backup-job-row')
    await expect(rows).toHaveCount(3)
    await expect(page.locator('[data-job="e2e-bj-mock-nightly"]')).toContainText('全部，排除 9000')
    await expect(page.locator('[data-job="e2e-bj-mock-weekly"]')).toContainText('已停用')
    await noHorizontalScroll(page)

    await page.getByTestId('uncovered-notice').getByRole('button', { name: '查看' }).click()
    const sheet = page.getByRole('dialog', { name: '没有备份计划的客户机' })
    await expect(sheet.locator('[data-vmid="5801"]')).toContainText('e2e-bj-db')
    await sheet.getByRole('button', { name: '关闭' }).click()
    await expect(sheet).toBeHidden()

    await page.locator('[data-job="e2e-bj-mock-weekly"]').getByRole('link').first().click()
    await expect(page).toHaveURL(/\/datacenter\/backup\/e2e-bj-mock-weekly$/)
    const toolbar = page.getByRole('toolbar', { name: '计划操作' })
    for (const name of ['编辑', '立即运行', '启用', '删除']) await expect(toolbar.getByRole('button', { name })).toBeVisible()
    await expect(page.locator('[data-testid="included-guest"][data-vmid="100"] [data-volume="scsi1"]')).toContainText('已禁用备份')
    await expect(page.locator('[data-testid="included-guest"][data-vmid="101"]')).toContainText('没有磁盘')
    await noHorizontalScroll(page)

    // The edit sheet loads the job; cancel without saving.
    await toolbar.getByRole('button', { name: '编辑' }).click()
    const edit = page.getByRole('dialog', { name: '编辑备份计划' })
    await expect(edit.getByRole('textbox', { name: '计划', exact: true })).toHaveValue('sun 01:00')
    await expect(edit.getByTestId('guest-picker-count')).toHaveText('已选 2')
    await edit.getByRole('button', { name: '取消' }).click()
    await expect(edit).toBeHidden()
  })

  test('new job sheet', async ({ page, pve }) => {
    await mockBackupApi(page, pve.node)
    await page.goto('/datacenter/backup')
    await page.getByRole('button', { name: '新建', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: '新建备份计划' })
    await expect(sheet.getByTestId('guest-picker')).toBeVisible()
    await sheet.getByRole('combobox', { name: '选择方式' }).click()
    await page.getByRole('option', { name: /资源池/ }).click()
    await expect(sheet.getByRole('combobox', { name: '资源池', exact: true })).toBeVisible()
    await sheet.getByRole('button', { name: '取消' }).click()
    await expect(sheet).toBeHidden()
  })
})
