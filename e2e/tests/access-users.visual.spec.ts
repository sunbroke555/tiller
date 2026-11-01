import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures'
import { mockAccessApi } from './access-users.mocks'

// Visual QA screenshots of the users / groups / tokens / TFA screens (dark
// theme), phone (390×844) and desktop (1440×900), from mocked data. Off by
// default:
//   … make e2e-visual PORT=8301 SPEC=tests/access-users.visual.spec.ts
// and fetch e2e/test-results/au-shots with rt --back.

async function shot(page: Page, name: string, mobile: boolean) {
  await page.waitForTimeout(450) // animations, sheets
  await page.screenshot({ path: `test-results/au-shots/${mobile ? 'phone' : 'desktop'}-${name}.png` })
}

test('access-users screens', async ({ page, mobile }) => {
  test.setTimeout(180_000)
  if (mobile) await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('pve-web:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
  })
  await mockAccessApi(page)
  // The token secret after "create" (never reaches the lab).
  await page.route(/\/api2\/json\/access\/users\/[^/]+\/token\/[^/?]+$/, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ json: { data: { 'full-tokenid': 'e2e-au-alice@pve!deploy', value: '3f1c2a9e-5b7d-4e21-9c0a-7d2e8b6f4a13' } } })
      : route.fallback(),
  )

  await page.goto('/datacenter/users')
  await expect(page.getByTestId('user-row')).toHaveCount(4)
  await shot(page, '01-users', mobile)

  await page.getByRole('button', { name: '新建', exact: true }).click()
  const create = page.getByRole('dialog', { name: '新建用户' })
  await expect(create.getByRole('combobox', { name: '认证域' })).toBeVisible()
  await shot(page, '02-new-user', mobile)
  await create.getByRole('button', { name: '取消' }).click()

  await page.goto('/datacenter/users/user/e2e-au-alice%40pve')
  await expect(page.getByTestId('token-row')).toHaveCount(2)
  await shot(page, '03-user', mobile)
  await page.mouse.wheel(0, 900)
  await shot(page, '04-user-scrolled', mobile)

  await page.getByRole('toolbar', { name: '用户操作' }).getByRole('button', { name: '权限' }).click()
  await expect(page.getByRole('dialog', { name: '用户权限' }).getByText('/vms', { exact: true })).toBeVisible()
  await shot(page, '05-permissions', mobile)
  await page.getByRole('dialog', { name: '用户权限' }).getByRole('button', { name: '关闭' }).last().click()

  await page.goto('/datacenter/users/groups')
  await expect(page.getByTestId('group-row')).toHaveCount(3)
  await shot(page, '06-groups', mobile)
  await page.goto('/datacenter/users/groups/e2e-au-ops')
  await expect(page.getByTestId('member-row')).toHaveCount(2)
  await shot(page, '07-group', mobile)

  await page.goto('/datacenter/users/tokens')
  await expect(page.getByTestId('token-row')).toHaveCount(3)
  await shot(page, '08-tokens', mobile)
  await page.getByRole('button', { name: '新建令牌' }).click()
  const tok = page.getByRole('dialog', { name: '新建 API 令牌' })
  await tok.getByRole('combobox', { name: '用户' }).click()
  await page.getByRole('option', { name: 'e2e-au-alice@pve' }).click()
  await tok.getByLabel('令牌 ID').fill('deploy')
  await shot(page, '09-new-token', mobile)
  await tok.getByRole('button', { name: '创建' }).click()
  await expect(page.getByTestId('token-secret')).toBeVisible()
  await shot(page, '10-token-secret', mobile)
  await page.getByRole('button', { name: '我已保存' }).click()

  await page.goto('/datacenter/users/tfa')
  await expect(page.getByTestId('tfa-user')).toHaveCount(2)
  await shot(page, '11-tfa', mobile)
  await page.getByRole('button', { name: '添加', exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: '添加两步验证' })).toBeVisible()
  await shot(page, '12-tfa-add', mobile)
})
