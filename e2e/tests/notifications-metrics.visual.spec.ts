import { expect, test } from '../fixtures'
import { mockNotificationApi } from './notifications-metrics.mocks'

// Visual QA of /datacenter/notifications (not a regression test): dark theme,
// 1440x900 and 390x844, mocked data, read-only. Runs only with
// E2E_SCREENSHOTS=1; images land in e2e/test-results/nm-shots/.

test('notifications and metrics screens', async ({ page, mobile }, info) => {
  test.setTimeout(120_000)
  if (mobile) await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('tiller:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
  })
  await mockNotificationApi(page)
  const dir = `test-results/nm-shots/${info.project.name}`
  const shot = async (name: string, fullPage = false) => {
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${dir}-${name}.png`, fullPage })
  }

  await page.goto('/datacenter/notifications/targets')
  await expect(page.locator('[data-target="e2e-nm-hook"]')).toBeVisible()
  await shot('targets', true)

  await page.getByRole('button', { name: '添加目标' }).click()
  await shot('target-picker')
  await page.getByRole('button', { name: /SMTP/ }).click()
  await shot('smtp-new')
  await page.getByRole('button', { name: '取消' }).click()

  await page.getByRole('button', { name: '编辑 e2e-nm-hook' }).click()
  await expect(page.getByLabel('请求体')).toHaveValue(/escape title/)
  await shot('webhook-edit')
  await page.getByRole('button', { name: '取消' }).click()

  await page.getByRole('button', { name: '测试 e2e-nm-gotify' }).click()
  await page.getByRole('dialog', { name: '发送测试通知' }).getByRole('button', { name: '发送' }).click()
  await expect(page.getByRole('dialog', { name: '发送测试通知' }).getByRole('alert')).toBeVisible()
  await shot('test-failed')
  await page.getByRole('button', { name: '完成' }).click()

  await page.goto('/datacenter/notifications/matchers')
  await expect(page.locator('[data-matcher="e2e-nm-backup"]')).toBeVisible()
  await shot('matchers', true)
  await page.getByRole('button', { name: '编辑 e2e-nm-backup' }).click()
  await expect(page.getByRole('listitem', { name: /^规则 3：/ })).toBeVisible()
  await shot('matcher-edit')
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()

  await page.goto('/datacenter/notifications/metrics')
  await expect(page.locator('[data-metric="e2e-nm-influx"]')).toBeVisible()
  await shot('metrics', true)
  await page.getByRole('button', { name: '编辑 e2e-nm-influx' }).click()
  await expect(page.getByLabel('组织')).toHaveValue('lab')
  await shot('influx-edit')
})
