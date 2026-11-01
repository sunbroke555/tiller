import type { Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'

// Area node-updates: pending package updates (refresh, changelog, upgrade
// shell), APT repositories and installed versions — the node "更新" tab.
//
// Lab tests (@lab, desktop) need the 3-node lab cluster (lab-cluster.env) and
// write only to pvelab-c3: apt-get update, and enabling / disabling
// repositories, which the cleanup restores exactly (pve-no-subscription and
// ceph-squid no-subscription on, enterprise repositories off). The upgrade
// shell is opened and left without answering apt's prompt: nothing gets
// installed. Phone checks (@mobile) run on mocked data.

const LAB_NODE = 'pvelab-c3'
const clusterLab = (process.env.PVE_LAB_NODES ?? '').split(/[\s,]+/).includes(LAB_NODE)

const panel = (page: Page) => page.getByRole('tabpanel', { name: '更新' })

interface RepoState {
  path: string
  index: number
  enabled: boolean
}

interface ReposAnswer {
  digest: string
  files: { path: string; digest: number[]; repositories: { Enabled: number | boolean; Components?: string[] }[] }[]
  'standard-repos': { handle: string; status?: number }[]
}

async function repoStates(pve: PveApi, node: string): Promise<RepoState[]> {
  const data = await pve.get<ReposAnswer>(`/nodes/${node}/apt/repositories`)
  return data.files.flatMap((f) => f.repositories.map((r, index) => ({ path: f.path, index, enabled: !!Number(r.Enabled) })))
}

/** SHA-256 of every sources file: equal digests mean byte-identical files. */
async function fileDigests(pve: PveApi, node: string): Promise<Record<string, string>> {
  const data = await pve.get<ReposAnswer>(`/nodes/${node}/apt/repositories`)
  return Object.fromEntries(data.files.map((f) => [f.path, f.digest.join(',')]))
}

/** Put every repository back to its state in `want` (each POST rewrites only the changed file). */
async function restoreRepos(pve: PveApi, node: string, want: RepoState[]) {
  for (const now of await repoStates(pve, node)) {
    const target = want.find((w) => w.path === now.path && w.index === now.index)
    if (target && target.enabled !== now.enabled) {
      await pve.post(`/nodes/${node}/apt/repositories`, { path: now.path, index: now.index, enabled: target.enabled ? 1 : 0 })
    }
  }
}

async function standardStatus(pve: PveApi, node: string, handle: string): Promise<number | undefined> {
  const data = await pve.get<ReposAnswer>(`/nodes/${node}/apt/repositories`)
  return data['standard-repos'].find((r) => r.handle === handle)?.status
}

test.describe('node updates (lab cluster)', { tag: '@lab' }, () => {
  test.skip(!clusterLab, `需要 3 节点实验集群（lab-cluster.env，节点 ${LAB_NODE}）`)

  test('package list: groups, search, details and changelog', async ({ page, pve }) => {
    const list = await pve.get<{ Package: string; Origin: string; Version: string; Title: string }[]>(`/nodes/${LAB_NODE}/apt/update`)
    test.skip(list.length === 0, `${LAB_NODE} 没有可更新的软件包`)
    const pkg = list.find((u) => u.Origin === 'Proxmox' && u.Package === 'pve-docs') ?? list.find((u) => u.Origin === 'Proxmox') ?? list[0]!

    await page.goto(`/node/${LAB_NODE}/updates`)
    const tab = panel(page)
    await expect(tab.getByRole('radio', { name: /可更新/ })).toHaveAttribute('data-state', 'on')
    await expect(tab.getByTestId('updates-count')).toHaveText(`${list.length} 个软件包可更新`)
    const origins = [...new Set(list.map((u) => u.Origin))]
    for (const o of origins) await expect(tab.getByRole('region', { name: `来源 ${o}` })).toBeVisible()

    await tab.getByLabel('搜索软件包').fill(pkg.Package)
    const row = tab.getByRole('button', { name: new RegExp(`^${pkg.Package.replace(/[.+]/g, '\\$&')}，`) })
    await expect(row).toBeVisible()
    await expect(row).toContainText(pkg.Version)
    await tab.getByLabel('显示详细描述').click()
    await row.click()

    const dialog = page.getByRole('dialog', { name: pkg.Package })
    await expect(dialog).toContainText(pkg.Version)
    await expect(dialog.getByRole('region', { name: '变更日志' })).toContainText(`${pkg.Package} (`, { timeout: 30_000 })
    await dialog.getByRole('button', { name: '关闭' }).first().click()
    await expect(dialog).toBeHidden()
  })

  test('refresh runs apt-get update and shows its log', async ({ page }) => {
    test.setTimeout(150_000)
    await page.goto(`/node/${LAB_NODE}/updates`)
    const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/nodes/${LAB_NODE}/apt/update`))
    await panel(page).getByRole('button', { name: '刷新', exact: true }).click()
    await posted
    const log = page.getByRole('dialog', { name: `刷新软件包索引（${LAB_NODE}）` })
    await expect(log.getByTestId('task-log')).toContainText(/Hit:|Get:|Reading package lists/, { timeout: 60_000 })
    await expect(log.getByText('完成')).toBeVisible({ timeout: 120_000 })
    await log.getByRole('button', { name: '关闭' }).first().click()
    await expect(panel(page).getByRole('button', { name: '刷新', exact: true })).toBeEnabled()
    await expect(panel(page).getByTestId('updates-count')).toContainText('个软件包可更新')
  })

  // Only the enterprise repository is switched: its file carries "Enabled: false",
  // so enable + disable writes it back byte for byte. (Disabling a repository
  // without an Enabled line and enabling it again would leave "Enabled: true".)
  test('repositories: status, enable / disable, add a standard repository', async ({ page, pve, cleanup }) => {
    const before = await repoStates(pve, LAB_NODE)
    const digests = await fileDigests(pve, LAB_NODE)
    cleanup.add(async () => {
      await restoreRepos(pve, LAB_NODE, before)
      expect(await fileDigests(pve, LAB_NODE)).toEqual(digests)
    })
    const noSub = before.find((r) => r.path.endsWith('/proxmox.sources'))
    test.skip(!noSub?.enabled || (await standardStatus(pve, LAB_NODE, 'enterprise')) !== 0, '软件源不是预期的实验集群配置')

    await page.goto(`/node/${LAB_NODE}/updates?view=repositories`)
    const tab = panel(page)
    const status = tab.getByRole('region', { name: '软件源状态' })
    await expect(status).toContainText('可以获取 Proxmox VE 的更新')
    await expect(status).toContainText('不建议在生产环境使用 no-subscription 软件源！')
    await expect(status).toContainText('不建议在生产环境使用 Ceph no-subscription/main 软件源！')
    await expect(status.getByTestId('repo-state')).toHaveText('2 条警告')
    const file = tab.getByRole('region', { name: '文件 /etc/apt/sources.list.d/proxmox.sources' })
    await expect(file).toContainText('pve-no-subscription')
    await expect(file).toContainText('no-subscription 软件源不适合生产环境')
    await expect(tab.getByRole('region', { name: '文件 /etc/apt/sources.list.d/pve-enterprise.sources' })).toContainText('已禁用')

    await expect(tab.getByRole('switch', { name: '启用 http://download.proxmox.com/debian/pve pve-no-subscription' })).toBeChecked()

    // Enable the enterprise repository from its switch: "no subscription" warning; then off again.
    const entSwitch = tab.getByRole('switch', { name: '启用 https://enterprise.proxmox.com/debian/pve pve-enterprise' })
    await expect(entSwitch).not.toBeChecked()
    await entSwitch.click()
    await expect(entSwitch).toBeChecked()
    await expect(status).toContainText('已启用 enterprise 软件源，但没有有效订阅！')
    await expect(status.getByTestId('repo-state')).toHaveText('3 条警告')
    expect(await standardStatus(pve, LAB_NODE, 'enterprise')).toBe(1)
    await entSwitch.click()
    await expect(entSwitch).not.toBeChecked()
    await expect(status.getByTestId('repo-state')).toHaveText('2 条警告')
    expect(await fileDigests(pve, LAB_NODE)).toEqual(digests)

    // Add "Enterprise": already configured but disabled, so it gets enabled.
    await tab.getByRole('button', { name: '添加软件源' }).click()
    const dialog = page.getByRole('dialog', { name: '添加软件源' })
    await expect(dialog.getByRole('radio', { name: 'No-Subscription', exact: true })).toBeDisabled()
    await dialog.getByRole('radio', { name: 'Enterprise', exact: true }).click()
    await expect(dialog).toContainText('这个软件源已经配置但被禁用')
    await dialog.getByRole('button', { name: '启用' }).click()
    await expect(dialog).toBeHidden()
    await expect(status).toContainText('已启用 enterprise 软件源，但没有有效订阅！')
    expect(await standardStatus(pve, LAB_NODE, 'enterprise')).toBe(1)

    // And off again from its switch.
    await expect(entSwitch).toBeChecked()
    await entSwitch.click()
    await expect(entSwitch).not.toBeChecked()
    await expect(status).not.toContainText('enterprise 软件源')
    expect(await repoStates(pve, LAB_NODE)).toEqual(before)
    expect(await fileDigests(pve, LAB_NODE)).toEqual(digests)
  })

  test('upgrade opens the pveupgrade shell (left without installing)', async ({ page }) => {
    await page.goto(`/node/${LAB_NODE}/updates`)
    const termproxy = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/nodes/${LAB_NODE}/termproxy`))
    await panel(page).getByRole('button', { name: '升级' }).click()
    await expect(page).toHaveURL(new RegExp(`/console/${LAB_NODE}/shell\\?cmd=upgrade`))
    expect((await termproxy).postData()).toContain('cmd=upgrade')
    // pveupgrade prints this before apt-get asks [Y/n]; the test never types into the terminal.
    await expect(page.getByTestId('xterm-console').locator('.xterm-rows')).toContainText(
      /Starting system upgrade|package database is out of date/,
      { timeout: 30_000 },
    )
    // Leaving closes the socket; termproxy ends pveupgrade at apt's prompt.
    await page.getByRole('link', { name: '返回' }).first().click()
    await expect(page).toHaveURL(new RegExp(`/node/${LAB_NODE}/updates$`))
  })

  test('installed versions', async ({ page }) => {
    await page.goto(`/node/${LAB_NODE}/updates?view=versions`)
    const list = panel(page).getByRole('list', { name: '软件包版本' })
    await expect(list).toContainText('pve-manager')
    await expect(list).toContainText('proxmox-ve')
    await panel(page).getByLabel('筛选软件包').fill('qemu-server')
    await expect(list.getByRole('listitem')).toHaveCount(1)
  })
})

