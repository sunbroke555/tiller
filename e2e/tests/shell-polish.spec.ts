import crypto from 'node:crypto'

import type { Browser, Page } from '@playwright/test'

import { env, expect, splitUser, test, type PveApi } from '../fixtures'

// Area shell-polish: datacenter summary, pools, tags, resource tree,
// permission-aware actions, account (password + TOTP), consent banner,
// keyboard shortcuts, offline banner and session edge cases.
// Fixtures (@lab, desktop) live in VMID 3900–3999, pool / user names start
// with "e2e-". The phone checks use the lab's own pool and tags read-only.

const VMID = 3901
const POOL = 'e2e-shell-polish'
const TAG = 'e2e-sp'

async function ensureFixtureVm(pve: PveApi) {
  const existing = (await pve.guests()).find((g) => g.vmid === VMID)
  if (existing && existing.name !== 'e2e-shell-polish') throw new Error(`VMID ${VMID} 被其他客户机占用`)
  try {
    await pve.post('/pools', { poolid: POOL, comment: 'shell-polish e2e' })
  } catch {
    // exists
  }
  if (!existing) {
    await pve.createTestVm({ vmid: VMID, name: 'e2e-shell-polish', params: { tags: `${TAG};blue`, pool: POOL, memory: 32 } })
  }
  await pve.waitForGuest(VMID, (g) => g.name === 'e2e-shell-polish')
}

interface StatusEntry {
  type: 'cluster' | 'node'
  name: string
  online?: number
  quorate?: number
}

/** The health card's cluster line and node count, from /cluster/status (single node or cluster). */
async function expectClusterHealth(page: Page, pve: PveApi) {
  const status = await pve.get<StatusEntry[]>('/cluster/status')
  const cluster = status.find((e) => e.type === 'cluster')
  const nodes = status.filter((e) => e.type === 'node')
  const health = page.locator('[aria-labelledby="dc-health"]')
  if (cluster) {
    await expect(health.getByText(`集群 ${cluster.name}`, { exact: true })).toBeVisible()
    await expect(health).toContainText(cluster.quorate ? '正常（Quorate）' : '已失去法定人数')
  } else {
    await expect(health.getByText('单节点，未组建集群')).toBeVisible()
  }
  await expect(health).toContainText(`${nodes.filter((n) => n.online === 1).length} / ${nodes.length} 在线`)
  return health
}

async function removeFixtures(pve: PveApi) {
  await pve.destroyGuest(VMID)
  try {
    await pve.del(`/pools`, { poolid: POOL })
  } catch {
    // already gone
  }
}

