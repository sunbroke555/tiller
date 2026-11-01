import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures'

// Visual QA screenshots of the storage browser in every theme, phone
// (390×844) and desktop (1440×900). Off by default; run with
//   … make e2e-visual PORT=8110 SPEC=tests/storage-browser.visual.spec.ts
// and fetch e2e/test-results/sb-shots with rt --back.

const THEMES = ['dark', 'light', 'paper'] as const
const VMID = { mobile: 3840, desktop: 3841 }
const NAME = 'e2e-storage-browser-shots'

async function shot(page: Page, name: string, mobile: boolean) {
  await page.waitForTimeout(450) // animations, sheets
  await page.screenshot({ path: `test-results/sb-shots/${mobile ? 'phone' : 'desktop'}-${name}.png` })
}

async function action(page: Page, mobile: boolean, name: string) {
  const bar = mobile ? page.getByRole('toolbar', { name: '操作' }) : page.locator('main header').first()
  await expect(bar.getByRole('button').first()).toBeVisible()
  const direct = bar.getByRole('button', { name, exact: true })
  if (await direct.count()) return direct.click()
  await bar.getByRole('button', { name: mobile ? '更多' : '更多操作' }).click()
  await page.getByRole('menuitem', { name }).click()
}

for (const theme of THEMES) {
  test(`screens in ${theme}`, async ({ page, pve, mobile, cleanup }) => {
    test.setTimeout(240_000)
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript((mode) => {
      localStorage.setItem('pve-web:appearance', JSON.stringify({ mode, accent: 'indigo', glass: true, density: 'comfortable' }))
    }, theme)

    const vmid = mobile ? VMID.mobile : VMID.desktop
    const node = pve.node
    if (theme === 'dark') {
      // Fixture: a tiny VM with two backups (one protected, with notes).
      await pve.destroyGuest(vmid)
      await pve.createTestVm({ vmid, name: NAME, params: { scsi0: 'local-lvm:0.01' } })
      for (let i = 0; i < 2; i++) {
        await pve.run('POST', `/nodes/${node}/vzdump`, {
          vmid,
          storage: 'local',
          mode: 'stop',
          compress: 'zstd',
          'notes-template': i ? '上线前的完整备份，保留' : '{{guestname}} 每日备份',
          protected: i ? 1 : 0,
        })
      }
    }
    if (theme === 'paper') {
      cleanup.add(async () => {
        const list = await pve.get<{ volid: string; protected?: number }[]>(`/nodes/${node}/storage/local/content`, {
          content: 'backup',
          vmid,
        })
        for (const v of list) {
          const path = `/nodes/${node}/storage/local/content/${encodeURIComponent(v.volid)}`
          if (v.protected) await pve.put(path, { protected: 0 })
          await pve.run('DELETE', path)
        }
      })
      cleanup.guest(vmid)
    }

    await page.goto('/storage')
    await expect(page.getByRole('main').getByRole('link', { name: '存储 local', exact: true })).toBeVisible()
    await shot(page, `${theme}-list`, mobile)

    await page.goto(`/storage/${node}/local`)
    await expect(page.getByRole('img', { name: /用量趋势/ })).toBeVisible({ timeout: 15_000 })
    await shot(page, `${theme}-summary`, mobile)
    if (mobile) {
      await page.mouse.wheel(0, 900)
      await shot(page, `${theme}-summary-2`, mobile)
    }

    await page.goto(`/storage/${node}/local/backup`)
    await expect(page.getByRole('list', { name: '备份' })).toBeVisible()
    await shot(page, `${theme}-backups`, mobile)

    const first = page.getByRole('list', { name: '备份' }).getByRole('button', { name: new RegExp(`vzdump-qemu-${vmid}-.* 详情`) }).first()
    await first.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await shot(page, `${theme}-details`, mobile)
    await page.getByRole('dialog').getByRole('button', { name: '恢复' }).click()
    await expect(page.getByRole('dialog', { name: '恢复为新虚拟机' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: /覆盖设置/ }).click()
    await shot(page, `${theme}-restore`, mobile)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: new RegExp(`vzdump-qemu-${vmid}-.* 的操作`) }).first().click()
    await shot(page, `${theme}-row-menu`, mobile)
    await page.getByRole('menuitem', { name: '清理此客户机的备份' }).click()
    const prune = page.getByRole('dialog', { name: '清理备份' })
    await prune.getByRole('textbox', { name: '保留最近' }).fill('1')
    await expect(prune.getByText(/保留 \d+ · 删除/)).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(600)
    await shot(page, `${theme}-prune`, mobile)
    await page.keyboard.press('Escape')

    await page.goto(`/storage/${node}/local/iso`)
    await action(page, mobile, '上传')
    await expect(page.getByRole('dialog', { name: '上传文件' })).toBeVisible()
    await shot(page, `${theme}-upload`, mobile)
    await page.keyboard.press('Escape')

    await action(page, mobile, '从 URL 下载')
    const dl = page.getByRole('dialog', { name: '从 URL 下载' })
    await dl.getByRole('button', { name: '高级选项' }).click()
    await shot(page, `${theme}-download`, mobile)
    await page.keyboard.press('Escape')

    await page.goto(`/storage/${node}/local/vztmpl`)
    await action(page, mobile, '容器模板')
    await expect(page.getByRole('dialog', { name: '容器模板' }).getByRole('listitem').first()).toBeVisible({ timeout: 20_000 })
    await shot(page, `${theme}-templates`, mobile)
    await page.keyboard.press('Escape')

    await action(page, mobile, '拉取 OCI 镜像')
    await expect(page.getByRole('dialog', { name: '拉取 OCI 镜像' })).toBeVisible()
    await shot(page, `${theme}-oci`, mobile)
    await page.keyboard.press('Escape')

    await page.goto(`/storage/${node}/local-lvm/images`)
    await expect(page.getByRole('list', { name: '虚拟机磁盘' })).toBeVisible()
    await shot(page, `${theme}-images`, mobile)

    await page.goto(`/storage/${node}/local/import`)
    await expect(page.getByText(/还没有导入|导入/).first()).toBeVisible()
    await shot(page, `${theme}-import`, mobile)

    // The lab has no Proxmox Backup Server: mock one for the file browser.
    await mockPbs(page, node)
    await page.goto(`/storage/${node}/${PBS}/backup`)
    await page.getByRole('button', { name: /vm\/100\/.* 的操作/ }).click()
    await page.getByRole('menuitem', { name: '文件级恢复' }).click()
    const fr = page.getByRole('dialog', { name: '文件级恢复' })
    await fr.getByRole('button', { name: '打开 drive-scsi0.img.fidx' }).click()
    await fr.getByRole('button', { name: '打开 part' }).click()
    await fr.getByRole('button', { name: '打开 1' }).click()
    await expect(fr.getByRole('button', { name: '打开 etc' })).toBeVisible()
    await shot(page, `${theme}-file-restore`, mobile)
  })
}

