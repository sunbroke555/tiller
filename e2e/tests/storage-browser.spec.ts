import crypto from 'node:crypto'

import type { Page } from '@playwright/test'

import { env, expect, test, type PveApi } from '../fixtures'

// Storage browser (area storage-browser) against the lab: storage list,
// summary, upload / URL download / templates / OCI pull, backups (notes,
// protection, prune, restore), VM disks and disk-image import.
//
// Writes only touch objects of this area: guests 3800–3899 named
// e2e-storage-browser-*, files named e2e-sb-*, and backups of those guests.
// Run: rt -- bash -lc 'set -a; . ~/.config/pve-web/lab.env; set +a; make e2e PORT=8110 SPEC=tests/storage-browser.spec.ts'

const PREFIX = 'e2e-storage-browser'
const VMID_MIN = 3800
const VMID_MAX = 3899
/** Host the lab can reach this app server on (URL download test). */
const LAN_HOST = process.env.E2E_LAN_HOST ?? '192.168.0.32'

interface Volume {
  volid: string
  vmid?: number | string
  protected?: number
  content: string
}

/** Per project VMIDs so the mobile and desktop runs never share fixtures. */
function ids(mobile: boolean) {
  const base = mobile ? VMID_MIN : VMID_MIN + 20
  return { source: base, restored: base + 1, imported: base + 5, orphan: base + 9 }
}

const tag = (mobile: boolean) => `${mobile ? 'm' : 'd'}${Date.now().toString(36).slice(-5)}`

async function deleteVolume(pve: PveApi, storage: string, volid: string) {
  try {
    await pve.run('DELETE', `/nodes/${pve.node}/storage/${storage}/content/${encodeURIComponent(volid)}`)
  } catch (e) {
    if (!/does not exist|no such|not found|No such/i.test(String(e))) throw e
  }
}

/** Remove leftovers of this area: guests, e2e-sb-* files, backups and disks of 3800–3899. */
async function sweepArea(pve: PveApi) {
  for (const g of await pve.guests()) {
    if (g.vmid >= VMID_MIN && g.vmid <= VMID_MAX && g.name?.startsWith(PREFIX)) await pve.destroyGuest(g.vmid)
  }
  const mine = (v: Volume) => {
    const vmid = Number(v.vmid)
    return /:(iso|vztmpl|import)\/e2e-sb-/.test(v.volid) || (vmid >= VMID_MIN && vmid <= VMID_MAX)
  }
  const guests = new Set((await pve.guests()).map((g) => g.vmid))
  for (const storage of ['local', 'local-lvm']) {
    const list = await pve.get<Volume[]>(`/nodes/${pve.node}/storage/${storage}/content`)
    for (const v of list.filter(mine)) {
      if ((v.content === 'images' || v.content === 'rootdir') && guests.has(Number(v.vmid))) continue
      if (v.protected) {
        await pve.put(`/nodes/${pve.node}/storage/${storage}/content/${encodeURIComponent(v.volid)}`, { protected: 0 })
      }
      await deleteVolume(pve, storage, v.volid)
    }
  }
}

/** Run a page action: desktop header buttons / "更多操作", phone action dock / "更多". */
async function pageAction(page: Page, mobile: boolean, name: string) {
  const bar = mobile ? page.getByRole('toolbar', { name: '操作' }) : page.locator('main header').first()
  await expect(bar.getByRole('button').first()).toBeVisible()
  const direct = bar.getByRole('button', { name, exact: true })
  if (await direct.count()) {
    await direct.click()
    return
  }
  await bar.getByRole('button', { name: mobile ? '更多' : '更多操作' }).click()
  await page.getByRole('menuitem', { name }).click()
}

const row = (page: Page, name: string) => page.getByRole('button', { name: `${name} 详情` })

async function rowAction(page: Page, name: string, action: string) {
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.getByRole('button', { name: `${name} 的操作` }).click()
  await page.getByRole('menuitem', { name: action }).click()
}

test.beforeAll(async ({ pve }) => {
  await sweepArea(pve)
})

