import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run on the test server (headless) against a pve-web
// instance that proxies to the lab PVE (VMID 9900), never production.
//
//   E2E_BASE_URL   pve-web under test (default http://127.0.0.1:8080)
//   PVE_USER / PVE_PASSWORD / PVE_REALM   lab credentials, from ~/.config/pve-web/lab.env
//
// Example (from the repo root on this Mac):
//   rt -- bash -c 'set -a; . ~/.config/pve-web/lab.env; cd e2e && npx playwright test' --back e2e/playwright-report

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // tests share one lab cluster
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: 'mobile', use: { ...devices['iPhone 15'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
})