// ------------------------------------------------------------ phone (mocked)

const MOCK_UPDATES = [
  {
    Package: 'pve-manager',
    Title: 'Proxmox Virtual Environment Management Tools',
    Description: 'This package contains the Proxmox Virtual Environment management tools.',
    OldVersion: '9.2.2',
    Version: '9.2.24',
    Origin: 'Proxmox',
    Arch: 'all',
    Section: 'admin',
    Priority: 'optional',
  },
  {
    Package: 'proxmox-kernel-7.0',
    Title: 'Latest Proxmox Kernel Image',
    OldVersion: '7.0.2-6',
    Version: '7.0.14-26',
    Origin: 'Proxmox',
  },
  {
    Package: 'libperl5.40',
    Title: 'shared Perl library',
    OldVersion: '5.40.1-6',
    Version: '5.40.1-6+deb13u1',
    Origin: 'Debian',
  },
]

const sources = (path: string, URIs: string[], Components: string[], Enabled: number) => ({
  path,
  'file-type': 'sources',
  digest: [],
  repositories: [
    {
      Types: ['deb'],
      URIs,
      Suites: ['trixie'],
      Components,
      Options: [{ Key: 'Signed-By', Values: ['/usr/share/keyrings/proxmox-archive-keyring.gpg'] }],
      FileType: 'sources',
      Enabled,
    },
  ],
})

