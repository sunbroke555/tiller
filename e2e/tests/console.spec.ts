import fs from 'node:fs'

import { expect, test, type PveApi } from '../fixtures'
import type { Page } from '@playwright/test'

// Consoles against the lab through the Go proxy: node shell (termproxy +
// xterm.js), VM noVNC (vncproxy), VM serial terminal, CT console, SPICE .vv
// download and sendkey. Fixtures live in VMIDs 3200–3299 (area console) and
// are named e2e-console-*; they are destroyed after the run (desktop, @lab).
// The phone checks (key bar, pinch zoom, /shell) use the node shell and the
// running sample VM 101 without sending it any keys.

const VMID_RANGE = [3200, 3299] as const

async function freeVmid(pve: PveApi, skip: number[] = []): Promise<number> {
  const used = new Set([...(await pve.guests()).map((g) => g.vmid), ...skip])
  for (let id = VMID_RANGE[0]; id <= VMID_RANGE[1]; id++) if (!used.has(id)) return id
  throw new Error('VMID 3200–3299 已用完')
}

async function alpineTemplate(pve: PveApi): Promise<string> {
  const content = await pve.get<{ volid: string }[]>(`/nodes/${pve.node}/storage/local/content`, { content: 'vztmpl' })
  const t = content.find((c) => /alpine.*amd64/.test(c.volid))
  if (!t) throw new Error('实验机 local 存储里没有 alpine amd64 模板')
  return t.volid
}

function status(page: Page) {
  return page.getByTestId('console-status').first()
}

async function expectConnected(page: Page) {
  await expect(status(page)).toHaveText('已连接', { timeout: 30_000 })
}

/** Type a command into the xterm.js console and wait for its output. */
async function runInTerminal(page: Page, command: string, expected: string) {
  const term = page.getByTestId('xterm-console').first()
  await term.locator('.xterm').click()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
  await expect(term.locator('.xterm-rows')).toContainText(expected, { timeout: 20_000 })
}

