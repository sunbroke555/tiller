import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures'
import { mockOptions, mockSubscription } from './dc-options.mocks'

// Visual QA screenshots of the datacenter options screens (dark theme), phone
// (390×844) and desktop (1440×900), from mocked options. Off by default:
//   … make e2e-visual PORT=8309 SPEC=tests/dc-options.visual.spec.ts
// and fetch e2e/test-results/dco-shots with rt --back.

async function shot(page: Page, name: string, mobile: boolean, fullPage = false) {
  await page.waitForTimeout(450) // animations, sheets
  await page.screenshot({ path: `test-results/dco-shots/${mobile ? 'phone' : 'desktop'}-${name}.png`, fullPage })
}

async function open(page: Page, key: string, title: string) {
  await page.locator(`[data-option="${key}"]`).getByRole('button').first().click()
  const dialog = page.getByRole('dialog', { name: title })
  await expect(dialog).toBeVisible()
  return dialog
}

test('datacenter options screens', async ({ page, pve, mobile }) => {
  test.setTimeout(180_000)
  if (mobile) await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('pve-web:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
  })
  await mockOptions(page)
  await mockSubscription(page, pve.node)

  await page.goto('/datacenter/options')
  await expect(page.locator('[data-option="bwlimit"]')).toContainText('100 MiB/s')
  await shot(page, '01-options', mobile)
  await shot(page, '02-options-full', mobile, true)

  for (const [i, [key, title]] of (
    [
      ['tag-style', '标签样式'],
      ['crs', '集群资源调度'],
      ['bwlimit', '带宽限制'],
      ['user-tag-access', '用户标签权限'],
      ['migration', '迁移设置'],
      ['webauthn', 'WebAuthn 设置'],
    ] as const
  ).entries()) {
    const dialog = await open(page, key, title)
    await shot(page, `${String(i + 3).padStart(2, '0')}-${key}`, mobile)
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
  }

  await page.goto(`/datacenter/options/subscription/${pve.node}`)
  await expect(page.getByText('pve1c-0123456789')).toBeVisible()
  await shot(page, '10-subscription', mobile)
  await page.getByRole('toolbar', { name: '订阅操作' }).getByRole('button', { name: '上传密钥' }).click()
  await expect(page.getByRole('dialog', { name: '上传订阅密钥' })).toBeVisible()
  await shot(page, '11-upload', mobile)
  await page.getByRole('dialog', { name: '上传订阅密钥' }).getByRole('button', { name: '取消' }).click()

  await page.goto(`/node/${pve.node}/subscription`)
  await expect(page.getByText('pve1c-0123456789')).toBeVisible()
  await shot(page, '12-node-tab', mobile)
})
