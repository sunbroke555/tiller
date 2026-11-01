import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run headless on the test server against a Tiller
// instance that proxies to the lab PVE (VMID 9900), never production.
//
//   BASE_URL        Tiller under test (default http://127.0.0.1:8080; E2E_BASE_URL also accepted)
//   PVE_LAB_*       lab credentials, from ~/.config/pve-web/lab.env
//   E2E_WORKERS     parallel workers (default 2)
//   E2E_SCREENSHOTS =1 adds the visual specs (*.visual.spec.ts), which only take screenshots
//
// Usually through make, which starts and stops the server (from this Mac):
//   rt -- bash -lc 'set -a; . ~/.config/pve-web/lab.env; set +a; make e2e-area AREA=tasks-logs PORT=8101'
//
// Tags decide which project runs a test:
//   @lab      changes the lab (guests, config, storage, users, services) or runs
//             slow real operations: desktop project only
//   @desktop  desktop-only UI (resource tree, task footer, keyboard shortcuts)
//   @mobile   phone-only UI (bottom navigation, action dock, console key bar)
//   @smoke    the quick subset behind `make e2e-smoke`
// Everything else runs in both projects. The phone project is read-only (see
// fixtures.ts): it covers layout and interaction, with page.route() mocks
// where it needs state.
//
// Parallelism: spec files run in parallel (one worker each), tests inside a
// file in order. Areas use their own VMID ranges (3000–3999), so their lab
// fixtures never collide.

const baseURL = process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080'
const screenshots = !!process.env.E2E_SCREENSHOTS

export default defineConfig({
  testDir: './tests',
  testIgnore: screenshots ? [] : ['**/*.visual.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: Number(process.env.E2E_WORKERS ?? 2),
  // A hang fails fast; known slow tests set their own (test.setTimeout).
  timeout: screenshots ? 600_000 : 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    // Clicks wait for their target at most this long instead of the whole test timeout.
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    ignoreHTTPSErrors: true,
  },
  projects: [
    // Desktop first: its lab-heavy spec files are the long ones, so they start
    // before the quick phone checks fill the remaining worker time.
    { name: 'desktop', grepInvert: /@mobile/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // Phone layout (bottom nav, sheets). Chromium with iPhone metrics: WebKit
    // does not run on the Arch test server.
    {
      name: 'mobile',
      grepInvert: /@lab|@desktop/,
      use: { ...devices['iPhone 15'], browserName: 'chromium', defaultBrowserType: 'chromium' },
    },
  ],
})
