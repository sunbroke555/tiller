import { expect, test } from '../fixtures'
import { mockHa } from './ha.mocks'

// Visual QA of the HA screens (not a regression test), dark theme, HA API
// mocked. Runs only with E2E_SCREENSHOTS=1; images land in
// e2e/test-results/ha-shots/.

test('ha screens (dark)', async ({ page, pve }, info) => {
  test.setTimeout(120_000)
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('pve-web:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
  })
  await mockHa(page, pve.node)

  const dir = `test-results/ha-shots/${info.project.name}`
  const shot = async (name: string, fullPage = false) => {
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${dir}-${name}.png`, fullPage })
  }

  await page.goto('/datacenter/ha')
  await expect(page.locator('[data-sid="ct:200"]')).toContainText('迁移中')
  await shot('status', true)

  await page.locator('[data-sid="ct:200"]').getByRole('button', { name: /HA 资源 ct:200/ }).click()
  await expect(page.getByRole('dialog', { name: 'HA 资源 ct:200' })).toBeVisible()
  await shot('detail')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '添加', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '添加 HA 资源' })).toBeVisible()
  await shot('add')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'CRS 设置' }).click()
  await expect(page.getByRole('dialog', { name: /CRS/ })).toBeVisible()
  await shot('crs')
  await page.keyboard.press('Escape')

  await page.goto('/datacenter/ha/rules')
  await expect(page.locator('[data-rule="pin-web"]')).toBeVisible()
  await shot('rules', true)

  await page.locator('[data-rule="pin-web"]').getByRole('button', { name: '规则 pin-web 的操作' }).click()
  await page.getByRole('menuitem', { name: '编辑' }).click()
  await expect(page.getByRole('dialog', { name: '编辑规则 pin-web' })).toBeVisible()
  await shot('rule-edit')
})
