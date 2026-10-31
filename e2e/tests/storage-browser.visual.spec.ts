import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures'

// Visual QA screenshots of the storage browser in every theme, phone
// (390×844) and desktop (1440×900). Off by default; run with
//   E2E_SCREENSHOTS=1 … make e2e PORT=8110 SPEC=tests/storage-browser.visual.spec.ts
// and fetch e2e/test-results/sb-shots with rt --back.

const THEMES = ['dark', 'light', 'paper'] as const
const VMID = { mobile: 3840, desktop: 3841 }
const NAME = 'e2e-storage-browser-shots'

test.skip(!process.env.E2E_SCREENSHOTS, '只在 E2E_SCREENSHOTS=1 时截图')

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
    await expect(page.getByRole('link', { name: '存储 local', exact: true })).toBeVisible()
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
  })
}
