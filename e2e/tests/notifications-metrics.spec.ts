import type { Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'
import { mockNotificationApi } from './notifications-metrics.mocks'

// Area notifications-metrics: notification targets, matchers and external
// metric servers (/datacenter/notifications/{targets,matchers,metrics}).
//
// Lab tests (@lab, desktop) only create objects named "e2e-nm-…" that point
// at unreachable endpoints (127.0.0.1 ports with nothing listening, *.invalid
// hosts); test notifications are expected to fail. The built-in
// mail-to-root target and default-matcher are never modified. Everything
// e2e-nm-* is removed before and after. Phone tests (@mobile) only check
// layout, with page.route() mocks.

const PREFIX = 'e2e-nm-'
const NOTIF = '/cluster/notifications'

interface Target {
  name: string
  type: string
  origin?: string
}

async function removeAll(pve: PveApi) {
  for (const m of await pve.get<{ name: string }[]>(`${NOTIF}/matchers`)) {
    if (m.name.startsWith(PREFIX)) await pve.del(`${NOTIF}/matchers/${m.name}`)
  }
  for (const t of await pve.get<Target[]>(`${NOTIF}/targets`)) {
    if (t.name.startsWith(PREFIX)) await pve.del(`${NOTIF}/endpoints/${t.type}/${t.name}`)
  }
  for (const s of await pve.get<{ id: string }[]>('/cluster/metrics/server')) {
    if (s.id.startsWith(PREFIX)) await pve.del(`/cluster/metrics/server/${s.id}`)
  }
}

const dialog = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name })