test.describe('datacenter, pools and tags', { tag: '@lab' }, () => {
  test.beforeAll(async ({ pve }) => {
    await ensureFixtureVm(pve)
  })
  test.afterAll(async ({ pve }) => {
    await removeFixtures(pve)
  })

  test('datacenter summary shows health, guests, nodes and subscriptions', async ({ page, pve }) => {
    await page.goto('/datacenter')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('数据中心')
    const health = await expectClusterHealth(page, pve)
    // With Ceph, the ceph spec sets noout (HEALTH_WARN → 需要关注) while it runs in parallel.
    const ceph = await pve.get('/cluster/ceph/status').then(() => true, () => false)
    await expect(health.getByText(ceph ? /^(运行正常|需要关注)$/ : /^运行正常$/)).toBeVisible()
    const nodes = page.locator('section[aria-labelledby="dc-nodes"]')
    await expect(nodes.getByRole('link', { name: pve.node }).first()).toBeVisible()
    await expect(page.getByText('没有有效订阅')).toBeVisible()
    await expect(page.getByRole('meter', { name: 'CPU' })).toBeVisible()

    // Guest counters link to the filtered list. Other areas start and stop
    // their e2e guests in parallel: check the lab's own ones.
    const running = (await pve.guests()).filter(
      (g) => g.type === 'qemu' && g.status === 'running' && g.template !== 1 && !g.name?.startsWith('e2e-'),
    )
    await page.locator('[aria-labelledby="dc-guests"]').getByRole('link', { name: /^运行中/ }).first().click()
    await expect(page).toHaveURL(/\/\?type=qemu&filter=running$/)
    const list = page.locator('section[aria-labelledby="guests-heading"]')
    for (const g of running) await expect(list.getByText(g.name ?? `VM ${g.vmid}`, { exact: true })).toBeVisible()
    await expect(list.getByText('e2e-shell-polish')).toHaveCount(0)
  })

  test('datacenter notes render Markdown and can be edited', async ({ page, pve, cleanup }) => {
    const before = await pve.get<{ description?: string }>('/cluster/options')
    cleanup.add(() =>
      before.description ? pve.put('/cluster/options', { description: before.description }) : pve.put('/cluster/options', { delete: 'description' }),
    )
    await page.goto('/datacenter')
    const card = page.locator('[data-slot="glass-card"]').filter({ hasText: '数据中心备注' })
    await card.getByRole('button', { name: '编辑' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('备注内容').fill('## e2e 维护窗口\n\n- 周六 **02:00**\n- <b>not html</b>')
    await dialog.getByRole('tab', { name: '预览' }).click()
    await expect(dialog.getByRole('heading', { name: 'e2e 维护窗口' })).toBeVisible()
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toBeHidden()
    await expect(card.getByRole('heading', { name: 'e2e 维护窗口' })).toBeVisible()
    await expect(card.getByText('02:00')).toHaveJSProperty('tagName', 'STRONG')
    await expect(card.getByText('<b>not html</b>')).toBeVisible()
    expect((await pve.get<{ description?: string }>('/cluster/options')).description).toContain('e2e 维护窗口')
  })

  test('pool list and pool page show members', async ({ page }) => {
    await page.goto('/pool')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('资源池')
    const main = page.getByRole('main')
    await main.getByRole('link', { name: new RegExp(POOL) }).click()
    await expect(page).toHaveURL(new RegExp(`/pool/${POOL}$`))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(POOL)
    await expect(main.getByText('shell-polish e2e')).toBeVisible()
    await expect(main.getByRole('link', { name: /e2e-shell-polish/ })).toBeVisible()
    await expect(page.getByText('客户机运行中')).toBeVisible()
  })

  test('tag chips filter the guest list and survive in the URL', async ({ page }) => {
    await page.goto('/')
    const group = page.getByRole('group', { name: '按标签筛选' })
    await group.getByRole('button', { name: new RegExp(`^${TAG}`) }).click()
    await expect(page).toHaveURL(new RegExp(`[?&]tag=${TAG}`))
    const list = page.locator('section[aria-labelledby="guests-heading"]')
    await expect(list.getByRole('link', { name: /e2e-shell-polish/ })).toBeVisible()
    await expect(list.getByRole('link')).toHaveCount(1)
    await page.reload()
    await expect(page.getByRole('group', { name: '按标签筛选' }).getByRole('button', { name: new RegExp(`^${TAG}`) })).toHaveAttribute('aria-pressed', 'true')
    // Free text filter + clear.
    await page.getByLabel('过滤客户机').fill('no-such-guest-xyz')
    await expect(page.getByText('没有匹配的客户机')).toBeVisible()
    await page.getByRole('button', { name: '清除筛选' }).first().click()
    await expect(page).not.toHaveURL(/tag=/)
  })

  test('resource tree groups by pool and tag and filters', async ({ page }) => {
    await page.goto('/')
    const tree = page.getByRole('tree', { name: '资源树' })
    await expect(tree.getByRole('link', { name: /e2e-shell-polish/ })).toBeVisible()
    await page.getByRole('button', { name: /分组方式/ }).click()
    await page.getByRole('menuitemradio', { name: '按资源池' }).click()
    await expect(tree.getByRole('treeitem', { name: POOL, exact: true })).toBeVisible()
    await page.getByRole('button', { name: /分组方式/ }).click()
    await page.getByRole('menuitemradio', { name: '按标签' }).click()
    await expect(tree.getByRole('treeitem', { name: TAG, exact: true })).toBeVisible()
    await page.getByLabel('过滤资源树').fill('3901')
    await expect(tree.getByRole('link', { name: /e2e-shell-polish/ }).first()).toBeVisible()
    await expect(tree.getByRole('treeitem', { name: '没有标签', exact: true })).toHaveCount(0)
    // Back to the default so other specs see the usual tree.
    await page.getByRole('button', { name: /分组方式/ }).click()
    await page.getByRole('menuitemradio', { name: '按节点' }).click()
  })
})

// ------------------------------------------------------------ permissions

async function testerPage(browser: Browser): Promise<Page> {
  test.skip(!env.testerPassword, '缺少 PVE_LAB_TESTER_PASSWORD')
  const ctx = await browser.newContext({ baseURL: env.baseURL, locale: 'zh-CN', storageState: { cookies: [], origins: [] } })
  const page = await ctx.newPage()
  try {
    await loginForm(page, env.testerUser, env.testerPassword)
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  } catch (e) {
    await test.info().attach('tester-login', { body: await page.screenshot(), contentType: 'image/png' })
    await ctx.close()
    throw e
  }
  return page
}

test('datacenter: per-type template links and the storages counted in the total', async ({ page, pve }) => {
  const guests = await pve.guests()
  const vmTemplates = guests.filter((g) => g.type === 'qemu' && g.template === 1)
  await page.goto('/datacenter')
  const card = page.locator('[aria-labelledby="dc-guests"]')
  const list = page.locator('section[aria-labelledby="guests-heading"]')
  // Row links read "<status> <type> <name> [tags] <vmid> · …".
  const row = (name: string | undefined) => list.getByRole('link', { name: new RegExp(` ${name} .*· `) })

  // VM column → only VM templates, with the 模板 status chip selected.
  await card.getByRole('link', { name: /^模板/ }).first().click()
  await expect(page).toHaveURL(/\/\?type=qemu&filter=template$/)
  await expect(page.getByRole('radiogroup', { name: '状态' }).getByRole('radio', { name: /^模板/ })).toHaveAttribute('aria-checked', 'true')
  for (const g of vmTemplates) await expect(row(g.name)).toBeVisible()
  const ct = guests.find((g) => g.type === 'lxc' && g.template !== 1)
  if (ct) await expect(row(ct.name)).toHaveCount(0)

  // CT column → CT templates only (none of the VM templates).
  await page.goto('/datacenter')
  await card.getByRole('link', { name: /^模板/ }).nth(1).click()
  await expect(page).toHaveURL(/\/\?type=lxc&filter=template$/)
  for (const g of vmTemplates) await expect(row(g.name)).toHaveCount(0)

  // Which storages count toward the storage total (kept in this browser only).
  await page.goto('/datacenter')
  const usage = page.locator('[aria-labelledby="dc-usage"]')
  await expect(usage.getByText(/^存储 · \d+ 个$/)).toBeVisible()
  await usage.getByRole('button', { name: '选择存储' }).click()
  const dlg = page.getByRole('dialog', { name: '计入总量的存储' })
  // On a cluster every node has its own local-lvm ("local-lvm <node>").
  const lvm = dlg.getByRole('checkbox', { name: new RegExp(`^local-lvm( ${pve.node})?$`) })
  await expect(lvm).toBeChecked()
  await lvm.click()
  await expect(lvm).not.toBeChecked()
  await dlg.getByRole('button', { name: '完成' }).click()
  await expect(dlg).toBeHidden()
  await expect(usage.getByText(/^存储 · \d+ 个（已选）$/)).toBeVisible()
  await page.reload()
  await expect(usage.getByText(/（已选）$/)).toBeVisible()
  await usage.getByRole('button', { name: '选择存储' }).click()
  await dlg.getByRole('button', { name: '全部计入' }).click()
  await expect(lvm).toBeChecked()
  await dlg.getByRole('button', { name: '完成' }).click()
  await expect(usage.getByText(/^存储 · \d+ 个$/)).toBeVisible()
})

test('actions and commands are hidden without privileges', async ({ browser, pve, mobile }) => {
  const g101 = (await pve.guests()).find((g) => g.vmid === 101)
  test.skip(!g101 || g101.status !== 'running', 'VM 101 不在运行')
  const page = await testerPage(browser)
  try {
    // tester@pve: PVEAuditor on / → no VM.Console on 101.
    await page.goto(`/guest/${g101!.node}/qemu/101`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(g101!.name ?? 'VM 101')
    const bar = mobile ? page.getByRole('toolbar', { name: '操作' }) : page.locator('header')
    await expect(page.getByRole('tabpanel')).toBeVisible()
    await expect(bar.getByRole('button', { name: '控制台' })).toHaveCount(0)
    // No VM.Allocate: no "create" in the palette.
    if (mobile) await page.getByRole('button', { name: '搜索' }).click()
    else await page.keyboard.press('Control+K')
    await page.getByPlaceholder('搜索资源、页面或操作…').fill('创建虚拟机')
    await expect(page.getByRole('option', { name: '创建虚拟机' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    // No Sys.Modify: datacenter notes are read-only.
    await page.goto('/datacenter')
    await expect(page.getByText('数据中心备注')).toBeVisible()
    await expect(page.locator('[data-slot="glass-card"]').filter({ hasText: '数据中心备注' }).getByRole('button', { name: '编辑' })).toHaveCount(0)
    // My permissions page lists the ACL paths.
    await page.goto('/account/permissions')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('我的权限')
    await expect(page.locator('[aria-label="/vms/100"]')).toContainText('PowerMgmt')
  } finally {
    await page.context().close()
  }
})

// ---------------------------------------------------------------- account

function totp(secret: string, at = Date.now(), step = 30): { code: string; counter: number } {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret.replace(/\s+/g, '')) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)))
  const counter = Math.floor(at / 1000 / step)
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = crypto.createHmac('sha1', key).update(msg).digest()
  const o = h[h.length - 1]! & 0xf
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000
  return { code: String(n).padStart(6, '0'), counter }
}

async function loginForm(page: Page, user: string, password: string) {
  const { username, realm } = splitUser(user)
  await page.goto('/login')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码', { exact: true }).fill(password)
  const realmBox = page.getByRole('combobox', { name: '认证域' })
  await expect(realmBox).toBeEnabled()
  if (!(await realmBox.textContent())?.includes(`@${realm}`)) {
    await realmBox.click()
    await page.getByRole('option', { name: new RegExp(`@${realm}$`) }).click()
  }
  await page.getByRole('button', { name: '登录', exact: true }).click()
}

test('account: change password, add TOTP, log in with it', { tag: '@lab' }, async ({ browser, pve, cleanup }) => {
  test.setTimeout(150_000) // waits for a fresh TOTP time step
  const user = 'e2e-sp-d@pve'
  const pw1 = `Start-${crypto.randomBytes(6).toString('hex')}`
  const pw2 = `Next-${crypto.randomBytes(6).toString('hex')}`
  try {
    await pve.del(`/access/users/${encodeURIComponent(user)}`)
  } catch {
    // not there
  }
  await pve.post('/access/users', { userid: user, password: pw1, comment: 'shell-polish e2e' })
  cleanup.add(() => pve.del(`/access/users/${encodeURIComponent(user)}`))

  const ctx = await browser.newContext({ baseURL: env.baseURL, locale: 'zh-CN', storageState: { cookies: [], origins: [] } })
  cleanup.add(() => ctx.close())
  const page = await ctx.newPage()
  await loginForm(page, user, pw1)
  await expect(page).not.toHaveURL(/\/login/)

  await page.goto('/account')
  await expect(page.getByTestId('account-user')).toHaveText(user)

  // Password
  await page.getByRole('button', { name: '修改密码' }).click()
  let dialog = page.getByRole('dialog', { name: '修改密码' })
  await dialog.getByLabel('当前密码').fill(pw1)
  await dialog.getByRole('textbox', { name: '新密码', exact: true }).fill(pw2)
  await dialog.getByRole('textbox', { name: '再次输入新密码' }).fill(pw2)
  await dialog.getByRole('button', { name: '修改密码' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('密码已修改')).toBeVisible()

  // TOTP
  await page.getByRole('button', { name: '添加' }).first().click()
  await page.getByRole('menuitem', { name: /验证器 App/ }).click()
  dialog = page.getByRole('dialog', { name: /添加验证器/ })
  await expect(dialog.getByRole('img', { name: 'TOTP 二维码' })).toBeVisible()
  const secret = (await dialog.getByTestId('totp-secret').textContent())!.replace(/\s+/g, '')
  expect(secret).toMatch(/^[A-Z2-7]{32}$/)
  const first = totp(secret)
  await dialog.getByLabel('App 显示的验证码').fill(first.code)
  await dialog.getByLabel('当前密码').fill(pw2)
  await dialog.getByRole('button', { name: '验证并添加' }).click()
  await expect(dialog).toBeHidden()
  const entries = page.getByRole('list', { name: '两步验证条目' })
  await expect(entries.getByText('验证器 App')).toBeVisible()
  await expect(page.getByText(/已开启 · 1 个第二因素/)).toBeVisible()

  // Log out, log in with the new password + TOTP (wait for a fresh time step: codes are single-use).
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/\/login/)
  await loginForm(page, user, pw2)
  await expect(page.getByRole('heading', { name: '两步验证' })).toBeVisible()
  let next = totp(secret)
  while (next.counter === first.counter) {
    await page.waitForTimeout(2000)
    next = totp(secret)
  }
  await page.getByLabel(/6 位验证码/).fill(next.code)
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  await page.goto('/account')
  await expect(page.getByTestId('account-user')).toHaveText(user)
})

// --------------------------------------------------------- login & session

test.describe('logged out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('consent text from the server is shown before login', async ({ page, request }) => {
    const res = await request.get('/api/config')
    expect(res.ok()).toBe(true)
    expect(await res.json()).toHaveProperty('consentText')

    await page.route('**/api/config', (route) =>
      route.fulfill({ json: { consentText: '## 访问规则\n\n仅限**授权人员**使用。' } }),
    )
    await page.goto('/login')
    const dialog = page.getByRole('dialog', { name: '使用须知' })
    await expect(dialog.getByRole('heading', { name: '访问规则' })).toBeVisible()
    await expect(dialog.getByText('授权人员')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible() // cannot be dismissed without accepting
    await dialog.getByRole('button', { name: '我已阅读并同意' }).click()
    await expect(dialog).toBeHidden()
    await page.reload()
    await expect(page.getByLabel('用户名')).toBeVisible()
    await expect(page.getByRole('dialog', { name: '使用须知' })).toHaveCount(0) // accepted for this session
  })

  test('a leftover expired session says why the user has to log in again', async ({ page }) => {
    await page.goto('/login')
    await page.evaluate(() => {
      localStorage.setItem(
        'tiller:session',
        JSON.stringify({ username: 'root@pam', csrfToken: 'x', ticketIssuedAt: Date.now() - 3 * 3600_000 }),
      )
      document.cookie = 'tiller-session=1; Path=/'
    })
    await page.goto('/datacenter')
    await expect(page).toHaveURL(/\/login\?next=%2Fdatacenter/)
    await expect(page.getByText('登录已过期，请重新登录')).toBeVisible()
  })
})

