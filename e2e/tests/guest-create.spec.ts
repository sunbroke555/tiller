import type { Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'

// Area guest-create: the VM and CT creation wizards. Guests are created
// (@lab, desktop) in the VMID range 3700–3799 only, named e2e-guest-create-*,
// kept tiny and destroyed after each test. On phones the wizard is walked to
// 确认 without creating anything.
// Screenshots of the wizards: guest-create.visual.spec.ts.

const RANGE = { min: 3700, max: 3799 }

async function freeVmid(pve: PveApi): Promise<number> {
  const used = new Set((await pve.guests()).map((g) => g.vmid))
  for (let id = RANGE.min; id <= RANGE.max; id++) if (!used.has(id)) return id
  throw new Error('3700–3799 范围内没有空闲的 VMID')
}

/** Guest config with every value as a string (numbers come back as numbers or strings). */
async function config(pve: PveApi, path: string): Promise<Record<string, string>> {
  const raw = await pve.get<Record<string, string | number>>(path)
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]))
}

function nextButton(page: Page) {
  return page.getByRole('button', { name: /^下一步/ })
}

async function next(page: Page, expectStep: string) {
  await nextButton(page).click()
  await expect(page.getByRole('heading', { level: 2, name: expectStep, exact: true })).toBeVisible()
}

/** Wait for VmidInput's auto-fill, then type our id and wait for the check. */
async function setVmid(page: Page, label: string, vmid: number) {
  const input = page.getByRole('textbox', { name: label, exact: true })
  await expect(input).not.toHaveValue('')
  await input.fill(String(vmid))
  await expect(page.getByText('可用', { exact: true })).toBeVisible()
}

/** Pick a unit in a SizeInput, then type the value. */
async function setSize(page: Page, label: string, value: string, unit: 'MiB' | 'GiB') {
  const field = page.locator('[data-slot="form-field"]').filter({ has: page.getByRole('textbox', { name: label, exact: true }) })
  const unitBox = field.getByRole('combobox', { name: '单位' })
  if ((await unitBox.count()) && !(await unitBox.textContent())?.includes(unit)) {
    await unitBox.click()
    await page.getByRole('option', { name: unit, exact: true }).click()
  }
  await page.getByRole('textbox', { name: label, exact: true }).fill(value)
}

