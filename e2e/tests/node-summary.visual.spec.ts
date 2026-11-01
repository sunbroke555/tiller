import { expect, test } from '../fixtures'

// Visual QA of the node pages (not a regression test): summary, package
// versions, services, syslog and notes in every theme. Read-only. Runs only
// with E2E_SCREENSHOTS=1 (make e2e-visual); images land in
// e2e/test-results/ns-shots/.

test.describe('node summary screenshots', () => {
  for (const theme of ['dark', 'light', 'paper'] as const) {
    test(`screens in ${theme}`, async ({ page, pve }, info) => {
      test.setTimeout(120_000)
      await page.addInitScript((mode) => {
        localStorage.setItem('tiller:appearance', JSON.stringify({ mode, accent: 'indigo', glass: true, density: 'comfortable' }))
      }, theme)
      const dir = `test-results/ns-shots/${info.project.name}-${theme}`
      await page.goto(`/node/${pve.node}`)
      await expect(page.getByRole('figure', { name: 'CPU 使用率' }).locator('.recharts-area').first()).toBeVisible()
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${dir}-summary.png`, fullPage: true })
      await page.getByRole('button', { name: '软件包版本' }).click()
      await expect(page.getByRole('list', { name: '软件包' })).toContainText('pve-manager')
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${dir}-packages.png` })
      await page.keyboard.press('Escape')
      await page.goto(`/node/${pve.node}/services`)
      await expect(page.getByRole('list', { name: '服务' })).toContainText('pveproxy')
      await page.screenshot({ path: `${dir}-services.png`, fullPage: true })
      await page.getByRole('button', { name: /^pveproxy，/ }).click()
      await expect(page.getByTestId('journal')).not.toContainText('正在读取', { timeout: 20_000 })
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${dir}-service-sheet.png` })
      await page.keyboard.press('Escape')
      await page.goto(`/node/${pve.node}/syslog`)
      await expect(page.getByTestId('journal')).toContainText(pve.node, { timeout: 20_000 })
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${dir}-syslog.png` })
      await page.goto(`/node/${pve.node}`)
      await page.getByRole('region', { name: '备注' }).getByRole('button', { name: '编辑备注' }).click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${dir}-notes.png` })
    })
  }
})
