import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run headless on the test server against a pve-web
// instance that proxies to the lab PVE (VMID 9900), never production.
//
//   BASE_URL     pve-web under test (default http://127.0.0.1:8080; E2E_BASE_URL also accepted)
//   PVE_LAB_*    lab credentials, from ~/.config/pve-web/lab.env
//
// Usually through make, which starts and stops the server (from this Mac):
//   rt -- bash -lc 'set -a; . ~/.config/pve-web/lab.env; set +a; make e2e PORT=8101 SPEC=tests/tasks.spec.ts'
// One project only: add E2E_ARGS="--project=desktop".

const baseURL = process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080'

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
    // Phone layout (bottom nav, sheets). Chromium with iPhone metrics: WebKit
    // does not run on the Arch test server.
    { name: 'mobile', use: { ...devices['iPhone 15'], browserName: 'chromium', defaultBrowserType: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
})
