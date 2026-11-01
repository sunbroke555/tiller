import fs from 'node:fs'
import path from 'node:path'

import type { Browser, Page } from '@playwright/test'

import { expect, test } from '../fixtures'

// Screenshots of the qemu-config screens in every theme at phone and desktop
// size, for visual review. Skipped unless QEMU_SHOTS=1:
//   rt --back e2e/test-results/qemu-config-shots -- bash -lc 'set -a; . ~/.config/pve-web/lab.env; set +a;
//     QEMU_SHOTS=1 make e2e PORT=8105 SPEC=tests/qemu-config-visual.spec.ts E2E_ARGS="--project=desktop"'

test.skip(!process.env.QEMU_SHOTS, 'set QEMU_SHOTS=1 to take screenshots')
test.describe.configure({ timeout: 600_000 })

const OUT = path.join(import.meta.dirname, '..', 'test-results', 'qemu-config-shots')
const THEMES = ['dark', 'light', 'paper'] as const
const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 }, mobile: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, mobile: false },
] as const

async function newPage(browser: Browser, authFile: string, theme: string, size: (typeof SIZES)[number]): Promise<Page> {
  const ctx = await browser.newContext({
    storageState: authFile,
    viewport: size.viewport,
    isMobile: size.mobile,
    hasTouch: size.mobile,
    deviceScaleFactor: size.mobile ? 2 : 1,
    locale: 'zh-CN',
  })
  await ctx.addInitScript((t) => {
    localStorage.setItem('pve-web:appearance', JSON.stringify({ mode: t, accent: 'indigo', glass: true, density: 'comfortable' }))
  }, theme)
  return ctx.newPage()
}

test('qemu-config screenshots', async ({ browser, authFile, pve, cleanup }) => {
  fs.mkdirSync(OUT, { recursive: true })
  const vmid = 3499
  await pve.destroyGuest(vmid).catch(() => undefined)
  await pve.createTestVm({
    vmid,
    name: 'e2e-qemu-config-shots',
    params: {
      memory: 128,
      ostype: 'l26',
      scsihw: 'virtio-scsi-single',
      bios: 'ovmf',
      vga: 'qxl',
      efidisk0: 'local-lvm:1,efitype=4m,pre-enrolled-keys=1',
      scsi0: 'local-lvm:1,iothread=1,discard=on',
      ide2: 'local:iso/alpine-virt-3.24.3-x86_64.iso,media=cdrom',
      ide0: 'local-lvm:cloudinit',
      net1: 'e1000,bridge=vmbr0,tag=20,firewall=1',
      serial0: 'socket',
      rng0: 'source=/dev/urandom',
      usb0: 'spice',
      audio0: 'device=ich9-intel-hda,driver=spice',
      agent: '1,fstrim_cloned_disks=1',
      ciuser: 'admin',
      ipconfig0: 'ip=dhcp,ip6=auto',
      boot: 'order=scsi0;ide2;net0',
      tags: 'demo',
    },
  })
  cleanup.guest(vmid)
  await pve.run('POST', `/nodes/${pve.node}/qemu/${vmid}/status/start`)
  await pve.waitForGuest(vmid, (g) => g.status === 'running')
  await pve.put(`/nodes/${pve.node}/qemu/${vmid}/config`, { memory: 256, cores: 2, net2: 'virtio,bridge=vmbr0' })

  const base = `/guest/${pve.node}/qemu/${vmid}`
  for (const size of SIZES) {
    for (const theme of THEMES) {
      const page = await newPage(browser, authFile, theme, size)
      const shot = async (name: string, full = true) => {
        await page.waitForTimeout(400)
        await page.screenshot({ path: path.join(OUT, `${size.name}-${theme}-${name}.png`), fullPage: full })
      }
      await page.goto(`${base}/hardware`)
      await expect(page.getByTestId('hw-memory')).toContainText('待生效')
      await shot('hardware')
      if (theme === 'dark' || size.name === 'phone') {
        await page.getByRole('button', { name: '添加硬件' }).click()
        await shot('add-menu', false)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(400)
        await page.getByRole('button', { name: '编辑处理器' }).click()
        await page.getByText('高级选项').click()
        await shot('processor', false)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(400)
        await page.getByRole('button', { name: '编辑硬盘 (scsi0)' }).click()
        await shot('disk', false)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(400)
        await page.getByRole('button', { name: '硬盘 (scsi0) 的更多操作' }).click()
        await shot('disk-menu', false)
        await page.keyboard.press('Escape')
      }
      await page.goto(`${base}/options`)
      await expect(page.getByTestId('opt-boot')).toBeVisible()
      await shot('options')
      if (theme === 'dark' || size.name === 'phone') {
        await page.getByRole('button', { name: '编辑启动顺序' }).click()
        await shot('boot-order', false)
        await page.keyboard.press('Escape')
      }
      await page.goto(`${base}/cloudinit`)
      await expect(page.getByTestId('ci-ciuser')).toBeVisible()
      await shot('cloudinit')
      await page.goto(`${base}/monitor`)
      await page.getByRole('button', { name: 'info status' }).click()
      await expect(page.getByRole('log')).toContainText('running')
      await shot('monitor')
      await page.context().close()
    }
  }
})
