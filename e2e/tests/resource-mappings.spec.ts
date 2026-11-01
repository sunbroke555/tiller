import type { Page } from '@playwright/test'

import { expect, labSsh, test, type PveApi } from '../fixtures'
import { mockMappingApi } from './resource-mappings.mocks'

// Area resource-mappings: PCI / USB / directory mappings and custom CPU
// models (/datacenter/mappings/{pci,usb,dir,cpu}).
//
// Lab tests (@lab, desktop) create mappings and CPU models named e2e-rm-*
// for the lab node the app talks to (PVE_LAB_NODE; on the cluster the dialog
// preselects it), using its real (virtio) PCI devices, the QEMU USB tablet
// and the directory /var/lib/e2e-rm-dir (made over SSH, see labSsh).
// Everything e2e-rm-* is removed before and after. Phone tests (@mobile)
// only check layout, with page.route() mocks (GPUs, mdev, USB devices).

const PREFIX = 'e2e-rm-'
const DIR = '/var/lib/e2e-rm-dir'

interface Mapping {
  id: string
  map: string[]
  description?: string
  'live-migration-capable'?: number
}

/** On the node the app talks to (pve.node), single lab or cluster. */
const ssh = (cmd: string) => labSsh(cmd)

async function sweep(pve: PveApi) {
  for (const kind of ['pci', 'usb', 'dir']) {
    for (const m of await pve.get<Mapping[]>(`/cluster/mapping/${kind}`)) if (m.id.startsWith(PREFIX)) await pve.del(`/cluster/mapping/${kind}/${m.id}`)
  }
  for (const m of await pve.get<{ cputype: string }[]>('/cluster/qemu/custom-cpu-models')) {
    if (m.cputype.startsWith(`custom-${PREFIX}`)) await pve.del(`/cluster/qemu/custom-cpu-models/${m.cputype}`)
  }
}

const card = (page: Page, id: string) => page.locator(`[data-mapping="${id}"]`)