const MOCK_REPOS = {
  digest: 'mock-digest',
  errors: [],
  files: [
    sources('/etc/apt/sources.list.d/proxmox.sources', ['http://download.proxmox.com/debian/pve'], ['pve-no-subscription'], 1),
    sources('/etc/apt/sources.list.d/pve-enterprise.sources', ['https://enterprise.proxmox.com/debian/pve'], ['pve-enterprise'], 0),
    sources('/etc/apt/sources.list.d/ceph.sources', ['http://download.proxmox.com/debian/ceph-squid'], ['no-subscription'], 1),
  ],
  infos: [
    { path: '/etc/apt/sources.list.d/proxmox.sources', index: 0, kind: 'origin', message: 'Proxmox' },
    { path: '/etc/apt/sources.list.d/pve-enterprise.sources', index: 0, kind: 'origin', message: 'Proxmox' },
    { path: '/etc/apt/sources.list.d/ceph.sources', index: 0, kind: 'origin', message: 'Proxmox' },
  ],
  'standard-repos': [
    { handle: 'enterprise', name: 'Enterprise', status: 0 },
    { handle: 'no-subscription', name: 'No-Subscription', status: 1 },
    { handle: 'test', name: 'Test' },
    { handle: 'ceph-squid-no-subscription', name: 'Ceph Squid No-Subscription', status: 1 },
  ],
}