const PBS = 'pbs-demo'

async function mockPbs(page: Page, node: string) {
  const b64 = (s: string) => Buffer.from(s).toString('base64')
  const now = Math.floor(Date.now() / 1000)
  await page.route('**/api2/json/cluster/resources*', async (route) => {
    const res = await route.fetch()
    const body = (await res.json()) as { data: unknown[] }
    body.data.push({
      id: `storage/${node}/${PBS}`,
      type: 'storage',
      node,
      storage: PBS,
      plugintype: 'pbs',
      content: 'backup',
      status: 'available',
      shared: 1,
      disk: 412 * 2 ** 30,
      maxdisk: 2 * 2 ** 40,
    })
    await route.fulfill({ response: res, json: body })
  })
  await page.route(`**/api2/json/nodes/${node}/storage/${PBS}/content*`, (route) =>
    route.fulfill({
      json: {
        data: [
          { volid: `${PBS}:backup/vm/100/2026-10-30T02:00:00Z`, content: 'backup', format: 'pbs-vm', subtype: 'qemu', vmid: 100, ctime: now - 86400, size: 2.1 * 2 ** 30, verification: { state: 'ok' } },
          { volid: `${PBS}:backup/ct/200/2026-10-30T02:10:00Z`, content: 'backup', format: 'pbs-ct', subtype: 'lxc', vmid: 200, ctime: now - 80000, size: 310 * 2 ** 20, protected: 1, notes: '升级前' },
        ],
      },
    }),
  )
  const dir = (p: string, text: string, type = 'd', extra: object = {}) => ({ filepath: b64(p), text, type, leaf: false, ...extra })
  const file = (p: string, text: string, size: number) => ({ filepath: b64(p), text, type: 'f', leaf: true, size, mtime: now - 3600 * 30 })
  const root = '/drive-scsi0.img.fidx/part/1'
  const tree: Record<string, unknown[]> = {
    '/': [dir('/drive-scsi0.img.fidx', 'drive-scsi0.img.fidx', 'v'), dir('/drive-efidisk0.img.fidx', 'drive-efidisk0.img.fidx', 'v')],
    [b64('/drive-scsi0.img.fidx')]: [dir('/drive-scsi0.img.fidx/part', 'part', 'v')],
    [b64('/drive-scsi0.img.fidx/part')]: [dir(root, '1', 'v'), dir('/drive-scsi0.img.fidx/part/2', '2', 'v')],
    [b64(root)]: [
      dir(`${root}/etc`, 'etc', 'd', { mtime: now - 7200 }),
      dir(`${root}/home`, 'home', 'd', { mtime: now - 7200 }),
      dir(`${root}/var`, 'var', 'd', { mtime: now - 7200 }),
      file(`${root}/vmlinuz`, 'vmlinuz', 11.4 * 2 ** 20),
      { filepath: b64(`${root}/initrd.img`), text: 'initrd.img', type: 'l', leaf: true },
      file(`${root}/swap.img`, 'swap.img', 2 ** 30),
    ],
  }
  await page.route('**/file-restore/list*', (route) => {
    const fp = new URL(route.request().url()).searchParams.get('filepath') ?? '/'
    return route.fulfill({ json: { data: tree[fp] ?? [] } })
  })
}
