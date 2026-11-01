import { createHmac } from 'node:crypto'

import { request, type Page } from '@playwright/test'

import { env, expect, PveApi, test } from '../fixtures'
import { mockAccessApi } from './access-users.mocks'

// Area access-users: users, groups, API tokens and TFA (/datacenter/users).
//
// Lab tests (@lab, desktop) only create users, groups and tokens named
// e2e-au-* in realm pve and delete all of them in teardown. root@pam and
// tester@pve are never modified, and nobody but e2e-au-* users gets TFA.
// Phone tests (@mobile) check layout with page.route() mocks.

const PREFIX = 'e2e-au-'

async function sweep(pve: PveApi) {
  for (const u of await pve.get<{ userid: string }[]>('/access/users')) {
    if (u.userid.startsWith(PREFIX)) await pve.del(`/access/users/${encodeURIComponent(u.userid)}`)
  }
  for (const g of await pve.get<{ groupid: string }[]>('/access/groups')) {
    if (g.groupid.startsWith(PREFIX)) await pve.del(`/access/groups/${encodeURIComponent(g.groupid)}`)
  }
}

const userPath = (userid: string) => `/access/users/${encodeURIComponent(userid)}`

async function canLogin(userid: string, password: string): Promise<boolean> {
  try {
    const api = await PveApi.login(userid, password)
    await api.dispose()
    return true
  } catch {
    return false
  }
}

/** RFC 6238 code (SHA1, 6 digits, 30 s) for a base32 secret. */
function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret.replace(/\s+/g, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)))
  const h = createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1]! & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

