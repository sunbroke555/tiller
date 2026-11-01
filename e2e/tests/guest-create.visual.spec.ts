import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures'

// Visual QA of the creation wizards (not a regression test): every step in
// every theme at phone (390×844) and desktop size. Read-only: the wizards stop
// at 确认. Runs only with E2E_SCREENSHOTS=1 (make e2e-visual); images land in
// e2e/test-results/<project>/guest-create-shots/.
//   rt --back e2e/test-results -- bash -lc '… make e2e-visual PORT=8108 SPEC=tests/guest-create.visual.spec.ts'

async function next(page: Page, expectStep: string) {
  await page.getByRole('button', { name: /^下一步/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: expectStep, exact: true })).toBeVisible()
}

const THEMES = ['dark', 'light', 'paper'] as const

test.describe('截图', () => {
  for (const theme of THEMES) {
    test(`截图 ${theme}`, async ({ page, mobile }, info) => {
      test.setTimeout(120_000)
      await page.addInitScript((mode) => {
        localStorage.setItem('pve-web:appearance', JSON.stringify({ mode, accent: 'indigo', glass: true, density: 'comfortable' }))
      }, theme)
      if (mobile) await page.setViewportSize({ width: 390, height: 844 })
      const dir = `${info.project.outputDir}/guest-create-shots`
      const shot = async (name: string) => {
        await page.waitForTimeout(400)
        await page.screenshot({ path: `${dir}/${info.project.name}-${theme}-${name}.png`, fullPage: false })
      }

      await page.goto('/create/qemu')
      await expect(page.getByRole('textbox', { name: 'VM ID', exact: true })).not.toHaveValue('')
      await expect(page.getByText('可用', { exact: true })).toBeVisible()
      await shot('qemu-1-general')
      await next(page, '操作系统')
      await shot('qemu-2-os')
      await page.getByRole('radio', { name: /Windows/ }).click()
      await page.getByRole('switch', { name: /VirtIO 驱动/ }).click()
      await shot('qemu-2-os-windows')
      await page.getByRole('radio', { name: /Linux/ }).click()
      await page.getByRole('radio', { name: /不使用介质/ }).click()
      await next(page, '系统')
      await page.getByRole('combobox', { name: 'BIOS' }).click()
      await page.getByRole('option', { name: /OVMF/ }).click()
      await shot('qemu-3-system')
      await page.getByRole('combobox', { name: 'BIOS' }).click()
      await page.getByRole('option', { name: /默认/ }).click()
      await next(page, '磁盘')
      await page.getByRole('button', { name: '添加磁盘' }).click()
      await shot('qemu-4-disks')
      await next(page, 'CPU')
      await page.getByRole('button', { name: '高级选项' }).click()
      await shot('qemu-5-cpu')
      await next(page, '内存')
      await shot('qemu-6-memory')
      await next(page, '网络')
      await shot('qemu-7-network')
      await next(page, '确认')
      await shot('qemu-8-confirm')

      await page.goto('/create/lxc')
      await expect(page.getByText('可用', { exact: true })).toBeVisible()
      await shot('lxc-1-general')
      await page.getByLabel('密码', { exact: true }).fill('secret12')
      await page.getByLabel('确认密码', { exact: true }).fill('secret12')
      await next(page, '模板')
      await page.getByRole('combobox', { name: '模板' }).click()
      await page.getByRole('option', { name: /alpine/ }).first().click()
      await shot('lxc-2-template')
      await next(page, '磁盘')
      await page.getByRole('button', { name: '添加挂载点' }).click()
      await shot('lxc-3-disks')
      await next(page, 'CPU')
      await next(page, '内存')
      await next(page, '网络')
      await page.getByRole('radio', { name: '静态' }).first().click()
      await shot('lxc-6-network')
      await page.getByRole('radio', { name: 'DHCP' }).first().click()
      await next(page, 'DNS')
      await next(page, '确认')
      await shot('lxc-8-confirm')

      await page.goto('/')
      await page.getByRole('button', { name: '新建' }).click()
      await shot('overview-menu')
    })
  }
})