test.describe.serial('console', { tag: '@lab' }, () => {
  let vm = 0
  let ct = 0

  test.beforeAll(async ({ pve }) => {
    test.setTimeout(240_000)
    await pve.sweep('e2e-console-')
    // VM: SPICE display (qxl) plus a serial socket, so every VM viewer works.
    vm = await freeVmid(pve)
    await pve.createTestVm({ vmid: vm, name: 'e2e-console-vm', params: { vga: 'qxl', serial0: 'socket' } })
    await pve.run('POST', `/nodes/${pve.node}/qemu/${vm}/status/start`)
    // CT: cmode=shell gives a root shell without a login prompt. Left stopped
    // so the tab test can start it from the console.
    ct = await freeVmid(pve, [vm])
    await pve.run('POST', `/nodes/${pve.node}/lxc`, {
      vmid: ct,
      hostname: 'e2e-console-ct',
      ostemplate: await alpineTemplate(pve),
      rootfs: 'local-lvm:1',
      memory: 64,
      swap: 0,
      unprivileged: 1,
      cmode: 'shell',
    })
    await pve.waitForGuest(ct, (g) => g.name === 'e2e-console-ct')
    await pve.waitForGuest(vm, (g) => g.status === 'running')
  })

  test.afterAll(async ({ pve }) => {
    test.setTimeout(180_000)
    for (const id of [vm, ct]) if (id) await pve.destroyGuest(id)
  })

  test('node shell runs commands through termproxy', async ({ page, pve }) => {
    await page.goto(`/console/${pve.node}/shell`)
    await expect(page.getByRole('heading', { level: 1, name: pve.node })).toBeVisible()
    await expectConnected(page)
    await runInTerminal(page, 'echo pve-web-$((6*7))', 'pve-web-42')

    await expect(page.getByRole('toolbar', { name: '辅助按键' })).toHaveCount(0)
    // Plain HTTP cannot read the clipboard: 粘贴 asks for the text instead.
    await page.getByRole('button', { name: '粘贴', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '粘贴到控制台' })
    await dialog.getByRole('textbox').fill('echo pasted-$((1+1))')
    await dialog.getByRole('button', { name: '发送', exact: true }).click()
    await expect(dialog).toBeHidden()
    // Bash uses bracketed paste: the pasted line waits for Enter. Focus is
    // back in the terminal.
    await expect(page.getByTestId('xterm-console').locator('textarea')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('xterm-console').locator('.xterm-rows')).toContainText('pasted-2')

    await page.getByRole('link', { name: '返回' }).click()
    await expect(page).toHaveURL(new RegExp(`/node/${pve.node}$`))
  })

  test('VM opens in noVNC and takes Ctrl+Alt+Del', async ({ page, pve }) => {
    await page.goto(`/guest/${pve.node}/qemu/${vm}`)
    await page.locator('header').getByRole('button', { name: '控制台' }).click()
    await expect(page).toHaveURL(new RegExp(`/console/${pve.node}/qemu/${vm}$`))
    await expectConnected(page)
    const vnc = page.getByTestId('vnc-console')
    await expect(vnc.locator('canvas')).toBeVisible()
    const box = await vnc.locator('canvas').boundingBox()
    expect(box!.width).toBeGreaterThan(100)

    // Viewer switch shows 图形 (noVNC) and 串口 (serial0).
    const viewers = page.getByRole('radiogroup', { name: '控制台类型' })
    await expect(viewers.getByRole('radio', { name: '图形' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: 'Ctrl+Alt+Del' }).click()
    await expectConnected(page)
  })

  test('VM serial port opens in xterm.js', async ({ page, pve }) => {
    await page.goto(`/console/${pve.node}/qemu/${vm}`)
    await expectConnected(page)
    await page.getByRole('radiogroup', { name: '控制台类型' }).getByRole('radio', { name: '串口' }).click()
    await expect(page).toHaveURL(/viewer=xterm/)
    await expect(page.getByTestId('xterm-console')).toBeVisible()
    await expectConnected(page)
  })

  test('SPICE downloads a .vv file', async ({ page, pve }) => {
    await page.goto(`/console/${pve.node}/qemu/${vm}`)
    await expectConnected(page)
    await page.getByRole('button', { name: '控制台菜单' }).click()
    await page.getByRole('menuitem', { name: /SPICE/ }).click()
    const dialog = page.getByRole('dialog', { name: 'SPICE 远程查看' })
    await expect(dialog).toBeVisible()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: '下载 .vv 文件' }).click(),
    ])
    expect(download.suggestedFilename()).toBe(`pve-spice-${vm}.vv`)
    const text = fs.readFileSync((await download.path())!, 'utf8')
    expect(text.startsWith('[virt-viewer]\n')).toBe(true)
    expect(text).toMatch(/^type=spice$/m)
    expect(text).toMatch(/^password=/m)
  })

  test('sendkey from the guest action menu', async ({ page, pve }) => {
    await page.goto(`/guest/${pve.node}/qemu/${vm}`)
    await page.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('menuitem', { name: '发送按键…' }).click()
    const dialog = page.getByRole('dialog', { name: '发送按键' })
    await dialog.getByRole('radio', { name: /Ctrl\+Alt\+F2/ }).click()
    await dialog.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByText(`已向 e2e-console-vm 发送 ctrl-alt-f2`)).toBeVisible()
    await expect(dialog).toBeHidden()
  })

  test('CT console tab starts the container and connects', async ({ page, pve }) => {
    const { status: st } = await pve.get<{ status: string }>(`/nodes/${pve.node}/lxc/${ct}/status/current`)
    if (st === 'running') await pve.run('POST', `/nodes/${pve.node}/lxc/${ct}/status/stop`)
    await page.goto(`/guest/${pve.node}/lxc/${ct}/console`)
    const panel = page.getByRole('tabpanel', { name: '控制台' })
    await expect(panel.getByText(`CT ${ct} 未运行`)).toBeVisible({ timeout: 20_000 })
    await panel.getByRole('button', { name: '启动' }).click()
    await expect(status(page)).toHaveText('已连接', { timeout: 60_000 })
    await runInTerminal(page, 'echo ct-$((7*6))-$(hostname)', 'ct-42-e2e-console-ct')

    // noVNC (vncterm) works for containers too.
    await panel.getByRole('radiogroup', { name: '控制台类型' }).getByRole('radio', { name: 'VNC' }).click()
    await expect(panel.getByTestId('vnc-console').locator('canvas')).toBeVisible({ timeout: 30_000 })
    await expectConnected(page)
    // Back to the terminal for the next visitor (the choice is remembered).
    await panel.getByRole('radiogroup', { name: '控制台类型' }).getByRole('radio', { name: '终端' }).click()
    await expectConnected(page)
  })

  test('node Shell tab and /shell page', async ({ page, pve }) => {
    await page.goto(`/node/${pve.node}/shell`)
    await expect(page.getByRole('tabpanel', { name: 'Shell' }).getByTestId('xterm-console')).toBeVisible()
    await expectConnected(page)

    await page.goto('/shell')
    await expect(page.getByRole('heading', { level: 1, name: 'Shell' })).toBeVisible()
    const vmLink = page.locator(`main a[href="/console/${pve.node}/qemu/${vm}"]`)
    await expect(vmLink).toBeVisible()
    await expect(vmLink).toContainText('e2e-console-vm')
    await expectConnected(page)
    await vmLink.click()
    await expect(page).toHaveURL(new RegExp(`/console/${pve.node}/qemu/${vm}$`))
    await expectConnected(page)
  })
})

