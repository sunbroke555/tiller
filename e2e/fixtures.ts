// Shared Playwright fixtures for Tiller e2e tests.
//
//   import { test, expect } from '../fixtures'
//
//   test('starts a VM', async ({ page, pve, cleanup, isMobile }) => {
//     const vmid = await pve.createTestVm({ name: 'e2e-power' })   // via the API, waits for the task
//     cleanup.guest(vmid)                                          // destroyed after the test, even on failure
//     await page.goto(`/guest/${pve.node}/qemu/${vmid}`)           // already logged in
//     …
//   })
//
// - `page` is logged in: each worker logs in through the UI once and reuses
//   the storage state (cookie + localStorage) for every test. For a logged-out
//   page use `test.use({ storageState: { cookies: [], origins: [] } })`.
// - `pve` talks to the lab through its scoped app API with a Tiller session
//   and the server-held API Token, for setup/teardown. Writes refuse to run unless the server
//   proxies the lab node (PVE_LAB_NODE), never production.
// - `rootPam` opens the lab as root@pam with its password, for what PVE
//   refuses API tokens (a node shell without `login:`, the node VNC shell).
// - Name everything a test creates "e2e-…" so `pve.sweep()` can clean up
//   leftovers of crashed runs.
// - Tags (see playwright.config.ts): tests that change the lab are tagged
//   `@lab` and run in the desktop project only. The phone project checks
//   layout and interaction and must not write: there `pve` refuses writes and
//   non-GET calls from the page fail the test (logins and console tickets
//   excepted). Mock state with page.route() instead.

import fs from 'node:fs'
import path from 'node:path'

import { execFile } from 'node:child_process'

import { test as base, expect, request, type APIRequestContext, type Browser, type Locator, type Page } from '@playwright/test'

export { expect }

export const env = {
  baseURL: process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080',
  /** user@realm used for UI login and API calls (default: lab root). */
  user: process.env.E2E_USER ?? process.env.PVE_LAB_USER ?? 'root@pam',
  password: process.env.E2E_PASSWORD ?? process.env.PVE_LAB_PASSWORD ?? '',
  /** Unprivileged lab user, for permission tests. */
  testerUser: process.env.PVE_LAB_TESTER_USER ?? 'tester@pve',
  testerPassword: process.env.PVE_LAB_TESTER_PASSWORD ?? '',
  node: process.env.PVE_LAB_NODE ?? 'pve-lab',
}

/** Nodes of the lab (PVE_LAB_NODES on the cluster, else the single PVE_LAB_NODE). */
export const labNodes = (process.env.PVE_LAB_NODES ?? env.node).split(/[\s,]+/).filter(Boolean)

/**
 * Run a shell command as root on a lab node over SSH from the test server
 * (setup the API cannot do, e.g. a directory on the host). Defaults to the
 * node the app talks to; PVE_LAB_NODE_IPS maps cluster nodes to addresses.
 */
export function labSsh(cmd: string, node = env.node): Promise<void> {
  const ips = (process.env.PVE_LAB_NODE_IPS ?? '').split(/[\s,]+/).filter(Boolean)
  const host = ips[labNodes.indexOf(node)] ?? (node === env.node ? process.env.PVE_LAB_HOST : undefined)
  if (!host) return Promise.reject(new Error(`不知道实验节点 ${node} 的地址（PVE_LAB_HOST / PVE_LAB_NODE_IPS）`))
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new', `root@${host}`, cmd]
  return new Promise((resolve, reject) => execFile('ssh', args, { timeout: 15_000 }, (err) => (err ? reject(err) : resolve())))
}

/**
 * Cross-worker lock for lab state that two spec files must not change at the
 * same time (e.g. `network`: an SDN apply reloads every node's network and
 * applies another spec's pending interface changes with it). A directory
 * under e2e/.run/locks is created atomically; a lock whose owner process is
 * gone is taken over.
 *
 *   test.beforeAll(async () => { test.setTimeout(900_000); release = await labLock('network') })
 *   test.afterAll(() => release?.())
 */
