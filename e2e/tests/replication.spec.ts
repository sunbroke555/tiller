import { expect, test, type PveApi } from '../fixtures'

// Area replication: datacenter list, node and guest tabs, create / edit /
// schedule now / log / delete.
//
// Needs the 3-node lab cluster (lab-cluster.env, app server on c1). The @lab
// suite makes sure the ZFS pool "e2erep" (sdb of the first two nodes) and the
// storage "e2e-rep" exist (idempotent, left in place, see docs/LAB.md), creates
// VM 5700 "e2e-replication-vm" with a 1G disk on it on the first node and
// replicates it to the second. Teardown removes the job, the VM and the replica.
// The @mobile checks mock the replication API with page.route().

const VMID = 5700
const VM_NAME = 'e2e-replication-vm'
const JOB = `${VMID}-0`
const STORAGE = 'e2e-rep'
const POOL = 'e2erep'

const labNodes = (process.env.PVE_LAB_NODES ?? '').split(',').filter(Boolean)

interface Job {
  id: string
  guest: number
  target: string
  schedule?: string
  rate?: number
  comment?: string
  disable?: number
  remove_job?: string
}

async function jobsOf(pve: PveApi, vmid: number): Promise<Job[]> {
  return (await pve.get<Job[]>('/cluster/replication')).filter((j) => j.guest === vmid)
}

/** ZFS pool on sdb of both nodes plus the shared zfspool storage definition. */
async function ensureStorage(pve: PveApi, nodes: string[]) {
  for (const node of nodes) {
    const pools = await pve.get<{ name: string }[]>(`/nodes/${node}/disks/zfs`)
    if (!pools.some((p) => p.name === POOL)) {
      await pve.run('POST', `/nodes/${node}/disks/zfs`, { name: POOL, devices: '/dev/sdb', raidlevel: 'single', ashift: 12, compression: 'on' })
    }
  }
  const storages = await pve.get<{ storage: string }[]>('/storage')
  if (!storages.some((s) => s.storage === STORAGE)) {
    await pve.post('/storage', { storage: STORAGE, type: 'zfspool', pool: POOL, nodes: nodes.join(','), content: 'images,rootdir', sparse: 1 })
  }
}

/** Remove jobs (no cleanup), the VM, and replica volumes left on the target. */
async function teardown(pve: PveApi, target: string) {
  for (const j of await jobsOf(pve, VMID)) await pve.del(`/cluster/replication/${j.id}`, { force: 1 })
  await pve.destroyGuest(VMID)
  const volumes = await pve.get<{ volid: string; vmid?: number }[]>(`/nodes/${target}/storage/${STORAGE}/content`)
  for (const v of volumes.filter((x) => x.vmid === VMID)) {
    await pve.run('DELETE', `/nodes/${target}/storage/${STORAGE}/content/${encodeURIComponent(v.volid)}`)
  }
}