// Datacenter default console (/cluster/options `console`), mocked on top of
// the lab's real options; only the node shell is opened (no guest needed).
test.describe('datacenter default console', { tag: '@desktop' }, () => {
  async function mockConsoleOption(page: Page, value: string) {
    await page.route('**/api2/json/cluster/options', async (route) => {
      const res = await route.fetch()
      const body = (await res.json()) as { data: Record<string, unknown> }
      await route.fulfill({ response: res, json: { ...body, data: { ...body.data, console: value } } })
    })
  }

  test('html5 opens the node shell tab in noVNC', async ({ page, pve }) => {
    await mockConsoleOption(page, 'html5')
    await page.goto(`/node/${pve.node}/shell`)
    const panel = page.getByRole('tabpanel', { name: 'Shell' })
    await expect(panel.getByRole('radiogroup', { name: '控制台类型' }).getByRole('radio', { name: 'VNC' })).toHaveAttribute('aria-checked', 'true')
    await expect(panel.getByTestId('vnc-console').locator('canvas')).toBeVisible({ timeout: 30_000 })
    await expectConnected(page)
  })

  test('vv (SPICE) offers the .vv download once and keeps the web shell', async ({ page, pve }) => {
    await mockConsoleOption(page, 'vv')
    await page.goto(`/console/${pve.node}/shell`)
    const dialog = page.getByRole('dialog', { name: 'SPICE 远程查看' })
    await expect(dialog).toBeVisible({ timeout: 20_000 })
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('radiogroup', { name: '控制台类型' }).getByRole('radio', { name: '终端' })).toHaveAttribute('aria-checked', 'true')
    await expectConnected(page)
    await expect(dialog).toHaveCount(0)
  })
})

test.describe('console on phones', { tag: '@mobile' }, () => {
  test('node shell key bar: Ctrl+C and sticky Ctrl', async ({ page, pve }) => {
    await page.goto(`/console/${pve.node}/shell`)
    await expectConnected(page)
    await runInTerminal(page, 'echo pve-web-$((6*7))', 'pve-web-42')
    const keys = page.getByRole('toolbar', { name: '辅助按键' })
    await expect(keys).toBeVisible()
    await page.keyboard.type('sleep 300')
    await page.keyboard.press('Enter')
    await keys.getByRole('button', { name: 'Ctrl+C' }).click()
    await runInTerminal(page, 'echo after-$((40+1))', 'after-41')
    // Sticky Ctrl from the key bar applies to the next typed key.
    await page.keyboard.type('sleep 300')
    await page.keyboard.press('Enter')
    const ctrl = keys.getByRole('button', { name: 'Ctrl', exact: true })
    await ctrl.click()
    await expect(ctrl).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.type('c')
    await expect(ctrl).toHaveAttribute('aria-pressed', 'false')
    await runInTerminal(page, 'echo sticky-$((50+5))', 'sticky-55')
  })

  test('noVNC: console from the action dock, pinch zoom, key bar', async ({ page, pve }) => {
    const vm = (await pve.guests()).find((g) => g.vmid === 101 && g.status === 'running')
    test.skip(!vm, 'VM 101 未运行')
    await page.goto(`/guest/${pve.node}/qemu/101`)
    await page.getByRole('toolbar', { name: '操作' }).getByRole('button', { name: '控制台' }).click()
    await expect(page).toHaveURL(new RegExp(`/console/${pve.node}/qemu/101$`))
    await expectConnected(page)
    const vnc = page.getByTestId('vnc-console')
    await expect(vnc.locator('canvas')).toBeVisible()
    // Pinch (noVNC gesture events) zooms the view locally instead of the guest.
    await vnc.locator('canvas').evaluate((el) => {
      const fire = (type: string, mag: number) =>
        el.dispatchEvent(new CustomEvent(type, { detail: { type: 'pinch', clientX: 100, clientY: 200, magnitudeX: mag, magnitudeY: 0 } }))
      fire('gesturestart', 100)
      fire('gesturemove', 200)
      fire('gestureend', 200)
    })
    const reset = vnc.getByRole('button', { name: '恢复适应窗口' })
    await expect(reset).toHaveText(/200%/)
    await reset.click()
    await expect(reset).toBeHidden()
    // The key bar offers Ctrl+Alt+Del (not sent: VM 101 is a shared sample).
    await expect(page.getByRole('toolbar', { name: '辅助按键' }).getByRole('button', { name: 'Ctrl+Alt+Del' })).toBeVisible()
  })

  test('/shell opens the node shell', async ({ page, pve }) => {
    await page.goto('/shell')
    await expect(page.getByRole('heading', { level: 1, name: 'Shell' })).toBeVisible()
    await page.getByRole('link', { name: '打开 Shell' }).first().click()
    await expect(page).toHaveURL(new RegExp(`/console/${pve.node}/shell$`))
    await expectConnected(page)
  })
})
