import { execFile } from 'node:child_process'

import type { Page, Route } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'

// Storage configuration (area storage-config, /datacenter/storage).
//
// @lab (desktop): a real directory storage e2e-sc-dir under /var/lib/e2e-sc-dir
// is added, edited, disabled/enabled and removed through the UI. Network types
// (NFS, PBS) are submitted against page.route() mocks — the lab has no such
// servers — and checked by the parameters the page sends. Never touches
// `local` or `local-lvm` (only opens their editor and cancels).
// Run: rt -- scripts/with-lab-env.sh make e2e-area AREA=storage-config PORT=8206

const PREFIX = 'e2e-sc-'
const DIR_ID = 'e2e-sc-dir'

interface StorageDef {
  storage: string
  type: string
  content?: string
  nodes?: string
  shared?: number
  disable?: number
  'prune-backups'?: string
}

/** Remove e2e-sc-* storages and their directories on the lab (leftovers of crashed runs too). */
async function sweep(pve: PveApi) {
  const list = await pve.get<StorageDef[]>('/storage')
  for (const s of list.filter((x) => x.storage.startsWith(PREFIX))) await pve.del(`/storage/${s.storage}`)
  await new Promise<void>((resolve) => {
    // Best effort: the test server reaches the lab as `ssh pvelab`.
    execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 'pvelab', 'rm -rf /var/lib/e2e-sc-*'], { timeout: 15_000 }, () => resolve())
  })
}

const getDef = (pve: PveApi, id: string) => pve.get<StorageDef>(`/storage/${id}`).catch(() => null)

/** The add flow: 添加存储 → type → the form dialog. */
async function openAdd(page: Page, typeLabel: string) {
  await page.getByRole('button', { name: '添加存储' }).first().click()
  const picker = page.getByRole('dialog', { name: '添加存储' })
  await picker.getByRole('button', { name: new RegExp(`^${typeLabel.replace(/[()]/g, '\\$&')}\\s`) }).click()
  const dialog = page.getByRole('dialog', { name: `添加${typeLabel}存储` })
  await expect(dialog.getByRole('textbox', { name: 'ID', exact: true })).toBeVisible()
  return dialog
}

/** Capture POST /storage and answer it without touching the lab. */
async function mockCreate(page: Page, reply: (params: URLSearchParams) => unknown) {
  const posted: URLSearchParams[] = []
  await page.route('**/api2/json/storage', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const params = new URLSearchParams(route.request().postData() ?? '')
    posted.push(params)
    await route.fulfill({ json: { data: reply(params) } })
  })
  return posted
}