test.describe('storage list and summary', () => {
  test('lists storages with type, content and usage, filters by content', async ({ page, pve }) => {
    await page.goto('/storage')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('存储')
    const local = page.getByRole('link', { name: '存储 local', exact: true })
    const lvm = page.getByRole('link', { name: '存储 local-lvm', exact: true })
    await expect(local).toContainText('目录')
    await expect(local).toContainText('ISO 镜像')
    await expect(lvm).toContainText('LVM-Thin')
    await expect(local.getByRole('meter')).toBeVisible()

    await page.getByRole('radio', { name: '备份' }).click()
    await expect(page).toHaveURL(/content=backup/)
    await expect(lvm).toHaveCount(0)
    await expect(local).toBeVisible()

    await local.click()
    await expect(page).toHaveURL(new RegExp(`/storage/${pve.node}/local$`))
    const summary = page.getByRole('tabpanel', { name: '概要' })
    await expect(summary).toContainText('已用空间')
    await expect(summary).toContainText('/var/lib/vz')
    await expect(summary).toContainText('已激活')
    await summary.getByRole('radio', { name: '周' }).click()
    await expect(summary.getByRole('img', { name: /用量趋势/ })).toBeVisible()
    // Content cards link to the tabs.
    await summary.getByRole('link', { name: /ISO 镜像/ }).click()
    await expect(page).toHaveURL(new RegExp(`/storage/${pve.node}/local/iso$`))
  })

  test('bottom navigation lands on the storage list', async ({ page, mobile }) => {
    test.skip(!mobile, '只有手机布局有底部导航')
    await page.goto('/')
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '存储' }).click()
    await expect(page).toHaveURL(/\/storage$/)
    await expect(page.getByRole('link', { name: '存储 local', exact: true })).toBeVisible()
  })
})

