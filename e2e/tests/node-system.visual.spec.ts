import { expect, test } from '../fixtures'

// Visual QA of the node system tab (dark theme; phone 390x844, desktop 1440x900).
// Read-only: node options are mocked so every row shows a value. Only runs
// with E2E_SCREENSHOTS=1:
//   make e2e-visual PORT=8202 SPEC=tests/node-system.visual.spec.ts
// Output: e2e/test-results/node-system-screens/<project>-<screen>.png

test('screens', async ({ page, pve, mobile }, info) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('tiller:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
  })
  await page.route(`**/api2/json/nodes/${pve.node}/config`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            data: {
              digest: 'e2e',
              'startall-onboot-delay': 30,
              wakeonlan: 'mac=bc:24:11:2a:7f:01,bind-interface=vmbr0',
              location: 'latitude=31.2304,longitude=121.4737,name=Shanghai DC1',
            },
          },
        })
      : route.fallback(),
  )
  const shot = (name: string, fullPage = false) =>
    page.screenshot({ path: `test-results/node-system-screens/${info.project.name}-${name}.png`, fullPage })

  await page.goto(`/node/${pve.node}/system`)
  await expect(page.getByRole('tabpanel', { name: '系统' }).getByLabel('hosts 文件内容')).toBeVisible()
  await page.waitForTimeout(1200)
  await shot('tab', true)

  await page.getByRole('button', { name: /^时区/ }).click()
  await page.waitForTimeout(800)
  await shot('dlg-timezone')
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()

  await page.getByRole('button', { name: /^DNS 服务器 1/ }).click()
  await page.waitForTimeout(800)
  await shot('dlg-dns')
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()

  await page.getByRole('button', { name: /^Wake-on-LAN/ }).click()
  await page.waitForTimeout(800)
  await shot('dlg-wol')
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()

  await page.getByRole('button', { name: /^位置/ }).click()
  await page.waitForTimeout(800)
  await shot('dlg-location')
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()

  await page.getByRole('button', { name: '编辑 Hosts' }).click()
  const text = page.getByRole('dialog').getByRole('textbox', { name: '文件内容' })
  await text.fill((await text.inputValue()).replace(new RegExp(`^.*\\s${pve.node}(\\s.*)?$`, 'm'), ''))
  await page.waitForTimeout(800)
  await shot('dlg-hosts')
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()
})
