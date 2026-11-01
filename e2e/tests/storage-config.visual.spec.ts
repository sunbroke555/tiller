import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures'

// Visual QA screenshots of the storage configuration (dark theme), phone
// (390×844) and desktop (1440×900). Off by default; run with
//   rt --back e2e/test-results -- scripts/with-lab-env.sh make e2e-visual PORT=8206 SPEC=tests/storage-config.visual.spec.ts
// Writes are mocked (page.route), the list is a mocked mix of types.

const LIST = [
  { storage: 'local', type: 'dir', path: '/var/lib/vz', content: 'iso,vztmpl,backup,import', 'prune-backups': 'keep-all=1', digest: 'x' },
  { storage: 'local-lvm', type: 'lvmthin', vgname: 'pve', thinpool: 'data', content: 'images,rootdir', digest: 'x' },
  { storage: 'nas-backup', type: 'nfs', server: '192.168.0.20', export: '/volume1/pve-backup', content: 'backup,iso,vztmpl', shared: 1, 'prune-backups': 'keep-last=3,keep-daily=7,keep-weekly=4', digest: 'x' },
  { storage: 'smb-media', type: 'cifs', server: 'nas.lan', share: 'media', content: 'iso', shared: 1, nodes: 'pve-lab', digest: 'x' },
  { storage: 'pbs-main', type: 'pbs', server: 'pbs.lan', datastore: 'store1', content: 'backup', 'prune-backups': 'keep-daily=14', digest: 'x' },
  { storage: 'ceph-vm', type: 'rbd', pool: 'vm', monhost: '10.0.0.1 10.0.0.2 10.0.0.3', content: 'images', krbd: 1, disable: 1, digest: 'x' },
]

async function shot(page: Page, name: string, mobile: boolean) {
  await page.waitForTimeout(450) // animations, sheets
  await page.screenshot({ path: `test-results/sc-shots/${mobile ? 'phone' : 'desktop'}-${name}.png` })
}

test('storage config screens (dark)', async ({ page, mobile }) => {
  test.setTimeout(180_000)
  if (mobile) await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('tiller:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
  })
  await page.route('**/api2/json/storage', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: LIST } })
    return route.fulfill({
      json: {
        data: {
          storage: 'e2e-sc-pbs',
          type: 'pbs',
          config: { 'encryption-key': JSON.stringify({ kdf: null, created: '2026-11-01T08:00:00+08:00', modified: '2026-11-01T08:00:00+08:00', data: 'Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5d2FsZG9mcmVk', fingerprint: '5e:a1:9c:44:0b:7d:2e:91:aa:3f:60:12:b8:c4:de:77:01:9a:5c:e3:44:21:b0:6f:83:d2:17:c9:3a:58:e0:4b' }) },
        },
      },
    })
  })
  await page.route('**/api2/json/storage/local', (route) => route.fulfill({ json: { data: LIST[0] } }))
  await page.route('**/api2/json/nodes/*/scan/nfs?*', (route) =>
    route.fulfill({ json: { data: [{ path: '/volume1/pve-backup', options: '192.168.0.0/24' }, { path: '/volume1/iso', options: '*' }] } }),
  )

  await page.goto('/datacenter/storage')
  await expect(page.locator('li[data-storage="ceph-vm"]')).toBeVisible()
  await shot(page, '01-list', mobile)

  await page.getByRole('button', { name: '添加存储' }).first().click()
  await expect(page.getByRole('dialog', { name: '添加存储' })).toBeVisible()
  await shot(page, '02-type-picker', mobile)

  await page.getByRole('dialog', { name: '添加存储' }).getByRole('button', { name: /^NFS\s/ }).click()
  const nfs = page.getByRole('dialog', { name: '添加NFS存储' })
  await nfs.getByRole('textbox', { name: 'ID', exact: true }).fill('nas-vm')
  await nfs.getByLabel('服务器').fill('192.168.0.20')
  await nfs.getByRole('button', { name: '扫描' }).click()
  await expect(nfs.getByRole('list', { name: '扫描结果' })).toBeVisible()
  await shot(page, '03-nfs-scan', mobile)
  await nfs.getByRole('button', { name: /\/volume1\/pve-backup/ }).click()
  await nfs.getByRole('button', { name: /高级选项/ }).click()
  await nfs.getByRole('button', { name: /^备份保留/ }).click()
  await nfs.getByRole('switch', { name: '保留全部备份' }).click()
  await nfs.getByLabel('保留最近').fill('3')
  await nfs.getByLabel('保留每天').fill('7')
  await nfs.getByRole('textbox', { name: 'ID', exact: true }).focus()
  await shot(page, '04-nfs-form', mobile)
  await nfs.getByRole('button', { name: '取消' }).click()
  const discard = page.getByRole('alertdialog')
  if (await discard.isVisible().catch(() => false)) await discard.getByRole('button', { name: /放弃/ }).click()
  await expect(nfs).toBeHidden()

  await page.getByRole('button', { name: '添加存储' }).first().click()
  await page.getByRole('dialog', { name: '添加存储' }).getByRole('button', { name: /^Proxmox Backup Server\s/ }).click()
  const pbs = page.getByRole('dialog', { name: '添加Proxmox Backup Server存储' })
  await pbs.getByRole('textbox', { name: 'ID', exact: true }).fill('e2e-sc-pbs')
  await pbs.getByLabel('服务器').fill('pbs.lan')
  await pbs.getByLabel('用户名').fill('root@pam')
  await pbs.getByLabel('密码').fill('secret')
  await pbs.getByLabel('数据存储').fill('store1')
  await pbs.getByRole('radio', { name: '自动生成客户端加密密钥' }).click()
  await pbs.getByRole('radio', { name: '自动生成客户端加密密钥' }).scrollIntoViewIfNeeded()
  await shot(page, '05-pbs-encryption', mobile)
  await pbs.getByRole('button', { name: '添加', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '请保存加密密钥' })).toBeVisible()
  await shot(page, '06-pbs-key', mobile)
  await page.getByRole('button', { name: '我已保存' }).click()

  await page.getByRole('button', { name: '编辑 local', exact: true }).click()
  const edit = page.getByRole('dialog', { name: '编辑存储 local' })
  await expect(edit.getByText('/var/lib/vz')).toBeVisible()
  await shot(page, '07-edit-local', mobile)
  await edit.getByRole('button', { name: '取消' }).click()

  await page.getByRole('button', { name: 'nas-backup 的操作' }).click()
  await shot(page, '08-row-menu', mobile)
  await page.getByRole('menuitem', { name: '删除' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await shot(page, '09-remove', mobile)
})
