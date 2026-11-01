import { expect, test } from '../fixtures'
import { mockMappingApi } from './resource-mappings.mocks'

// Visual QA of the resource mapping screens (not a regression test), dark
// theme, with the mapping API mocked. Runs only with E2E_SCREENSHOTS=1;
// images land in e2e/test-results/rm-shots/.

test('resource mapping screens (dark)', async ({ page, pve }, info) => {
  test.setTimeout(120_000)
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('pve-web:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
  })
  await mockMappingApi(page, pve.node)
  const dir = `test-results/rm-shots/${info.project.name}`
  const shot = async (name: string, fullPage = false) => {
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${dir}-${name}.png`, fullPage })
  }

  await page.goto('/datacenter/mappings/pci')
  await expect(page.locator('[data-mapping="e2e-rm-t4"] [data-state="ok"]')).toHaveCount(2)
  await shot('pci', true)

  await page.getByRole('button', { name: '添加 PCI 映射' }).click()
  const pci = page.getByRole('dialog', { name: '添加 PCI 映射' })
  await pci.getByRole('checkbox', { name: /^0000:03:00\.0 / }).click()
  await shot('pci-add')
  await pci.getByRole('button', { name: '取消' }).click()

  await page.goto('/datacenter/mappings/usb')
  await expect(page.locator('[data-mapping="e2e-rm-port"]')).toContainText('没有设备')
  await shot('usb', true)
  await page.getByRole('button', { name: '添加 USB 映射' }).click()
  await page.getByRole('dialog', { name: '添加 USB 映射' }).getByRole('button', { name: /Logitech/ }).click()
  await shot('usb-add')
  await page.keyboard.press('Escape')

  await page.goto('/datacenter/mappings/dir')
  await expect(page.locator('[data-mapping="e2e-rm-missing"]')).toContainText('does not exist')
  await shot('dir', true)

  await page.goto('/datacenter/mappings/cpu')
  await expect(page.locator('[data-cpu-model="e2e-rm-win"]')).toBeVisible()
  await shot('cpu', true)
  await page.getByRole('button', { name: 'CPU 型号 e2e-rm-win' }).click()
  await expect(page.getByRole('dialog', { name: '编辑 CPU 型号 e2e-rm-win' }).locator('[data-flag="aes"]')).toBeVisible()
  await shot('cpu-edit')
})