test.describe('users and tokens on the lab', { tag: '@lab' }, () => {
  test.beforeAll(async ({ pve }) => sweep(pve))
  test.afterAll(async ({ pve }) => sweep(pve))

  test('create a user, set the password, edit and delete it', async ({ page, pve }) => {
    test.setTimeout(120_000)
    const userid = `${PREFIX}u1@pve`
    await pve.post('/access/groups', { groupid: `${PREFIX}g1` })

    await page.goto('/datacenter/users')
    await page.getByRole('button', { name: '新建', exact: true }).click()
    const create = page.getByRole('dialog', { name: '新建用户' })
    await create.getByLabel('用户名').fill(`${PREFIX}u1`)
    await expect(create.getByRole('combobox', { name: '认证域' })).toContainText('pve')
    await create.getByLabel(/^密码/).fill('e2e-au-pass-1')
    await create.getByLabel('确认密码').fill('e2e-au-pass-1')
    await create.getByRole('checkbox', { name: `${PREFIX}g1` }).click()
    await create.getByLabel('名', { exact: true }).fill('Ada')
    await create.getByLabel('邮箱').fill('ada@example.com')
    await create.getByRole('button', { name: '创建' }).click()
    await expect(create).toBeHidden()
    await expect(page).toHaveURL(/\/datacenter\/users\/user\/e2e-au-u1(@|%40)pve$/)

    const cfg = await pve.get<{ firstname?: string; email?: string; groups?: string[]; enable?: number }>(userPath(userid))
    expect(cfg).toMatchObject({ firstname: 'Ada', email: 'ada@example.com', groups: [`${PREFIX}g1`], enable: 1 })
    expect(await canLogin(userid, 'e2e-au-pass-1')).toBe(true)

    const toolbar = page.getByRole('toolbar', { name: '用户操作' })
    await toolbar.getByRole('button', { name: '设置密码' }).click()
    const pw = page.getByRole('dialog', { name: '设置密码' })
    await pw.getByLabel(/^新密码/).fill('e2e-au-pass-2')
    await pw.getByLabel('再次输入新密码').fill('e2e-au-pass-2')
    await pw.getByRole('button', { name: '设置密码' }).click()
    await expect(pw).toBeHidden()
    expect(await canLogin(userid, 'e2e-au-pass-2')).toBe(true)

    await toolbar.getByRole('button', { name: '编辑' }).click()
    const edit = page.getByRole('dialog', { name: `编辑用户 ${userid}` })
    await expect(edit.getByLabel('名', { exact: true })).toHaveValue('Ada')
    await edit.getByLabel('名', { exact: true }).fill('Grace')
    await edit.getByRole('checkbox', { name: `${PREFIX}g1` }).click()
    await edit.getByRole('switch', { name: '启用' }).click()
    await edit.getByRole('button', { name: '保存' }).click()
    await expect(edit).toBeHidden()
    await expect.poll(() => pve.get<{ firstname?: string; enable?: number; groups?: string[] }>(userPath(userid))).toMatchObject({
      firstname: 'Grace',
      enable: 0,
      groups: [],
    })
    await expect(page.getByText('已停用').first()).toBeVisible()

    await toolbar.getByRole('button', { name: '删除' }).click()
    const del = page.getByRole('alertdialog', { name: '删除这个用户？' })
    await del.getByRole('textbox').fill(userid)
    await del.getByRole('button', { name: '删除' }).click()
    await expect(page).toHaveURL(/\/datacenter\/users$/)
    const users = await pve.get<{ userid: string }[]>('/access/users')
    expect(users.some((u) => u.userid === userid)).toBe(false)
  })

  test('groups: create, add and remove members, edit, delete', async ({ page, pve }) => {
    test.setTimeout(120_000)
    const group = `${PREFIX}g2`
    const [m1, m2] = [`${PREFIX}m1@pve`, `${PREFIX}m2@pve`]
    await pve.post('/access/groups', { groupid: `${PREFIX}keep` })
    await pve.post('/access/users', { userid: m1, groups: `${PREFIX}keep` })
    await pve.post('/access/users', { userid: m2 })

    await page.goto('/datacenter/users/groups')
    await page.getByRole('button', { name: '新建', exact: true }).click()
    const create = page.getByRole('dialog', { name: '新建组' })
    await create.getByLabel('组名').fill(group)
    await create.getByLabel('备注').fill('测试组')
    await create.getByRole('button', { name: '创建' }).click()
    await expect(page).toHaveURL(new RegExp(`/datacenter/users/groups/${group}$`))

    await page.getByRole('button', { name: '添加成员' }).click()
    const add = page.getByRole('dialog', { name: '添加成员' })
    await add.getByRole('checkbox', { name: m1 }).click()
    await add.getByRole('checkbox', { name: m2 }).click()
    await add.getByRole('button', { name: '添加 2 个用户' }).click()
    await expect(add).toBeHidden()
    await expect(page.getByTestId('member-row')).toHaveCount(2)
    // Other memberships stay.
    expect((await pve.get<{ groups: string[] }>(userPath(m1))).groups.sort()).toEqual([`${PREFIX}g2`, `${PREFIX}keep`])

    await page.getByRole('button', { name: `把 ${m2} 移出组` }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '移出' }).click()
    await expect(page.getByTestId('member-row')).toHaveCount(1)
    expect((await pve.get<{ members: string[] }>(`/access/groups/${group}`)).members).toEqual([m1])

    const toolbar = page.getByRole('toolbar', { name: '组操作' })
    await toolbar.getByRole('button', { name: '编辑' }).click()
    const edit = page.getByRole('dialog', { name: `编辑组 ${group}` })
    await edit.getByLabel('备注').fill('新备注')
    await edit.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('新备注')).toBeVisible()

    await toolbar.getByRole('button', { name: '删除' }).click()
    const del = page.getByRole('alertdialog', { name: '删除这个组？' })
    await del.getByRole('textbox').fill(group)
    await del.getByRole('button', { name: '删除' }).click()
    await expect(page).toHaveURL(/\/datacenter\/users\/groups$/)
    expect((await pve.get<{ groupid: string }[]>('/access/groups')).some((g) => g.groupid === group)).toBe(false)
    expect((await pve.get<{ groups: string[] }>(userPath(m1))).groups).toEqual([`${PREFIX}keep`])
  })

  test('API tokens: create with secret, edit, permissions, regenerate, delete', async ({ page, pve }) => {
    test.setTimeout(120_000)
    const owner = `${PREFIX}t1@pve`
    const full = `${owner}!ci`
    await pve.post('/access/users', { userid: owner })

    await page.goto('/datacenter/users/tokens')
    await page.getByRole('button', { name: '新建令牌' }).click()
    const create = page.getByRole('dialog', { name: '新建 API 令牌' })
    await create.getByRole('combobox', { name: '用户' }).click()
    await page.getByRole('option', { name: owner }).click()
    await create.getByLabel('令牌 ID').fill('ci')
    await create.getByLabel('备注').fill('e2e')
    await create.getByRole('button', { name: '创建' }).click()

    const secretDialog = page.getByRole('dialog', { name: '令牌密钥' })
    await expect(secretDialog.getByTestId('token-id')).toHaveText(full)
    const secret = (await secretDialog.getByTestId('token-secret').textContent())!.trim()
    expect(secret).toMatch(/^[0-9a-f-]{36}$/)
    // The secret works (no cookie: a fresh request context).
    const anon = await request.newContext({ baseURL: env.baseURL })
    const res = await anon.get('/api2/json/version', { headers: { Authorization: `PVEAPIToken=${full}=${secret}` } })
    expect(res.status()).toBe(200)
    await anon.dispose()
    await secretDialog.getByRole('button', { name: '我已保存' }).click()

    const row = page.locator(`[data-token="${full}"]`)
    await expect(row).toContainText('权限分离')
    const menu = async (item: string) => {
      await row.getByRole('button', { name: `令牌 ${full} 的操作` }).click()
      await page.getByRole('menuitem', { name: item }).click()
    }

    await menu('编辑…')
    const edit = page.getByRole('dialog', { name: `编辑令牌 ${full}` })
    await edit.getByRole('switch', { name: '权限分离' }).click()
    await edit.getByLabel('备注').fill('')
    await edit.getByRole('button', { name: '保存' }).click()
    await expect(edit).toBeHidden()
    await expect.poll(() => pve.get<Record<string, unknown>>(`${userPath(owner)}/token/ci`)).toEqual({ privsep: 0, expire: 0 })
    await expect(row).toContainText('完整用户权限')

    await menu('查看权限')
    const perms = page.getByRole('dialog', { name: '令牌权限' })
    await expect(perms).toContainText(full)
    await perms.getByRole('button', { name: '关闭' }).last().click()

    await menu('重新生成密钥…')
    await page.getByRole('alertdialog').getByRole('button', { name: '重新生成' }).click()
    await expect(secretDialog.getByTestId('token-secret')).not.toHaveText(secret)
    await secretDialog.getByRole('button', { name: '我已保存' }).click()

    await menu('删除…')
    const del = page.getByRole('alertdialog', { name: '删除这个 API 令牌？' })
    await del.getByRole('textbox').fill('ci')
    await del.getByRole('button', { name: '删除' }).click()
    await expect(row).toBeHidden()
    expect(await pve.get<unknown[]>(`${userPath(owner)}/token`)).toEqual([])
  })

  test('TFA administration: recovery keys, TOTP, edit, delete', async ({ page, pve }) => {
    test.setTimeout(120_000)
    const userid = `${PREFIX}f1@pve`
    await pve.post('/access/users', { userid })

    // Recovery keys for another user from the TFA overview.
    await page.goto('/datacenter/users/tfa')
    await page.getByRole('button', { name: '添加', exact: true }).first().click()
    const pick = page.getByRole('dialog', { name: '添加两步验证' })
    await pick.getByRole('combobox', { name: '用户' }).click()
    await page.getByRole('option', { name: userid }).click()
    await pick.getByRole('button', { name: /恢复码/ }).click()
    const gen = page.getByRole('dialog', { name: '生成恢复码' })
    await gen.getByRole('button', { name: '生成' }).click()
    await expect(page.getByTestId('recovery-keys').locator('li')).toHaveCount(10)
    await page.getByRole('button', { name: '我已保存' }).click()
    await expect(page.locator(`[data-testid="tfa-user"][data-userid="${userid}"] [data-type="recovery"]`)).toBeVisible()

    // TOTP from the user's page.
    await page.goto(`/datacenter/users/user/${encodeURIComponent(userid)}`)
    const card = page.locator(`[data-testid="tfa-user"][data-userid="${userid}"]`)
    await card.getByRole('button', { name: '添加' }).click()
    await page.getByRole('dialog', { name: '添加两步验证' }).getByRole('button', { name: /验证器（TOTP）/ }).click()
    const add = page.getByRole('dialog', { name: '添加验证器（TOTP）' })
    const secret = (await add.getByTestId('totp-secret').textContent())!
    await add.getByLabel('App 显示的验证码').fill(totp(secret))
    await add.getByRole('button', { name: '验证并添加' }).click()
    await expect(add).toBeHidden()
    await expect(card.locator('[data-type="totp"]')).toContainText('验证器 App')

    await card.getByRole('button', { name: '验证器 App 的操作' }).click()
    await page.getByRole('menuitem', { name: '编辑…' }).click()
    const edit = page.getByRole('dialog', { name: '编辑两步验证' })
    await edit.getByLabel('说明').fill('e2e 手机')
    await edit.getByRole('switch', { name: '启用' }).click()
    await edit.getByRole('button', { name: '保存' }).click()
    await expect(card.locator('[data-type="totp"]')).toContainText('已停用')
    const entries = await pve.get<{ type: string; description?: string; enable?: number }[]>(`/access/tfa/${encodeURIComponent(userid)}`)
    expect(entries.find((e) => e.type === 'totp')).toMatchObject({ description: 'e2e 手机', enable: 0 })

    await card.getByRole('button', { name: 'e2e 手机 的操作' }).click()
    await page.getByRole('menuitem', { name: '删除…' }).click()
    await page.getByRole('dialog', { name: '删除“e2e 手机”？' }).getByRole('button', { name: '删除' }).click()
    await expect(card.locator('[data-type="totp"]')).toHaveCount(0)
    const left = await pve.get<{ type: string }[]>(`/access/tfa/${encodeURIComponent(userid)}`)
    expect(left.map((e) => e.type)).toEqual(['recovery'])
  })
})

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

