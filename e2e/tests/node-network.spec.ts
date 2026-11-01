import type { Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'
import { mockNetwork } from './node-network.mock'

// Area node-network: interface list, create / edit / delete, pending diff,
// apply and revert.
//
// Lab writes (@lab, desktop) happen on the 3-node lab cluster's pvelab-c3
// only, on its spare link-down NICs ens19 / ens20, with objects named
// vmbr9x / bond9 / <dev>.9xx. vmbr0, ens18 and the management address are
// never touched. Every test reverts pending changes and removes (and
// un-applies) its objects afterwards. Phone checks are read-only with a
// mocked interface list.

const LAB_NODE = 'pvelab-c3'
const NET = `/nodes/${LAB_NODE}/network`
const OURS = /^(vmbr9\d|bond9|(ens19|ens20|bond9)\.9\d\d)$/

interface Iface {
  iface: string
  type: string
  active?: number
  autostart?: number
  cidr?: string
  comments?: string
  bridge_ports?: string
  bridge_vlan_aware?: number
  bridge_vids?: string
  mtu?: string | number
  slaves?: string
  bond_mode?: string
  'bond-primary'?: string
}

/** Revert pending changes; remove our test objects from the running config too. */
async function resetNetwork(pve: PveApi) {
  await pve.del(NET)
  const ours = (await pve.get<Iface[]>(NET)).filter((i) => OURS.test(i.iface))
  if (ours.length === 0) return
  // VLANs first, then bonds and bridges.
  ours.sort((a, b) => Number(b.iface.includes('.')) - Number(a.iface.includes('.')))
  for (const i of ours) await pve.del(`${NET}/${i.iface}`)
  await pve.run('PUT', NET)
}

const panel = (page: Page) => page.getByRole('tabpanel', { name: '网络' })
const dialog = (page: Page) => page.getByRole('dialog')
const pendingRegion = (page: Page) => panel(page).getByRole('region', { name: '待应用的更改' })

async function createFromMenu(page: Page, type: string) {
  await panel(page).getByRole('button', { name: '创建' }).click()
  await page.getByRole('menuitem', { name: type }).click()
  await expect(dialog(page)).toContainText(`创建 ${type}`)
}

async function pickOption(page: Page, label: string, option: string | RegExp) {
  await dialog(page).getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: option }).click()
}