export async function labLock(name: string, timeoutMs = 900_000): Promise<() => void> {
  const dir = path.join(import.meta.dirname, '.run', 'locks', name)
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, 'pid'), String(process.pid))
      return () => fs.rmSync(dir, { recursive: true, force: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    const owner = Number(fs.readFileSync(path.join(dir, 'pid'), { encoding: 'utf8', flag: 'a+' }) || 0)
    if (owner && !isAlive(owner)) fs.rmSync(dir, { recursive: true, force: true })
    else if (Date.now() > deadline) throw new Error(`等待实验锁 ${name} 超时`)
    else await new Promise((r) => setTimeout(r, 1000))
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Pick `option` (its label) in a select field: waits until the options have
 * loaded, opens it and clicks the option. Tests that depend on a value (e.g.
 * the storage local-lvm) choose it instead of relying on the preselection,
 * which follows the lab's state (first storage by name, like the official UI).
 */
export async function chooseOption(page: Page, combobox: Locator, option: string) {
  await expect(combobox).toBeEnabled()
  await combobox.click()
  await page.getByRole('option').filter({ has: page.getByText(option, { exact: true }) }).click()
  await expect(combobox).toContainText(option)
}

export function splitUser(user: string): { username: string; realm: string } {
  const at = user.lastIndexOf('@')
  return at > 0 ? { username: user.slice(0, at), realm: user.slice(at + 1) } : { username: user, realm: 'pam' }
}

// ------------------------------------------------------------------- API

export type Params = Record<string, string | number | boolean | undefined | null>

export class PveApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors?: Record<string, string>,
  ) {
    super(message)
  }
}

export interface TaskStatus {
  status: 'running' | 'stopped'
  exitstatus?: string
  type: string
  id: string
  node: string
}

const UPID_RE = /^UPID:([^:]+):[0-9A-Fa-f]{8}:[0-9A-Fa-f]{8,9}:[0-9A-Fa-f]{8}:[^:]+:.*:[^:]+:$/

function form(params?: Params): string {
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null) continue
    out.append(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v))
  }
  return out.toString()
}

/** Direct PVE API access through the app server, for test setup/teardown. */
export class PveApi {
  private verifiedLab = false
  /** Set for the phone project: setup that writes belongs in an @lab test. */
  readOnly = false

  constructor(
    readonly ctx: APIRequestContext,
    readonly node: string,
    readonly apiBase = '/api2/json',
  ) {}

