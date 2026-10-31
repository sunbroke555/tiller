import { expect, test } from '@playwright/test'

// Placeholder smoke test; real scenarios are written in the Verify phase.
test('login page renders', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'PVE Web' })).toBeVisible()
  await expect(page.getByLabel('用户名')).toBeVisible()
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
})
