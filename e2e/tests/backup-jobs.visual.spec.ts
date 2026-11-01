import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures'
import { mockBackupApi } from './backup-jobs.mocks'

// Visual QA screenshots of the backup job screens (dark theme), phone
// (390×844) and desktop (1440×900), from mocked jobs. Off by default:
//   … make e2e-visual PORT=8209 SPEC=tests/backup-jobs.visual.spec.ts
// and fetch e2e/test-results/bj-shots with rt --back.

async function shot(page: Page, name: string, mobile: boolean) {
  await page.waitForTimeout(450) // animations, sheets
  await page.screenshot({ path: `test-results/bj-shots/${mobile ? 'phone' : 'desktop'}-${name}.png` })
}

test('backup job screens', async ({ page, pve, mobile }) => {
  test.setTimeout(180_000)
  if (mobile) await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('pve-web:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
  })
  await mockBackupApi(page, pve.node)

  await page.goto('/datacenter/backup')
  await expect(page.getByTestId('backup-job-row')).toHaveCount(3)
  await shot(page, '01-list', mobile)

  await page.getByTestId('uncovered-notice').getByRole('button', { name: '查看' }).click()
  const uncovered = page.getByRole('dialog', { name: '没有备份计划的客户机' })
  await expect(uncovered).toBeVisible()
  await shot(page, '02-uncovered', mobile)
  await uncovered.getByRole('button', { name: '关闭', exact: true }).last().click()
  await expect(uncovered).toBeHidden()

  await page.getByRole('button', { name: '计划模拟器' }).click()
  const sim = page.getByRole('dialog', { name: '计划模拟器' })
  await sim.getByRole('textbox', { name: '计划', exact: true }).fill('mon..fri 21:00')
  await expect(sim.getByTestId('simulator-runs')).toBeVisible()
  await shot(page, '03-simulator', mobile)
  await sim.getByRole('button', { name: '关闭' }).last().click()

  await page.getByRole('button', { name: '新建', exact: true }).click()
  const create = page.getByRole('dialog', { name: '新建备份计划' })
  await expect(create.getByTestId('guest-picker')).toBeVisible()
  await create.getByRole('checkbox', { name: '100 tiny-vm', exact: true }).click()
  await shot(page, '04-new', mobile)
  await create.getByTestId('guest-picker').scrollIntoViewIfNeeded()
  await shot(page, '05-new-guests', mobile)
  await create.getByRole('button', { name: /保留策略/ }).click()
  await create.getByRole('button', { name: /高级选项/ }).click()
  await create.getByRole('button', { name: /高级选项/ }).scrollIntoViewIfNeeded()
  await shot(page, '06-new-advanced', mobile)
  await create.getByRole('button', { name: '取消' }).click()

  await page.locator('[data-job="e2e-bj-mock-nightly"]').getByRole('link').first().click()
  await expect(page.locator('[data-testid="included-guest"]').first()).toBeVisible()
  await shot(page, '07-detail', mobile)
  await page.getByRole('toolbar', { name: '计划操作' }).getByRole('button', { name: '编辑' }).click()
  const edit = page.getByRole('dialog', { name: '编辑备份计划' })
  await expect(edit.getByRole('textbox', { name: '计划', exact: true })).toHaveValue('21:00')
  await shot(page, '08-edit', mobile)
  await edit.getByRole('button', { name: '取消' }).click()

  await page.goto('/datacenter/backup/backup-6f1c2a9e-1b2c')
  await expect(page.locator('[data-testid="included-guest"]').first()).toBeVisible()
  await shot(page, '09-detail-pool', mobile)
})
