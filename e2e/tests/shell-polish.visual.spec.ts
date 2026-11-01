import path from 'node:path'

import { expect, test } from '../fixtures'

// Visual QA screenshots of the shell-polish screens in every theme. Skipped
// unless E2E_SCREENSHOTS=1; images go to test-results/shots/ (fetch with rt --back).
//   rt --back e2e/test-results -- bash -lc '… make e2e-visual PORT=8111 SPEC=tests/shell-polish.visual.spec.ts'

const THEMES = ['dark', 'light', 'paper'] as const
const PAGES: { name: string; path: string; ready: string; action?: 'filters' | 'shortcuts' | 'palette' | 'menu' }[] = [
  { name: 'overview', path: '/', ready: '虚拟机与容器' },
  { name: 'overview-filters', path: '/?tag=demo', ready: '虚拟机与容器', action: 'filters' },
  { name: 'datacenter', path: '/datacenter', ready: '健康状态' },
  { name: 'pools', path: '/pool', ready: 'lab-pool' },
  { name: 'pool', path: '/pool/lab-pool', ready: '客户机运行中' },
  { name: 'account', path: '/account', ready: '两步验证' },
  { name: 'permissions', path: '/account/permissions', ready: '/vms' },
  { name: 'settings', path: '/settings/appearance', ready: '界面语言' },
  { name: 'guest', path: '/guest/pve-lab/qemu/100', ready: '硬件' },
  { name: 'shortcuts', path: '/', ready: '虚拟机与容器', action: 'shortcuts' },
]

for (const theme of THEMES) {
  test(`screens in ${theme}`, async ({ page, mobile }, testInfo) => {
    test.setTimeout(180_000)
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 })
    await page.addInitScript((mode) => {
      localStorage.setItem('pve-web:appearance', JSON.stringify({ mode, accent: 'indigo', glass: true, density: 'comfortable' }))
      localStorage.removeItem('pve-web:install-dismissed')
    }, theme)
    const shot = async (name: string, fullPage = true) =>
      page.screenshot({ path: path.join(testInfo.project.outputDir, 'shots', `${mobile ? 'm' : 'd'}-${theme}-${name}.png`), fullPage })

    for (const p of PAGES) {
      if (p.action === 'shortcuts' && mobile) continue
      await page.goto(p.path)
      await expect(page.getByText(p.ready).first()).toBeVisible({ timeout: 20_000 })
      await page.waitForTimeout(600) // charts / sparklines settle
      // No horizontal page scroll: report the elements that stick out.
      const wide = await page.evaluate(() => {
        const w = document.documentElement.clientWidth
        if (document.documentElement.scrollWidth <= w) return []
        return [...document.querySelectorAll('body *')]
          .filter((el) => el.getBoundingClientRect().right > w + 1)
          .slice(0, 8)
          .map((el) => `${el.tagName}.${String((el as HTMLElement).className).slice(0, 80)} → ${Math.round(el.getBoundingClientRect().right)}`)
      })
      expect.soft(wide, `${p.name} 横向溢出`).toEqual([])
      if (p.action === 'filters') {
        await page.getByRole('button', { name: '筛选与排序' }).click()
        await page.waitForTimeout(500)
        await shot(p.name, false)
        await page.keyboard.press('Escape')
        continue
      }
      if (p.action === 'shortcuts') {
        await page.locator('body').press('?')
        await page.waitForTimeout(400)
        await shot(p.name, false)
        await page.keyboard.press('Escape')
        continue
      }
      await shot(p.name)
    }

    // Logged-out login page.
    await page.context().clearCookies()
    await page.evaluate(() => localStorage.removeItem('pve-web:session'))
    await page.goto('/login')
    await expect(page.getByLabel('用户名')).toBeVisible()
    await shot('login', false)
  })
}
