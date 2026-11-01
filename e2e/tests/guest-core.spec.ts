import type { Locator, Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'

// Guest summary, power and lifecycle (areas guest-summary-power and
// guest-lifecycle). Writes (@lab, desktop) only to guests this spec creates,
// VMIDs 3300–3399. The shared samples (100, 101, 200, 9000) are only read; the
// phone checks open the action dock, sheets and dialogs on them and cancel.
//
//   rt -- bash -lc 'set -a; . ~/.config/pve-web/lab.env; set +a; make e2e-area AREA=guest-summary-power PORT=8104'

const BASE = 3300

/** Create a tiny diskless VM in our range (destroying a leftover first). */
async function vm(pve: PveApi, cleanup: { guest(vmid: number): void }, vmid: number, name: string, params = {}) {
  await pve.destroyGuest(vmid)
  cleanup.guest(vmid)
  return pve.createTestVm({ vmid, name, params })
}

const running = (pve: PveApi, vmid: number, status = 'running', timeout = 60_000) =>
  pve.waitForGuest(vmid, (g) => g.status === status, timeout)

/** The page header (desktop action buttons live here). */
const header = (page: Page) => page.locator('header', { has: page.getByRole('heading', { level: 1 }) })

/** Primary action button: mobile dock or desktop header. */
function primary(page: Page, mobile: boolean, name: string): Locator {
  const bar = mobile ? page.getByRole('toolbar', { name: '操作' }) : header(page)
  return bar.getByRole('button', { name, exact: true })
}

/** Open "更多" and pick a menu item. */
async function menu(page: Page, mobile: boolean, item: string | RegExp) {
  if (mobile) await page.getByRole('toolbar', { name: '操作' }).getByRole('button', { name: '更多' }).click()
  else await header(page).getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: item, exact: typeof item === 'string' }).click()
}

const card = (page: Page, title: string) =>
  page.locator('[data-slot=glass-card]', { has: page.getByRole('heading', { name: title, exact: true }) })

