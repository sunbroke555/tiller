import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'
import { CUSTOM, FAKE_UPID, NAME, NODE, mockAcmeState } from './certificates-acme.mocks'

// Area certificates-acme: node certificates (list, details, custom upload and
// delete), the node's ACME domains, ordering / renewing / revoking, ACME
// accounts and DNS plugins.
//
// Lab writes (@lab, desktop) happen ONLY on node pvelab-c3 of the 3-node lab
// cluster (c1's certificate fingerprint is pinned by everything else): a
// self-signed custom certificate (deleted again, back to pve-ssl.pem), c3's
// ACME node config (restored), one DNS plugin and one Let's Encrypt STAGING
// account (both removed). Ordering a certificate is never sent to the lab:
// the lab has no public domain, so order / renew / revoke run against
// page.route() mocks.

const STAGING = 'https://acme-staging-v02.api.letsencrypt.org/directory'

const panel = (page: Page) => page.getByRole('tabpanel', { name: '证书' })

async function hasNode(pve: PveApi): Promise<boolean> {
  const nodes = await pve.get<{ node: string }[]>('/nodes')
  return nodes.some((n) => n.node === NODE)
}

async function certFiles(pve: PveApi): Promise<string[] | null> {
  try {
    return (await pve.get<{ filename: string }[]>(`/nodes/${NODE}/certificates/info`)).map((c) => c.filename)
  } catch {
    return null // pveproxy on the node is restarting
  }
}

async function removeCustomCert(pve: PveApi) {
  const files = await certFiles(pve)
  if (files?.includes(CUSTOM)) await pve.del(`/nodes/${NODE}/certificates/custom`, { restart: 1 })
}

const ACME_KEYS = ['acme', 'acmedomain0', 'acmedomain1', 'acmedomain2', 'acmedomain3', 'acmedomain4']

async function resetAcmeConfig(pve: PveApi) {
  const cfg = await pve.get<Record<string, unknown>>(`/nodes/${NODE}/config`)
  const set = ACME_KEYS.filter((k) => cfg[k] !== undefined)
  if (set.length) await pve.put(`/nodes/${NODE}/config`, { delete: set.join(',') })
}

async function removePlugin(pve: PveApi) {
  const list = await pve.get<{ plugin: string }[]>('/cluster/acme/plugins')
  if (list.some((p) => p.plugin === NAME)) await pve.del(`/cluster/acme/plugins/${NAME}`)
}

async function removeAccount(pve: PveApi) {
  const list = await pve.get<{ name: string }[]>('/cluster/acme/account')
  if (list.some((a) => a.name === NAME)) await pve.run('DELETE', `/cluster/acme/account/${NAME}`)
}

/** Self-signed certificate and key for the upload test, as one combined PEM file. */
function selfSigned(): { combined: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cert-'))
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30',
    '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
    '-subj', `/CN=${NAME}.lan`,
    '-addext', `subjectAltName=DNS:${NAME}.lan,DNS:${NODE}`,
  ], { stdio: 'ignore' })
  const combined = path.join(dir, 'combined.pem')
  fs.writeFileSync(combined, fs.readFileSync(path.join(dir, 'key.pem'), 'utf8') + fs.readFileSync(path.join(dir, 'cert.pem'), 'utf8'))
  return { combined, dir }
}

// ------------------------------------------------------------------ tests