test.describe('创建向导', () => {
  test('创建虚拟机：完整走一遍向导', { tag: '@lab' }, async ({ page, pve, cleanup }) => {
    test.setTimeout(150_000)
    const vmid = await freeVmid(pve)
    const name = `e2e-guest-create-vm-${vmid}`
    cleanup.guest(vmid)

    await page.goto('/create/qemu')
    await expect(page.getByRole('heading', { level: 1, name: '创建虚拟机' })).toBeVisible()

    // General
    await setVmid(page, 'VM ID', vmid)
    await page.getByLabel('名称', { exact: true }).fill(name)
    await next(page, '操作系统')

    // OS: no media, Linux
    await page.getByRole('radio', { name: /不使用介质/ }).click()
    await expect(page.getByRole('radio', { name: /Linux/ })).toHaveAttribute('aria-checked', 'true')
    await next(page, '系统')

    // System: enable the guest agent
    await page.getByRole('switch', { name: /QEMU Guest Agent/ }).click()
    await next(page, '磁盘')

    // Disks: one 1 GiB disk on scsi0
    await expect(page.getByRole('region', { name: '磁盘 scsi0', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '存储' })).toContainText('local-lvm')
    await setSize(page, '大小', '1', 'GiB')
    await next(page, 'CPU')
    await next(page, '内存')

    // Memory: 64 MiB, ballooning stays on
    await setSize(page, '内存', '64', 'MiB')
    await next(page, '网络')
    await expect(page.getByRole('combobox', { name: '网桥' })).toContainText('vmbr0')
    await next(page, '确认')

    // Review
    const general = page.getByRole('region', { name: '常规', exact: true })
    await expect(general).toContainText(String(vmid))
    await expect(general).toContainText(name)
    await expect(page.getByRole('region', { name: '磁盘', exact: true })).toContainText('1 GiB')
    await expect(page.getByRole('region', { name: '内存', exact: true })).toContainText('64 MiB')

    // Back via the step list and forward again keeps the values.
    await page.getByRole('button', { name: '修改内存' }).click()
    await expect(page.getByRole('textbox', { name: '内存', exact: true })).toHaveValue('64')
    await nextButton(page).click()
    await next(page, '确认')

    await page.getByRole('button', { name: '创建虚拟机' }).click()
    await expect(page).toHaveURL(new RegExp(`/guest/${pve.node}/qemu/${vmid}$`), { timeout: 90_000 })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)

    const cfg = await config(pve, `/nodes/${pve.node}/qemu/${vmid}/config`)
    expect(cfg).toMatchObject({ name, memory: '64', ostype: 'l26', scsihw: 'virtio-scsi-single', cpu: 'x86-64-v2-AES', agent: '1' })
    expect(String(cfg.scsi0)).toMatch(/^local-lvm:vm-\d+-disk-0,iothread=1,size=1G$/)
    expect(String(cfg.ide2)).toBe('none,media=cdrom')
    expect(String(cfg.net0)).toMatch(/^virtio=[0-9A-F:]{17},bridge=vmbr0,firewall=1$/)
  })

  test('创建容器：完整走一遍向导', { tag: '@lab' }, async ({ page, pve, cleanup }) => {
    test.setTimeout(150_000)
    const vmid = await freeVmid(pve)
    const hostname = `e2e-guest-create-ct-${vmid}`
    cleanup.guest(vmid)

    await page.goto(`/create/lxc?node=${pve.node}`)
    await expect(page.getByRole('heading', { level: 1, name: '创建容器' })).toBeVisible()

    // General: password mismatch is caught first.
    await setVmid(page, 'CT ID', vmid)
    await page.getByLabel('主机名', { exact: true }).fill(hostname)
    await page.getByLabel('密码', { exact: true }).fill('e2e-secret')
    await page.getByLabel('确认密码', { exact: true }).fill('e2e-other')
    await nextButton(page).click()
    await expect(page.getByText('两次输入的密码不一致')).toBeVisible()
    await page.getByLabel('确认密码', { exact: true }).fill('e2e-secret')
    await expect(page.getByText('两次输入的密码不一致')).toHaveCount(0)
    await next(page, '模板')

    // Template
    await page.getByRole('combobox', { name: '模板' }).click()
    await page.getByRole('option', { name: /alpine/ }).first().click()
    await next(page, '磁盘')

    await expect(page.getByRole('combobox', { name: '存储' })).toContainText('local-lvm')
    await setSize(page, '大小', '1', 'GiB')
    await next(page, 'CPU')
    await next(page, '内存')
    await setSize(page, '内存', '64', 'MiB')
    await setSize(page, '交换分区', '0', 'MiB')
    await next(page, '网络')

    // Static IPv4 with a validation round trip.
    await page.getByRole('radio', { name: '静态' }).first().click()
    await page.getByRole('textbox', { name: 'IPv4/CIDR', exact: true }).fill('10.250.0.5')
    await nextButton(page).click()
    await expect(page.getByText('请输入 IPv4/CIDR')).toBeVisible()
    await page.getByRole('textbox', { name: 'IPv4/CIDR', exact: true }).fill('10.250.0.5/24')
    await next(page, 'DNS')
    await page.getByLabel('DNS 服务器', { exact: true }).fill('10.250.0.1')
    await next(page, '确认')

    await expect(page.getByRole('region', { name: '网络', exact: true })).toContainText('10.250.0.5/24')
    await page.getByRole('button', { name: /API 参数/ }).click()
    await expect(page.getByText('••••••')).toBeVisible() // password masked

    await page.getByRole('button', { name: '创建容器' }).click()
    await expect(page).toHaveURL(new RegExp(`/guest/${pve.node}/lxc/${vmid}$`), { timeout: 120_000 })

    const cfg = await config(pve, `/nodes/${pve.node}/lxc/${vmid}/config`)
    expect(cfg).toMatchObject({ hostname, memory: '64', swap: '0', unprivileged: '1', features: 'nesting=1', nameserver: '10.250.0.1' })
    expect(String(cfg.rootfs)).toMatch(/^local-lvm:vm-\d+-disk-0,size=1G$/)
    expect(String(cfg.net0)).toMatch(/name=eth0,bridge=vmbr0,firewall=1,.*ip=10\.250\.0\.5\/24/)
  })

  test('手机：向导走到确认页（不创建）', { tag: '@mobile' }, async ({ page }) => {
    await page.goto('/create/qemu')
    await expect(page.getByRole('heading', { level: 1, name: '创建虚拟机' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'VM ID', exact: true })).not.toHaveValue('')
    await expect(page.getByText('可用', { exact: true })).toBeVisible()
    await page.getByLabel('名称', { exact: true }).fill('e2e-guest-create-phone')
    await next(page, '操作系统')
    await page.getByRole('radio', { name: /不使用介质/ }).click()
    await next(page, '系统')
    await next(page, '磁盘')
    // The step is invalid until the storages have loaded.
    await expect(page.getByRole('combobox', { name: '存储' })).toContainText('local-lvm')
    await setSize(page, '大小', '1', 'GiB') // the default 32 GiB does not fit the lab
    await next(page, 'CPU')
    await next(page, '内存')
    await next(page, '网络')
    await next(page, '确认')
    await expect(page.getByRole('region', { name: '常规', exact: true })).toContainText('e2e-guest-create-phone')
    await expect(page.getByRole('button', { name: '创建虚拟机' })).toBeEnabled()
    // Back to an earlier step from the summary.
    await page.getByRole('button', { name: '修改内存' }).click()
    await expect(page.getByRole('heading', { level: 2, name: '内存', exact: true })).toBeVisible()
  })

  test('VM ID 已占用时不能继续', async ({ page }) => {
    await page.goto('/create/qemu')
    const input = page.getByRole('textbox', { name: 'VM ID', exact: true })
    await expect(input).not.toHaveValue('')
    await input.fill('100')
    await expect(page.getByText('ID 100 已被使用').first()).toBeVisible()
    await nextButton(page).click()
    await expect(page.getByRole('heading', { level: 2, name: '常规', exact: true })).toBeVisible()
    // Later steps cannot be reached from the step list either.
    await expect(page.getByRole('navigation', { name: '步骤' }).filter({ visible: true }).getByRole('button', { name: /确认/ })).toBeDisabled()
  })

  test('深链接到后面的步骤会退回第一步', async ({ page }) => {
    await page.goto('/create/lxc?step=confirm')
    await expect(page.getByRole('heading', { level: 2, name: '常规', exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/create\/lxc$/)
  })

  test('入口：概览的“新建”菜单和命令面板', async ({ page, mobile }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '新建' }).click()
    await page.getByRole('menuitem', { name: '创建容器' }).click()
    await expect(page).toHaveURL(/\/create\/lxc$/)

    await page.goto('/')
    if (mobile) await page.getByRole('button', { name: '搜索' }).click()
    else await page.keyboard.press('Control+k')
    await page.getByRole('dialog').getByRole('combobox').fill('创建虚拟机')
    await page.getByRole('option', { name: '创建虚拟机' }).first().click()
    await expect(page).toHaveURL(/\/create\/qemu$/)
  })
})
