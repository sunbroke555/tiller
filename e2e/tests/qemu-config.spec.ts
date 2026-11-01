import type { Locator, Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'

// Area qemu-config: VM hardware, options, Cloud-Init and monitor, against the
// lab. Every @lab test (desktop) creates its own tiny VM in the area's VMID
// range 3400–3498 (named e2e-qemu-config-*) and destroys it afterwards. On
// phones the editors open as sheets on the sample VM 100 and are cancelled.

// A throwaway public key (its private half was never kept); PVE validates the format.
const SSH_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGc+hDza8aezohk7xUgNvvaHGEP0l/RUseHx4T63ItX0 e2e@lab'

const VMID_MIN = 3400
const VMID_MAX = 3498

async function freeVmid(pve: PveApi): Promise<number> {
  const used = new Set((await pve.guests()).map((g) => g.vmid))
  for (let id = VMID_MIN; id <= VMID_MAX; id++) {
    if (used.has(id)) continue
    try {
      await pve.get('/cluster/nextid', { vmid: id })
      return id
    } catch {
      // taken (resources lag behind)
    }
  }
  throw new Error('qemu-config 的 VMID 范围 3400–3498 已用完')
}

type Config = Record<string, string | number | undefined>

async function config(pve: PveApi, vmid: number): Promise<Config> {
  return pve.get<Config>(`/nodes/${pve.node}/qemu/${vmid}/config`)
}

/** Poll the config until `check` passes (tasks and polling settle). */
async function expectConfig(pve: PveApi, vmid: number, check: (c: Config) => boolean, message: string) {
  await expect.poll(async () => check(await config(pve, vmid)), { message, timeout: 30_000 }).toBe(true)
}

/** The open dialog (desktop dialog or phone sheet) with this title. */
function dialog(page: Page, name: string | RegExp): Locator {
  return page.getByRole('dialog', { name })
}

async function rowMenu(page: Page, title: string) {
  await page.getByRole('button', { name: `${title} 的更多操作` }).click()
}

test.describe('qemu-config', { tag: '@lab' }, () => {
  test('hardware: memory, network device and disk lifecycle', async ({ page, pve, cleanup }) => {
    const vmid = await freeVmid(pve)
    await pve.createTestVm({ vmid, name: `e2e-qemu-config-hw-${vmid}`, params: { ostype: 'l26', scsihw: 'virtio-scsi-single' } })
    cleanup.guest(vmid)
    await page.goto(`/guest/${pve.node}/qemu/${vmid}/hardware`)
    const panel = page.getByRole('tabpanel', { name: '硬件' })
    await expect(panel.getByTestId('hw-memory')).toContainText('64 MiB')
    await expect(panel.getByTestId('hw-net0')).toContainText('vmbr0')

    // Memory
    await panel.getByRole('button', { name: '编辑内存' }).click()
    let d = dialog(page, '内存')
    await d.getByRole('textbox', { name: '内存' }).fill('96')
    await d.getByRole('button', { name: '保存' }).click()
    await expect(d).toBeHidden()
    await expectConfig(pve, vmid, (c) => String(c.memory) === '96', 'memory=96')
    await expect(panel.getByTestId('hw-memory')).toContainText('96 MiB')

    // Network device with a VLAN tag
    await panel.getByRole('button', { name: '添加硬件' }).click()
    await dialog(page, '添加硬件').getByRole('button', { name: /网络设备/ }).click()
    d = dialog(page, '添加网络设备')
    await expect(d.getByRole('combobox').first()).toContainText('vmbr0')
    await d.getByRole('textbox', { name: 'VLAN 标签' }).fill('20')
    await d.getByRole('button', { name: '添加' }).click()
    await expect(d).toBeHidden()
    await expect(panel.getByTestId('hw-net1')).toContainText('VLAN 20')
    await expectConfig(pve, vmid, (c) => /bridge=vmbr0/.test(String(c.net1)) && /tag=20/.test(String(c.net1)), 'net1 tag=20')

    await rowMenu(page, '网络设备 (net1)')
    await page.getByRole('menuitem', { name: '删除' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click()
    await expect(panel.getByTestId('hw-net1')).toHaveCount(0)
    await expectConfig(pve, vmid, (c) => c.net1 === undefined, 'net1 removed')

    // New 1 GiB disk → resize → detach → delete the unused volume
    await panel.getByRole('button', { name: '添加硬件' }).click()
    await dialog(page, '添加硬件').getByRole('button', { name: /^硬盘/ }).click()
    d = dialog(page, '添加硬盘')
    await expect(d.getByRole('combobox', { name: '存储' })).toContainText('local-lvm')
    await d.getByRole('textbox', { name: '大小' }).fill('1')
    await d.getByRole('button', { name: '添加' }).click()
    await expect(d).toBeHidden()
    await expect(panel.getByTestId('hw-scsi0')).toContainText('1 GiB', { timeout: 30_000 })
    await expectConfig(pve, vmid, (c) => /size=1G/.test(String(c.scsi0)) && /iothread=1/.test(String(c.scsi0)), 'scsi0 1G with iothread')

    await rowMenu(page, '硬盘 (scsi0)')
    await page.getByRole('menuitem', { name: '扩容' }).click()
    d = dialog(page, '扩容 scsi0')
    await d.getByRole('textbox', { name: '增加' }).fill('1')
    await expect(d).toContainText('扩容后：2 GiB')
    await d.getByRole('button', { name: '扩容' }).click()
    await expect(d).toBeHidden()
    await expectConfig(pve, vmid, (c) => /size=2G/.test(String(c.scsi0)), 'scsi0 resized to 2G')
    await expect(panel.getByTestId('hw-scsi0')).toContainText('2 GiB')

    await rowMenu(page, '硬盘 (scsi0)')
    await page.getByRole('menuitem', { name: '分离' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '分离' }).click()
    await expect(panel.getByTestId('hw-unused0')).toBeVisible()
    await expectConfig(pve, vmid, (c) => c.scsi0 === undefined && /vm-\d+-disk/.test(String(c.unused0)), 'scsi0 detached')

    await rowMenu(page, '未使用的磁盘 0')
    await page.getByRole('menuitem', { name: '删除' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByRole('button', { name: '删除' })).toBeDisabled()
    await confirm.getByRole('textbox').fill('unused0')
    await confirm.getByRole('button', { name: '删除' }).click()
    await expect(panel.getByTestId('hw-unused0')).toHaveCount(0, { timeout: 30_000 })
    await expectConfig(pve, vmid, (c) => c.unused0 === undefined, 'unused0 deleted')
  })

  test('hardware: pending change is shown and reverted; monitor runs commands', async ({ page, pve, cleanup }) => {
    const vmid = await freeVmid(pve)
    await pve.createTestVm({ vmid, name: `e2e-qemu-config-pend-${vmid}` })
    cleanup.guest(vmid)
    await pve.run('POST', `/nodes/${pve.node}/qemu/${vmid}/status/start`)
    await pve.waitForGuest(vmid, (g) => g.status === 'running')
    // Memory cannot be hot-plugged here, so the change stays pending.
    await pve.put(`/nodes/${pve.node}/qemu/${vmid}/config`, { memory: 96 })

    await page.goto(`/guest/${pve.node}/qemu/${vmid}/hardware`)
    const panel = page.getByRole('tabpanel', { name: '硬件' })
    const memory = panel.getByTestId('hw-memory')
    await expect(memory).toContainText('待生效')
    await expect(memory).toContainText('96 MiB')
    await expect(panel.getByRole('status')).toContainText('1 项更改尚未生效')

    await rowMenu(page, '内存')
    await page.getByRole('menuitem', { name: '撤销未生效的更改' }).click()
    await expect(memory).not.toContainText('待生效')
    const pending = await pve.get<{ key: string; pending?: unknown }[]>(`/nodes/${pve.node}/qemu/${vmid}/pending`)
    expect(pending.find((e) => e.key === 'memory')?.pending).toBeUndefined()

    await page.goto(`/guest/${pve.node}/qemu/${vmid}/monitor`)
    const mon = page.getByRole('tabpanel', { name: '监视器' })
    await mon.getByRole('button', { name: 'info status' }).click()
    await expect(mon.getByRole('log')).toContainText('VM status: running')
    await mon.getByRole('textbox', { name: '监视器命令' }).fill('info version')
    await mon.getByRole('textbox', { name: '监视器命令' }).press('Enter')
    await expect(mon.getByRole('log')).toContainText(/\d+\.\d+\.\d+/)
  })

  test('hardware: CD/DVD media, USB and reassigning a disk to another VM', async ({ page, pve, cleanup }) => {
    const vmid = await freeVmid(pve)
    await pve.createTestVm({
      vmid,
      name: `e2e-qemu-config-cd-${vmid}`,
      params: { ostype: 'l26', scsihw: 'virtio-scsi-single', scsi0: 'local-lvm:1' },
    })
    cleanup.guest(vmid)
    const target = await freeVmid(pve)
    await pve.createTestVm({ vmid: target, name: `e2e-qemu-config-tgt-${target}` })
    cleanup.guest(target)
    await page.goto(`/guest/${pve.node}/qemu/${vmid}/hardware`)
    const panel = page.getByRole('tabpanel', { name: '硬件' })

    // CD/DVD with an ISO from the lab's local storage, then eject.
    await panel.getByRole('button', { name: '添加硬件' }).click()
    await dialog(page, '添加硬件').getByRole('button', { name: /CD\/DVD 光驱/ }).click()
    let d = dialog(page, '添加 CD/DVD 光驱')
    await d.getByRole('combobox', { name: 'ISO 镜像' }).click()
    await page.getByRole('option', { name: /alpine-virt/ }).click()
    await d.getByRole('button', { name: '添加' }).click()
    await expect(d).toBeHidden()
    await expectConfig(pve, vmid, (c) => /^local:iso\/alpine-virt.*media=cdrom/.test(String(c.ide2)), 'ide2 iso')
    await panel.getByRole('button', { name: '编辑CD/DVD 光驱 (ide2)' }).click()
    d = dialog(page, 'CD/DVD 光驱 (ide2)')
    await d.getByRole('radio', { name: '无介质' }).click()
    await d.getByRole('button', { name: '保存' }).click()
    await expectConfig(pve, vmid, (c) => c.ide2 === 'none,media=cdrom', 'ide2 ejected')
    await expect(panel.getByTestId('hw-ide2')).toContainText('无介质')

    // USB (SPICE redirection needs no host device).
    await panel.getByRole('button', { name: '添加硬件' }).click()
    await dialog(page, '添加硬件').getByRole('button', { name: /USB 设备/ }).click()
    d = dialog(page, '添加 USB 设备')
    await d.getByRole('button', { name: '添加' }).click()
    await expectConfig(pve, vmid, (c) => c.usb0 === 'spice', 'usb0 spice')

    // Reassign scsi0 to the other VM.
    await rowMenu(page, '硬盘 (scsi0)')
    await page.getByRole('menuitem', { name: '转移给其他虚拟机' }).click()
    d = dialog(page, '转移 scsi0 给其他虚拟机')
    await d.getByRole('combobox', { name: '目标虚拟机' }).click()
    await page.getByRole('option', { name: new RegExp(`^${target} `) }).click()
    await expect(d.getByRole('textbox', { name: '编号' })).toHaveValue('0')
    await d.getByRole('button', { name: '转移' }).click()
    await expect(d).toBeHidden()
    await expectConfig(pve, target, (c) => new RegExp(`vm-${target}-disk`).test(String(c.scsi0)), 'disk now on target')
    await expectConfig(pve, vmid, (c) => c.scsi0 === undefined, 'disk gone from source')
    await expect(panel.getByTestId('hw-scsi0')).toHaveCount(0)
  })

  test('options: toggles, name and boot order', async ({ page, pve, cleanup }) => {
    const vmid = await freeVmid(pve)
    const name = `e2e-qemu-config-opt-${vmid}`
    await pve.createTestVm({ vmid, name, params: { boot: 'order=net0', ide2: 'none,media=cdrom' } })
    cleanup.guest(vmid)
    await page.goto(`/guest/${pve.node}/qemu/${vmid}/options`)
    const panel = page.getByRole('tabpanel', { name: '选项' })

    await panel.getByRole('switch', { name: '开机自启' }).click()
    await expectConfig(pve, vmid, (c) => String(c.onboot) === '1', 'onboot=1')
    await expect(panel.getByRole('switch', { name: '开机自启' })).toBeChecked()

    await panel.getByRole('button', { name: '编辑名称' }).click()
    let d = dialog(page, '名称')
    await d.getByRole('textbox', { name: '名称' }).fill('bad name')
    await expect(d.getByRole('button', { name: '保存' })).toBeDisabled()
    await d.getByRole('textbox', { name: '名称' }).fill(`${name}-x`)
    await d.getByRole('button', { name: '保存' }).click()
    await expect(d).toBeHidden()
    await expectConfig(pve, vmid, (c) => c.name === `${name}-x`, 'renamed')

    await panel.getByRole('button', { name: '编辑启动顺序' }).click()
    d = dialog(page, '启动顺序')
    await d.getByRole('checkbox', { name: 'ide2 参与启动' }).click()
    await d.getByRole('button', { name: 'ide2 上移' }).click()
    await d.getByRole('button', { name: '保存' }).click()
    await expect(d).toBeHidden()
    await expectConfig(pve, vmid, (c) => c.boot === 'order=ide2;net0', 'boot order ide2;net0')
    await expect(panel.getByTestId('opt-boot')).toContainText('ide2 → net0')
  })

  test('cloud-init: add drive, user, IP config and generated config', async ({ page, pve, cleanup }) => {
    const vmid = await freeVmid(pve)
    await pve.createTestVm({ vmid, name: `e2e-qemu-config-ci-${vmid}`, params: { ostype: 'l26' } })
    cleanup.guest(vmid)
    await page.goto(`/guest/${pve.node}/qemu/${vmid}/cloudinit`)
    const panel = page.getByRole('tabpanel', { name: 'Cloud-Init' })
    await expect(panel).toContainText('没有 Cloud-Init 驱动器')
    await panel.getByRole('button', { name: '添加 Cloud-Init 驱动器' }).click()
    let d = dialog(page, '添加 Cloud-Init 驱动器')
    await expect(d.getByRole('combobox', { name: '存储' })).toContainText('local-lvm')
    await d.getByRole('button', { name: '添加' }).click()
    await expect(d).toBeHidden()
    await expectConfig(pve, vmid, (c) => /vm-\d+-cloudinit/.test(String(c.ide0)), 'cloud-init drive on ide0')

    await panel.getByRole('button', { name: '编辑用户' }).click()
    d = dialog(page, '用户')
    await d.getByRole('textbox', { name: '用户名' }).fill('e2euser')
    await d.getByRole('button', { name: '保存' }).click()
    await expectConfig(pve, vmid, (c) => c.ciuser === 'e2euser', 'ciuser')

    await panel.getByRole('button', { name: '编辑IP 配置 (net0)' }).click()
    d = dialog(page, 'IP 配置 (net0)')
    await d.getByRole('radiogroup', { name: 'IPv4 模式' }).getByRole('radio', { name: '静态' }).click()
    await d.getByRole('textbox', { name: 'IPv4/CIDR' }).fill('10.20.30.40/24')
    await d.getByRole('textbox', { name: '网关' }).first().fill('10.20.30.1')
    await d.getByRole('radiogroup', { name: 'IPv6 模式' }).getByRole('radio', { name: 'SLAAC' }).click()
    await d.getByRole('button', { name: '保存' }).click()
    await expectConfig(pve, vmid, (c) => c.ipconfig0 === 'ip=10.20.30.40/24,gw=10.20.30.1,ip6=auto', 'ipconfig0')
    await expect(panel.getByTestId('ci-net0')).toContainText('10.20.30.40/24')

    await panel.getByRole('button', { name: '编辑SSH 公钥' }).click()
    d = dialog(page, 'SSH 公钥')
    await d.getByRole('textbox', { name: '公钥' }).fill(SSH_KEY)
    await d.getByRole('button', { name: '保存' }).click()
    await expectConfig(pve, vmid, (c) => decodeURIComponent(String(c.sshkeys)).includes('e2e@lab'), 'sshkeys')
    await expect(panel.getByTestId('ci-sshkeys')).toContainText('e2e@lab')

    await panel.getByRole('button', { name: '查看生成的配置' }).click()
    d = dialog(page, '生成的 Cloud-Init 配置')
    await expect(d).toContainText('user: e2euser')
    await d.getByRole('radio', { name: '网络配置' }).click()
    await expect(d).toContainText('10.20.30.40')
  })
})

test.describe('VM config on phones', { tag: '@mobile' }, () => {
  test('hardware editors open as sheets (VM 100, cancelled)', async ({ page, pve }) => {
    test.skip(!(await pve.guests()).some((g) => g.vmid === 100 && g.type === 'qemu'), '实验机里没有 VM 100')
    await page.goto(`/guest/${pve.node}/qemu/100/hardware`)
    const panel = page.getByRole('tabpanel', { name: '硬件' })
    await expect(panel.getByTestId('hw-memory')).toBeVisible()

    await panel.getByRole('button', { name: '编辑内存' }).click()
    let d = dialog(page, '内存')
    await expect(d.getByRole('textbox', { name: '内存' })).toBeVisible()
    await d.getByRole('button', { name: '取消' }).click()
    await expect(d).toBeHidden()

    await panel.getByRole('button', { name: '添加硬件' }).click()
    await dialog(page, '添加硬件').getByRole('button', { name: /网络设备/ }).click()
    d = dialog(page, '添加网络设备')
    await expect(d.getByRole('textbox', { name: 'VLAN 标签' })).toBeVisible()
    await d.getByRole('button', { name: '取消' }).click()
    await expect(d).toBeHidden()

    await page.goto(`/guest/${pve.node}/qemu/100/options`)
    await expect(page.getByRole('tabpanel', { name: '选项' }).getByRole('switch', { name: '开机自启' })).toBeVisible()
  })
})
