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
// - `pve` talks to the lab through the app server (/api2/json/...) with its
//   own ticket, for setup/teardown. Writes refuse to run unless the server
//   proxies the lab node (PVE_LAB_NODE), never production.
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
  ) {}

  static async login(user = env.user, password = env.password, baseURL = env.baseURL): Promise<PveApi> {
    if (!password) throw new Error('缺少密码：先 source ~/.config/pve-web/lab.env（PVE_LAB_PASSWORD）')
    const anon = await request.newContext({ baseURL })
    const res = await anon.post('/api2/json/access/ticket', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: form({ username: user, password }),
    })
    if (!res.ok()) throw new Error(`登录 ${user} 失败：HTTP ${res.status()} ${await res.text()}`)
    const { data } = (await res.json()) as { data: { ticket: string; CSRFPreventionToken: string } }
    await anon.dispose()
    const ctx = await request.newContext({
      baseURL,
      extraHTTPHeaders: {
        Cookie: `PVEAuthCookie=${encodeURIComponent(data.ticket)}`,
        CSRFPreventionToken: data.CSRFPreventionToken,
      },
    })
    return new PveApi(ctx, env.node)
  }

  async dispose() {
    await this.ctx.dispose()
  }

  async call<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', apiPath: string, params?: Params): Promise<T> {
    if (method !== 'GET' && this.readOnly) {
      throw new Error(`手机布局的测试不写实验机：${method} ${apiPath}（写操作放到 @lab 测试里）`)
    }
    if (method !== 'GET') await this.assertLab()
    const url = `/api2/json${apiPath}`
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
      throw new PveApiError(res.status(), `${method} ${apiPath}: ${json.message ?? res.statusText()}`, json.errors)
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
    if (status !== 'stopped') {
      await this.run('POST', `${base}/status/stop`, guest.type === 'qemu' ? { skiplock: 1 } : undefined)
    }
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
/** Reuse a saved login for this long (tickets live 2 h). */
const AUTH_MAX_AGE_MS = 80 * 60 * 1000

/** Log in through the login page and save the storage state; returns its path. */
export async function uiLogin(browser: Browser, user = env.user, password = env.password): Promise<string> {
  fs.mkdirSync(AUTH_DIR, { recursive: true })
  const file = path.join(AUTH_DIR, `${user.replace(/[^\w.-]/g, '_')}.json`)
  try {
    if (Date.now() - fs.statSync(file).mtimeMs < AUTH_MAX_AGE_MS) return file
  } catch {
    // no saved state yet
  }
  if (!password) throw new Error('缺少密码：先 source ~/.config/pve-web/lab.env（PVE_LAB_PASSWORD）')
  const { username, realm } = splitUser(user)
  // Inside a test, browser.newContext() inherits the project's (logged-in)
  // storageState, and /login would redirect away: start empty explicitly.
  const context = await browser.newContext({ baseURL: env.baseURL, locale: 'zh-CN', storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  try {
    await page.goto('/login')
    await page.getByLabel('用户名').fill(username)
    await page.getByLabel('密码', { exact: true }).fill(password)
    const realmBox = page.getByRole('combobox', { name: '认证域' })
    await expect(realmBox).toBeEnabled()
    if (!(await realmBox.textContent())?.includes(`@${realm}`)) {
      await realmBox.click()
      await page.getByRole('option', { name: new RegExp(`@${realm}$`) }).click()
    }
    await page.getByRole('button', { name: '登录' }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
    // Workers log in in parallel: write, then rename, so nobody reads half a file.
    const tmp = `${file}.${process.pid}.tmp`
    await context.storageState({ path: tmp })
    fs.renameSync(tmp, file)
  } finally {
    await context.close()
  }
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
}

interface WorkerFixtures {
  pve: PveApi
  authFile: string
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  authFile: [async ({ browser }, use) => use(await uiLogin(browser)), { scope: 'worker' }],
  storageState: async ({ authFile }, use) => use(authFile),

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
