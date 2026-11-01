import { defineConfig } from '@playwright/test'
import shared from './playwright.config'

// The guide must work without PVE or a login. Exercise the production binary,
// including its CSP, clean URLs and the app service worker, with API mocks.
const port = Number(process.env.DOCS_TEST_PORT ?? 8197)
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  ...shared,
  testDir: './docs',
  use: { ...shared.use, baseURL },
  webServer: {
    command: '../server/tiller',
    url: `${baseURL}/healthz`,
    env: { LISTEN: `127.0.0.1:${port}`, PVE_URL: 'https://127.0.0.1:1' },
    reuseExistingServer: false,
    timeout: 15_000,
  },
})
