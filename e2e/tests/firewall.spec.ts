import type { Page, Request } from '@playwright/test'

import { expect, test } from '../fixtures'
import { DC, PREFIX, dcOptions, deleteTestRules, rulesAt, sweepFirewall, type Rule } from './firewall-helpers'

// Area firewall: one rule editor / options / aliases / IPSets / log module
// for the datacenter, nodes and guests.
//
// SAFETY: the datacenter firewall stays disabled for the whole run (enabling
// it with a DROP input policy can lock the lab out). The tests only open the
// "enable" confirmation and cancel it. Everything they create is named
// e2e-fw-* and removed afterwards (and swept before each lab test). Guests:
// VMIDs 5600–5699.

const comments = (rules: Rule[]) => rules.filter((r) => r.comment?.startsWith(PREFIX)).map((r) => r.comment)
const rulesRegion = (page: Page) => page.getByRole('region', { name: '规则', exact: true })
const ruleRow = (page: Page, text: string) => rulesRegion(page).locator('tr', { hasText: text })

test.describe('firewall (lab)', { tag: '@lab' }, () => {
  test.beforeEach(async ({ pve }) => {
    await sweepFirewall(pve)
    // Never run against an enabled datacenter firewall.
    expect(Number((await dcOptions(pve)).enable ?? 0), '数据中心防火墙必须保持关闭').toBe(0)
  })

  test('数据中心规则：添加、编辑、启用、键盘和拖动排序、复制、删除', async ({ page, pve, cleanup }) => {
    test.setTimeout(150_000)
    cleanup.add(() => deleteTestRules(pve, `${DC}/rules`))
    // Created at the top in reverse: e2e-fw-a above e2e-fw-b.
    await pve.post(`${DC}/rules`, { type: 'in', action: 'DROP', proto: 'udp', dport: '9999', comment: `${PREFIX}-b` })
    await pve.post(`${DC}/rules`, { type: 'out', action: 'REJECT', macro: 'DNS', comment: `${PREFIX}-a` })

    await page.goto('/datacenter/firewall/rules')
    await expect(page.getByRole('status').filter({ hasText: '数据中心防火墙未启用' })).toBeVisible()
    await expect(ruleRow(page, `${PREFIX}-a`)).toContainText('REJECT')

    // Add through the form.
    await rulesRegion(page).getByRole('button', { name: '添加规则' }).first().click()
    const dlg = page.getByRole('dialog', { name: '添加规则' })
    await dlg.getByRole('textbox', { name: '协议' }).fill('tcp')
    await dlg.getByLabel('目的端口').fill('8006')
    await dlg.getByRole('textbox', { name: '源地址' }).fill('192.168.0.0/24')
    await dlg.getByLabel('注释').fill(`${PREFIX}-ui`)
    await dlg.getByRole('button', { name: '添加' }).click()
    await expect(dlg).toBeHidden()
    let rules = await rulesAt(pve, `${DC}/rules`)
    expect(comments(rules)).toEqual([`${PREFIX}-ui`, `${PREFIX}-a`, `${PREFIX}-b`])
    expect(rules[0]).toMatchObject({ type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '8006', source: '192.168.0.0/24', enable: 0 })

    // Edit: more ports, drop the source.
    await ruleRow(page, `${PREFIX}-ui`).getByRole('button', { name: /更多操作/ }).click()
    await page.getByRole('menuitem', { name: '编辑' }).click()
    const edit = page.getByRole('dialog', { name: '编辑规则 #0' })
    await edit.getByLabel('目的端口').fill('8006,22')
    await edit.getByRole('textbox', { name: '源地址' }).fill('')
    await edit.getByRole('button', { name: '保存' }).click()
    await expect(edit).toBeHidden()
    rules = await rulesAt(pve, `${DC}/rules`)
    expect(rules[0]).toMatchObject({ dport: '8006,22', comment: `${PREFIX}-ui` })
    expect(rules[0]!.source).toBeUndefined()

    // Enable in place.
    await ruleRow(page, `${PREFIX}-ui`).getByRole('switch', { name: '启用规则 #0' }).click()
    await expect.poll(async () => (await rulesAt(pve, `${DC}/rules`))[0]?.enable).toBe(1)

    // Keyboard: two steps down.
    const handle = ruleRow(page, `${PREFIX}-ui`).getByRole('button', { name: /移动规则/ })
    await handle.focus()
    await page.keyboard.press('ArrowDown')
    await expect(ruleRow(page, `${PREFIX}-ui`).getByRole('button', { name: /移动规则/ })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect.poll(async () => comments(await rulesAt(pve, `${DC}/rules`))).toEqual([`${PREFIX}-a`, `${PREFIX}-b`, `${PREFIX}-ui`])
    await expect(ruleRow(page, `${PREFIX}-ui`)).toHaveAttribute('data-rule-pos', '2')

    // Drag back to the top.
    await ruleRow(page, `${PREFIX}-ui`)
      .getByRole('button', { name: /移动规则/ })
      .dragTo(ruleRow(page, `${PREFIX}-a`), { targetPosition: { x: 40, y: 3 } })
    await expect.poll(async () => comments(await rulesAt(pve, `${DC}/rules`))).toEqual([`${PREFIX}-ui`, `${PREFIX}-a`, `${PREFIX}-b`])

    // Copy lands right below its original, disabled.
    await ruleRow(page, `${PREFIX}-a`).getByRole('button', { name: /更多操作/ }).click()
    await page.getByRole('menuitem', { name: '复制' }).click()
    const copy = page.getByRole('dialog', { name: '复制规则 #1' })
    await copy.getByLabel('注释').fill(`${PREFIX}-copy`)
    await copy.getByRole('button', { name: '添加' }).click()
    await expect(copy).toBeHidden()
    await expect.poll(async () => comments(await rulesAt(pve, `${DC}/rules`))).toEqual([`${PREFIX}-ui`, `${PREFIX}-a`, `${PREFIX}-copy`, `${PREFIX}-b`])
    expect((await rulesAt(pve, `${DC}/rules`))[2]).toMatchObject({ type: 'out', action: 'REJECT', macro: 'DNS', enable: 0 })

    // Delete.
    await ruleRow(page, `${PREFIX}-copy`).getByRole('button', { name: /更多操作/ }).click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click()
    await expect(ruleRow(page, `${PREFIX}-copy`)).toHaveCount(0)
    expect(comments(await rulesAt(pve, `${DC}/rules`))).toEqual([`${PREFIX}-ui`, `${PREFIX}-a`, `${PREFIX}-b`])
  })

  test('数据中心选项：策略改后恢复默认；启用防火墙只打开确认', async ({ page, pve, cleanup }) => {
    const before = await dcOptions(pve)
    cleanup.add(async () => {
      if (before.policy_forward === undefined) await pve.put(`${DC}/options`, { delete: 'policy_forward' })
      else await pve.put(`${DC}/options`, { policy_forward: before.policy_forward })
    })
    await page.goto('/datacenter/firewall/options')

    await page.getByRole('button', { name: /^转发策略/ }).click()
    const dlg = page.getByRole('dialog', { name: '转发策略' })
    await dlg.getByRole('combobox').click()
    await page.getByRole('option', { name: /DROP/ }).click()
    await dlg.getByRole('button', { name: '保存' }).click()
    await expect(dlg).toBeHidden()
    await expect.poll(async () => (await dcOptions(pve)).policy_forward).toBe('DROP')

    await page.getByRole('button', { name: '更多操作：转发策略' }).click()
    await page.getByRole('menuitem', { name: '恢复默认' }).click()
    await expect.poll(async () => (await dcOptions(pve)).policy_forward).toBeUndefined()

    // Enabling asks first and checks 8006/22; cancel, never confirm.
    await page.getByRole('switch', { name: '防火墙' }).click()
    const confirm = page.getByRole('alertdialog', { name: '启用数据中心防火墙？' })
    await expect(confirm).toContainText('没有找到放行 8006')
    await confirm.getByRole('button', { name: '取消' }).click()
    await expect(confirm).toBeHidden()
    expect(Number((await dcOptions(pve)).enable ?? 0)).toBe(0)
    await expect(page.getByRole('switch', { name: '防火墙' })).not.toBeChecked()
  })

  test('安全组、别名、IPSet', async ({ page, pve, cleanup }) => {
    test.setTimeout(150_000)
    cleanup.add(() => sweepFirewall(pve))
    const group = `${PREFIX}-grp`

    // Security group with one rule (macro picked from the list), then renamed.
    await page.goto('/datacenter/firewall/groups')
    await page.getByRole('button', { name: '新建' }).click()
    let dlg = page.getByRole('dialog', { name: '新建安全组' })
    await dlg.getByLabel('名称').fill(group)
    await dlg.getByLabel('注释').fill('e2e')
    await dlg.getByRole('button', { name: '新建' }).click()
    await expect(page).toHaveURL(new RegExp(`/datacenter/firewall/groups/${group}$`))
    const groupRules = page.getByRole('region', { name: '组内规则' })
    await groupRules.getByRole('button', { name: '添加规则' }).first().click()
    dlg = page.getByRole('dialog', { name: '添加规则' })
    await dlg.getByRole('combobox', { name: '宏' }).click()
    await page.getByPlaceholder('搜索宏…').fill('SSH')
    await page.getByRole('option', { name: /^SSH/ }).first().click()
    await expect(dlg.getByLabel('目的端口')).toBeDisabled()
    await dlg.getByRole('button', { name: '添加' }).click()
    await expect(dlg).toBeHidden()
    expect(await rulesAt(pve, `${DC}/groups/${group}`)).toMatchObject([{ type: 'in', action: 'ACCEPT', macro: 'SSH' }])

    await page.getByRole('button', { name: `更多操作：安全组 ${group}` }).last().click()
    await page.getByRole('menuitem', { name: '重命名 / 注释' }).click()
    dlg = page.getByRole('dialog', { name: `编辑安全组 ${group}` })
    await dlg.getByLabel('名称').fill(`${group}2`)
    await dlg.getByRole('button', { name: '保存' }).click()
    await expect(page).toHaveURL(new RegExp(`/groups/${group}2$`))
    expect((await pve.get<{ group: string }[]>(`${DC}/groups`)).map((g) => g.group)).toContain(`${group}2`)

    // Alias.
    await page.getByRole('link', { name: '别名', exact: true }).click()
    await page.getByRole('button', { name: '添加别名' }).first().click()
    dlg = page.getByRole('dialog', { name: '添加别名' })
    await dlg.getByLabel('名称').fill(`${PREFIX}-alias`)
    await dlg.getByLabel('IP/CIDR').fill('10.99.0.1')
    await dlg.getByRole('button', { name: '添加' }).click()
    await expect(page.getByRole('button', { name: `别名 ${PREFIX}-alias：10.99.0.1` })).toBeVisible()
    await page.getByRole('button', { name: `别名 ${PREFIX}-alias：10.99.0.1` }).click()
    dlg = page.getByRole('dialog', { name: `编辑别名 ${PREFIX}-alias` })
    await dlg.getByLabel('IP/CIDR').fill('10.99.0.0/28')
    await dlg.getByRole('button', { name: '保存' }).click()
    await expect.poll(async () => (await pve.get<{ name: string; cidr: string }[]>(`${DC}/aliases`)).find((a) => a.name === `${PREFIX}-alias`)?.cidr).toBe('10.99.0.0/28')

    // IPSet with an alias member and an excluded (nomatch) network.
    const set = `${PREFIX}-set`
    await page.getByRole('link', { name: 'IPSet', exact: true }).click()
    await page.getByRole('button', { name: '新建' }).click()
    dlg = page.getByRole('dialog', { name: '新建 IPSet' })
    await dlg.getByLabel('名称').fill(set)
    await dlg.getByRole('button', { name: '新建' }).click()
    await expect(page).toHaveURL(new RegExp(`/ipset/${set}$`))
    await page.getByRole('button', { name: '添加成员' }).click()
    dlg = page.getByRole('dialog', { name: `添加到 ${set}` })
    await dlg.getByRole('button', { name: '选择别名' }).click()
    await page.getByRole('option', { name: new RegExp(`${PREFIX}-alias`) }).click()
    await expect(dlg.getByLabel('IP/CIDR')).toHaveValue(`dc/${PREFIX}-alias`)
    await dlg.getByRole('button', { name: '添加' }).click()
    await expect(dlg).toBeHidden()
    await page.getByRole('button', { name: '添加成员' }).click()
    dlg = page.getByRole('dialog', { name: `添加到 ${set}` })
    await dlg.getByLabel('IP/CIDR').fill('10.98.0.0/24')
    await dlg.getByRole('switch', { name: /排除/ }).click()
    await dlg.getByRole('button', { name: '添加' }).click()
    await expect(page.locator('[data-cidr="10.98.0.0/24"]')).toContainText('排除')
    const members = await pve.get<{ cidr: string; nomatch?: number }[]>(`${DC}/ipset/${set}`)
    expect(members.map((m) => [m.cidr, !!m.nomatch]).sort()).toEqual([
      ['10.98.0.0/24', true],
      [`dc/${PREFIX}-alias`, false],
    ])

    // Deleting a non-empty set asks for its name.
    await page.getByRole('button', { name: `更多操作：IPSet ${set}` }).last().click()
    await page.getByRole('menuitem', { name: '删除 IPSet' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('还有 2 个成员')
    await confirm.getByRole('textbox').fill(set)
    await confirm.getByRole('button', { name: '删除' }).click()
    await expect(page).toHaveURL(/\/datacenter\/firewall\/ipset$/)
    expect((await pve.get<{ name: string }[]>(`${DC}/ipset`)).map((s) => s.name)).not.toContain(set)
  })

  test('客户机防火墙：启用、插入安全组、日志筛选', async ({ page, pve, cleanup }) => {
    test.setTimeout(150_000)
    const group = `${PREFIX}-guest`
    await pve.post(`${DC}/groups`, { group })
    await pve.post(`${DC}/groups/${group}`, { type: 'in', action: 'ACCEPT', macro: 'Ping', enable: 1 })
    cleanup.add(() => sweepFirewall(pve))
    await pve.destroyGuest(5600)
    const vmid = await pve.createTestVm({ vmid: 5600, name: 'e2e-fw-vm' })
    cleanup.guest(vmid)
    const base = `/nodes/${pve.node}/qemu/${vmid}/firewall`

    await page.goto(`/guest/${pve.node}/qemu/${vmid}/firewall?fw=options`)
    await expect(page.getByRole('status').filter({ hasText: '这一层的防火墙未启用' })).toBeVisible()
    await page.getByRole('switch', { name: '防火墙' }).click()
    await expect.poll(async () => (await pve.get<{ enable?: number }>(`${base}/options`)).enable).toBe(1)
    await expect(page.getByRole('status').filter({ hasText: '这一层的防火墙未启用' })).toHaveCount(0)

    await page.getByRole('navigation', { name: '防火墙' }).getByRole('link', { name: '规则', exact: true }).click()
    await page.getByRole('button', { name: '插入安全组' }).click()
    const dlg = page.getByRole('dialog', { name: '插入安全组' })
    await dlg.getByRole('combobox').click()
    await page.getByRole('option', { name: group }).click()
    await dlg.getByRole('textbox', { name: '接口' }).fill('net0')
    await dlg.getByRole('switch', { name: '启用' }).click()
    await dlg.getByRole('button', { name: '插入' }).click()
    await expect(dlg).toBeHidden()
    expect(await rulesAt(pve, `${base}/rules`)).toMatchObject([{ type: 'group', action: group, iface: 'net0', enable: 1 }])
    await expect(rulesRegion(page).locator('tr', { hasText: group })).toBeVisible()

    // Log with a time filter (sent as Unix seconds).
    await page.getByRole('link', { name: '日志', exact: true }).click()
    await expect(page.getByRole('log', { name: '防火墙日志' })).toBeVisible()
    await page.getByLabel('开始时间').fill('2026-01-01T00:00')
    const req: Promise<Request> = page.waitForRequest((r) => r.url().includes(`${base}/log`) && r.url().includes('since='))
    await page.getByRole('button', { name: '筛选' }).click()
    const since = new URL((await req).url()).searchParams.get('since')
    // The browser runs in Asia/Shanghai (playwright.config.ts): local midnight is 16:00 UTC the day before.
    expect(Number(since)).toBe(Date.UTC(2026, 0, 1) / 1000 - 8 * 3600)
    await expect(page.getByText('（已筛选）')).toBeVisible()
  })
})

test('节点防火墙：选项与日志（只读）', async ({ page, pve }) => {
  await page.goto(`/node/${pve.node}/firewall?fw=options`)
  await expect(page.getByRole('switch', { name: 'nftables 后端（技术预览）' })).toBeVisible()
  await expect(page.locator('[data-option="nf_conntrack_max"]')).toContainText('262144')
  await page.getByRole('navigation', { name: '防火墙' }).getByRole('link', { name: '日志', exact: true }).click()
  await expect(page).toHaveURL(/fw=log/)
  await expect(page.getByRole('log', { name: '防火墙日志' })).toBeVisible()
  await expect(page.getByText(/共 \d+ 行|没有日志/).first()).toBeVisible()
})

// ------------------------------------------------------------- phone layout

const MOCK_RULES = [
  { type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '22', source: '+dc/admins', enable: 1, comment: 'ssh from admins' },
  { type: 'in', action: 'DROP', macro: 'SMB', enable: 0 },
  { type: 'group', action: 'webservers', iface: 'vmbr0', enable: 1 },
]

/** Stateful mock of the datacenter rule list: GET lists, PUT moveto reorders. */
async function mockRules(page: Page) {
  let rules = MOCK_RULES.map((r) => ({ ...r }))
  const moves: string[] = []
  await page.route('**/api2/json/cluster/firewall/rules**', async (route) => {
    const req = route.request()
    if (req.method() === 'GET') {
      return route.fulfill({ json: { data: rules.map((r, pos) => ({ ...r, pos, digest: 'mock' })) } })
    }
    const body = new URLSearchParams(req.postData() ?? '')
    const from = Number(new URL(req.url()).pathname.split('/').pop())
    const moveto = Number(body.get('moveto'))
    moves.push(`${from}→${moveto}`)
    // PVE: take the rule out, insert it before the rule that was at `moveto`.
    const moved = rules[from]!
    const next: typeof rules = []
    rules.forEach((r, i) => {
      if (i === from) return
      if (i === moveto) next.push(moved)
      next.push(r)
    })
    if (moveto >= rules.length) next.push(moved)
    rules = next
    return route.fulfill({ json: { data: null } })
  })
  return moves
}

test.describe('firewall (phone)', { tag: '@mobile' }, () => {
  test('规则是卡片，移动在底部抽屉里', async ({ page }) => {
    const moves = await mockRules(page)
    await page.goto('/datacenter/firewall')
    const list = page.getByRole('list', { name: '规则列表' })
    await expect(list.getByRole('listitem')).toHaveCount(3)
    const first = list.getByRole('listitem').first()
    await expect(first).toContainText('ACCEPT')
    await expect(first).toContainText('tcp 22')
    await expect(first).toContainText('admins（IPSet）')
    await expect(list.getByRole('listitem').nth(1)).toContainText('未启用')
    await expect(list.getByRole('listitem').nth(2)).toContainText('webservers')

    await first.getByRole('button', { name: '更多操作：规则 #0' }).click()
    await page.getByRole('menuitem', { name: '移动…' }).click()
    const sheet = page.getByRole('dialog', { name: '移动规则' })
    await expect(sheet.getByRole('button', { name: '上移' })).toBeDisabled()
    await sheet.getByRole('button', { name: '下移' }).click()
    await expect(sheet).toContainText('第 1 条，共 3 条')
    await sheet.getByRole('button', { name: '移到最后' }).click()
    await expect(sheet).toContainText('第 2 条，共 3 条')
    await sheet.getByRole('button', { name: '完成' }).click()
    expect(moves).toEqual(['0→2', '1→3'])
    await expect(list.getByRole('listitem').last()).toContainText('ssh from admins')
  })

  test('规则表单在底部抽屉里，宏会禁用端口', async ({ page }) => {
    await mockRules(page)
    await page.goto('/datacenter/firewall/rules')
    await page.getByRole('list', { name: '规则列表' }).getByRole('listitem').nth(1).getByRole('button').first().click()
    const dlg = page.getByRole('dialog', { name: '编辑规则 #1' })
    await expect(dlg.getByRole('radio', { name: /丢弃 DROP/ })).toHaveAttribute('aria-checked', 'true')
    await expect(dlg.getByRole('combobox', { name: '宏' })).toContainText('SMB')
    await expect(dlg.getByLabel('目的端口')).toBeDisabled()
    const box = await dlg.boundingBox()
    // A bottom sheet: anchored to the bottom edge of the viewport.
    expect(box!.y + box!.height).toBeGreaterThan(page.viewportSize()!.height - 4)
    await dlg.getByRole('button', { name: '取消' }).click()
    await expect(dlg).toBeHidden()
  })
})