test.describe('存储配置', () => {
  test('目录存储：添加、编辑、禁用/启用、浏览链接、删除', { tag: '@lab' }, async ({ page, pve, cleanup }) => {
    test.setTimeout(120_000)
    await sweep(pve)
    cleanup.add(() => sweep(pve))
    await page.goto('/datacenter/storage')
    await expect(page.locator('li[data-storage="local"]')).toBeVisible()

    // Add.
    const add = await openAdd(page, '目录')
    await add.getByRole('textbox', { name: 'ID', exact: true }).fill(DIR_ID)
    await add.getByRole('textbox', { name: '目录', exact: true }).fill(`/var/lib/${DIR_ID}`)
    await add.getByRole('checkbox', { name: 'ISO 镜像' }).click()
    await add.getByRole('checkbox', { name: '备份' }).click()
    await add.getByRole('button', { name: /^备份保留/ }).click()
    await add.getByRole('switch', { name: '保留全部备份' }).click()
    await add.getByLabel('保留最近').fill('3')
    await add.getByRole('button', { name: '添加', exact: true }).click()
    await expect(add).toBeHidden()

    const row = page.locator(`li[data-storage="${DIR_ID}"]`)
    await expect(row).toContainText('保留：最近 3')
    let def = await getDef(pve, DIR_ID)
    expect(def).toMatchObject({ type: 'dir', 'prune-backups': 'keep-last=3' })
    expect(def!.content!.split(',').sort()).toEqual(['backup', 'images', 'iso'])

    // Edit: shared + node restriction.
    await page.getByRole('button', { name: `编辑 ${DIR_ID}` }).click()
    const edit = page.getByRole('dialog', { name: `编辑存储 ${DIR_ID}` })
    await expect(edit.getByText(`/var/lib/${DIR_ID}`)).toBeVisible() // fixed path, read-only
    await edit.getByRole('switch', { name: '共享' }).click()
    await edit.getByRole('checkbox', { name: pve.node }).click()
    await edit.getByRole('button', { name: '保存', exact: true }).click()
    await expect(edit).toBeHidden()
    await expect.poll(async () => (await getDef(pve, DIR_ID))?.nodes).toBe(pve.node)
    def = await getDef(pve, DIR_ID)
    expect(def?.shared).toBe(1)
    await expect(row).toContainText('共享')

    // Browse link to the per-node storage page.
    await expect(row.getByRole('link', { name: `浏览 ${DIR_ID} 的内容` })).toHaveAttribute(
      'href',
      `/storage/${pve.node}/${DIR_ID}`,
      { timeout: 30_000 },
    )

    // Disable (confirm), then enable.
    await row.getByRole('button', { name: `${DIR_ID} 的操作` }).click()
    await page.getByRole('menuitem', { name: '禁用' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '禁用' }).click()
    await expect(row).toContainText('已禁用')
    expect((await getDef(pve, DIR_ID))?.disable).toBe(1)
    await row.getByRole('button', { name: `${DIR_ID} 的操作` }).click()
    await page.getByRole('menuitem', { name: '启用' }).click()
    await expect(row).not.toContainText('已禁用')
    expect((await getDef(pve, DIR_ID))?.disable).toBeUndefined()

    // Remove: type the ID.
    await row.getByRole('button', { name: `${DIR_ID} 的操作` }).click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByRole('button', { name: '删除' })).toBeDisabled()
    await confirm.getByRole('textbox').fill(DIR_ID)
    await confirm.getByRole('button', { name: '删除' }).click()
    await expect(row).toBeHidden()
    expect(await getDef(pve, DIR_ID)).toBeNull()
  })

  test('local 的编辑：固定参数只读、不能限制节点；LVM-Thin 扫描卷组和精简池', { tag: '@desktop' }, async ({ page, pve }) => {
    await page.goto('/datacenter/storage')
    await page.getByRole('button', { name: '编辑 local', exact: true }).click()
    const edit = page.getByRole('dialog', { name: '编辑存储 local' })
    await expect(edit.getByText('/var/lib/vz')).toBeVisible()
    await expect(edit.getByRole('textbox', { name: 'ID', exact: true })).toHaveCount(0)
    await expect(edit.getByRole('checkbox', { name: pve.node })).toBeDisabled()
    await edit.getByRole('button', { name: '取消' }).click()
    await expect(edit).toBeHidden()

    // Real scans (GET only): VG "pve" holds the thin pool "data".
    const add = await openAdd(page, 'LVM-Thin')
    await add.getByRole('combobox').first().click()
    await page.getByRole('option', { name: /^pve/ }).click()
    await add.getByRole('combobox').nth(1).click()
    await expect(page.getByRole('option', { name: /^data/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await add.getByRole('button', { name: '取消' }).click()
  })

  test('NFS：扫描导出目录，提交的参数（模拟）', { tag: '@desktop' }, async ({ page }) => {
    await page.route('**/api2/json/nodes/*/scan/nfs?*', (route) =>
      route.fulfill({ json: { data: [{ path: '/export/pve', options: '10.0.0.0/24' }, { path: '/export/iso', options: '*' }] } }),
    )
    const posted = await mockCreate(page, (p) => ({ storage: p.get('storage'), type: 'nfs' }))
    await page.goto('/datacenter/storage')
    const add = await openAdd(page, 'NFS')
    await add.getByRole('textbox', { name: 'ID', exact: true }).fill('e2e-sc-nfs')
    await add.getByRole('button', { name: '添加', exact: true }).click()
    await expect(add.getByText('请填写服务器')).toBeVisible() // client-side validation
    await add.getByLabel('服务器').fill('10.9.9.9')
    await add.getByRole('button', { name: '扫描' }).click()
    await add.getByRole('button', { name: /\/export\/pve/ }).click()
    await expect(add.getByLabel('导出路径')).toHaveValue('/export/pve')
    await add.getByRole('button', { name: /高级选项/ }).click()
    await add.getByRole('combobox').filter({ hasText: '默认' }).last().click()
    await page.getByRole('option', { name: '4.2' }).click()
    await add.getByRole('button', { name: '添加', exact: true }).click()
    await expect(add).toBeHidden()
    expect(posted).toHaveLength(1)
    expect(Object.fromEntries(posted[0]!)).toEqual({
      storage: 'e2e-sc-nfs',
      type: 'nfs',
      server: '10.9.9.9',
      export: '/export/pve',
      content: 'images',
      options: 'vers=4.2',
      'prune-backups': 'keep-all=1',
    })
  })

  test('PBS：扫描数据存储、自动生成密钥并提示保存（模拟）', async ({ page }) => {
    const key = JSON.stringify({ kdf: null, created: '2026-11-01T00:00:00Z', data: 'c2VjcmV0', fingerprint: 'aa:bb:cc:dd:ee:ff:00:11' })
    await page.route('**/api2/json/nodes/*/scan/pbs?*', (route) =>
      route.fulfill({ json: { data: [{ store: 'store1', comment: '主存储' }] } }),
    )
    const posted = await mockCreate(page, (p) => ({ storage: p.get('storage'), type: 'pbs', config: { 'encryption-key': key } }))
    await page.goto('/datacenter/storage')
    const add = await openAdd(page, 'Proxmox Backup Server')
    await add.getByRole('textbox', { name: 'ID', exact: true }).fill('e2e-sc-pbs')
    await add.getByLabel('服务器').fill('10.9.9.8:8008')
    await add.getByLabel('用户名').fill('backup@pbs')
    await add.getByLabel('密码').fill('secret')
    await add.getByRole('button', { name: '扫描' }).click()
    await add.getByRole('button', { name: /store1/ }).click()
    await add.getByRole('radio', { name: '自动生成客户端加密密钥' }).click()
    await add.getByRole('button', { name: '添加', exact: true }).click()

    const keyDialog = page.getByRole('dialog', { name: '请保存加密密钥' })
    await expect(keyDialog).toBeVisible()
    await expect(keyDialog.getByRole('textbox', { name: '加密密钥' })).toHaveValue(/c2VjcmV0/)
    expect(Object.fromEntries(posted[0]!)).toMatchObject({
      type: 'pbs',
      server: '10.9.9.8',
      port: '8008',
      username: 'backup@pbs',
      password: 'secret',
      datastore: 'store1',
      content: 'backup',
      'encryption-key': 'autogen',
    })
    await keyDialog.getByRole('button', { name: '我已保存' }).click()
    await expect(keyDialog).toBeHidden()
  })

  test('只读用户：没有添加和修改入口，只能浏览', { tag: '@desktop' }, async ({ page }) => {
    await page.route('**/api2/json/access/permissions*', (route) =>
      route.fulfill({ json: { data: { '/': { 'Datastore.Audit': 1, 'Sys.Audit': 1 }, '/storage': { 'Datastore.Audit': 1 } } } }),
    )
    await page.goto('/datacenter/storage')
    const row = page.locator('li[data-storage="local"]')
    await expect(row).toBeVisible()
    await expect(page.getByRole('button', { name: '添加存储' })).toHaveCount(0)
    await expect(row.getByRole('button', { name: '编辑 local' })).toHaveCount(0)
    await expect(row.getByRole('link', { name: '浏览 local 的内容' })).toBeVisible()
  })

  test('手机布局：列表、类型选择和表单在底部抽屉里', { tag: '@mobile' }, async ({ page }) => {
    await page.route('**/api2/json/storage', (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        json: {
          data: [
            { storage: 'local', type: 'dir', path: '/var/lib/vz', content: 'iso,vztmpl,backup', 'prune-backups': 'keep-all=1', digest: 'x' },
            { storage: 'local-lvm', type: 'lvmthin', vgname: 'pve', thinpool: 'data', content: 'images,rootdir', digest: 'x' },
            { storage: 'nas-long-name-for-backups', type: 'nfs', server: '192.168.100.200', export: '/volume1/very/long/export/path/for/pve', content: 'backup,iso,vztmpl,snippets,import', shared: 1, 'prune-backups': 'keep-last=3,keep-daily=7,keep-weekly=4', digest: 'x' },
            { storage: 'pbs', type: 'pbs', server: 'pbs.lan', datastore: 'store1', content: 'backup', disable: 1, digest: 'x' },
          ],
        },
      })
    })
    await page.goto('/datacenter/storage')
    await expect(page.locator('li[data-storage="nas-long-name-for-backups"]')).toContainText('共享')
    await expect(page.locator('li[data-storage="pbs"]')).toContainText('已禁用')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    const add = await openAdd(page, 'SMB/CIFS')
    // Bottom sheet: the dialog spans the viewport width.
    const box = await add.boundingBox()
    expect(box!.width).toBeGreaterThan(380)
    await expect(add.getByRole('button', { name: '扫描' })).toBeDisabled() // needs a server first
    await add.getByRole('button', { name: '取消' }).click()
    await expect(add).toBeHidden()
  })
})