test.describe('certificates', () => {
  test.beforeEach(async ({ pve }) => {
    test.skip(!(await hasNode(pve)), `实验集群里没有 ${NODE}`)
  })

  test('lists the node certificates with details', async ({ page, pve }) => {
    const info = await pve.get<{ filename: string; fingerprint: string }[]>(`/nodes/${NODE}/certificates/info`)
    const ssl = info.find((c) => c.filename === 'pve-ssl.pem')!
    await page.goto(`/node/${NODE}/certificates`)
    const certs = panel(page).getByRole('region', { name: '证书', exact: true })
    await expect(certs.getByRole('button', { name: '查看证书 pve-root-ca.pem' })).toBeVisible()
    const row = certs.getByRole('button', { name: '查看证书 pve-ssl.pem' })
    await expect(row).toContainText(`${NODE}.lan`)
    await expect(row).toContainText(/天后到期|年后到期/)
    await row.click()
    const dialog = page.getByRole('dialog', { name: '节点证书（集群 CA 签发）' })
    await expect(dialog.getByLabel('指纹')).toHaveText(ssl.fingerprint)
    const sans = dialog.getByRole('list', { name: '备用名称' })
    await expect(sans).toContainText(`${NODE}.lan`)
    await expect(sans).toContainText('::1')
    await expect(dialog).toContainText('PVE Cluster Manager CA')
    await dialog.getByRole('button', { name: '显示 PEM' }).click()
    await expect(dialog.getByLabel('PEM')).toContainText('BEGIN CERTIFICATE')
    await dialog.getByRole('button', { name: '关闭' }).last().click()
    await expect(dialog).toBeHidden()
  })

  test('upload a custom certificate and delete it again', { tag: '@lab' }, async ({ page, pve, cleanup }) => {
    test.setTimeout(150_000)
    await removeCustomCert(pve)
    cleanup.add(() => removeCustomCert(pve))
    const { combined, dir } = selfSigned()
    cleanup.add(async () => fs.rmSync(dir, { recursive: true, force: true }))

    await page.goto(`/node/${NODE}/certificates`)
    await panel(page).getByRole('button', { name: '上传自定义证书' }).click()
    const dialog = page.getByRole('dialog', { name: '上传自定义证书' })
    // A combined file in the chain field fills both chain and key.
    await dialog.locator('input[type=file]').first().setInputFiles(combined)
    await expect(dialog.getByLabel('证书链（PEM）')).toHaveValue(/BEGIN CERTIFICATE/)
    await expect(dialog.getByLabel('私钥（PEM，可选）')).toHaveValue(/BEGIN PRIVATE KEY/)
    await expect(dialog.getByLabel('证书链（PEM）')).not.toHaveValue(/PRIVATE KEY/)
    await expect(dialog.getByRole('switch', { name: '上传后重启 pveproxy' })).toBeChecked()
    await dialog.getByRole('button', { name: '上传' }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })

    await expect.poll(() => certFiles(pve), { timeout: 40_000 }).toContain(CUSTOM)
    const row = panel(page).getByRole('button', { name: `查看证书 ${CUSTOM}` })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText(`${NAME}.lan`)
    await expect(row).toContainText('Web 界面使用中')

    await panel(page).getByRole('button', { name: '更多操作：自定义证书（Web 界面使用）' }).click()
    await page.getByRole('menuitem', { name: '删除自定义证书' }).click()
    const confirm = page.getByRole('alertdialog', { name: '删除自定义证书？' })
    await confirm.getByRole('button', { name: '删除' }).click()
    await expect(confirm).toBeHidden({ timeout: 30_000 })
    await expect.poll(async () => (await certFiles(pve)) ?? [CUSTOM], { timeout: 40_000 }).not.toContain(CUSTOM)
    await expect(row).toBeHidden({ timeout: 30_000 })
    await expect(panel(page).getByRole('button', { name: '查看证书 pve-ssl.pem' })).toContainText('Web 界面使用中')
  })

  test('DNS plugin and ACME domains', { tag: '@lab' }, async ({ page, pve, cleanup }) => {
    test.setTimeout(120_000)
    await resetAcmeConfig(pve)
    await removePlugin(pve)
    cleanup.add(() => removePlugin(pve))
    cleanup.add(() => resetAcmeConfig(pve))

    await page.goto(`/node/${NODE}/certificates`)
    const plugins = panel(page).getByRole('region', { name: 'DNS 插件', exact: true })

    // Create a Cloudflare plugin from the challenge schema form.
    await plugins.getByRole('button', { name: '添加插件' }).click()
    let dialog = page.getByRole('dialog', { name: '添加 DNS 插件' })
    await dialog.getByLabel('插件 ID').fill(NAME)
    await dialog.getByRole('combobox').click()
    await page.getByPlaceholder('搜索服务商…').fill('Cloudflare')
    await page.getByRole('option', { name: /Cloudflare Managed DNS/ }).click()
    await dialog.getByLabel('CF_Token').fill('e2e-token=with=equals')
    await dialog.getByLabel('CF_Account_ID').fill('42')
    await dialog.getByRole('button', { name: '添加' }).click()
    await expect(dialog).toBeHidden()
    const created = await pve.get<{ api: string; data: string }>(`/cluster/acme/plugins/${NAME}`)
    expect(created.api).toBe('cf')
    expect(created.data).toContain('CF_Token=e2e-token=with=equals')
    expect(created.data).toContain('CF_Account_ID=42')

    // Edit: values come back into the fields; set delay and node restriction.
    await plugins.getByRole('button', { name: `编辑插件 ${NAME}` }).click()
    dialog = page.getByRole('dialog', { name: `编辑 DNS 插件 ${NAME}` })
    await expect(dialog.getByLabel('CF_Token')).toHaveValue('e2e-token=with=equals')
    await dialog.getByRole('button', { name: '高级选项' }).click()
    await dialog.getByLabel('验证延迟').fill('90')
    await dialog.getByRole('group', { name: '限定节点' }).getByText(NODE).click()
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toBeHidden()
    const edited = await pve.get<{ 'validation-delay': number; nodes: string; data: string }>(`/cluster/acme/plugins/${NAME}`)
    expect(edited['validation-delay']).toBe(90)
    expect(edited.nodes).toBe(NODE)
    expect(edited.data).toContain('CF_Token=e2e-token=with=equals')
    await expect(plugins.getByRole('button', { name: `编辑插件 ${NAME}` })).toContainText(`仅限节点 ${NODE}`)

    // Domains of c3: one HTTP, one DNS with that plugin and an alias.
    const acme = panel(page).getByRole('region', { name: 'ACME 证书', exact: true })
    await acme.getByRole('button', { name: '添加域名' }).click()
    dialog = page.getByRole('dialog', { name: '添加 ACME 域名' })
    await dialog.getByRole('textbox', { name: '域名', exact: true }).fill('bad')
    await dialog.getByRole('button', { name: '添加' }).click()
    await expect(dialog.getByText('不是有效的域名').first()).toBeVisible()
    await dialog.getByRole('textbox', { name: '域名', exact: true }).fill(`http.${NAME}.example.com`)
    await dialog.getByRole('button', { name: '添加' }).click()
    await expect(dialog).toBeHidden()

    await acme.getByRole('button', { name: '添加域名' }).click()
    dialog = page.getByRole('dialog', { name: '添加 ACME 域名' })
    await dialog.getByRole('radio', { name: 'DNS' }).click()
    await dialog.getByRole('textbox', { name: '域名', exact: true }).fill(`dns.${NAME}.example.com`)
    await dialog.getByRole('combobox').click()
    await page.getByRole('option', { name: NAME }).click()
    await dialog.getByLabel('验证别名（可选）').fill('_acme-challenge.alias.example.net')
    await dialog.getByRole('button', { name: '添加' }).click()
    await expect(dialog).toBeHidden()

    await expect
      .poll(async () => {
        const cfg = await pve.get<Record<string, string>>(`/nodes/${NODE}/config`)
        return [cfg.acme, cfg.acmedomain0]
      })
      .toEqual([`domains=http.${NAME}.example.com`, `domain=dns.${NAME}.example.com,plugin=${NAME},alias=_acme-challenge.alias.example.net`])
    const domains = acme.getByRole('list', { name: 'ACME 域名' })
    await expect(domains.getByRole('listitem')).toHaveCount(2)
    await expect(domains).toContainText(`插件 ${NAME}`)

    // HTTP → DNS moves the domain into a free acmedomain slot.
    await domains.getByRole('button', { name: `编辑域名 http.${NAME}.example.com` }).click()
    dialog = page.getByRole('dialog', { name: '编辑 ACME 域名' })
    await dialog.getByRole('radio', { name: 'DNS' }).click()
    await dialog.getByRole('combobox').click()
    await page.getByRole('option', { name: NAME }).click()
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toBeHidden()
    await expect
      .poll(async () => {
        const cfg = await pve.get<Record<string, string>>(`/nodes/${NODE}/config`)
        return [cfg.acme ?? null, cfg.acmedomain1 ?? null]
      })
      .toEqual([null, `domain=http.${NAME}.example.com,plugin=${NAME}`])

    // Remove both domains, then the plugin.
    for (const d of [`http.${NAME}.example.com`, `dns.${NAME}.example.com`]) {
      await domains.getByRole('button', { name: `更多操作：${d}` }).click()
      await page.getByRole('menuitem', { name: '删除' }).click()
      await page.getByRole('alertdialog', { name: `删除域名 ${d}？` }).getByRole('button', { name: '删除' }).click()
    }
    await expect(acme.getByText('还没有配置域名。')).toBeVisible()
    await plugins.getByRole('button', { name: `更多操作：${NAME}` }).click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await page.getByRole('alertdialog', { name: `删除 DNS 插件 ${NAME}？` }).getByRole('button', { name: '删除' }).click()
    await expect(plugins.getByRole('button', { name: `编辑插件 ${NAME}` })).toBeHidden()
    expect((await pve.get<{ plugin: string }[]>('/cluster/acme/plugins')).map((p) => p.plugin)).not.toContain(NAME)
  })

  test('register, view, update and deactivate an ACME account (Let’s Encrypt staging)', { tag: '@lab' }, async ({ page, pve, cleanup }) => {
    test.setTimeout(150_000)
    try {
      await pve.get('/cluster/acme/meta', { directory: STAGING })
    } catch (e) {
      test.skip(true, `实验集群连不上 Let's Encrypt staging：${String(e)}`)
    }
    await removeAccount(pve)
    cleanup.add(() => removeAccount(pve))

    await page.goto(`/node/${NODE}/certificates`)
    const accounts = panel(page).getByRole('region', { name: 'ACME 账户', exact: true })
    await accounts.getByRole('button', { name: '注册账户' }).click()
    let dialog = page.getByRole('dialog', { name: '注册 ACME 账户' })
    await dialog.getByRole('textbox', { name: '账户名称' }).fill(NAME)
    await dialog.getByRole('textbox', { name: '邮箱' }).fill('tiller-e2e@mailinator.com')
    await dialog.getByRole('combobox').click()
    await page.getByRole('option', { name: /Let's Encrypt V2 Staging/ }).click()
    await expect(dialog.getByRole('link', { name: /letsencrypt\.org/ })).toBeVisible({ timeout: 20_000 })
    // ToS must be accepted.
    await dialog.getByRole('button', { name: '注册' }).click()
    await expect(dialog.getByText('需要同意服务条款').first()).toBeVisible()
    await dialog.getByRole('checkbox', { name: '我已阅读并同意服务条款' }).click()
    await dialog.getByRole('button', { name: '注册' }).click()
    await expect(dialog).toBeHidden({ timeout: 20_000 })

    const row = accounts.getByRole('button', { name: `查看账户 ${NAME}` })
    await expect(row).toBeVisible({ timeout: 60_000 })
    await row.click()
    dialog = page.getByRole('dialog', { name: NAME })
    // Let's Encrypt no longer returns contact addresses: the email may show as "—".
    await expect(dialog).toContainText('有效', { timeout: 20_000 })
    await expect(dialog).toContainText("Let's Encrypt V2 Staging")
    await expect(dialog).toContainText('acme-staging-v02.api.letsencrypt.org/acme/acct/')

    await dialog.getByRole('button', { name: '修改邮箱' }).click()
    const email = page.getByRole('dialog', { name: '修改账户邮箱' })
    await email.getByRole('textbox', { name: '邮箱' }).fill('tiller-e2e2@mailinator.com')
    const update = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes(`/cluster/acme/account/${NAME}`))
    await email.getByRole('button', { name: '保存' }).click()
    const res = await update
    expect(res.request().postData()).toBe('contact=tiller-e2e2%40mailinator.com')
    await expect(email).toBeHidden()
    await pve.waitTask(((await res.json()) as { data: string }).data, { timeout: 60_000, allowWarnings: false })

    await dialog.getByRole('button', { name: '注销账户' }).click()
    const confirm = page.getByRole('alertdialog', { name: `注销 ACME 账户 ${NAME}？` })
    await confirm.getByRole('textbox').fill(NAME)
    await confirm.getByRole('button', { name: '注销' }).click()
    await expect(confirm).toBeHidden({ timeout: 20_000 })
    await expect(row).toBeHidden({ timeout: 60_000 })
  })

  test('order, renew and revoke go to the API (mocked)', async ({ page }) => {
    await mockAcmeState(page)
    const sent: string[] = []
    await page.route(`**/api2/json/nodes/${NODE}/certificates/acme/certificate*`, async (route) => {
      const req = route.request()
      const type = { POST: 'acmenewcert', PUT: 'acmerenew', DELETE: 'acmerevoke' }[req.method()] ?? 'x'
      sent.push(`${req.method()} ${req.postData() ?? ''}`)
      await route.fulfill({ json: { data: FAKE_UPID(type) } })
    })
    await page.goto(`/node/${NODE}/certificates`)
    const acme = panel(page).getByRole('region', { name: 'ACME 证书', exact: true })
    await expect(acme).toContainText(NAME)
    await expect(acme.getByRole('list', { name: 'ACME 域名' }).getByRole('listitem')).toHaveCount(2)

    await acme.getByRole('button', { name: '立即申请证书' }).click()
    let confirm = page.getByRole('alertdialog', { name: `为 ${NODE} 申请证书？` })
    await expect(confirm).toContainText('2 个域名')
    await confirm.getByRole('button', { name: '申请' }).click()
    await expect(confirm).toBeHidden()

    await acme.getByRole('button', { name: '续期' }).click()
    confirm = page.getByRole('alertdialog', { name: `续期 ${NODE} 的 ACME 证书？` })
    await confirm.getByRole('button', { name: '续期' }).click()
    await expect(confirm).toBeHidden()

    await acme.getByRole('button', { name: '吊销' }).click()
    confirm = page.getByRole('alertdialog', { name: `吊销 ${NODE} 的 ACME 证书？` })
    await expect(confirm.getByRole('button', { name: '吊销' })).toBeDisabled()
    await confirm.getByRole('textbox').fill(NODE)
    await confirm.getByRole('button', { name: '吊销' }).click()
    await expect(confirm).toBeHidden()

    expect(sent).toEqual(['POST force=1', 'PUT force=1', 'DELETE '])
  })
})