  static async login(user = env.user, password = env.password, baseURL = env.baseURL): Promise<PveApi> {
    if (user === env.user && baseURL === env.baseURL) return PveApi.forInstance(testConnection(baseURL).instance, baseURL)
    // Tests that explicitly verify a PVE user's password talk directly to the
    // lab. This is separate from Tiller's administrator authentication.
    baseURL = process.env.PVE_LAB_URL ?? ''
    if (!baseURL || new URL(baseURL).hostname === '192.168.0.6') throw new Error('Refusing non-lab authentication')
    if (!password) throw new Error('缺少密码：先 source ~/.config/pve-web/lab.env（PVE_LAB_PASSWORD）')
    const anon = await request.newContext({ baseURL, ignoreHTTPSErrors: true })
    const res = await anon.post('/api2/json/access/ticket', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: form({ username: user, password }),
    })
    if (!res.ok()) throw new Error(`登录 ${user} 失败：HTTP ${res.status()} ${await res.text()}`)
    const { data } = (await res.json()) as { data: { ticket: string; CSRFPreventionToken: string } }
    await anon.dispose()
    const ctx = await request.newContext({
      baseURL, ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        Cookie: `PVEAuthCookie=${encodeURIComponent(data.ticket)}`,
        CSRFPreventionToken: data.CSRFPreventionToken,
      },
    })
    return new PveApi(ctx, env.node)
  }

  /** The lab through one of the e2e server's instances, with the test administrator's Tiller session. */
  static async forInstance(instance: { id: string; version: string }, baseURL = env.baseURL): Promise<PveApi> {
    const connection = testConnection(baseURL)
    const anon = await request.newContext({ baseURL })
    try {
      const res = await anon.post('/api/auth/login', { data: { username: connection.username, password: connection.password } })
      if (!res.ok()) throw new Error(`Tiller test login failed: HTTP ${res.status()}`)
      const { session } = await res.json()
      const ctx = await request.newContext({ baseURL, storageState: await anon.storageState(), extraHTTPHeaders: { CSRFPreventionToken: session.csrfToken } })
      return new PveApi(ctx, env.node, `/api/instances/${instance.id}/${instance.version}/api2/json`)
    } finally { await anon.dispose() }
  }

  async dispose() {
    await this.ctx.dispose()
  }

  async call<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', apiPath: string, params?: Params): Promise<T> {
    if (method !== 'GET' && this.readOnly) {
      throw new Error(`手机布局的测试不写实验机：${method} ${apiPath}（写操作放到 @lab 测试里）`)
    }
    if (method !== 'GET') await this.assertLab()
    const url = `${this.apiBase}${apiPath}`
    const body = form(params)
    const res =
      method === 'GET' || method === 'DELETE'
        ? await this.ctx.fetch(body ? `${url}?${body}` : url, { method })
        : await this.ctx.fetch(url, {
            method,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            data: body,
          })
    const text = await res.text()
    const json = text ? (JSON.parse(text) as { data?: T; message?: string; errors?: Record<string, string> }) : {}
    if (!res.ok()) {
      // PVE names the offending parameters in `errors` ("Parameter verification failed.").
      const detail = json.errors ? ` ${JSON.stringify(json.errors)}` : ''
      throw new PveApiError(res.status(), `${method} ${apiPath}: ${json.message ?? res.statusText()}${detail}`, json.errors)
    }
    return json.data as T
  }

  get<T>(apiPath: string, params?: Params) {
    return this.call<T>('GET', apiPath, params)
  }
  post<T = unknown>(apiPath: string, params?: Params) {
    return this.call<T>('POST', apiPath, params)
  }
  put<T = unknown>(apiPath: string, params?: Params) {
    return this.call<T>('PUT', apiPath, params)
  }
  del<T = unknown>(apiPath: string, params?: Params) {
    return this.call<T>('DELETE', apiPath, params)
  }

  /** Refuse writes unless the app server proxies the lab (its node list contains PVE_LAB_NODE only). */
  private async assertLab() {
    if (this.verifiedLab) return
    const nodes = await this.get<{ node: string }[]>('/nodes')
    if (!nodes.some((n) => n.node === env.node) || nodes.some((n) => n.node === 'pve')) {
      throw new Error(`拒绝写操作：服务器节点 ${nodes.map((n) => n.node).join(',')} 不是实验机 ${env.node}`)
    }
    this.verifiedLab = true
  }

  /** Wait for a task; throws with the exit status unless it ended OK (or with warnings if allowed). */
  async waitTask(upid: string, { timeout = 120_000, allowWarnings = true } = {}): Promise<TaskStatus> {
    const node = UPID_RE.exec(upid)?.[1] ?? this.node
    const deadline = Date.now() + timeout
    for (;;) {
      const st = await this.get<TaskStatus>(`/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`)
      if (st.status === 'stopped') {
        const ok = st.exitstatus === 'OK' || (allowWarnings && /^WARNINGS/.test(st.exitstatus ?? ''))
        if (!ok) throw new Error(`任务 ${st.type} ${st.id} 失败：${st.exitstatus}`)
        return st
      }
      if (Date.now() > deadline) throw new Error(`任务超时：${upid}`)
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  /** POST/PUT/DELETE and, when it returns a UPID, wait for the task. */
  async run(method: 'POST' | 'PUT' | 'DELETE', apiPath: string, params?: Params, timeout?: number): Promise<unknown> {
    const result = await this.call<unknown>(method, apiPath, params)
    if (typeof result === 'string' && UPID_RE.test(result)) return this.waitTask(result, { timeout })
    return result
  }

  async nextId(): Promise<number> {
    return Number(await this.get<string>('/cluster/nextid'))
  }

  async guests(): Promise<
    { vmid: number; node: string; type: 'qemu' | 'lxc'; name?: string; status: string; template?: number; pool?: string; tags?: string }[]
  > {
    return this.get('/cluster/resources', { type: 'vm' })
  }

  /**
   * Small diskless VM (no OS) for UI tests; returns its VMID once the task
   * finished and /cluster/resources lists it by name (so pages show it).
   */
  async createTestVm(opts: { name?: string; vmid?: number; params?: Params } = {}): Promise<number> {
    const vmid = opts.vmid ?? (await this.nextId())
    const name = opts.name ?? `e2e-vm-${vmid}`
    await this.run('POST', `/nodes/${this.node}/qemu`, {
      vmid,
      name,
      memory: 64,
      cores: 1,
      ostype: 'other',
      net0: 'virtio,bridge=vmbr0',
      ...opts.params,
    })
    // VMIDs are reused: wait for this name, not a stale entry of a deleted guest.
    await this.waitForGuest(vmid, (g) => g.name === name)
    return vmid
  }

  /**
   * Wait until /cluster/resources lists the guest with `match` (it lags a few
   * seconds behind creation, renames and power changes). Returns the entry.
   */
  async waitForGuest(
    vmid: number,
    match: (g: Awaited<ReturnType<PveApi['guests']>>[number]) => boolean = (g) => !!g.name,
    timeout = 30_000,
  ) {
    const deadline = Date.now() + timeout
    for (;;) {
      const g = (await this.guests()).find((x) => x.vmid === vmid)
      if (g && match(g)) return g
      if (Date.now() > deadline) throw new Error(`等待客户机 ${vmid} 超时`)
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  /** Stop (if running) and destroy a guest with its disks. Missing guests are ignored. */
  async destroyGuest(vmid: number): Promise<void> {
    const guest = (await this.guests()).find((g) => g.vmid === vmid)
    if (!guest) return
    const base = `/nodes/${guest.node}/${guest.type}/${vmid}`
    // /cluster/resources lags behind; ask the node for the live state.
    const { status } = await this.get<{ status: string }>(`${base}/status/current`)
    // No skiplock: the e2e server talks to PVE with a root@pam API token, and
    // PVE allows skiplock only for root@pam itself ("Only root may use this option.").
    if (status !== 'stopped') await this.run('POST', `${base}/status/stop`)
    await this.run('DELETE', base, { purge: 1, 'destroy-unreferenced-disks': 1 })
  }

  /** Destroy every guest named e2e-* (leftovers of crashed runs). */
  async sweep(prefix = 'e2e-'): Promise<number[]> {
    const victims = (await this.guests()).filter((g) => g.name?.startsWith(prefix) && g.template !== 1)
    for (const g of victims) await this.destroyGuest(g.vmid)
    return victims.map((g) => g.vmid)
  }
}

// ------------------------------------------------------------- UI login

const AUTH_DIR = path.join(import.meta.dirname, '.auth')
export function testConnection(baseURL = env.baseURL): { username: string; password: string; instance: { id: string; version: string } } {
  const file = process.env.TILLER_E2E_CONNECTION_FILE ?? path.join(import.meta.dirname, '.run', `server-${new URL(baseURL).port}.connection.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** Path prefix of the lab instance's app routes: /i/<instance id>/<version>. */
export function instanceBase(): string {
  const { instance } = testConnection()
  return `/i/${instance.id}/${instance.version}`
}

const isRootRoute = (route: string) => route === '/' || /^\/[?#]/.test(route)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * An app route as links show it (`href`): under the lab instance's prefix,
 * the root route being the bare prefix, like React Router's basename
 * (`/` → /i/<id>/<ver>, `/?node=c1` → /i/<id>/<ver>?node=c1).
 *
 *   await expect(link).toHaveAttribute('href', appPath('/datacenter/ceph'))
 */
export function appPath(route: string): string {
  return instanceBase() + (isRootRoute(route) ? route.slice(1) : route)
}

/**
 * toHaveURL() pattern for exactly this app route (path and query). The root
 * route matches with or without a trailing slash: in-app navigation drops it,
 * page.goto('/') keeps it.
 *
 *   await expect(page).toHaveURL(appUrl(`/?node=${pve.node}`))
 */
export function appUrl(route: string): RegExp {
  const body = isRootRoute(route) ? `${escapeRe(instanceBase())}/?${escapeRe(route.slice(1))}` : escapeRe(appPath(route))
  return new RegExp(`^[a-z]+://[^/]+${body}$`)
}

/**
 * Let the page believe the lab instance signs in as root@pam with a password.
 * The e2e server connects with a root@pam API token, which PVE (and so the
 * app) does not treat as root@pam: root-only UI such as the Ceph install shell
 * stays hidden. Only for mocked tests whose root-only requests are intercepted.
 */
export async function mockRootPamInstance(page: Page) {
  const { instance } = testConnection()
  await page.route('**/api2/tiller/instances', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const response = await route.fetch()
    const catalog = (await response.json()) as { instances: { id: string; version: string }[] }
    catalog.instances = catalog.instances.map((i) =>
      i.id === instance.id && i.version === instance.version
        ? { ...i, authMode: 'password', username: 'root', realm: 'pam', tokenId: undefined }
        : i,
    )
    return route.fulfill({ response, json: catalog })
  })
}

/** A Tiller instance of the e2e server, addressed by its app routes. */
export interface LabInstance {
  id: string
  version: string
  /** App route under this instance's prefix (`/console/n/shell` → /i/<id>/<ver>/console/n/shell). */
  path(route: string): string
}

export interface RootPamLab {
  instance: LabInstance
  /** The lab API as root@pam (through the instance), for setup PVE refuses tokens. */
  pve: PveApi
  /** Remove the instance again. */
  dispose(): Promise<void>
}

/**
 * Add a second instance of the lab to the e2e server that signs in as root@pam
 * with the lab password (PVE_LAB_PASSWORD), for what PVE grants root@pam only
 * and never to an API token, not even root@pam's: a node shell without a
 * `login:` prompt, the node VNC / SPICE shell, wiping a disk. Tests use the
 * `rootPam` fixture; beforeAll / afterAll call this and dispose() it. Only
 * Tiller's instance list changes; PVE is not touched.
 */
export async function rootPamLab(): Promise<RootPamLab> {
  const { instance, remove } = await addRootPasswordInstance()
  try {
    const pve = await PveApi.forInstance(instance)
    return { instance, pve, dispose: async () => { await pve.dispose(); await remove() } }
  } catch (error) {
    await remove()
    throw error
  }
}

// Plain fetch, not Playwright's request API: traces must not record the password.
async function addRootPasswordInstance(): Promise<{ instance: LabInstance; remove: () => Promise<void> }> {
  const labURL = process.env.PVE_LAB_URL ?? ''
  if (!labURL || new URL(labURL).hostname === '192.168.0.6') throw new Error('拒绝连接非实验机（PVE_LAB_URL）')
  if (!process.env.PVE_LAB_PASSWORD) throw new Error('缺少密码：先 source ~/.config/pve-web/lab.env（PVE_LAB_PASSWORD）')
  const admin = testConnection()
  const login = await fetch(env.baseURL + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: admin.username, password: admin.password }),
  })
  if (!login.ok) throw new Error(`Tiller test login failed: HTTP ${login.status}`)
  const { session } = (await login.json()) as { session: { csrfToken: string } }
  const headers = {
    Cookie: login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '),
    CSRFPreventionToken: session.csrfToken,
    'Content-Type': 'application/json',
  }
  const created = await fetch(env.baseURL + '/api2/tiller/instances', {
    method: 'POST', headers,
    body: JSON.stringify({
      name: 'E2E Lab root@pam', url: labURL, fingerprint: process.env.PVE_LAB_FINGERPRINT,
      authMode: 'password', username: 'root', realm: 'pam', password: process.env.PVE_LAB_PASSWORD,
    }),
  })
  if (created.status !== 201) throw new Error(`添加 root@pam 密码实例失败：HTTP ${created.status} ${((await created.json()) as { message?: string }).message ?? ''}`)
  const { id, version } = (await created.json()) as { id: string; version: string }
  const base = `/i/${id}/${version}`
  return {
    instance: { id, version, path: (route) => base + (isRootRoute(route) ? route.slice(1) : route) },
    remove: async () => {
      const res = await fetch(`${env.baseURL}/api2/tiller/instances/${id}`, { method: 'DELETE', headers })
      if (!res.ok && res.status !== 404) throw new Error(`删除 root@pam 密码实例失败：HTTP ${res.status}`)
    },
  }
}

