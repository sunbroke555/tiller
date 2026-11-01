import type { Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'
import { mockHa } from './ha.mocks'

// Area ha: /datacenter/ha — status (quorum, master, LRMs), HA resources
// (add / request state / migrate / remove) and affinity rules.
//
// The @lab suite needs the 3-node lab cluster (lab-cluster.env, app server on
// c1) and skips elsewhere. It creates two diskless 64MB VMs 6200/6201
// (e2e-ha-*), makes them HA resources and rules named e2e-ha-*; teardown
// removes rules, resources and VMs and waits until the HA stack has no e2e
// entries left. The @mobile checks mock the HA API with page.route().

const VM1 = 6200
const VM2 = 6201
const SID1 = `vm:${VM1}`
const SID2 = `vm:${VM2}`
const VMIDS = [VM1, VM2]

interface Rule {
  rule: string
  type: string
  resources: string
  nodes?: string
  strict?: number
  affinity?: string
  disable?: number
  comment?: string
}

async function e2eServices(pve: PveApi): Promise<string[]> {
  const st = await pve.get<{ type: string; sid?: string }[]>('/cluster/ha/status/current')
  return st.filter((e) => e.type === 'service' && VMIDS.some((v) => e.sid?.endsWith(`:${v}`))).map((e) => e.sid!)
}

/** Remove e2e rules, resources and guests; wait until the CRM dropped them. */
async function teardown(pve: PveApi) {
  for (const r of await pve.get<Rule[]>('/cluster/ha/rules')) {
    if (r.rule.startsWith('e2e-ha-')) await pve.del(`/cluster/ha/rules/${r.rule}`)
  }
  const resources = await pve.get<{ sid: string }[]>('/cluster/ha/resources')
  for (const r of resources.filter((x) => VMIDS.some((v) => x.sid.endsWith(`:${v}`)))) {
    await pve.del(`/cluster/ha/resources/${encodeURIComponent(r.sid)}`)
  }
  const deadline = Date.now() + 90_000
  while ((await e2eServices(pve)).length) {
    if (Date.now() > deadline) throw new Error('HA 栈里仍有 e2e 资源')
    await new Promise((r) => setTimeout(r, 2000))
  }
  for (const v of VMIDS) await pve.destroyGuest(v)
}

async function rowMenu(page: Page, sid: string, item: string) {
  // A menu still animating out would match the item too.
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.locator(`[data-sid="${sid}"]`).getByRole('button', { name: `${sid} 的操作` }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

test.describe('ha (lab cluster)', { tag: '@lab' }, () => {
  test.describe.configure({ mode: 'serial' })
  let nodes: string[] = []
  let other = ''

  test.beforeAll(async ({ pve }) => {
    test.setTimeout(180_000)
    nodes = (await pve.get<{ node: string; status: string }[]>('/nodes'))
      .filter((n) => n.status === 'online')
      .map((n) => n.node)
      .sort()
    test.skip(nodes.length < 3, '需要 3 节点实验集群（lab-cluster.env）')
    other = nodes.find((n) => n !== pve.node)!
    await teardown(pve)
    await pve.createTestVm({ vmid: VM1, name: 'e2e-ha-vm1' })
    await pve.createTestVm({ vmid: VM2, name: 'e2e-ha-vm2' })
  })

  test.afterAll(async ({ pve }) => {
    test.setTimeout(180_000)
    if (nodes.length >= 3) await teardown(pve)
  })

  test('状态：法定人数、各节点 LRM', async ({ page }) => {
    await page.goto('/datacenter/ha')
    const overview = page.getByTestId('ha-overview')
    await expect(overview).toContainText('法定人数')
    await expect(overview).toContainText('正常')
    await expect(page.getByRole('heading', { name: 'HA 资源', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'CRS 设置' })).toBeVisible()
  })

  test('添加 HA 资源（停止状态、重启次数、备注）', async ({ page, pve }) => {
    await page.goto('/datacenter/ha')
    await page.getByRole('button', { name: '添加', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: '添加 HA 资源' })
    await dialog.getByRole('combobox', { name: '客户机' }).click()
    await page.getByRole('option', { name: new RegExp(`^${VM1} · e2e-ha-vm1`) }).click()
    await dialog.getByRole('combobox', { name: '请求状态' }).click()
    await page.getByRole('option', { name: /^停止/ }).click()
    await dialog.getByLabel('最多重启次数').fill('2')
    await dialog.getByLabel('备注').fill('e2e')
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()

    const row = page.locator(`[data-sid="${SID1}"]`)
    await expect(row).toBeVisible()
    await expect(row).toContainText('e2e-ha-vm1')
    await expect(row.getByTestId('ha-state')).toHaveText('已停止', { timeout: 60_000 })
    const cfg = await pve.get<{ state: string; max_restart?: number; comment?: string; max_relocate?: number }>(`/cluster/ha/resources/${SID1}`)
    expect(cfg).toMatchObject({ state: 'stopped', max_restart: 2, comment: 'e2e' })
    expect(cfg.max_relocate).toBeUndefined()

    // Second resource through the API, for the rules.
    await pve.post('/cluster/ha/resources', { sid: SID2, state: 'stopped' })
    // Once a resource exists, the CRM becomes active: master and LRM per node.
    await expect(page.getByTestId('ha-lrm')).toHaveCount(nodes.length, { timeout: 60_000 })
  })

  test('编辑、启动、迁移、停止', async ({ page, pve }) => {
    test.setTimeout(240_000)
    await page.goto('/datacenter/ha')
    const row = page.locator(`[data-sid="${SID1}"]`)

    await rowMenu(page, SID1, '编辑')
    const edit = page.getByRole('dialog', { name: `编辑 HA 资源 ${SID1}` })
    await expect(edit.getByLabel('备注')).toHaveValue('e2e')
    await edit.getByLabel('最多重启次数').fill('1')
    await edit.getByRole('switch', { name: '自动回迁' }).click()
    await edit.getByRole('button', { name: '保存' }).click()
    await expect(edit).toBeHidden()
    const cfg = await pve.get<{ max_restart?: number; failback?: number }>(`/cluster/ha/resources/${SID1}`)
    expect(cfg.max_restart).toBeUndefined()
    expect(cfg.failback).toBe(0)

    await rowMenu(page, SID1, '启动')
    await expect(row.getByTestId('ha-request-state')).toHaveText('启动')
    await expect(row.getByTestId('ha-state')).toHaveText('运行中', { timeout: 90_000 })

    await rowMenu(page, SID1, '迁移')
    const move = page.getByRole('dialog', { name: `迁移 ${SID1}` })
    await move.getByRole('combobox', { name: '目标节点' }).click()
    await expect(page.getByRole('option', { name: new RegExp(`^${pve.node}`) })).toHaveCount(0)
    await page.getByRole('option', { name: new RegExp(`^${other}`) }).click()
    await move.getByRole('button', { name: '迁移', exact: true }).click()
    await expect(move).toBeHidden()
    await expect(row).toContainText(other, { timeout: 90_000 })
    await expect(row.getByTestId('ha-state')).toHaveText('运行中', { timeout: 60_000 })

    await rowMenu(page, SID1, '停止')
    const confirm = page.getByRole('alertdialog', { name: `停止 ${SID1}？` })
    await confirm.getByRole('button', { name: '停止' }).click()
    await expect(row.getByTestId('ha-state')).toHaveText('已停止', { timeout: 90_000 })
  })

  test('亲和规则：添加、停用、删除', async ({ page, pve }) => {
    await page.goto('/datacenter/ha/rules')
    await page.getByRole('button', { name: '添加节点亲和规则' }).click()
    const dialog = page.getByRole('dialog', { name: '添加节点亲和规则' })
    await dialog.getByLabel('规则 ID').fill('e2e-ha-pin')
    await dialog.getByRole('checkbox', { name: SID1 }).click()
    await dialog.getByRole('checkbox', { name: SID2 }).click()
    await dialog.getByRole('checkbox', { name: pve.node, exact: true }).click()
    await dialog.getByLabel(`${pve.node} 的优先级`).fill('2')
    await dialog.getByRole('checkbox', { name: other, exact: true }).click()
    await dialog.getByRole('switch', { name: '严格' }).click()
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()
    const pin = page.locator('[data-rule="e2e-ha-pin"]')
    await expect(pin).toContainText('严格')
    await expect(pin).toContainText('优先级 2')
    expect(await pve.get<Rule>('/cluster/ha/rules/e2e-ha-pin')).toMatchObject({
      type: 'node-affinity',
      resources: `${SID1},${SID2}`,
      nodes: `${pve.node}:2,${other}`,
      strict: 1,
    })

    await page.locator('[data-rule="e2e-ha-pin"]').getByRole('button', { name: '规则 e2e-ha-pin 的操作' }).click()
    await page.getByRole('menuitem', { name: '停用' }).click()
    await expect(pin).toContainText('已停用')
    expect((await pve.get<Rule>('/cluster/ha/rules/e2e-ha-pin')).disable).toBe(1)

    await expect(page.getByRole('menu')).toHaveCount(0)
    await pin.getByRole('button', { name: '规则 e2e-ha-pin 的操作' }).click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await page.getByRole('alertdialog', { name: '删除规则 e2e-ha-pin？' }).getByRole('button', { name: '删除' }).click()
    await expect(pin).toHaveCount(0)

    // Resource affinity (after the pin rule is gone: PVE refuses resource
    // affinity between resources pinned with different node priorities).
    // A single resource is not enough.
    await page.getByRole('button', { name: '添加资源亲和规则' }).click()
    const res = page.getByRole('dialog', { name: '添加资源亲和规则' })
    await res.getByLabel('规则 ID').fill('e2e-ha-apart')
    await res.getByRole('checkbox', { name: SID1 }).click()
    await expect(res.getByRole('button', { name: '添加', exact: true })).toBeDisabled()
    await res.getByRole('checkbox', { name: SID2 }).click()
    await res.getByRole('button', { name: '添加', exact: true }).click()
    await expect(res).toBeHidden()
    await expect(page.locator('[data-rule="e2e-ha-apart"]')).toContainText('保持分开')
  })

  test('移出 HA（同时从规则中移除）', async ({ page, pve }) => {
    await page.goto('/datacenter/ha')
    await rowMenu(page, SID1, '移出 HA')
    const dialog = page.getByRole('dialog', { name: `把 ${SID1} 移出 HA？` })
    await expect(dialog.getByRole('switch', { name: '同时从规则中移除' })).toBeChecked()
    await dialog.getByRole('button', { name: '移出 HA' }).click()
    await expect(page.locator(`[data-sid="${SID1}"]`)).toHaveCount(0, { timeout: 60_000 })
    const rules = await pve.get<Rule[]>('/cluster/ha/rules')
    expect(rules.filter((r) => r.resources.split(',').includes(SID1))).toEqual([])
  })
})

// ------------------------------------------------------------------ phones

test.describe('ha on phones', { tag: '@mobile' }, () => {
  test.beforeEach(async ({ page, pve }) => {
    await mockHa(page, pve.node)
  })

  test('状态、维护模式和资源详情底部弹层', async ({ page }) => {
    await page.goto('/datacenter/ha')
    await expect(page.getByText('处于维护模式')).toBeVisible()
    const c3 = page.locator('[data-testid="ha-lrm"][data-node="pvelab-c3"]')
    await expect(c3.getByTestId('ha-lrm-state')).toHaveText('维护模式')
    await expect(page.getByRole('link', { name: '旧 HA 组' })).toHaveCount(0)

    const row = page.locator('[data-sid="ct:200"]')
    await expect(row).toContainText('迁移中')
    await row.getByRole('button', { name: /HA 资源 ct:200/ }).click()
    const sheet = page.getByRole('dialog', { name: 'HA 资源 ct:200' })
    await expect(sheet).toContainText('数据库')
    await expect(sheet.getByRole('button', { name: '启动', pressed: true })).toBeDisabled()
    await expect(sheet.getByRole('button', { name: '重定位' })).toBeEnabled()
    await sheet.getByRole('button', { name: '迁移' }).click()
    const move = page.getByRole('dialog', { name: '迁移 ct:200' })
    await expect(move.getByRole('combobox', { name: '目标节点' })).toBeVisible()
    await move.getByRole('button', { name: '取消' }).click()
    await expect(move).toBeHidden()
  })

  test('规则列表和冲突说明', async ({ page }) => {
    await page.goto('/datacenter/ha/rules')
    await expect(page.locator('[data-rule="pin-web"]')).toContainText('优先级 2')
    await expect(page.getByText('1 条规则有冲突或错误')).toBeVisible()
    await page.getByRole('button', { name: '规则 together 有 1 个问题' }).click()
    await expect(page.getByTestId('ha-rule-errors')).toContainText('negative resource affinity')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: '添加资源亲和规则' }).click()
    const dialog = page.getByRole('dialog', { name: '添加资源亲和规则' })
    await expect(dialog.getByRole('checkbox', { name: 'ct:200' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '添加', exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: '取消' }).click()
  })
})