test.describe('adding content', () => {
  test('uploads an ISO with a checksum and deletes it after typing its name', async ({ page, pve, mobile, cleanup }) => {
    const name = `e2e-sb-${tag(mobile)}.iso`
    cleanup.add(() => deleteVolume(pve, 'local', `local:iso/${name}`))
    const buffer = crypto.randomBytes(512 * 1024)
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')

    await page.goto(`/storage/${pve.node}/local/iso`)
    await pageAction(page, mobile, '上传')
    const dlg = page.getByRole('dialog', { name: '上传文件' })
    await expect(dlg.getByRole('radio', { name: 'ISO 镜像' })).toHaveAttribute('aria-checked', 'true')
    await dlg.getByLabel('选择文件').setInputFiles({ name, mimeType: 'application/octet-stream', buffer })
    await expect(dlg.getByRole('textbox', { name: '保存为' })).toHaveValue(name)
    await dlg.getByRole('button', { name: /校验和/ }).click()
    await dlg.getByRole('combobox', { name: '算法' }).click()
    await page.getByRole('option', { name: 'SHA-256' }).click()
    await dlg.getByRole('textbox', { name: '校验和' }).fill('abc')
    await dlg.getByRole('button', { name: '上传', exact: true }).click()
    await expect(dlg.getByText(/应为 64 位/)).toBeVisible()
    await dlg.getByRole('textbox', { name: '校验和' }).fill(sha256)
    await dlg.getByRole('button', { name: '上传', exact: true }).click()
    await expect(dlg).toBeHidden({ timeout: 30_000 })

    await expect(row(page, name)).toBeVisible({ timeout: 30_000 })
    const list = await pve.get<Volume[]>(`/nodes/${pve.node}/storage/local/content`, { content: 'iso' })
    expect(list.map((v) => v.volid)).toContain(`local:iso/${name}`)

    await rowAction(page, name, '删除')
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText(name)
    await expect(confirm.getByRole('button', { name: '删除' })).toBeDisabled()
    await confirm.getByRole('textbox').fill(name)
    await confirm.getByRole('button', { name: '删除' }).click()
    await expect(confirm).toBeHidden({ timeout: 20_000 })
    await expect(row(page, name)).toHaveCount(0, { timeout: 20_000 })
  })

  test('downloads from a URL after querying its metadata', async ({ page, pve, mobile, cleanup }) => {
    const name = `e2e-sb-${tag(mobile)}-dl.iso`
    cleanup.add(() => deleteVolume(pve, 'local', `local:iso/${name}`))
    const port = new URL(env.baseURL).port || '80'

    await page.goto(`/storage/${pve.node}/local/iso`)
    await pageAction(page, mobile, '从 URL 下载')
    const dlg = page.getByRole('dialog', { name: '从 URL 下载' })
    await dlg.getByRole('textbox', { name: 'URL' }).fill(`http://${LAN_HOST}:${port}/favicon.svg`)
    await dlg.getByRole('button', { name: '查询' }).click()
    await expect(dlg.getByText('image/svg+xml')).toBeVisible({ timeout: 20_000 })
    const filename = dlg.getByRole('textbox', { name: '保存为' })
    await expect(filename).toHaveValue('favicon.svg')
    await expect(dlg.getByText(/扩展名必须是/)).toBeVisible()
    await filename.fill(name)
    await dlg.getByRole('button', { name: '下载', exact: true }).click()
    await expect(dlg).toBeHidden({ timeout: 20_000 })
    await expect(row(page, name)).toBeVisible({ timeout: 45_000 })
  })

  test('container template catalog marks downloaded templates', async ({ page, pve, mobile }) => {
    const catalog = await pve.get<{ template: string; package: string; version: string }[]>(`/nodes/${pve.node}/aplinfo`)
    const present = await pve.get<Volume[]>(`/nodes/${pve.node}/storage/local/content`, { content: 'vztmpl' })
    const have = catalog.find((t) => present.some((v) => v.volid.endsWith(`/${t.template}`)))

    await page.goto(`/storage/${pve.node}/local/vztmpl`)
    await pageAction(page, mobile, '容器模板')
    const dlg = page.getByRole('dialog', { name: '容器模板' })
    await expect(dlg.getByRole('list', { name: '模板' }).getByRole('listitem').first()).toBeVisible({ timeout: 20_000 })
    await dlg.getByRole('radio', { name: '系统' }).click()
    await dlg.getByRole('searchbox', { name: '搜索模板' }).fill(have ? have.package : 'debian')
    const items = dlg.getByRole('list', { name: '模板' }).getByRole('listitem')
    await expect(items.first()).toBeVisible()
    if (have) await expect(dlg.getByRole('button', { name: `下载 ${have.package} ${have.version}`, exact: true })).toHaveText('已下载')
    await dlg.getByRole('searchbox', { name: '搜索模板' }).fill('zzz-no-such-template')
    await expect(dlg.getByText('没有匹配的模板')).toBeVisible()
  })

  test('pulls an OCI image as a container template', async ({ page, pve, mobile, cleanup }) => {
    test.setTimeout(150_000)
    const name = `e2e-sb-${tag(mobile)}-busybox`
    cleanup.add(() => deleteVolume(pve, 'local', `local:vztmpl/${name}.tar`))

    await page.goto(`/storage/${pve.node}/local/vztmpl`)
    await pageAction(page, mobile, '拉取 OCI 镜像')
    const dlg = page.getByRole('dialog', { name: '拉取 OCI 镜像' })
    await dlg.getByRole('textbox', { name: '镜像' }).fill('docker.io/library/busybox')
    await dlg.getByRole('button', { name: '查询标签' }).click()
    const tags = dlg.getByRole('listbox', { name: '可用标签' })
    await expect(tags.getByRole('option', { name: 'latest', exact: true })).toBeVisible({ timeout: 45_000 })
    await expect(dlg.getByRole('textbox', { name: '标签' })).toHaveValue('latest')
    await dlg.getByRole('textbox', { name: '文件名' }).fill(name)
    await dlg.getByRole('button', { name: '拉取', exact: true }).click()
    await expect(dlg).toBeHidden({ timeout: 20_000 })
    await expect(row(page, `${name}.tar`)).toBeVisible({ timeout: 90_000 })
  })
})