/**
 * Open the command palette (desktop: Ctrl+K, phone: the search button) and
 * return its input. The shell, and with it the shortcut, mounts only after the
 * session and the instance list have loaded, so a key press right after
 * page.goto() can go nowhere: retry until the palette is open.
 */
export async function openPalette(page: Page, mobile = false): Promise<Locator> {
  const input = page.getByRole('dialog').getByPlaceholder('搜索资源、页面或操作…')
  await expect(async () => {
    if (!(await input.isVisible())) {
      if (mobile) await page.getByRole('button', { name: '搜索', exact: true }).first().click({ timeout: 2_000 })
      else await page.keyboard.press('Control+K')
    }
    await expect(input).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  return input
}

/** Log in through Tiller's UI; each worker gets an independent session. */
export async function uiLogin(browser: Browser): Promise<string> {
  fs.mkdirSync(AUTH_DIR, { recursive: true })
  const { username, password } = testConnection()
  const file = path.join(AUTH_DIR, `${new URL(env.baseURL).port}-${process.pid}.json`)
  const context = await browser.newContext({ baseURL: env.baseURL, locale: 'zh-CN', storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  try {
    await page.goto('/login')
    await page.getByLabel('用户名', { exact: true }).fill(username)
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible()
    await context.storageState({ path: file })
    fs.chmodSync(file, 0o600)
  } finally { await context.close() }
  return file
}

// -------------------------------------------------------------- fixtures

interface Cleanup {
  /** Run after the test (reverse order), even when it failed. */
  add(fn: () => Promise<unknown>): void
  /** Destroy this guest after the test. */
  guest(vmid: number): void
}

interface TestFixtures {
  cleanup: Cleanup
  /** The current project is the phone layout (iPhone viewport, touch). */
  mobile: boolean
  /** Phone project: fails the test when the page sent a write to the lab. */
  readOnlyGuard: void
  /**
   * The lab as a second instance signing in as root@pam with its password
   * (the e2e server's own instance uses an API token). Added for this test
   * only and removed afterwards; open its routes with `rootPam.path(…)`.
   */
  rootPam: LabInstance
}

interface WorkerFixtures {
  pve: PveApi
  authFile: string
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  authFile: [async ({ browser }, use) => use(await uiLogin(browser)), { scope: 'worker' }],
  storageState: async ({ authFile }, use) => use(authFile),
  // Existing feature specs address routes relative to the lab instance.
  // Global authentication/aggregation specs import Playwright directly.
  page: async ({ page }, use) => {
    const { instance } = testConnection()
    const goto = page.goto.bind(page)
    page.goto = (url, options) => goto(url.startsWith('/') && !/^\/(login|docs|api|i)(\/|$)/.test(url)
      ? `/i/${instance.id}/${instance.version}${url}` : url, options)
    await use(page)
  },

  pve: [
    async ({}, use, workerInfo) => {
      const api = await PveApi.login()
      api.readOnly = workerInfo.project.name === 'mobile' && !process.env.E2E_SCREENSHOTS
      await use(api)
      await api.dispose()
    },
    { scope: 'worker' },
  ],

  cleanup: async ({ pve }, use) => {
    const tasks: (() => Promise<unknown>)[] = []
    await use({
      add: (fn) => tasks.push(fn),
      guest: (vmid) => tasks.push(() => pve.destroyGuest(vmid)),
    })
    const errors: unknown[] = []
    for (const fn of tasks.reverse()) {
      try {
        await fn()
      } catch (e) {
        errors.push(e)
      }
    }
    if (errors.length) throw new Error(`清理失败：${errors.map(String).join('; ')}`)
  },

  mobile: async ({}, use, testInfo) => use(testInfo.project.name === 'mobile'),

  rootPam: async ({}, use) => {
    const lab = await rootPamLab()
    try {
      await use(lab.instance)
    } finally {
      await lab.dispose()
    }
  },

  readOnlyGuard: [
    async ({ page, mobile }, use) => {
      if (!mobile || process.env.E2E_SCREENSHOTS) return use()
      const writes: string[] = []
      // Registered first, so a test's own page.route() mocks take precedence.
      await page.route('**/api2/**', (route) => {
        const req = route.request()
        const path = new URL(req.url()).pathname
        if (req.method() === 'GET' || READ_ONLY_POSTS.test(path)) return route.fallback()
        writes.push(`${req.method()} ${path}`)
        return route.fulfill({ status: 403, json: { data: null, message: 'e2e：手机布局的测试不写实验机' } })
      })
      await use()
      expect(writes, '手机布局的测试向实验机发了写请求（写操作放到 @lab 测试里，或用 page.route() 模拟）').toEqual([])
    },
    { auto: true },
  ],
})

/** POSTs that change nothing: logging in and console tickets. */
const READ_ONLY_POSTS = /\/api2\/json\/(access\/ticket|nodes\/[^/]+\/((qemu|lxc)\/\d+\/)?(vncproxy|termproxy|spiceproxy))$/