test.describe('node network on the lab cluster', { tag: '@lab' }, () => {
  test.beforeEach(async ({ pve }) => {
    const nodes = await pve.get<{ node: string; status: string }[]>('/nodes')
    test.skip(!nodes.some((n) => n.node === LAB_NODE && n.status === 'online'), `实验集群里没有在线的 ${LAB_NODE}`)
    await resetNetwork(pve)
  })

  test('list, create / edit / delete a bridge, diff and revert', async ({ page, pve, cleanup }) => {
    cleanup.add(() => resetNetwork(pve))
    await page.goto(`/node/${LAB_NODE}/network`)
    const p = panel(page)
    // Read: management bridge and the spare NICs with their altnames.
    await expect(p.getByRole('list', { name: '网桥' })).toContainText('vmbr0')
    await expect(p.getByRole('list', { name: '网桥' })).toContainText('192.168.0.248/24')
    await expect(p.getByRole('list', { name: '物理网卡' })).toContainText('ens19')
    await expect(p.getByRole('list', { name: '物理网卡' })).toContainText('enp0s19')
    await expect(pendingRegion(page)).toHaveCount(0)

    // Create vmbr91 on ens19 (the name is pre-filled with the next free vmbrN).
    await createFromMenu(page, 'Linux 网桥')
    const d = dialog(page)
    await expect(d.getByRole('textbox', { name: '名称' })).toHaveValue(/^vmbr\d+$/)
    await d.getByRole('textbox', { name: '名称' }).fill('vmbr91')
    await d.getByRole('group', { name: '选择网桥端口' }).getByRole('button', { name: 'ens19' }).click()
    // ens18 is a port of vmbr0: offered but disabled.
    await expect(d.getByRole('group', { name: '选择网桥端口' }).getByRole('button', { name: /ens18/ })).toBeDisabled()
    await d.getByRole('textbox', { name: 'IPv4/CIDR' }).fill('10.91.0.1/40')
    await expect(d.getByText('前缀长度应在 8–32 之间')).toBeVisible()
    await d.getByRole('textbox', { name: 'IPv4/CIDR' }).fill('10.91.0.1/24')
    await d.getByRole('textbox', { name: '注释' }).fill('e2e-node-network')
    await d.getByRole('button', { name: '创建', exact: true }).click()
    await expect(d).toBeHidden()

    const created = await pve.get<Iface>(`${NET}/vmbr91`)
    expect(created).toMatchObject({ type: 'bridge', bridge_ports: 'ens19', cidr: '10.91.0.1/24', autostart: 1 })
    expect(created.comments?.trim()).toBe('e2e-node-network')

    await expect(pendingRegion(page)).toContainText('vmbr91')
    const row = p.getByRole('button', { name: '编辑 vmbr91' })
    await expect(row).toContainText('待新增')
    await expect(row).toContainText('10.91.0.1/24')

    // Edit: VLAN aware with a VID range, MTU, comment cleared.
    await row.click()
    await expect(d).toContainText('编辑 Linux 网桥 vmbr91')
    await d.getByRole('switch', { name: 'VLAN 感知' }).click()
    await d.getByRole('button', { name: '高级选项' }).click()
    // PVE refuses a bridge MTU above its ports' (ens19 has 1500).
    await d.getByRole('textbox', { name: 'MTU' }).fill('9000')
    await d.getByRole('button', { name: '保存' }).click()
    await expect(d.getByRole('alert').first()).toContainText('mtu 1500 is lower')
    await d.getByRole('textbox', { name: 'MTU' }).fill('1400')
    await d.getByRole('textbox', { name: 'VLAN ID 范围' }).fill('2-100')
    await d.getByRole('textbox', { name: '注释' }).fill('')
    await d.getByRole('button', { name: '保存' }).click()
    await expect(d).toBeHidden()
    const edited = await pve.get<Iface>(`${NET}/vmbr91`)
    expect(edited).toMatchObject({ bridge_vlan_aware: 1, bridge_vids: '2-100', cidr: '10.91.0.1/24', bridge_ports: 'ens19' })
    expect(Number(edited.mtu)).toBe(1400)
    expect(edited.comments ?? '').toBe('')
    await expect(p.getByRole('button', { name: '编辑 vmbr91' })).toContainText('VLAN 感知')

    // The diff shows the new stanza.
    await pendingRegion(page).getByRole('button', { name: '差异' }).click()
    const diff = pendingRegion(page).getByRole('region', { name: '配置差异' })
    await expect(diff).toContainText('+iface vmbr91 inet static')
    await expect(diff).toContainText('bridge-vlan-aware yes')

    // Delete (pending).
    await p.getByRole('button', { name: '更多操作：vmbr91' }).click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click()
    await expect(p.getByRole('button', { name: '编辑 vmbr91' })).toHaveCount(0)
    expect((await pve.get<Iface[]>(NET)).some((i) => i.iface === 'vmbr91')).toBe(false)

    // Edit a physical NIC, then revert everything.
    await p.getByRole('button', { name: '编辑 ens20' }).click()
    await expect(d).toContainText('编辑 网卡 ens20')
    await expect(d.getByRole('textbox', { name: '名称' })).toHaveCount(0)
    await expect(d).toContainText('enp0s20')
    await d.getByRole('textbox', { name: '注释' }).fill('e2e-node-network')
    await d.getByRole('button', { name: '保存' }).click()
    await expect(d).toBeHidden()
    await expect(p.getByRole('button', { name: '编辑 ens20' })).toContainText('待修改')

    await pendingRegion(page).getByRole('button', { name: '还原' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '还原' }).click()
    await expect(pendingRegion(page)).toHaveCount(0)
    expect((await pve.get<Iface>(`${NET}/ens20`)).comments).toBeUndefined()
  })

  test('bond and VLAN with validation, then apply', async ({ page, pve, cleanup }) => {
    test.setTimeout(150_000)
    cleanup.add(() => resetNetwork(pve))
    await page.goto(`/node/${LAB_NODE}/network`)
    const p = panel(page)
    const d = dialog(page)
    await expect(p.getByRole('list', { name: '网桥' })).toContainText('vmbr0')

    // Bond9: active-backup over ens19 + ens20 with ens19 as primary.
    await createFromMenu(page, 'Linux Bond')
    await d.getByRole('textbox', { name: '名称' }).fill('bond9')
    const slaves = d.getByRole('group', { name: '选择成员网卡' })
    await slaves.getByRole('button', { name: 'ens19' }).click()
    await slaves.getByRole('button', { name: 'ens20' }).click()
    await expect(d.getByRole('combobox', { name: '哈希策略' })).toHaveCount(0)
    await pickOption(page, '模式', /active-backup/)
    await pickOption(page, '主网卡', 'ens19')
    await d.getByRole('button', { name: '创建', exact: true }).click()
    await expect(d).toBeHidden()
    expect(await pve.get<Iface>(`${NET}/bond9`)).toMatchObject({
      type: 'bond',
      slaves: 'ens19 ens20',
      bond_mode: 'active-backup',
      'bond-primary': 'ens19',
    })

    // VLAN: a custom name needs parent + id; "<parent>.<id>" derives both.
    await createFromMenu(page, 'Linux VLAN')
    await expect(d.getByRole('textbox', { name: '名称' })).toHaveValue(/^vlan\d+$/)
    await d.getByRole('textbox', { name: '名称' }).fill('e2emgmt')
    await d.getByRole('button', { name: '创建', exact: true }).click()
    await expect(d.getByText('请填写 VLAN 的父接口')).toBeVisible()
    await expect(d.getByText('请填写 VLAN ID')).toBeVisible()
    await d.getByRole('textbox', { name: '名称' }).fill('bond9.901')
    await expect(d.getByText('请填写 VLAN 的父接口')).toHaveCount(0)
    await expect(d).toContainText('由名称决定')
    await d.getByRole('textbox', { name: 'IPv4/CIDR' }).fill('10.99.1.2/24')
    await d.getByRole('button', { name: '创建', exact: true }).click()
    await expect(d).toBeHidden()
    expect(await pve.get<Iface>(`${NET}/bond9.901`)).toMatchObject({ type: 'vlan', cidr: '10.99.1.2/24' })
    await expect(p.getByRole('list', { name: 'VLAN' })).toContainText('VLAN 901 @ bond9')

    // Apply: confirm dialog with the diff, then ifreload as a task.
    await pendingRegion(page).getByRole('button', { name: '应用配置' }).click()
    const apply = page.getByRole('dialog', { name: '应用网络配置？' })
    await expect(apply.getByRole('region', { name: '配置差异' })).toContainText('iface bond9 inet manual')
    await expect(apply).not.toContainText('承载默认网关')
    await apply.getByRole('button', { name: '应用', exact: true }).click()
    await expect(apply).toBeHidden()
    await expect(pendingRegion(page)).toHaveCount(0, { timeout: 60_000 })
    await expect.poll(async () => (await pve.get<Iface>(`${NET}/bond9`)).active, { timeout: 30_000 }).toBe(1)
    await expect(p.getByRole('button', { name: '编辑 bond9', exact: true })).not.toContainText('未激活')
  })

  test('OVS without Open vSwitch installed shows the API error', async ({ page, pve, cleanup }) => {
    cleanup.add(() => resetNetwork(pve))
    await page.goto(`/node/${LAB_NODE}/network`)
    await createFromMenu(page, 'OVS 网桥')
    const d = dialog(page)
    await d.getByRole('textbox', { name: '名称' }).fill('vmbr95')
    await d.getByRole('button', { name: '创建', exact: true }).click()
    await expect(d.getByRole('alert').first()).toContainText(/Open ?VSwitch/i)
    await d.getByRole('button', { name: '取消' }).click()
    expect((await pve.get<Iface[]>(NET)).some((i) => i.iface === 'vmbr95')).toBe(false)

    // OVS IntPort needs an OVS bridge: none here.
    await createFromMenu(page, 'OVS 内部端口')
    await expect(d).toContainText('这台节点还没有 OVS 网桥')
    await d.getByRole('button', { name: '取消' }).click()
  })
})