test.describe('replication (lab cluster)', { tag: '@lab' }, () => {
  test.describe.configure({ mode: 'serial' })
  let target = ''

  test.beforeAll(async ({ pve }) => {
    test.setTimeout(180_000)
    const nodes = (await pve.get<{ node: string; status: string }[]>('/nodes')).filter((n) => n.status === 'online').map((n) => n.node)
    test.skip(nodes.length < 2, '需要多节点实验集群（lab-cluster.env）')
    target = labNodes.find((n) => n !== pve.node && nodes.includes(n)) ?? nodes.find((n) => n !== pve.node)!
    await ensureStorage(pve, [pve.node, target])
    await teardown(pve, target)
    await pve.createTestVm({ vmid: VMID, name: VM_NAME, params: { scsi0: `${STORAGE}:1`, scsihw: 'virtio-scsi-single', net0: undefined } })
  })

  test.afterAll(async ({ pve }) => {
    test.setTimeout(120_000)
    if (target) await teardown(pve, target)
  })

  test('客户机页：添加复制任务（常用计划、限速、备注）', async ({ page, pve }) => {
    await page.goto(`/guest/${pve.node}/qemu/${VMID}/replication`)
    await expect(page.getByRole('heading', { name: '还没有复制任务' })).toBeVisible()
    await page.getByRole('button', { name: '添加', exact: true }).click()

    const dialog = page.getByRole('dialog', { name: '添加复制任务' })
    await expect(dialog.getByLabel('客户机')).toHaveValue(new RegExp(`${VMID}`))
    await dialog.getByRole('combobox', { name: '目标节点' }).click()
    // The source node is not offered.
    await expect(page.getByRole('option', { name: new RegExp(`^${pve.node}`) })).toHaveCount(0)
    await page.getByRole('option', { name: new RegExp(`^${target}`) }).click()

    await dialog.getByRole('button', { name: '常用计划' }).click()
    await page.getByRole('menuitem', { name: /每 30 分钟/ }).click()
    await expect(dialog.getByTestId('schedule-input')).toHaveValue('*/30')
    await expect(dialog.getByText(/接下来/)).toBeVisible()

    // An unparsable schedule blocks saving.
    await dialog.getByTestId('schedule-input').fill('bogus')
    await expect(dialog.getByText(/无法识别的计划格式/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: '添加', exact: true })).toBeDisabled()
    await dialog.getByTestId('schedule-input').fill('*/30')

    await dialog.getByLabel('限速').fill('50')
    await dialog.getByLabel('备注').fill('e2e')
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).toBeHidden()

    const row = page.locator(`[data-job="${JOB}"]`)
    await expect(row).toBeVisible()
    await expect(row).toContainText(target)
    await expect(row).toContainText('每 30 分钟')
    const [job] = await jobsOf(pve, VMID)
    expect(job).toMatchObject({ id: JOB, target, schedule: '*/30', rate: 50, comment: 'e2e' })
  })

  test('立即同步，查看日志', async ({ page, pve }) => {
    test.setTimeout(180_000)
    await page.goto(`/guest/${pve.node}/qemu/${VMID}/replication`)
    const row = page.locator(`[data-job="${JOB}"]`)
    await expect(row.getByTestId('replication-state')).toHaveText('尚未同步')
    await row.getByRole('button', { name: `立即同步 ${JOB}` }).click()
    await expect(page.getByText(/已排队/)).toBeVisible()
    // pvescheduler starts due jobs once a minute.
    await expect(row.getByTestId('replication-state')).toHaveText('正常', { timeout: 150_000 })

    await row.getByRole('button', { name: `${JOB} 的日志` }).click()
    const log = page.getByRole('dialog', { name: `复制日志 ${JOB}` })
    await expect(log.getByTestId('replication-log')).toContainText('end replication job')
    await page.keyboard.press('Escape')
    await expect(log).toBeHidden()

    // Details: last sync and duration are filled in.
    await row.getByRole('button', { name: new RegExp(`复制任务 ${JOB}`) }).click()
    const detail = page.getByRole('dialog', { name: `复制任务 ${JOB}` })
    await expect(detail.getByText('失败次数')).toBeVisible()
    await expect(detail).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
    await page.keyboard.press('Escape')
  })

  test('编辑：改计划、取消限速、停用', async ({ page, pve }) => {
    await page.goto(`/node/${pve.node}/replication`)
    const row = page.locator(`[data-job="${JOB}"]`)
    await expect(row).toContainText(VM_NAME)
    await row.getByRole('button', { name: `${JOB} 的更多操作` }).click()
    await page.getByRole('menuitem', { name: '编辑' }).click()

    const dialog = page.getByRole('dialog', { name: `编辑复制任务 ${JOB}` })
    await expect(dialog.getByLabel('限速')).toHaveValue('50')
    await dialog.getByTestId('schedule-input').fill('mon..fri 00:00')
    await expect(dialog.getByText('周一至周五 00:00')).toBeVisible()
    await dialog.getByLabel('限速').fill('')
    await dialog.getByRole('switch', { name: '启用' }).click()
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toBeHidden()

    await expect(row.getByTestId('replication-state')).toHaveText('已停用')
    const [job] = await jobsOf(pve, VMID)
    expect(job).toMatchObject({ schedule: 'mon..fri 00:00', disable: 1, comment: 'e2e' })
    expect(job?.rate).toBeUndefined()
  })

  test('数据中心：列出任务，删除并清理副本', async ({ page, pve }) => {
    await page.goto('/datacenter/replication')
    const row = page.locator(`[data-job="${JOB}"]`)
    await expect(row).toContainText(VM_NAME)
    await expect(row).toContainText(target)
    await row.getByRole('button', { name: `${JOB} 的更多操作` }).click()
    await page.getByRole('menuitem', { name: '删除' }).click()

    const dialog = page.getByRole('dialog', { name: `删除复制任务 ${JOB}？` })
    await expect(dialog.getByRole('radio', { name: /删除任务并清理副本/ })).toBeChecked()
    const submit = dialog.getByRole('button', { name: '删除', exact: true })
    await expect(submit).toBeDisabled()
    await dialog.getByLabel(/输入任务 ID/).fill(JOB)
    await submit.click()
    await expect(dialog).toBeHidden()

    // Marked for removal; the runner cleans up and drops it within a minute or two.
    const jobs = await jobsOf(pve, VMID)
    expect(jobs.length === 0 || jobs[0]?.remove_job === 'full').toBe(true)
    if (jobs.length) await expect(row.getByTestId('replication-state')).toHaveText('等待删除')
  })
})

