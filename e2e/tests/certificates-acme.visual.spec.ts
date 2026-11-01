import { expect, test } from '../fixtures'
import { CUSTOM, NAME, NODE, mockAcmeState } from './certificates-acme.mocks'

// Visual QA of the certificates tab (not a regression test), dark theme,
// 1440x900 and 390x844, with mocked ACME state. Read-only. Runs only with
// E2E_SCREENSHOTS=1; images land in e2e/test-results/ca-shots/.

test('certificates screens', async ({ page, mobile }, info) => {
  test.setTimeout(120_000)
  if (mobile) await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('tiller:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
  })
  await mockAcmeState(page)
  const dir = `test-results/ca-shots/${info.project.name}`
  const tab = page.getByRole('tabpanel', { name: '证书' })
  const shot = async (name: string, fullPage = false) => {
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${dir}-${name}.png`, fullPage })
  }

  await page.goto(`/node/${NODE}/certificates`)
  await expect(tab.getByRole('button', { name: `查看证书 ${CUSTOM}` })).toBeVisible()
  await expect(tab.getByRole('button', { name: `编辑插件 ${NAME}` })).toBeVisible()
  await shot('tab', true)

  await tab.getByRole('button', { name: '查看证书 pve-ssl.pem' }).click()
  await page.getByRole('button', { name: '显示 PEM' }).click()
  await shot('details')
  await page.keyboard.press('Escape')

  await tab.getByRole('button', { name: '上传自定义证书' }).click()
  await shot('upload')
  await page.getByRole('button', { name: '取消' }).click()

  await tab.getByRole('button', { name: `编辑域名 dns.e2e.example.com` }).click()
  await shot('domain')
  await page.getByRole('button', { name: '取消' }).click()

  await tab.getByRole('button', { name: `编辑插件 ${NAME}` }).click()
  await expect(page.getByLabel('CF_Token')).toHaveValue('abc=def')
  await shot('plugin')
  await page.getByRole('button', { name: '取消' }).click()

  await tab.getByRole('button', { name: '注册账户' }).click()
  await page.getByRole('dialog', { name: '注册 ACME 账户' }).getByRole('textbox', { name: '邮箱' }).fill('admin@example.org')
  await expect(page.getByRole('checkbox', { name: '我已阅读并同意服务条款' })).toBeVisible({ timeout: 20_000 })
  await shot('register')
})
