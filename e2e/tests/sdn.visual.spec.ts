import { expect, test } from '../fixtures'
import { mockSdn } from './sdn.mocks'

// Visual QA of the SDN screens (not a regression test), dark theme, SDN API
// mocked. Runs only with E2E_SCREENSHOTS=1; images land in
// e2e/test-results/sdn-shots/.

test('SDN screens (dark)', async ({ page }, info) => {
  test.setTimeout(180_000)
  const mobile = info.project.name === 'mobile'
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 })
  await page.addInitScript(() => {
    localStorage.setItem('pve-web:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
  })
  await mockSdn(page)
  const dir = `test-results/sdn-shots/${info.project.name}`
  const shot = async (name: string, fullPage = true) => {
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${dir}-${name}.png`, fullPage })
  }

  await page.goto('/datacenter/sdn')
  await expect(page.getByTestId('sdn-status-row').first()).toBeVisible()
  await shot('overview')

  await page.goto('/datacenter/sdn/zones')
  await expect(page.getByTestId('sdn-zone-row').first()).toBeVisible()
  await shot('zones')
  await page.getByTestId('sdn-zones').getByRole('button', { name: '添加', exact: true }).click()
  await shot('zones-add-menu', false)
  await page.getByRole('menuitem', { name: /^EVPN/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await shot('zone-dialog-evpn', false)
  await page.keyboard.press('Escape')

  await page.goto('/datacenter/sdn/zones/lab')
  await expect(page.getByTestId('sdn-zone-runtime')).toBeVisible()
  await shot('zone-detail')

  await page.goto('/datacenter/sdn/vnets')
  await expect(page.getByTestId('sdn-vnet-row').first()).toBeVisible()
  await shot('vnets')
  await page.goto('/datacenter/sdn/vnets/labnet')
  await expect(page.getByTestId('sdn-subnet-row').first()).toBeVisible()
  await shot('vnet-detail')
  await page.getByTestId('sdn-subnet-row').first().getByRole('button').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await shot('subnet-dialog', false)
  await page.keyboard.press('Escape')

  await page.goto('/datacenter/sdn/options')
  await expect(page.getByTestId('sdn-controller-row').first()).toBeVisible()
  await shot('options')

  await page.goto('/datacenter/sdn/ipam')
  await expect(page.getByTestId('sdn-ipam-entry').first()).toBeVisible()
  await shot('ipam')

  await page.goto('/datacenter/sdn/fabrics')
  await expect(page.getByTestId('sdn-fabric-row').first()).toBeVisible()
  await shot('fabrics')
  await page.goto('/datacenter/sdn/fabrics/under')
  await expect(page.getByTestId('sdn-fabric-node-row').first()).toBeVisible()
  await shot('fabric-detail')
  await page.getByRole('button', { name: '添加节点' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '添加接口' }).click()
  await shot('fabric-node-dialog', false)
  await page.keyboard.press('Escape')

  await page.goto('/datacenter/sdn/route-maps')
  await expect(page.getByTestId('sdn-route-map-entry').first()).toBeVisible()
  await shot('route-maps')
  await page.getByTestId('sdn-route-map-entry').first().getByRole('button').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await shot('route-map-dialog', false)
  await page.keyboard.press('Escape')

  await page.goto('/datacenter/sdn/prefix-lists')
  await expect(page.getByTestId('sdn-prefix-entry').first()).toBeVisible()
  await shot('prefix-lists')

  await page.goto('/datacenter/sdn/zones')
  await page.getByTestId('sdn-pending-bar').getByRole('button', { name: '差异预览' }).click()
  await page.getByRole('dialog').getByRole('combobox').click()
  await page.getByRole('option').first().click()
  await expect(page.getByRole('dialog')).toContainText('router openfabric')
  await shot('dry-run', false)
})