async function pick(page: Page, trigger: ReturnType<Page['getByRole']>, option: string) {
  await trigger.click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test.describe('notifications and metric servers on the lab', { tag: '@lab' }, () => {
  test.beforeAll(async ({ pve }) => removeAll(pve))
  test.afterAll(async ({ pve }) => removeAll(pve))

  test('webhook target: create, failing test, edit, delete', async ({ page, pve }) => {
    const name = `${PREFIX}hook`
    await page.goto('/datacenter/notifications')
    await expect(page).toHaveURL(/\/datacenter\/notifications\/targets$/)
    const list = page.getByRole('list', { name: '通知目标列表' })
    const builtin = list.locator('[data-target="mail-to-root"]')
    await expect(builtin).toContainText('内置')
    await expect(builtin).toContainText('root@pam')

    await page.getByRole('button', { name: '添加目标' }).click()
    await dialog(page, '添加通知目标').getByRole('button', { name: /Webhook/ }).click()
    const d = dialog(page, '添加 Webhook 目标')
    await d.getByLabel('名称').fill(name)
    await d.getByLabel('URL').fill('http://127.0.0.1:9/hook/{{ secrets.path }}')
    await d.getByRole('button', { name: '添加请求头' }).click()
    await d.getByLabel('请求头 1 名称').fill('Content-Type')
    await d.getByLabel('请求头 1 值').fill('application/json')
    await d.getByRole('button', { name: '填入 JSON 示例' }).click()
    await d.getByRole('button', { name: '添加机密' }).click()
    await d.getByLabel('机密 1 名称').fill('path')
    await d.getByLabel('机密 1 值').fill('s3cret')
    await d.getByRole('button', { name: '添加', exact: true }).click()
    await expect(d).toBeHidden()

    const row = list.locator(`[data-target="${name}"]`)
    await expect(row).toContainText('POST http://127.0.0.1:9/hook/')
    const cfg = await pve.get<{ header: string[]; secret: string[]; body: string; method: string }>(`${NOTIF}/endpoints/webhook/${name}`)
    expect(cfg.method).toBe('post')
    expect(cfg.header).toEqual([`name=Content-Type,value=${Buffer.from('application/json').toString('base64')}`])
    expect(cfg.secret).toEqual(['name=path'])
    expect(Buffer.from(cfg.body, 'base64').toString()).toContain('{{ escape title }}')

    // The test fails (nothing listens on 127.0.0.1:9) and says why.
    await row.getByRole('button', { name: `测试 ${name}` }).click()
    const t = dialog(page, '发送测试通知')
    await t.getByRole('button', { name: '发送' }).click()
    const alert = t.getByRole('alert')
    await expect(alert).toContainText('测试失败')
    await expect(alert).toContainText(/refused|Could not test/i)
    await expect(t.getByRole('button', { name: '重试' })).toBeVisible()
    await t.getByRole('button', { name: '完成' }).click()

    // Edit: secrets stay unless retyped.
    await row.getByRole('button', { name: `编辑 ${name}` }).click()
    const e = dialog(page, `编辑通知目标 ${name}`)
    await expect(e.getByLabel('机密 1 值')).toHaveAttribute('placeholder', '不变')
    await e.getByLabel('备注').fill('e2e 改过')
    await pick(page, e.getByLabel('方法'), 'PUT')
    await e.getByRole('button', { name: '保存' }).click()
    await expect(e).toBeHidden()
    await expect(row).toContainText('e2e 改过')
    const after = await pve.get<{ secret: string[]; method: string; comment: string }>(`${NOTIF}/endpoints/webhook/${name}`)
    expect(after).toMatchObject({ method: 'put', comment: 'e2e 改过', secret: ['name=path'] })

    await row.getByRole('button', { name: `${name} 的操作` }).click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    const c = page.getByRole('alertdialog')
    await c.getByRole('textbox').fill(name)
    await c.getByRole('button', { name: '删除' }).click()
    await expect(row).toBeHidden()
  })

  test('SMTP target with STARTTLS and authentication', async ({ page, pve }) => {
    const name = `${PREFIX}smtp`
    await page.goto('/datacenter/notifications/targets')
    await page.getByRole('button', { name: '添加目标' }).click()
    await dialog(page, '添加通知目标').getByRole('button', { name: /SMTP/ }).click()
    const d = dialog(page, '添加 SMTP 目标')
    await d.getByLabel('名称').fill(name)
    await d.getByLabel('服务器').fill('127.0.0.1')
    await pick(page, d.getByLabel('加密'), 'STARTTLS')
    await expect(d.getByLabel('端口')).toHaveAttribute('placeholder', '默认 587')
    await d.getByLabel('端口').fill('1')
    await d.getByLabel('用户名').fill('e2e')
    await d.getByLabel('密码').fill('e2e-pass')
    await d.getByLabel('发件人地址').fill('pve@example.invalid')
    // Recipients are required.
    await d.getByRole('button', { name: '添加', exact: true }).click()
    await expect(d.getByText('至少选一个用户或填一个邮箱地址')).toBeVisible()
    await d.getByLabel('其他邮箱').fill('e2e@example.invalid')
    await d.getByRole('switch', { name: '启用' }).click()
    await d.getByRole('button', { name: '添加', exact: true }).click()
    await expect(d).toBeHidden()

    const cfg = await pve.get<Record<string, unknown>>(`${NOTIF}/endpoints/smtp/${name}`)
    expect(cfg).toMatchObject({ server: '127.0.0.1', mode: 'starttls', port: 1, username: 'e2e', 'from-address': 'pve@example.invalid', mailto: ['e2e@example.invalid'], disable: 1 })
    expect(cfg.password).toBeUndefined()
    const row = page.locator(`[data-target="${name}"]`)
    await expect(row).toContainText('已禁用')
    await expect(row).toContainText('127.0.0.1:1 → e2e@example.invalid')

    // Turn authentication off: username and password are removed.
    await row.getByRole('button', { name: `编辑 ${name}` }).click()
    const e = dialog(page, `编辑通知目标 ${name}`)
    await expect(e.getByLabel('密码')).toHaveAttribute('placeholder', '不变')
    await e.getByRole('switch', { name: '需要认证' }).click()
    await e.getByRole('button', { name: '保存' }).click()
    await expect(e).toBeHidden()
    await expect.poll(async () => (await pve.get<Record<string, unknown>>(`${NOTIF}/endpoints/smtp/${name}`)).username).toBeUndefined()
  })

  test('matcher with severity, field and calendar rules', async ({ page, pve }) => {
    const target = `${PREFIX}t`
    const name = `${PREFIX}match`
    await pve.post(`${NOTIF}/endpoints/gotify`, { name: target, server: 'http://127.0.0.1:1', token: 'x', disable: 1 })

    await page.goto('/datacenter/notifications/matchers')
    const list = page.getByRole('list', { name: '匹配规则列表' })
    const builtin = list.locator('[data-matcher="default-matcher"]')
    await expect(builtin).toContainText('匹配所有通知')
    await builtin.getByRole('button', { name: 'default-matcher 的操作' }).click()
    await expect(page.getByRole('menuitem', { name: '内置规则不能删除' })).toBeDisabled()
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: '添加规则' }).click()
    const d = dialog(page, '添加匹配规则')
    await d.getByLabel('名称').fill(name)
    await pick(page, d.getByLabel('何时匹配'), '没有规则满足')

    await d.getByRole('button', { name: '匹配严重级别' }).click()
    const sev = d.getByRole('listitem', { name: '规则 1：匹配严重级别' })
    for (const s of ['信息', '提示', '未知']) await sev.getByRole('checkbox', { name: s }).click()

    await d.getByRole('button', { name: '匹配字段' }).click()
    const field = d.getByRole('listitem', { name: '规则 2：匹配字段' })
    await pick(page, field.getByLabel('字段'), '通知类型（type）')
    await field.getByRole('checkbox', { name: /备份（vzdump）/ }).click()

    await d.getByRole('button', { name: '匹配时间' }).click()
    const cal = d.getByRole('listitem', { name: '规则 3：匹配时间' })
    await cal.getByRole('button', { name: 'mon..fri 8-17' }).click()

    // A target is required.
    await d.getByRole('button', { name: '添加', exact: true }).click()
    await expect(d.getByText('至少选一个通知目标')).toBeVisible()
    await d.getByRole('checkbox', { name: new RegExp(target) }).click()
    await d.getByRole('button', { name: '添加', exact: true }).click()
    await expect(d).toBeHidden()

    const cfg = await pve.get<Record<string, unknown>>(`${NOTIF}/matchers/${name}`)
    expect(cfg).toMatchObject({
      mode: 'any',
      'invert-match': 1,
      'match-severity': ['warning,error'],
      'match-field': ['exact:type=vzdump'],
      'match-calendar': ['mon..fri 8-17'],
      target: [target],
    })
    const row = list.locator(`[data-matcher="${name}"]`)
    await expect(row).toContainText('排除：')
    await expect(row).toContainText('通知类型 是 备份')

    // Edit: switch to "all", drop the calendar rule.
    await row.getByRole('button', { name: `编辑 ${name}` }).click()
    const e = dialog(page, `编辑匹配规则 ${name}`)
    await expect(e.getByRole('listitem', { name: /^规则 \d：/ })).toHaveCount(3)
    await pick(page, e.getByLabel('何时匹配'), '全部规则都满足')
    await e.getByRole('button', { name: '删除规则 3' }).click()
    await e.getByRole('button', { name: '保存' }).click()
    await expect(e).toBeHidden()
    await expect
      .poll(async () => {
        const m = await pve.get<Record<string, unknown>>(`${NOTIF}/matchers/${name}`)
        return [m.mode, m['invert-match'] ?? 0, m['match-calendar'] ?? null]
      })
      .toEqual(['all', 0, null])

    // Disable from the menu.
    await row.getByRole('button', { name: `${name} 的操作` }).click()
    await page.getByRole('menuitem', { name: '禁用' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '禁用' }).click()
    await expect(row).toContainText('已禁用')
    expect((await pve.get<Record<string, unknown>>(`${NOTIF}/matchers/${name}`)).disable).toBe(1)
  })

  test('metric servers: graphite toggle, influxdb connection error, delete', async ({ page, pve }) => {
    const graphite = `${PREFIX}graphite`
    const influx = `${PREFIX}influx`
    await page.goto('/datacenter/notifications/metrics')

    await page.getByRole('button', { name: '添加服务器' }).click()
    await dialog(page, '添加指标服务器').getByRole('button', { name: /Graphite/ }).click()
    const g = dialog(page, '添加 Graphite 服务器')
    await g.getByLabel('名称').fill(graphite)
    await g.getByLabel('服务器').fill('127.0.0.1')
    await expect(g.getByLabel('端口')).toHaveValue('2003')
    await g.getByLabel('路径前缀').fill('e2e.lab')
    await g.getByRole('switch', { name: '启用' }).click()
    await g.getByRole('button', { name: '添加', exact: true }).click()
    await expect(g).toBeHidden()
    expect(await pve.get(`/cluster/metrics/server/${graphite}`)).toMatchObject({ type: 'graphite', server: '127.0.0.1', port: 2003, path: 'e2e.lab', disable: 1 })

    const list = page.getByRole('list', { name: '指标服务器列表' })
    const row = list.locator(`[data-metric="${graphite}"]`)
    await expect(row).toContainText('已禁用')
    await row.getByRole('button', { name: `${graphite} 的操作` }).click()
    await page.getByRole('menuitem', { name: '启用' }).click()
    await expect(row).not.toContainText('已禁用')
    expect((await pve.get<{ disable?: number }>(`/cluster/metrics/server/${graphite}`)).disable ?? 0).toBe(0)
    await row.getByRole('button', { name: `${graphite} 的操作` }).click()
    await page.getByRole('menuitem', { name: '禁用' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '禁用' }).click()
    await expect(row).toContainText('已禁用')

    // InfluxDB over HTTP, enabled: PVE tests the connection and refuses to save.
    await page.getByRole('button', { name: '添加服务器' }).click()
    await dialog(page, '添加指标服务器').getByRole('button', { name: /InfluxDB/ }).click()
    const i = dialog(page, '添加 InfluxDB 服务器')
    await i.getByLabel('名称').fill(influx)
    await i.getByLabel('服务器').fill('127.0.0.1')
    await i.getByLabel('端口').fill('1')
    await pick(page, i.getByLabel('协议'), 'HTTP')
    await i.getByLabel('组织').fill('lab')
    await i.getByLabel('存储桶').fill('proxmox')
    await i.getByLabel('Token').fill('e2e-token')
    await i.getByRole('button', { name: '添加', exact: true }).click()
    await expect(i.getByRole('alert').first()).toContainText(/refused|connect|500/i)
    await expect(i).toBeVisible()
    await i.getByRole('switch', { name: '启用' }).click()
    await i.getByRole('button', { name: '添加', exact: true }).click()
    await expect(i).toBeHidden()
    expect(await pve.get(`/cluster/metrics/server/${influx}`)).toMatchObject({
      type: 'influxdb',
      influxdbproto: 'http',
      organization: 'lab',
      bucket: 'proxmox',
      port: 1,
      disable: 1,
    })
    await expect(list.locator(`[data-metric="${influx}"]`)).toContainText('HTTP')

    await row.getByRole('button', { name: `${graphite} 的操作` }).click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    const c = page.getByRole('alertdialog')
    await c.getByRole('textbox').fill(graphite)
    await c.getByRole('button', { name: '删除' }).click()
    await expect(row).toBeHidden()
  })
})