// ------------------------------------------------------------- phones

const now = () => Math.floor(Date.now() / 1000)

test.describe('replication on phones', { tag: '@mobile' }, () => {
  test.beforeEach(async ({ page, pve }) => {
    const jobs = [
      { id: '100-0', guest: 100, jobnum: 0, target: 'pvelab-c2', type: 'local', schedule: '*/15', source: pve.node },
      { id: '200-0', guest: 200, jobnum: 0, target: 'pvelab-c3', type: 'local', schedule: 'mon..fri 00:00', rate: 20, source: pve.node, comment: '夜间同步' },
    ]
    const states = [
      { ...jobs[0], last_sync: now() - 300, duration: 2.4, next_sync: now() + 600, fail_count: 0 },
      { ...jobs[1], last_sync: now() - 7200, duration: 1.1, next_sync: now() + 3600, fail_count: 3, error: 'command zfs send failed: exit code 1' },
    ]
    await page.route('**/api2/json/cluster/replication', (route) =>
      route.request().method() === 'GET' ? route.fulfill({ json: { data: jobs } }) : route.fallback(),
    )
    await page.route('**/api2/json/nodes/*/replication?*', (route) => route.fulfill({ json: { data: states.filter((s) => route.request().url().includes(`guest=${s.guest}`)) } }))
    await page.route('**/api2/json/nodes/*/replication', (route) =>
      route.fulfill({ json: { data: route.request().url().includes(`/nodes/${pve.node}/`) ? states : [] } }),
    )
  })

  test('数据中心列表和详情底部弹层', async ({ page }) => {
    await page.goto('/datacenter')
    await page.getByRole('link', { name: /存储复制/ }).click()
    await expect(page).toHaveURL(/\/datacenter\/replication$/)
    await expect(page.getByTestId('replication-summary')).toHaveText('2 个任务 · 1 个失败')
    const failed = page.locator('[data-job="200-0"]')
    await expect(failed).toContainText('失败（3 次）')
    await expect(failed).toContainText('command zfs send failed')

    await page.locator('[data-job="100-0"]').getByRole('button', { name: /复制任务 100-0/ }).click()
    const sheet = page.getByRole('dialog', { name: '复制任务 100-0' })
    await expect(sheet.getByText('下次同步')).toBeVisible()
    await expect(sheet.getByRole('button', { name: '立即同步' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: '删除' })).toBeVisible()
    const box = await sheet.boundingBox()
    expect(box && box.y + box.height).toBeGreaterThan((page.viewportSize()?.height ?? 0) - 4)
  })

  test('添加对话框：常用计划和预览', async ({ page }) => {
    // Adding needs at least two nodes; on the single-node lab pretend there is a second one.
    await page.route('**/api2/json/cluster/resources*', async (route) => {
      const res = await route.fetch()
      const body = (await res.json()) as { data: { type: string; node?: string; id: string }[] }
      const nodes = body.data.filter((r) => r.type === 'node')
      if (nodes.length === 1) body.data.push({ ...nodes[0], id: 'node/pvelab-fake', node: 'pvelab-fake' })
      await route.fulfill({ response: res, json: body })
    })
    await page.goto('/datacenter/replication')
    await page.getByRole('button', { name: '添加', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '添加复制任务' })
    await expect(dialog.getByRole('combobox', { name: '目标节点' })).toBeDisabled()
    await dialog.getByRole('button', { name: '常用计划' }).click()
    await page.getByRole('menuitem', { name: /每天 21:00/ }).click()
    await expect(dialog.getByTestId('schedule-input')).toHaveValue('21:00')
    await expect(dialog.getByText(/接下来/)).toBeVisible()
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
  })
})