async function menu(page: Page, label: string, item: string) {
  await page.getByRole('button', { name: `更多操作：${label}`, exact: true }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

test.describe('resource mappings on the lab', { tag: '@lab' }, () => {
  test.beforeAll(async ({ pve }) => sweep(pve))
  test.afterAll(async ({ pve }) => {
    await sweep(pve)
    await ssh(`rm -rf ${DIR}`).catch(() => undefined)
  })

  test('PCI mapping: create, edit devices, remove one, flags, delete', async ({ page, pve }) => {
    test.setTimeout(120_000)
    const id = `${PREFIX}pci`
    const get = () => pve.get<Mapping>(`/cluster/mapping/pci/${id}`)
    await page.goto('/datacenter/mappings')
    await expect(page).toHaveURL(/\/datacenter\/mappings\/pci$/)
    await page.getByRole('button', { name: '添加 PCI 映射' }).first().click()

    const dialog = page.getByRole('dialog', { name: '添加 PCI 映射' })
    await dialog.getByLabel('名称').fill(id)
    // The nested lab has no IOMMU: the picker says so.
    await expect(dialog.getByText('没有检测到 IOMMU')).toBeVisible()
    await dialog.getByRole('checkbox', { name: /^0000:00:12\.0 / }).click()
    await dialog.getByLabel('说明').fill('e2e 网卡')
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()

    const m = await get()
    expect(m.map).toEqual([`node=${pve.node},path=0000:00:12.0,id=1af4:1000,subsystem-id=1af4:0001`])
    // PVE 9.2 returns mapping descriptions undecoded (UTF-8 bytes as Latin-1); the UI repairs them.
    expect(Buffer.from(m.description ?? '', 'latin1').toString('utf8')).toBe('e2e 网卡')
    await expect(card(page, id)).toContainText('e2e 网卡')
    await expect(card(page, id)).toContainText('0000:00:12.0')
    await expect(card(page, id)).toContainText('与主机一致')

    // Add a second device on the node.
    await menu(page, `${id} · ${pve.node}`, '编辑此节点')
    const nodeDialog = page.getByRole('dialog', { name: `${id} · ${pve.node}` })
    await expect(nodeDialog.getByRole('checkbox', { name: /^0000:00:12\.0 / })).toBeChecked()
    await nodeDialog.getByRole('checkbox', { name: /^0000:01:01\.0 / }).click()
    await expect(nodeDialog.getByText('选择多个设备时')).toBeVisible()
    await nodeDialog.getByRole('button', { name: '保存' }).click()
    await expect(nodeDialog).toBeHidden()
    await expect.poll(async () => (await get()).map.length).toBe(2)
    await expect(card(page, id).locator('[data-entry]')).toHaveCount(2)

    // Remove just that device.
    await menu(page, `${id} · ${pve.node}`, '移除 0000:01:01.0')
    await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click()
    await expect.poll(async () => (await get()).map).toEqual(m.map)

    // Mapping-wide flags.
    await menu(page, id, '编辑')
    const edit = page.getByRole('dialog', { name: `编辑 ${id}` })
    await edit.getByText('可实时迁移（实验性）').click()
    await edit.getByRole('button', { name: '保存' }).click()
    await expect(edit).toBeHidden()
    await expect.poll(async () => (await get())['live-migration-capable']).toBe(1)
    await expect(card(page, id)).toContainText('可实时迁移')

    // Delete (type the name to confirm).
    await menu(page, id, '删除映射')
    const confirm = page.getByRole('alertdialog')
    await confirm.getByRole('textbox').fill(id)
    await confirm.getByRole('button', { name: '删除' }).click()
    await expect(card(page, id)).toHaveCount(0)
    expect((await pve.get<Mapping[]>('/cluster/mapping/pci')).some((x) => x.id === id)).toBe(false)
  })

  test('USB mapping by port', async ({ page, pve }) => {
    const id = `${PREFIX}usb`
    await page.goto('/datacenter/mappings/usb')
    await page.getByRole('button', { name: '添加 USB 映射' }).first().click()
    const dialog = page.getByRole('dialog', { name: '添加 USB 映射' })
    await dialog.getByLabel('名称').fill(id)
    await dialog.getByRole('radio', { name: '按 USB 端口' }).click()
    // The QEMU tablet of the lab VM (hubs are hidden).
    await dialog.getByRole('button', { name: /QEMU USB Tablet/ }).click()
    await expect(dialog.getByLabel('USB 端口')).toHaveValue('1-1')
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect((await pve.get<Mapping>(`/cluster/mapping/usb/${id}`)).map).toEqual([`node=${pve.node},path=1-1,id=0627:0001`])
    await expect(card(page, id)).toContainText('端口 1-1')
    await expect(card(page, id)).toContainText('与主机一致')
  })

  test('directory mapping and its node check', async ({ page, pve }) => {
    const id = `${PREFIX}dir`
    await ssh(`mkdir -p ${DIR}`)
    await page.goto('/datacenter/mappings/dir')
    await page.getByRole('button', { name: '添加目录映射' }).first().click()
    const dialog = page.getByRole('dialog', { name: '添加目录映射' })
    await dialog.getByLabel('名称').fill(id)
    await dialog.getByLabel('主机目录').fill('/bad,path')
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog.getByText('路径里不能有')).toHaveCount(2)
    await dialog.getByLabel('主机目录').fill(DIR)
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect((await pve.get<Mapping>(`/cluster/mapping/dir/${id}`)).map).toEqual([`node=${pve.node},path=${DIR}`])
    await expect(card(page, id)).toContainText('与主机一致')

    // The node reports a missing directory.
    await ssh(`rmdir ${DIR}`)
    await page.reload()
    await expect(card(page, id)).toContainText('does not exist')
  })

  test('custom CPU model: create, edit, delete', async ({ page, pve }) => {
    const name = `${PREFIX}cpu`
    const get = () => pve.get<Record<string, unknown>>(`/cluster/qemu/custom-cpu-models/custom-${name}`)
    await page.goto('/datacenter/mappings/cpu')
    await page.getByRole('button', { name: '添加 CPU 型号' }).first().click()
    const dialog = page.getByRole('dialog', { name: '添加 CPU 型号' })
    await dialog.getByLabel('名称').fill(name)
    await dialog.getByRole('combobox', { name: '基础型号' }).click()
    await page.getByRole('option').filter({ hasText: /^EPYC-Rome\s*AMD$/ }).click()
    await dialog.getByText('隐藏虚拟化特征').click()
    await dialog.getByRole('radio', { name: '指定' }).click()
    await dialog.getByRole('textbox', { name: '物理地址位数' }).fill('42')
    await dialog.getByLabel('搜索 CPU 标志').fill('aes')
    await dialog.locator('[data-flag="aes"]').getByRole('radio', { name: '开' }).click()
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(get).toMatchObject({ 'reported-model': 'EPYC-Rome', hidden: 1, 'phys-bits': '42', flags: '+aes' })

    const row = page.locator(`[data-cpu-model="${name}"]`)
    await expect(row).toContainText('基于 EPYC-Rome')
    await expect(row).toContainText('+aes')

    await row.getByRole('button', { name: `CPU 型号 ${name}` }).click()
    const edit = page.getByRole('dialog', { name: `编辑 CPU 型号 ${name}` })
    await edit.getByRole('radio', { name: '默认' }).first().click()
    await edit.getByLabel('搜索 CPU 标志').fill('pcid')
    await edit.locator('[data-flag="pcid"]').getByRole('radio', { name: '关' }).click()
    await edit.getByRole('button', { name: '保存' }).click()
    await expect(edit).toBeHidden()
    await expect.poll(get).toMatchObject({ flags: '+aes;-pcid' })
    expect((await get())['phys-bits']).toBeUndefined()

    await menu(page, name, '删除')
    await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click()
    await expect(row).toHaveCount(0)
  })
})

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

test.describe('phone layout', { tag: '@mobile' }, () => {
  test('PCI mappings: per-node status and the device picker', async ({ page, pve }) => {
    await mockMappingApi(page, pve.node)
    await page.goto('/datacenter/mappings/pci')
    const t4 = card(page, 'e2e-rm-t4')
    await expect(t4).toContainText('中介设备')
    await expect(t4.locator('[data-state="ok"]')).toHaveCount(2)
    await expect(t4).toContainText('集群中没有这个节点')
    await expect(t4).toContainText('NVIDIA Corporation TU104GL [Tesla T4]')
    await expect(card(page, 'e2e-rm-nic')).toContainText('iommugroup 不匹配')
    await noHorizontalScroll(page)

    await page.getByRole('button', { name: '添加 PCI 映射' }).click()
    const dialog = page.getByRole('dialog', { name: '添加 PCI 映射' })
    // The multi-function GPU gets an "all functions" row.
    await expect(dialog.locator('[data-pci="0000:01:00"]')).toContainText('整个设备')
    await dialog.getByRole('checkbox', { name: /^0000:03:00\.0 / }).click()
    await expect(dialog.getByText('同一个 IOMMU 组')).toBeVisible()
    await dialog.getByText('用于中介设备（mdev）').click()
    await expect(dialog.locator('[data-pci="0000:04:00.0"]')).toHaveCount(0)
    await expect(dialog.locator('[data-pci="0000:02:00.0"]')).toBeVisible()
    await noHorizontalScroll(page)
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
  })

  test('USB, directory and CPU model lists', async ({ page, pve }) => {
    await mockMappingApi(page, pve.node)
    await page.goto('/datacenter/mappings/usb')
    await expect(card(page, 'e2e-rm-dongle')).toContainText('Logitech USB Receiver')
    await expect(card(page, 'e2e-rm-port')).toContainText('端口 1-4 上没有设备')
    await page.getByRole('button', { name: '添加 USB 映射' }).click()
    const dialog = page.getByRole('dialog', { name: '添加 USB 映射' })
    await expect(dialog.getByRole('button', { name: /EHCI/ })).toHaveCount(0)
    await dialog.getByRole('button', { name: /Kingston/ }).click()
    await expect(dialog.getByLabel('设备 ID')).toHaveValue('0951:1666')
    await dialog.getByRole('button', { name: '取消' }).click()

    await page.getByRole('link', { name: '目录', exact: true }).click()
    await expect(card(page, 'e2e-rm-missing')).toContainText('Path /srv/missing does not exist')
    await expect(card(page, 'e2e-rm-share').locator('[data-state="ok"]')).toHaveCount(1)
    await noHorizontalScroll(page)

    await page.getByRole('link', { name: 'CPU 型号', exact: true }).click()
    await expect(page.locator('[data-cpu-model="e2e-rm-win"]')).toContainText('-hypervisor')
    await expect(page.locator('[data-cpu-model="e2e-rm-epyc"]')).toContainText('CPUID level 30')
    await noHorizontalScroll(page)
  })
})