test.describe('notifications and metrics on the phone', { tag: '@mobile' }, () => {
  test.beforeEach(async ({ page }) => mockNotificationApi(page))

  test('targets list, type picker, edit sheet and a failing test', async ({ page }) => {
    await page.goto('/datacenter/notifications/targets')
    const list = page.getByRole('list', { name: '通知目标列表' })
    await expect(list.locator('[data-target="mail-to-root"]')).toContainText('内置（已修改）')
    await expect(list.locator('[data-target="e2e-nm-smtp"]')).toContainText('已禁用')

    await list.getByRole('button', { name: 'mail-to-root 的操作' }).click()
    await expect(page.getByRole('menuitem', { name: '重置为默认' })).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: '添加目标' }).click()
    await expect(dialog(page, '添加通知目标').getByRole('button', { name: /Gotify/ })).toBeVisible()
    await page.keyboard.press('Escape')

    await list.getByRole('button', { name: '编辑 e2e-nm-hook' }).click()
    const e = dialog(page, '编辑通知目标 e2e-nm-hook')
    await expect(e.getByLabel('请求头 1 值')).toHaveValue('application/json')
    await expect(e.getByLabel('机密 1 值')).toHaveAttribute('placeholder', '不变')
    await expect(e.getByLabel('请求体')).toHaveValue(/escape title/)
    await e.getByRole('button', { name: '取消' }).click()

    await list.getByRole('button', { name: '测试 e2e-nm-gotify' }).click()
    const t = dialog(page, '发送测试通知')
    await t.getByRole('button', { name: '发送' }).click()
    await expect(t.getByRole('alert')).toContainText('Connection refused')
  })

  test('matchers and metric servers', async ({ page }) => {
    await page.goto('/datacenter/notifications/matchers')
    const m = page.getByRole('list', { name: '匹配规则列表' }).locator('[data-matcher="e2e-nm-backup"]')
    await expect(m).toContainText('通知类型 是 备份 或 存储复制 且 级别是 警告、错误 且 时间在 mon..fri 8-17')
    await m.getByRole('button', { name: '编辑 e2e-nm-backup' }).click()
    const d = dialog(page, '编辑匹配规则 e2e-nm-backup')
    await expect(d.getByRole('listitem', { name: /^规则 \d：/ })).toHaveCount(3)
    await expect(d.getByRole('checkbox', { name: /e2e-nm-hook/ })).toBeChecked()
    await d.getByRole('button', { name: '取消' }).click()

    await page.getByRole('navigation', { name: '通知与指标' }).getByRole('link', { name: '指标服务器' }).click()
    const s = page.getByRole('list', { name: '指标服务器列表' })
    await expect(s.locator('[data-metric="e2e-nm-influx"]')).toContainText('HTTPS')
    await expect(s.locator('[data-metric="e2e-nm-otel"]')).toContainText('已禁用')
    await s.getByRole('button', { name: '编辑 e2e-nm-influx' }).click()
    const i = dialog(page, '编辑指标服务器 e2e-nm-influx')
    await expect(i.getByLabel('组织')).toHaveValue('lab')
    await expect(i.getByLabel('Token')).toHaveAttribute('placeholder', '不变')
    await i.getByRole('button', { name: '取消' }).click()
  })
})