async function mockApt(page: Page, node: string) {
  await page.route(`**/api2/json/nodes/${node}/apt/update`, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { data: MOCK_UPDATES } }) : route.fallback(),
  )
  await page.route(`**/api2/json/nodes/${node}/apt/changelog?*`, (route) =>
    route.fulfill({ json: { data: 'pve-manager (9.2.24) trixie; urgency=medium\n\n  * mocked changelog entry\n' } }),
  )
  await page.route(`**/api2/json/nodes/${node}/apt/repositories`, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { data: MOCK_REPOS } }) : route.fallback(),
  )
  await page.route(`**/api2/json/nodes/${node}/subscription`, (route) =>
    route.fulfill({ json: { data: { status: 'notfound', message: 'There is no subscription key' } } }),
  )
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
}

test.describe('node updates on a phone', { tag: '@mobile' }, () => {
  test('package list and changelog sheet', async ({ page, pve }) => {
    await mockApt(page, pve.node)
    await page.goto(`/node/${pve.node}/updates`)
    const tab = panel(page)
    await expect(tab.getByTestId('updates-count')).toHaveText('3 个软件包可更新')
    await expect(tab.getByText('包含内核更新')).toBeVisible()
    await expect(tab.getByRole('region', { name: '来源 Proxmox' }).getByRole('listitem')).toHaveCount(2)
    await expect(tab.getByRole('region', { name: '来源 Debian' })).toBeVisible()
    // Buttons fit the phone and are big enough to tap.
    const refresh = tab.getByRole('button', { name: '刷新', exact: true })
    expect((await refresh.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await noHorizontalScroll(page)

    await tab.getByRole('button', { name: /^pve-manager，/ }).click()
    const sheet = page.getByRole('dialog', { name: 'pve-manager' })
    await expect(sheet.getByRole('region', { name: '变更日志' })).toContainText('mocked changelog entry')
    await expect(sheet).toContainText('9.2.24')
    await sheet.getByRole('button', { name: '关闭' }).first().click()
    await expect(sheet).toBeHidden()
  })

  test('repositories: status, toggle and add sheet', async ({ page, pve }) => {
    await mockApt(page, pve.node)
    const posts: string[] = []
    await page.route(`**/api2/json/nodes/${pve.node}/apt/repositories`, async (route) => {
      if (route.request().method() === 'GET') return route.fallback()
      posts.push(`${route.request().method()} ${route.request().postData() ?? ''}`)
      await route.fulfill({ json: { data: null } })
    })
    await page.goto(`/node/${pve.node}/updates?view=repositories`)
    const tab = panel(page)
    const status = tab.getByRole('region', { name: '软件源状态' })
    await expect(status.getByTestId('repo-state')).toHaveText('2 条警告')
    await expect(tab.getByTestId('repo-row')).toHaveCount(3)
    await noHorizontalScroll(page)

    await tab.getByRole('switch', { name: '启用 https://enterprise.proxmox.com/debian/pve pve-enterprise' }).click()
    await expect.poll(() => posts).toEqual([
      expect.stringMatching(/^POST path=%2Fetc%2Fapt%2Fsources\.list\.d%2Fpve-enterprise\.sources&index=0&enabled=1&digest=mock-digest$/),
    ])

    await tab.getByRole('button', { name: '添加软件源' }).click()
    const sheet = page.getByRole('dialog', { name: '添加软件源' })
    await expect(sheet.getByRole('radio', { name: 'No-Subscription', exact: true })).toBeDisabled()
    await sheet.getByRole('radio', { name: 'Test', exact: true }).click()
    await expect(sheet.getByRole('button', { name: '添加', exact: true })).toBeEnabled()
    await sheet.getByRole('button', { name: '取消' }).click()
    await expect(sheet).toBeHidden()
    expect(posts).toHaveLength(1)
  })
})