test('offline banner, keyboard shortcuts and logout', async ({ page, context, mobile }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('概览')
  await context.setOffline(true)
  await expect(page.getByText('网络已断开')).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByText('网络已断开')).toBeHidden()

  if (!mobile) {
    await page.locator('body').press('?')
    const help = page.getByRole('dialog', { name: '键盘快捷键' })
    await expect(help).toBeVisible()
    await expect(help.getByText('数据中心')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(help).toBeHidden()
    await page.keyboard.press('g')
    await page.keyboard.press('d')
    await expect(page).toHaveURL(/\/datacenter$/)
    await page.keyboard.press('g')
    await page.keyboard.press('p')
    await expect(page).toHaveURL(/\/pool$/)
  }
})

test('phone: datacenter, pools and tag chips (lab samples)', { tag: '@mobile' }, async ({ page, pve }) => {
  const guests = await pve.guests()
  await page.goto('/datacenter')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('数据中心')
  await expectClusterHealth(page, pve)
  await expect(page.getByRole('meter', { name: 'CPU' })).toBeVisible()

  const pooled = guests.find((g) => g.pool === 'lab-pool')
  if (pooled) {
    await page.goto('/pool')
    await page.getByRole('main').getByRole('link', { name: /lab-pool/ }).click()
    await expect(page).toHaveURL(/\/pool\/lab-pool$/)
    await expect(page.getByRole('main').getByRole('link', { name: new RegExp(pooled.name!) })).toBeVisible()
  }

  const tagged = guests.find((g) => g.tags?.split(';').includes('demo'))
  if (tagged) {
    await page.goto('/')
    await page.getByRole('group', { name: '按标签筛选' }).getByRole('button', { name: /^demo/ }).click()
    await expect(page).toHaveURL(/[?&]tag=demo/)
    await expect(page.locator('section[aria-labelledby="guests-heading"]').getByRole('link', { name: new RegExp(`${tagged.name!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`) })).toBeVisible()
  }
})
