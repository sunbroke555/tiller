import fs from 'node:fs'
import path from 'node:path'

import type { Browser, BrowserContextOptions, Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'

// Visual QA of the console screens (not a regression test): every main screen
// at 390×844, 844×390 (landscape) and 1440×900 in the dark, light and paper
// themes. Only runs with E2E_SCREENSHOTS=1; images land in
// e2e/test-results/screens/console/.
//
//   rt --back e2e/test-results -- env E2E_SCREENSHOTS=1 … make e2e PORT=8103 \
//     SPEC=tests/console-screens.spec.ts E2E_ARGS=--project=desktop

const OUT = path.join(import.meta.dirname, '..', 'test-results', 'screens', 'console')
const THEMES = ['dark', 'light', 'paper'] as const
const SIZES: Record<string, BrowserContextOptions> = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  landscape: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
}

test.skip(!process.env.E2E_SCREENSHOTS, '只在 E2E_SCREENSHOTS=1 时截图')

async function freeVmid(pve: PveApi, skip: number[] = []): Promise<number> {
  const used = new Set([...(await pve.guests()).map((g) => g.vmid), ...skip])
  for (let id = 3250; id <= 3299; id++) if (!used.has(id)) return id
  throw new Error('VMID 3250–3299 已用完')
}

async function shoot(
  browser: Browser,
  authFile: string,
  name: string,
  sizes: (keyof typeof SIZES)[],
  url: string,
  prepare: (page: Page) => Promise<void>,
) {
  fs.mkdirSync(OUT, { recursive: true })
  for (const theme of THEMES) {
    for (const size of sizes) {
      const context = await browser.newContext({ ...SIZES[size], storageState: authFile, locale: 'zh-CN' })
      await context.addInitScript((mode) => {
        localStorage.setItem('pve-web:appearance', JSON.stringify({ mode, accent: 'indigo', glass: true, density: 'comfortable' }))
      }, theme)
      const page = await context.newPage()
      await page.goto(url)
      await prepare(page)
      await page.waitForTimeout(400)
      await page.screenshot({ path: path.join(OUT, `${name}-${size}-${theme}.png`) })
      await context.close()
    }
  }
}

const connected = async (page: Page) => {
  await expect(page.getByTestId('console-status').first()).toHaveText('已连接', { timeout: 30_000 })
}

test.describe.serial('console screenshots', () => {
  let vm = 0
  let ct = 0

  test.beforeAll(async ({ pve }) => {
    test.setTimeout(240_000)
    vm = await freeVmid(pve)
    await pve.createTestVm({ vmid: vm, name: 'e2e-console-shot-vm', params: { vga: 'qxl', serial0: 'socket' } })
    await pve.run('POST', `/nodes/${pve.node}/qemu/${vm}/status/start`)
    ct = await freeVmid(pve, [vm])
    const tpl = (await pve.get<{ volid: string }[]>(`/nodes/${pve.node}/storage/local/content`, { content: 'vztmpl' })).find(
      (c) => /alpine.*amd64/.test(c.volid),
    )!.volid
    await pve.run('POST', `/nodes/${pve.node}/lxc`, {
      vmid: ct,
      hostname: 'e2e-console-shot-ct',
      ostemplate: tpl,
      rootfs: 'local-lvm:1',
      memory: 64,
      swap: 0,
      unprivileged: 1,
      cmode: 'shell',
      start: 1,
    })
    await pve.waitForGuest(ct, (g) => g.status === 'running')
    await pve.waitForGuest(vm, (g) => g.status === 'running')
  })

  test.afterAll(async ({ pve }) => {
    test.setTimeout(180_000)
    for (const id of [vm, ct]) if (id) await pve.destroyGuest(id)
  })

  test('full-screen consoles', async ({ browser, authFile, pve }) => {
    test.setTimeout(600_000)
    await shoot(browser, authFile, 'vm-novnc', ['phone', 'landscape', 'desktop'], `/console/${pve.node}/qemu/${vm}`, connected)
    await shoot(browser, authFile, 'node-shell', ['phone', 'landscape', 'desktop'], `/console/${pve.node}/shell`, async (page) => {
      await connected(page)
      const term = page.getByTestId('xterm-console')
      await term.locator('.xterm').click()
      await page.keyboard.type('ls --color=auto /; echo; uname -a')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(600)
    })
  })

  test('embedded tabs and pages', async ({ browser, authFile, pve }) => {
    test.setTimeout(600_000)
    await shoot(browser, authFile, 'ct-tab', ['phone', 'desktop'], `/guest/${pve.node}/lxc/${ct}/console`, async (page) => {
      await connected(page)
      await page.getByTestId('xterm-console').locator('.xterm').click()
      await page.keyboard.type('cat /etc/os-release')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(500)
    })
    await shoot(browser, authFile, 'shell-page', ['phone', 'desktop'], '/shell', async (page) => {
      await expect(page.getByRole('heading', { level: 1, name: 'Shell' })).toBeVisible()
      if ((page.viewportSize()?.width ?? 0) >= 1024) await connected(page)
    })
    await shoot(browser, authFile, 'menu', ['phone', 'desktop'], `/console/${pve.node}/qemu/${vm}`, async (page) => {
      await connected(page)
      await page.getByRole('button', { name: '控制台菜单' }).click()
    })
    await shoot(browser, authFile, 'sendkey', ['phone', 'desktop'], `/guest/${pve.node}/qemu/${vm}`, async (page) => {
      const mobile = (page.viewportSize()?.width ?? 0) < 1024
      if (mobile) await page.getByRole('toolbar', { name: '操作' }).getByRole('button', { name: '更多' }).click()
      else await page.getByRole('button', { name: '更多操作' }).click()
      await page.getByRole('menuitem', { name: '发送按键…' }).click()
      await expect(page.getByRole('dialog', { name: '发送按键' })).toBeVisible()
      await page.waitForTimeout(400)
    })
    await pve.run('POST', `/nodes/${pve.node}/lxc/${ct}/status/stop`)
    await pve.waitForGuest(ct, (g) => g.status === 'stopped')
    await shoot(browser, authFile, 'ct-stopped', ['phone', 'desktop'], `/guest/${pve.node}/lxc/${ct}/console`, async (page) => {
      await expect(page.getByText(`CT ${ct} 未运行`)).toBeVisible({ timeout: 20_000 })
    })
  })
})