test.describe('backups and disks', () => {
  test('notes, protection, prune and restore of backups; disks of guests', async ({ page, pve, mobile, cleanup }) => {
    test.setTimeout(300_000)
    const id = ids(mobile)
    const name = `${PREFIX}-${mobile ? 'm' : 'd'}`
    await pve.destroyGuest(id.source)
    await pve.createTestVm({
      vmid: id.source,
      name,
      params: { scsi0: 'local-lvm:0.01', scsihw: 'virtio-scsi-single' },
    })
    cleanup.add(() => sweepBackups(pve, id.source))
    cleanup.guest(id.source)
    for (let i = 0; i < 2; i++) {
      await pve.run('POST', `/nodes/${pve.node}/vzdump`, { vmid: id.source, storage: 'local', mode: 'stop', compress: 'zstd' })
      await new Promise((r) => setTimeout(r, 1100)) // distinct timestamps in the names
    }

    await page.goto(`/storage/${pve.node}/local/backup`)
    await expect(row(page, '').first()).toBeVisible()
    const vmidFilter = page.getByRole('combobox', { name: '按 VMID 筛选' })
    if (await vmidFilter.count()) {
      await vmidFilter.click()
      await page.getByRole('option', { name: new RegExp(`^${id.source}`) }).click()
    }
    const list = page.getByRole('list', { name: '备份' })
    await expect(list.getByRole('listitem')).toHaveCount(2)
    await expect(list.getByRole('listitem').first()).toContainText(`VM ${id.source} · ${name}`)
    const backups = (await pve.get<Volume[]>(`/nodes/${pve.node}/storage/local/content`, { content: 'backup', vmid: id.source }))
      .map((v) => v.volid.replace(/^local:backup\//, ''))
      .sort()
    const newest = backups[1]!
    const oldest = backups[0]!

    await test.step('notes', async () => {
      await row(page, newest).click()
      const details = page.getByRole('dialog', { name: newest })
      await details.getByRole('button', { name: '编辑备注' }).click()
      const dlg = page.getByRole('dialog', { name: '编辑备注' })
      await dlg.getByRole('textbox', { name: '备注' }).fill('e2e 备注：上线前')
      await dlg.getByRole('button', { name: '保存' }).click()
      await expect(dlg).toBeHidden()
      await expect(list.getByRole('listitem').first()).toContainText('e2e 备注：上线前')
    })

    await test.step('protection blocks deletion', async () => {
      await rowAction(page, newest, '保护')
      await expect(list.getByRole('listitem').first()).toContainText('受保护', { timeout: 15_000 })
      await page.getByRole('button', { name: `${newest} 的操作` }).click()
      await expect(page.getByRole('menuitem', { name: '删除' })).toBeDisabled()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)
      await rowAction(page, newest, '取消保护')
      await expect(list.getByRole('listitem').first()).not.toContainText('受保护', { timeout: 15_000 })
    })

    await test.step('prune keeps the newest', async () => {
      await rowAction(page, newest, '清理此客户机的备份')
      const dlg = page.getByRole('dialog', { name: '清理备份' })
      await dlg.getByRole('textbox', { name: '保留最近' }).fill('1')
      await expect(dlg.getByText('保留 1 · 删除 1')).toBeVisible({ timeout: 15_000 })
      await expect(dlg.getByText('保留 · 最近 1')).toBeVisible()
      await dlg.getByRole('button', { name: '删除 1 个备份' }).click()
      await expect(dlg).toBeHidden({ timeout: 20_000 })
      await expect(row(page, oldest)).toHaveCount(0, { timeout: 30_000 })
      await expect(row(page, newest)).toBeVisible()
    })

    await test.step('restore as a new VM', async () => {
      await pve.destroyGuest(id.restored)
      cleanup.guest(id.restored)
      await rowAction(page, newest, '恢复')
      const dlg = page.getByRole('dialog', { name: '恢复为新虚拟机' })
      const vmidBox = dlg.getByRole('textbox', { name: 'VM ID' })
      await expect(vmidBox).not.toHaveValue('')
      await vmidBox.fill(String(id.restored))
      await expect(dlg.getByText('可用', { exact: true })).toBeVisible({ timeout: 10_000 })
      await dlg.getByRole('button', { name: /覆盖设置/ }).click()
      await dlg.getByRole('textbox', { name: '名称' }).fill(`${name}-restored`)
      await dlg.getByRole('button', { name: '恢复', exact: true }).click()
      await expect(dlg).toBeHidden({ timeout: 20_000 })
      await pve.waitForGuest(id.restored, (g) => g.name === `${name}-restored`, 90_000)
    })

    await test.step('VM disks: owned disks are protected, orphans can be deleted', async () => {
      const orphan = `vm-${id.orphan}-disk-0`
      cleanup.add(() => deleteVolume(pve, 'local-lvm', `local-lvm:${orphan}`))
      await pve.post(`/nodes/${pve.node}/storage/local-lvm/content`, { vmid: id.orphan, filename: orphan, size: '4M' })

      await page.goto(`/storage/${pve.node}/local-lvm/images`)
      const owned = `vm-${id.source}-disk-0`
      await expect(row(page, owned)).toContainText(`VM ${id.source} · ${name}`)
      await page.getByRole('button', { name: `${owned} 的操作` }).click()
      await expect(page.getByRole('menuitem', { name: '删除' })).toBeDisabled()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)

      await expect(row(page, orphan)).toContainText('孤立')
      await rowAction(page, orphan, '删除')
      const confirm = page.getByRole('alertdialog')
      await confirm.getByRole('textbox').fill(String(id.orphan))
      await confirm.getByRole('button', { name: '删除' }).click()
      await expect(row(page, orphan)).toHaveCount(0, { timeout: 30_000 })
    })
  })

  test('uploads a disk image to import and creates a VM from it', async ({ page, pve, mobile, cleanup }) => {
    test.setTimeout(150_000)
    const id = ids(mobile)
    const file = `e2e-sb-${tag(mobile)}.raw`
    const vmName = `${PREFIX}-imp-${mobile ? 'm' : 'd'}`
    cleanup.add(() => deleteVolume(pve, 'local', `local:import/${file}`))
    await pve.destroyGuest(id.imported)
    cleanup.guest(id.imported)

    await page.goto(`/storage/${pve.node}/local/import`)
    await pageAction(page, mobile, '上传')
    const up = page.getByRole('dialog', { name: '上传文件' })
    await expect(up.getByRole('radio', { name: '导入' })).toHaveAttribute('aria-checked', 'true')
    await up.getByLabel('选择文件').setInputFiles({ name: file, mimeType: 'application/octet-stream', buffer: Buffer.alloc(1024 * 1024) })
    await up.getByRole('button', { name: '上传', exact: true }).click()
    await expect(up).toBeHidden({ timeout: 30_000 })
    await expect(row(page, file)).toBeVisible({ timeout: 30_000 })

    await rowAction(page, file, '导入')
    const dlg = page.getByRole('dialog', { name: '用磁盘镜像创建虚拟机' })
    await dlg.getByRole('textbox', { name: 'VM ID' }).fill(String(id.imported))
    await expect(dlg.getByText('可用', { exact: true })).toBeVisible({ timeout: 10_000 })
    await dlg.getByRole('textbox', { name: '名称' }).fill(vmName)
    await dlg.getByRole('textbox', { name: '内存' }).fill('64')
    await expect(dlg.getByRole('combobox', { name: '目标存储' })).not.toHaveText(/选择存储|加载中/)
    await dlg.getByRole('button', { name: '导入', exact: true }).click()
    await expect(dlg).toBeHidden({ timeout: 20_000 })
    await pve.waitForGuest(id.imported, (g) => g.name === vmName, 60_000)
    const config = await pve.get<Record<string, string>>(`/nodes/${pve.node}/qemu/${id.imported}/config`)
    expect(config.scsi0).toMatch(/^local-lvm:vm-\d+-disk-0/)
    expect(config.net0).toContain('bridge=vmbr0')
  })
})

/** Delete every backup of a guest on "local" (unprotecting first). */
async function sweepBackups(pve: PveApi, vmid: number) {
  const list = await pve.get<Volume[]>(`/nodes/${pve.node}/storage/local/content`, { content: 'backup', vmid })
  for (const v of list) {
    if (v.protected) await pve.put(`/nodes/${pve.node}/storage/local/content/${encodeURIComponent(v.volid)}`, { protected: 0 })
    await deleteVolume(pve, 'local', v.volid)
  }
}