test.describe('guest summary', () => {
  test('shows status, charts, notes and tags, and edits notes and tags', { tag: '@lab' }, async ({ page, pve, cleanup }) => {
    const id = BASE
    await vm(pve, cleanup, id, 'e2e-gc-summary', { tags: 'e2e', description: '# 用途\n测试 **备注**' })
    await page.goto(`/guest/${pve.node}/qemu/${id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('e2e-gc-summary')

    await expect(page.getByRole('region', { name: '资源使用' })).toContainText('CPU')
    await expect(card(page, '状态')).toContainText('已停止')
    await expect(card(page, '网络')).toContainText('虚拟机未运行')
    await expect(page.getByRole('heading', { name: '资源历史' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'CPU 使用率趋势图' }).or(page.getByText('暂无数据').first())).toBeVisible()

    // Notes: Markdown rendered, then edited.
    const notes = card(page, '备注')
    await expect(notes.getByRole('heading', { name: '用途' })).toBeVisible()
    await expect(notes.locator('strong')).toHaveText('备注')
    await notes.getByRole('button', { name: '编辑' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('备注').fill('新的备注 e2e')
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toBeHidden()
    await expect(notes).toContainText('新的备注 e2e')
    expect((await pve.get<{ description?: string }>(`/nodes/${pve.node}/qemu/${id}/config`)).description?.trim()).toBe('新的备注 e2e')

    // Tags: add one, remove the old one.
    const tags = card(page, '标签')
    await expect(tags).toContainText('e2e')
    await tags.getByRole('button', { name: '编辑' }).click()
    await dialog.getByLabel('添加标签', { exact: true }).fill('gc-tag')
    await dialog.getByLabel('添加标签', { exact: true }).press('Enter')
    await dialog.getByRole('button', { name: '移除标签 e2e', exact: true }).click()
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await pve.get<{ tags?: string }>(`/nodes/${pve.node}/qemu/${id}/config`)).tags).toBe('gc-tag')
    await expect(tags).toContainText('gc-tag')
    await expect(header(page)).toContainText('gc-tag')
  })

  test('container summary lists its interfaces (read-only, CT 200)', async ({ page, pve }) => {
    const ct = (await pve.guests()).find((g) => g.vmid === 200 && g.status === 'running')
    test.skip(!ct, 'CT 200 未运行')
    await page.goto(`/guest/${ct!.node}/lxc/200`)
    await expect(card(page, '网络')).toContainText('eth0', { timeout: 20_000 })
    await expect(card(page, '状态')).toContainText('非特权容器')
    await expect(page.getByRole('heading', { name: '根磁盘用量' })).toBeVisible()
  })

  test('template summary offers clone (read-only, VM 9000)', async ({ page, pve }) => {
    const tpl = (await pve.guests()).find((g) => g.vmid === 9000 && g.template === 1)
    test.skip(!tpl, '没有模板 9000')
    await page.goto(`/guest/${tpl!.node}/qemu/9000`)
    await expect(page.getByRole('heading', { name: '虚拟机模板' })).toBeVisible()
    await expect(card(page, '配置')).toContainText('base-9000-disk-0')
    await page.getByRole('button', { name: '克隆', exact: true }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('radio', { name: /^链接克隆/ })).toBeChecked()
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
  })
})

test.describe('power', { tag: '@lab' }, () => {
  test('start, pause and resume, then force stop from the sheet', async ({ page, pve, cleanup, mobile }) => {
    const id = BASE + 1
    await vm(pve, cleanup, id, 'e2e-gc-power')
    await page.goto(`/guest/${pve.node}/qemu/${id}`)

    await primary(page, mobile, '启动').click()
    await running(pve, id)
    await expect(primary(page, mobile, '关机')).toBeVisible({ timeout: 30_000 })
    await expect(primary(page, mobile, '重启')).toBeVisible()

    await menu(page, mobile, '暂停')
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('radio', { name: /^暂停/ })).toBeChecked()
    await sheet.getByRole('button', { name: '暂停', exact: true }).click()
    await running(pve, id, 'paused')
    await primary(page, mobile, '恢复').click({ timeout: 30_000 })
    await running(pve, id)

    // 关机 opens the sheet on "正常关机"; switch to the forceful way.
    await primary(page, mobile, '关机').click({ timeout: 30_000 })
    await expect(sheet.getByRole('radio', { name: /^正常关机/ })).toBeChecked()
    await expect(sheet.getByRole('radio', { name: /^休眠/ })).toBeVisible()
    await sheet.getByRole('radio', { name: /^强制停止/ }).click()
    await sheet.getByRole('button', { name: '强制停止', exact: true }).click()
    await running(pve, id, 'stopped')
    await expect(primary(page, mobile, '启动')).toBeVisible({ timeout: 30_000 })
  })

  test('palette starts a guest', async ({ page, pve, cleanup }) => {
    const id = BASE + 2
    await vm(pve, cleanup, id, 'e2e-gc-palette')
    await page.goto('/')
    await page.keyboard.press('Control+K')
    await page.getByPlaceholder('搜索资源、页面或操作…').fill('启动 e2e-gc-palette')
    await page.getByRole('option', { name: /启动 e2e-gc-palette/ }).click()
    await running(pve, id)
  })
})

test.describe('lifecycle', () => {
  test('clone, convert to template, protect and delete', { tag: '@lab' }, async ({ page, pve, cleanup, mobile }) => {
    test.setTimeout(150_000)
    const src = BASE + 3
    const copy = BASE + 4
    await pve.destroyGuest(copy)
    cleanup.guest(copy)
    await vm(pve, cleanup, src, 'e2e-gc-source')
    await page.goto(`/guest/${pve.node}/qemu/${src}`)

    // Clone (a primary action while the guest is stopped)
    await primary(page, mobile, '克隆').click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('新 VM ID').fill(String(copy))
    await expect(dialog.getByText('可用', { exact: true })).toBeVisible()
    await dialog.getByLabel('名称').fill('e2e-gc-copy')
    await dialog.getByRole('button', { name: '克隆', exact: true }).click()
    await expect(dialog).toBeHidden()
    await pve.waitForGuest(copy, (g) => g.name === 'e2e-gc-copy', 60_000)

    // Convert the source to a template
    await menu(page, mobile, '转换为模板')
    await page.getByRole('alertdialog').getByRole('button', { name: '转换为模板' }).click()
    await pve.waitForGuest(src, (g) => g.template === 1, 60_000)
    await expect(page.getByRole('heading', { name: '虚拟机模板' })).toBeVisible({ timeout: 30_000 })

    // Protect the copy, then delete it (lifting the protection in the dialog)
    await page.goto(`/guest/${pve.node}/qemu/${copy}`)
    await menu(page, mobile, '删除保护')
    await dialog.getByRole('switch', { name: '启用删除保护' }).click()
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toBeHidden()
    expect((await pve.get<{ protection?: number }>(`/nodes/${pve.node}/qemu/${copy}/config`)).protection).toBe(1)

    await menu(page, mobile, '删除')
    await expect(dialog).toContainText('已启用删除保护')
    const confirm = dialog.getByLabel(`请输入 ${copy} 以确认`)
    await confirm.fill(String(copy))
    await expect(dialog.getByRole('button', { name: '删除', exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: '取消保护' }).click()
    await expect(dialog).not.toContainText('已启用删除保护', { timeout: 15_000 })
    await dialog.getByRole('button', { name: '删除', exact: true }).click()
    await expect(page).toHaveURL(/\/$/, { timeout: 60_000 })
    await expect.poll(async () => (await pve.guests()).some((g) => g.vmid === copy), { timeout: 30_000 }).toBe(false)
  })

  test('migrate explains that there is no other node (read-only, VM 100)', async ({ page, pve, mobile }) => {
    test.skip(!(await pve.guests()).some((g) => g.vmid === 100), '没有 VM 100')
    await page.goto(`/guest/${pve.node}/qemu/100`)
    await menu(page, mobile, '迁移')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('没有可以迁移到的节点')
    await expect(dialog.getByRole('button', { name: '迁移', exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
  })

  test('HA: add as ignored, then remove', { tag: '@lab' }, async ({ page, pve, cleanup, mobile }) => {
    const id = BASE + 6
    const sid = `vm:${id}`
    await vm(pve, cleanup, id, 'e2e-gc-ha')
    cleanup.add(async () => {
      const list = await pve.get<{ sid: string }[]>('/cluster/ha/resources')
      if (list.some((r) => r.sid === sid)) await pve.del(`/cluster/ha/resources/${sid}`)
    })
    await page.goto(`/guest/${pve.node}/qemu/${id}`)
    await menu(page, mobile, '加入 HA')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox').first().click()
    await page.getByRole('option', { name: /^忽略/ }).click()
    await dialog.getByRole('button', { name: '加入 HA', exact: true }).click()
    await expect(dialog).toBeHidden()
    const ha = await pve.get<{ sid: string; state?: string }[]>('/cluster/ha/resources')
    expect(ha.find((r) => r.sid === sid)?.state).toBe('ignored')

    await menu(page, mobile, /加入 HA|HA 设置/)
    await expect(dialog).toContainText(`已由 HA 管理（${sid}）`)
    await dialog.getByRole('button', { name: '移出 HA' }).click()
    await expect
      .poll(async () => (await pve.get<{ sid: string }[]>('/cluster/ha/resources')).some((r) => r.sid === sid), { timeout: 20_000 })
      .toBe(false)
  })
})

test.describe('bulk actions', { tag: '@lab' }, () => {
  test('overview multi-select starts and shuts down guests', async ({ page, pve, cleanup }) => {
    test.setTimeout(150_000)
    const a = BASE + 7
    const b = BASE + 8
    await vm(pve, cleanup, a, 'e2e-gc-bulk-a')
    await vm(pve, cleanup, b, 'e2e-gc-bulk-b')
    await page.goto('/')
    await page.getByRole('button', { name: '多选' }).click()
    const pick = async () => {
      await page.getByRole('checkbox', { name: `e2e-gc-bulk-a（${a}）` }).click()
      await page.getByRole('checkbox', { name: `e2e-gc-bulk-b（${b}）` }).click()
    }
    await pick()
    const bar = page.getByRole('toolbar', { name: '批量操作' })
    await bar.getByRole('button', { name: '启动' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('已选 2 / 2')
    await dialog.getByRole('button', { name: '启动 2 台' }).click()
    await expect(dialog).toBeHidden()
    await running(pve, a)
    await running(pve, b)

    await page.getByRole('button', { name: '多选' }).click()
    await pick()
    await bar.getByRole('button', { name: '关机' }).click()
    await dialog.getByRole('textbox', { name: '超时' }).fill('5')
    await dialog.getByRole('button', { name: '关机 2 台' }).click()
    await expect(dialog).toBeHidden()
    await running(pve, a, 'stopped', 90_000)
    await running(pve, b, 'stopped', 90_000)
  })

  test('node bulk start runs only the checked guest', async ({ page, pve, cleanup, mobile }) => {
    const id = BASE + 9
    await vm(pve, cleanup, id, 'e2e-gc-nodebulk')
    await page.goto(`/node/${pve.node}`)
    await menu(page, mobile, '批量启动')
    const dialog = page.getByRole('dialog')
    // Select everything, then clear it, so only our guest gets checked.
    await expect(dialog.getByRole('checkbox', { name: `e2e-gc-nodebulk（${id}）` })).toBeVisible()
    const selectAll = dialog.getByRole('button', { name: '全选', exact: true })
    if (await selectAll.isVisible()) await selectAll.click()
    await dialog.getByRole('button', { name: '全不选', exact: true }).click()
    await expect(dialog).toContainText('已选 0 /')
    await dialog.getByLabel('筛选客户机').fill('e2e-gc-nodebulk')
    await dialog.getByRole('checkbox', { name: `e2e-gc-nodebulk（${id}）` }).click()
    await expect(dialog).toContainText('已选 1 /')
    await dialog.getByRole('button', { name: '启动 1 台' }).click()
    await expect(dialog).toBeHidden()
    await running(pve, id)
    // The shared samples were not touched.
    expect((await pve.guests()).find((g) => g.vmid === 100)?.status).toBe('stopped')
  })
})

// Container start in debug mode (status/start debug=1). Uses VMID 3790 (the
// phase-1 follow-up range 3700–3799), destroyed afterwards.
test.describe('container debug start', { tag: '@lab' }, () => {
  test('starts a stopped container with debug=1 after confirming', async ({ page, pve, cleanup, mobile }) => {
    test.setTimeout(150_000)
    const vmid = 3790
    const name = 'e2e-p1-debug-ct'
    await pve.destroyGuest(vmid)
    cleanup.guest(vmid)
    const templates = await pve.get<{ volid: string }[]>(`/nodes/${pve.node}/storage/local/content`, { content: 'vztmpl' })
    const ostemplate = templates.map((t) => t.volid).find((v) => /alpine.*amd64/.test(v))
    test.skip(!ostemplate, '实验机上没有 alpine 模板')
    await pve.run('POST', `/nodes/${pve.node}/lxc`, {
      vmid,
      hostname: name,
      ostemplate: ostemplate!,
      memory: 64,
      swap: 0,
      rootfs: 'local-lvm:0.5',
      unprivileged: 1,
    })
    await pve.waitForGuest(vmid, (g) => g.name === name)

    await page.goto(`/guest/${pve.node}/lxc/${vmid}`)
    await expect(primary(page, mobile, '启动')).toBeVisible()
    const start = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/lxc/${vmid}/status/start`))
    await menu(page, mobile, '调试模式启动')
    const confirm = page.getByRole('alertdialog', { name: `以调试模式启动 ${name}？` })
    await expect(confirm).toContainText('调试日志')
    await confirm.getByRole('button', { name: '启动' }).click()
    expect((await start).postData()).toContain('debug=1')
    await running(pve, vmid)
    await pve.run('POST', `/nodes/${pve.node}/lxc/${vmid}/status/stop`)
  })
})