test.describe('certificates on phones', { tag: '@mobile' }, () => {
  test('sections, details sheet and dialogs fit the screen', async ({ page, pve }) => {
    test.skip(!(await hasNode(pve)), `实验集群里没有 ${NODE}`)
    await mockAcmeState(page)
    await page.goto(`/node/${NODE}/certificates`)
    const tab = panel(page)
    for (const name of ['证书', 'ACME 证书', 'ACME 账户', 'DNS 插件']) await expect(tab.getByRole('region', { name, exact: true })).toBeVisible()
    await expect(tab.getByRole('button', { name: `查看证书 ${CUSTOM}` })).toContainText('天后到期')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)

    // Details as a bottom sheet.
    await tab.getByRole('button', { name: `查看证书 ${CUSTOM}` }).click()
    const sheet = page.getByRole('dialog', { name: '自定义证书（Web 界面使用）' })
    await expect(sheet.getByRole('list', { name: '备用名称' })).toContainText('dns.e2e.example.com')
    await sheet.getByRole('button', { name: '关闭' }).last().click()
    await expect(sheet).toBeHidden()

    // Upload sheet opens and closes without sending anything.
    await tab.getByRole('button', { name: '上传自定义证书' }).click()
    const upload = page.getByRole('dialog', { name: '上传自定义证书' })
    await expect(upload.getByLabel('证书链（PEM）')).toBeVisible()
    await upload.getByRole('button', { name: '取消' }).click()
    await expect(upload).toBeHidden()

    // Plugin edit: schema fields filled from the data (value after the first "=" kept).
    await tab.getByRole('button', { name: `编辑插件 ${NAME}` }).click()
    const plugin = page.getByRole('dialog', { name: `编辑 DNS 插件 ${NAME}` })
    await expect(plugin.getByLabel('CF_Token')).toHaveValue('abc=def')
    await expect(plugin.getByLabel('CF_Account_ID')).toHaveValue('42')
    await plugin.getByRole('button', { name: '取消' }).click()
    await expect(plugin).toBeHidden()
  })
})