test.describe('node network on phones', { tag: '@mobile' }, () => {
  test('pending banner, sheets and row menus (mocked list)', async ({ page, pve }) => {
    await mockNetwork(page, pve.node)
    await page.goto(`/node/${pve.node}/network`)
    const p = panel(page)
    await expect(p.getByRole('list', { name: 'Bond' })).toContainText('bond0')
    await expect(p.getByRole('button', { name: '编辑 vmbr1' })).toContainText('待新增')
    await expect(p.getByRole('button', { name: '编辑 vmbr0.20' })).toContainText('待修改')
    await expect(p.getByRole('button', { name: '编辑 vmbr0', exact: true })).toContainText('待修改')
    const apply = pendingRegion(page).getByRole('button', { name: '应用配置' })
    await expect(apply).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    // Apply asks first, with a warning about the gateway bridge and the diff.
    await apply.click()
    const confirm = page.getByRole('dialog', { name: '应用网络配置？' })
    await expect(confirm).toContainText('承载默认网关的接口 vmbr0')
    await expect(confirm.getByRole('region', { name: '配置差异' })).toContainText('+iface vmbr1 inet static')
    await confirm.getByRole('button', { name: '取消' }).click()
    await expect(confirm).toBeHidden()

    // Create and edit open as bottom sheets.
    await createFromMenu(page, 'Linux Bond')
    const box = await dialog(page).boundingBox()
    expect(box && Math.round(box.y + box.height)).toBeGreaterThanOrEqual(page.viewportSize()!.height - 2)
    await dialog(page).getByRole('button', { name: '取消' }).click()
    await expect(dialog(page)).toBeHidden()

    await p.getByRole('button', { name: '编辑 vmbr0', exact: true }).click()
    await expect(dialog(page)).toContainText('编辑 Linux 网桥 vmbr0')
    await expect(dialog(page).getByRole('textbox', { name: 'IPv6/CIDR' })).toHaveValue('2001:db8:10::5/64')
    await dialog(page).getByRole('button', { name: '取消' }).click()

    await p.getByRole('button', { name: '更多操作：bond0' }).click()
    for (const item of ['编辑', '删除']) await expect(page.getByRole('menuitem', { name: item })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
  })
})