// Phones: the action dock, its sheets and the bulk bar, on the shared samples
// (every dialog is cancelled).
test.describe('phone action dock', { tag: '@mobile' }, () => {
  test('a running guest offers power actions in the dock and sheets', async ({ page, pve }) => {
    const vm = (await pve.guests()).find((g) => g.vmid === 101 && g.status === 'running')
    test.skip(!vm, 'VM 101 未运行')
    await page.goto(`/guest/${pve.node}/qemu/101`)
    const dock = page.getByRole('toolbar', { name: '操作' })
    await expect(dock.getByRole('button', { name: '控制台', exact: true })).toBeVisible()
    await expect(dock.getByRole('button', { name: '重启', exact: true })).toBeVisible()

    await dock.getByRole('button', { name: '关机', exact: true }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('radio', { name: /^正常关机/ })).toBeChecked()
    await expect(sheet.getByRole('radio', { name: /^强制停止/ })).toBeVisible()
    await sheet.getByRole('radio', { name: /^强制停止/ }).click()
    await expect(sheet.getByRole('button', { name: '强制停止', exact: true })).toBeVisible()
    await sheet.getByRole('button', { name: '取消' }).click()
    await expect(sheet).toBeHidden()

    await dock.getByRole('button', { name: '更多' }).click()
    await expect(page.getByRole('menuitem', { name: '暂停', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '迁移', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
  })

  test('overview multi-select shows the bulk bar and its dialog', async ({ page, pve }) => {
    const samples = (await pve.guests()).filter((g) => g.vmid === 100 || g.vmid === 101)
    test.skip(samples.length < 2, '实验机缺少示例客户机 100 / 101')
    await page.goto('/')
    await page.getByRole('button', { name: '多选' }).click()
    for (const g of samples) await page.getByRole('checkbox', { name: `${g.name}（${g.vmid}）` }).click()
    const bar = page.getByRole('toolbar', { name: '批量操作' }).filter({ visible: true })
    await expect(bar).toContainText('2')
    await bar.getByRole('button', { name: '启动' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(/已选 \d+ \/ 2/)
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
    await bar.getByRole('button', { name: '取消' }).click()
    await expect(bar).toBeHidden()
  })
})