test.describe('phone layout', { tag: '@mobile' }, () => {
  test('users list and user page', async ({ page }) => {
    await mockAccessApi(page)
    await page.goto('/datacenter/users')
    await expect(page.getByTestId('user-row')).toHaveCount(4)
    const alice = page.locator('[data-userid="e2e-au-alice@pve"]')
    await expect(alice).toContainText('TFA 已锁定')
    await expect(alice).toContainText('e2e-au-ops')
    await expect(page.locator('[data-userid="e2e-au-bob@pve"]')).toContainText('已过期')
    await noHorizontalScroll(page)

    await alice.getByRole('link').click()
    await expect(page).toHaveURL(/\/datacenter\/users\/user\/e2e-au-alice(@|%40)pve$/)
    const toolbar = page.getByRole('toolbar', { name: '用户操作' })
    for (const name of ['编辑', '设置密码', '权限', '解锁 TFA', '删除']) await expect(toolbar.getByRole('button', { name })).toBeVisible()
    await expect(page.getByTestId('token-row')).toHaveCount(2)
    await expect(page.locator('[data-testid="tfa-user"]').getByRole('button', { name: '解锁' })).toBeVisible()
    await noHorizontalScroll(page)

    await toolbar.getByRole('button', { name: '编辑' }).click()
    const edit = page.getByRole('dialog', { name: '编辑用户 e2e-au-alice@pve' })
    await expect(edit.getByLabel('名', { exact: true })).toHaveValue('Alice')
    await expect(edit.getByRole('checkbox', { name: 'e2e-au-ops' })).toHaveAttribute('aria-checked', 'true')
    await edit.getByRole('button', { name: '取消' }).click()
    await expect(edit).toBeHidden()

    await toolbar.getByRole('button', { name: '权限' }).click()
    const perms = page.getByRole('dialog', { name: '用户权限' })
    await expect(perms.getByText('/vms', { exact: true })).toBeVisible()
    await perms.getByRole('button', { name: '关闭' }).last().click()
  })

  test('groups, tokens and TFA views', async ({ page }) => {
    await mockAccessApi(page)
    await page.goto('/datacenter/users/groups')
    await expect(page.getByTestId('group-row')).toHaveCount(3)
    await page.locator('[data-group="e2e-au-ops"]').getByRole('link').click()
    await expect(page.getByTestId('member-row')).toHaveCount(2)
    await noHorizontalScroll(page)

    await page.getByRole('navigation', { name: '用户与令牌' }).getByRole('link', { name: 'API 令牌' }).click()
    await expect(page.getByTestId('token-row')).toHaveCount(3)
    await noHorizontalScroll(page)
    await page.getByRole('button', { name: '新建令牌' }).click()
    const sheet = page.getByRole('dialog', { name: '新建 API 令牌' })
    await expect(sheet.getByRole('switch', { name: '权限分离' })).toBeChecked()
    await sheet.getByRole('button', { name: '取消' }).click()

    await page.getByRole('navigation', { name: '用户与令牌' }).getByRole('link', { name: '两步验证' }).click()
    await expect(page.getByTestId('tfa-user')).toHaveCount(2)
    await expect(page.locator('[data-testid="tfa-user"][data-userid="e2e-au-alice@pve"]')).toContainText('已锁定')
    await noHorizontalScroll(page)
  })
})
