import fs from 'node:fs'
import path from 'node:path'

import type { BrowserContextOptions, Page } from '@playwright/test'

import { expect, test } from '../fixtures'

// Visual QA of the node "更新" tab (not a regression test): updates list,
// changelog, repositories, add dialog and versions at 390×844 and 1440×900 in
// the dark theme. Read-only. Only runs with E2E_SCREENSHOTS=1; images land in
// e2e/test-results/screens/node-updates/.
//
//   rt --back e2e/test-results/screens -- bash -lc 'set -a; . ~/.config/pve-web/lab-cluster.env; set +a; \
//     make e2e-visual PORT=8204 SPEC=tests/node-updates.visual.spec.ts E2E_ARGS=--project=desktop'

const OUT = path.join(import.meta.dirname, '..', 'test-results', 'screens', 'node-updates')
const NODE = (process.env.PVE_LAB_NODES ?? '').split(/[\s,]+/).includes('pvelab-c3') ? 'pvelab-c3' : (process.env.PVE_LAB_NODE ?? 'pve-lab')
const SIZES: Record<string, BrowserContextOptions> = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
}

const SCREENS: { name: string; url: string; full?: boolean; prepare: (page: Page) => Promise<void> }[] = [
  {
    name: 'updates',
    url: `/node/${NODE}/updates`,
    prepare: async (page) => {
      await expect(page.getByTestId('updates-count')).toBeVisible({ timeout: 20_000 })
    },
  },
  {
    name: 'changelog',
    url: `/node/${NODE}/updates`,
    prepare: async (page) => {
      await page.getByRole('button', { name: /^pve-docs，|^pve-manager，/ }).first().click()
      await expect(page.getByRole('region', { name: '变更日志' })).toContainText('(', { timeout: 30_000 })
    },
  },
  {
    name: 'repositories',
    url: `/node/${NODE}/updates?view=repositories`,
    full: true,
    prepare: async (page) => {
      await expect(page.getByTestId('repo-state')).toBeVisible({ timeout: 20_000 })
    },
  },
  {
    name: 'add-repo',
    url: `/node/${NODE}/updates?view=repositories`,
    prepare: async (page) => {
      await page.getByRole('button', { name: '添加软件源' }).click()
      await expect(page.getByRole('dialog', { name: '添加软件源' })).toBeVisible()
    },
  },
  {
    name: 'versions',
    url: `/node/${NODE}/updates?view=versions`,
    full: true,
    prepare: async (page) => {
      await expect(page.getByRole('list', { name: '软件包版本' })).toContainText('pve-manager', { timeout: 20_000 })
    },
  },
]

test('node updates screenshots', async ({ browser, authFile }) => {
  test.setTimeout(240_000)
  fs.mkdirSync(OUT, { recursive: true })
  for (const [size, opts] of Object.entries(SIZES)) {
    const context = await browser.newContext({ ...opts, storageState: authFile, locale: 'zh-CN' })
    await context.addInitScript(() => {
      localStorage.setItem('tiller:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
    })
    const page = await context.newPage()
    for (const s of SCREENS) {
      await page.goto(s.url)
      await s.prepare(page)
      await page.waitForTimeout(600)
      await page.screenshot({ path: path.join(OUT, `${s.name}-${size}.png`), fullPage: !!s.full && size === 'desktop' })
    }
    await context.close()
  }
})
