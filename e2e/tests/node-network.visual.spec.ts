import { expect, test } from '../fixtures'
import { mockNetwork } from './node-network.mock'

// Visual QA of the node network tab (not a regression test), with a mocked
// interface list and pending diff. Read-only. Runs only with
// E2E_SCREENSHOTS=1; images land in e2e/test-results/nn-shots/.
//   make e2e SPEC=tests/node-network.visual.spec.ts E2E_SCREENSHOTS=1

test('node network screenshots (dark)', async ({ page, pve, mobile }, info) => {
  test.setTimeout(120_000)
  if (mobile) await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('pve-web:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
  })
  await mockNetwork(page, pve.node)
  const dir = `test-results/nn-shots/${info.project.name}`
  const panel = page.getByRole('tabpanel', { name: '网络' })
  const dialog = page.getByRole('dialog')
  const settle = () => page.waitForTimeout(600)

  await page.goto(`/node/${pve.node}/network`)
  await expect(panel.getByRole('list', { name: 'Bond' })).toContainText('bond0')
  await settle()
  await page.screenshot({ path: `${dir}-list.png`, fullPage: true })

  await panel.getByRole('button', { name: '差异' }).click()
  await settle()
  await page.screenshot({ path: `${dir}-diff.png`, fullPage: true })

  await panel.getByRole('button', { name: '应用配置' }).click()
  await settle()
  await page.screenshot({ path: `${dir}-apply.png` })
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(dialog).toBeHidden()

  await panel.getByRole('button', { name: '编辑 vmbr0', exact: true }).click()
  await settle()
  await page.screenshot({ path: `${dir}-edit-bridge.png` })
  await dialog.getByRole('button', { name: '取消' }).click()

  await panel.getByRole('button', { name: '编辑 bond0' }).click()
  await settle()
  await page.screenshot({ path: `${dir}-edit-bond.png` })
  await dialog.getByRole('button', { name: '取消' }).click()

  await panel.getByRole('button', { name: '创建' }).click()
  await settle()
  await page.screenshot({ path: `${dir}-create-menu.png` })
  await page.getByRole('menuitem', { name: 'Linux VLAN' }).click()
  await dialog.getByRole('textbox', { name: '名称' }).fill('mgmt')
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await settle()
  await page.screenshot({ path: `${dir}-create-vlan.png` })
})
