import type { Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'

// Area node-disks: disk list, SMART, GPT / wipe, and LVM / LVM-Thin /
// directory / ZFS storages on unused disks.
//
// Lab writes (@lab, desktop) only touch node pvelab-c3 of the 3-node lab
// cluster and only its two blank 16 GiB disks /dev/sdb and /dev/sdc (never
// sda, the OS disk; the replication area uses the blank disks of c1 / c2).
// Storages are named e2e-disks-*; afterAll destroys leftovers with cleanup
// and wipes sdb / sdc so they are blank again. Phone checks use mocks.

const NODE = 'pvelab-c3'
const TARGETS = ['/dev/sdb', '/dev/sdc'] as const
const SIZE_16G = 16 * 1024 ** 3
const PREFIX = 'e2e-disks-'

const panel = (page: Page) => page.getByRole('tabpanel', { name: '磁盘' })
const diskRow = (page: Page, devpath: string) => panel(page).getByRole('button', { name: new RegExp(`^${devpath}，`) })

interface Disk {
  devpath: string
  size: number
  gpt?: number
  used?: string
  parent?: string
}

async function disks(pve: PveApi) {
  return pve.get<Disk[]>(`/nodes/${NODE}/disks/list`, { 'include-partitions': 1, skipsmart: 1 })
}

/** Refuse to write unless sdb / sdc on c3 are the lab's 16 GiB data disks. */
async function assertTargets(pve: PveApi) {
  const nodes = await pve.get<{ node: string }[]>('/nodes')
  test.skip(!nodes.some((n) => n.node === NODE), `实验集群里没有 ${NODE}（需要 lab-cluster.env）`)
  const list = await disks(pve)
  for (const dev of TARGETS) {
    const d = list.find((x) => x.devpath === dev)
    if (!d || d.size !== SIZE_16G) throw new Error(`${NODE} 上的 ${dev} 不是 16G 测试盘，拒绝写入`)
  }
}

/** Destroy e2e-disks-* storages (with cleanup) and wipe sdb / sdc. */
async function resetDisks(pve: PveApi) {
  const base = `/nodes/${NODE}/disks`
  const cleanup = { 'cleanup-disks': 1, 'cleanup-config': 1 }
  for (const z of await pve.get<{ name: string }[]>(`${base}/zfs`)) {
    if (z.name.startsWith(PREFIX)) await pve.run('DELETE', `${base}/zfs/${z.name}`, cleanup)
  }
  for (const t of await pve.get<{ lv: string; vg: string }[]>(`${base}/lvmthin`)) {
    if (t.vg.startsWith(PREFIX)) await pve.run('DELETE', `${base}/lvmthin/${t.lv}`, { ...cleanup, 'volume-group': t.vg })
  }
  const lvm = await pve.get<{ children?: { name: string }[] }>(`${base}/lvm`)
  for (const vg of lvm.children ?? []) {
    if (vg.name.startsWith(PREFIX)) await pve.run('DELETE', `${base}/lvm/${vg.name}`, cleanup)
  }
  for (const d of await pve.get<{ path: string }[]>(`${base}/directory`)) {
    const name = d.path.replace('/mnt/pve/', '')
    if (name.startsWith(PREFIX)) await pve.run('DELETE', `${base}/directory/${name}`, cleanup)
  }
  for (const s of await pve.get<{ storage: string }[]>('/storage')) {
    if (s.storage.startsWith(PREFIX)) await pve.del(`/storage/${s.storage}`)
  }
  for (const dev of TARGETS) await pve.run('PUT', `${base}/wipedisk`, { disk: dev })
}

async function waitDisk(pve: PveApi, devpath: string, match: (d: Disk | undefined) => boolean) {
  await expect.poll(async () => match((await disks(pve)).find((d) => d.devpath === devpath)), { timeout: 30_000 }).toBe(true)
}

/** Fill a create dialog's common fields; the disk select is a combobox. */
async function pickDisk(page: Page, dialog: ReturnType<Page['getByRole']>, devpath: string) {
  await dialog.getByRole('combobox', { name: '磁盘' }).click()
  await page.getByRole('option', { name: new RegExp(`^${devpath}`) }).click()
}

async function destroyViaUi(page: Page, button: string, confirmText: string) {
  await panel(page).getByRole('button', { name: button }).click()
  const dialog = page.getByRole('dialog', { name: /^删除/ })
  await expect(dialog.getByRole('checkbox', { name: '清理磁盘' })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: '清理存储配置' })).toBeChecked()
  const submit = dialog.getByRole('button', { name: '删除', exact: true })
  await expect(submit).toBeDisabled()
  await dialog.getByLabel(/请输入/).fill(confirmText)
  await submit.click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
}

test.describe('node disks (lab)', { tag: '@lab' }, () => {
  test.beforeAll(async ({ pve }) => {
    await assertTargets(pve)
    await resetDisks(pve)
  })
  test.afterAll(async ({ pve }) => {
    const nodes = await pve.get<{ node: string }[]>('/nodes')
    if (nodes.some((n) => n.node === NODE)) await resetDisks(pve)
  })

  test('disk list, SMART, initialise GPT and wipe', async ({ page, pve }) => {
    test.setTimeout(150_000)
    await page.goto(`/node/${NODE}/disks`)
    const list = panel(page).getByRole('list', { name: '磁盘' })
    await expect(list).toContainText('/dev/sda')
    await expect(panel(page).getByRole('list', { name: '/dev/sda 的分区' })).toContainText('/dev/sda3')
    await expect(diskRow(page, '/dev/sdb')).toContainText('未使用')

    await diskRow(page, '/dev/sdb').click()
    const dialog = page.getByRole('dialog', { name: '/dev/sdb' })
    await expect(dialog.getByRole('group', { name: '序列号' })).toContainText('drive-scsi1')
    // QEMU disks report SMART as text.
    await expect(dialog.getByRole('region', { name: 'S.M.A.R.T. 值' })).toContainText('Temperature')
    await expect(dialog.getByRole('group', { name: 'GPT' })).toContainText('否')

    await dialog.getByRole('button', { name: '初始化 GPT' }).click()
    const gpt = page.getByRole('alertdialog', { name: '初始化 /dev/sdb？' })
    await gpt.getByRole('button', { name: '初始化' }).click()
    await waitDisk(pve, '/dev/sdb', (d) => d?.gpt === 1)
    await expect(dialog.getByRole('group', { name: 'GPT' })).toContainText('是', { timeout: 30_000 })

    await dialog.getByRole('button', { name: '擦除磁盘' }).click()
    const wipe = page.getByRole('alertdialog', { name: '擦除 /dev/sdb？' })
    await expect(wipe.getByRole('button', { name: '擦除' })).toBeDisabled()
    await wipe.getByRole('textbox').fill('/dev/sdb')
    await wipe.getByRole('button', { name: '擦除' }).click()
    await waitDisk(pve, '/dev/sdb', (d) => !d?.gpt)
    await expect(dialog.getByRole('group', { name: 'GPT' })).toContainText('否', { timeout: 30_000 })
  })

  test('ZFS mirror: create with storage, pool status, destroy with cleanup', async ({ page, pve }) => {
    test.setTimeout(180_000)
    const name = `${PREFIX}zfs`
    await page.goto(`/node/${NODE}/disks?view=zfs`)
    await expect(panel(page).getByText('没有 ZFS 池')).toBeVisible()
    await panel(page).getByRole('button', { name: '创建 ZFS 池' }).click()
    const dialog = page.getByRole('dialog', { name: '创建 ZFS 池' })
    await dialog.getByLabel('名称').fill(name)
    await dialog.getByRole('combobox', { name: 'RAID 级别' }).click()
    await page.getByRole('option', { name: /^Mirror/ }).click()
    await dialog.getByRole('combobox', { name: '压缩' }).click()
    await page.getByRole('option', { name: 'lz4', exact: true }).click()
    const create = dialog.getByRole('button', { name: '创建', exact: true })
    await dialog.getByRole('checkbox', { name: /\/dev\/sdb/ }).click()
    await expect(dialog).toContainText('至少需要 2 块')
    await expect(create).toBeDisabled()
    await dialog.getByRole('checkbox', { name: /\/dev\/sdc/ }).click()
    await expect(dialog.getByRole('checkbox', { name: '添加为存储' })).toBeChecked()

    const request = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/nodes/${NODE}/disks/zfs`))
    await create.click()
    const body = new URLSearchParams((await request).postData() ?? '')
    expect(Object.fromEntries(body)).toMatchObject({
      name,
      raidlevel: 'mirror',
      devices: '/dev/sdb,/dev/sdc',
      compression: 'lz4',
      ashift: '12',
      add_storage: '1',
    })

    const row = panel(page).getByRole('button', { name: `${name}，ONLINE` })
    await expect(row).toBeVisible({ timeout: 60_000 })
    expect(await pve.get<{ type: string; nodes?: string }>(`/storage/${name}`)).toMatchObject({ type: 'zfspool', nodes: NODE })

    await row.click()
    const detail = page.getByRole('dialog', { name })
    const vdevs = detail.getByRole('list', { name: 'vdev' })
    await expect(vdevs).toContainText('mirror-0')
    await expect(vdevs.getByRole('listitem')).toHaveCount(4)
    await expect(vdevs).toContainText('drive-scsi1')
    await expect(detail.getByRole('group', { name: '健康' })).toContainText('ONLINE')
    await expect(detail.getByRole('group', { name: '错误', exact: true })).toContainText('No known data errors')
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()

    await destroyViaUi(page, `删除 ZFS 池 ${name}`, name)
    await expect(panel(page).getByText('没有 ZFS 池')).toBeVisible({ timeout: 60_000 })
    await expect(pve.get(`/storage/${name}`)).rejects.toThrow()
  })

  test('LVM, LVM-Thin and directory: create and destroy', async ({ page, pve }) => {
    test.setTimeout(240_000)

    // LVM volume group on sdb (without storage).
    const vg = `${PREFIX}vg`
    await page.goto(`/node/${NODE}/disks?view=lvm`)
    await panel(page).getByRole('button', { name: '创建卷组' }).click()
    let dialog = page.getByRole('dialog', { name: '创建 LVM 卷组' })
    await pickDisk(page, dialog, '/dev/sdb')
    await dialog.getByLabel('名称').fill(vg)
    await dialog.getByRole('checkbox', { name: '添加为存储' }).click()
    await dialog.getByRole('button', { name: '创建', exact: true }).click()
    const vgs = panel(page).getByRole('list', { name: 'LVM 卷组' })
    await expect(vgs).toContainText(vg, { timeout: 60_000 })
    await expect(panel(page).getByRole('list', { name: `${vg} 的物理卷` })).toContainText('/dev/sdb')
    await destroyViaUi(page, `删除卷组 ${vg}`, vg)
    await expect(vgs).not.toContainText(vg, { timeout: 60_000 })
    await waitDisk(pve, '/dev/sdb', (d) => !d?.used)

    // LVM-Thin pool on sdc, added as storage.
    const thin = `${PREFIX}thin`
    await page.goto(`/node/${NODE}/disks?view=lvmthin`)
    await panel(page).getByRole('button', { name: '创建 Thin 池' }).click()
    dialog = page.getByRole('dialog', { name: '创建 LVM-Thin 池' })
    await pickDisk(page, dialog, '/dev/sdc')
    await dialog.getByLabel('名称').fill(thin)
    await dialog.getByRole('button', { name: '创建', exact: true }).click()
    const pools = panel(page).getByRole('list', { name: 'LVM-Thin 池' })
    await expect(pools).toContainText(thin, { timeout: 60_000 })
    await expect(pools.getByRole('listitem').filter({ hasText: thin }).getByRole('meter', { name: '元数据' })).toBeVisible()
    expect(await pve.get<{ type: string }>(`/storage/${thin}`)).toMatchObject({ type: 'lvmthin' })
    await destroyViaUi(page, `删除 Thin 池 ${thin}/${thin}`, `${thin}/${thin}`)
    await expect(pools).not.toContainText(thin, { timeout: 60_000 })
    await expect(pve.get(`/storage/${thin}`)).rejects.toThrow()

    // Directory (xfs) on sdb, added as storage.
    const dir = `${PREFIX}dir`
    await page.goto(`/node/${NODE}/disks?view=directory`)
    await panel(page).getByRole('button', { name: '创建目录' }).click()
    dialog = page.getByRole('dialog', { name: '创建目录存储' })
    await pickDisk(page, dialog, '/dev/sdb')
    await dialog.getByLabel('名称').fill(dir)
    await expect(dialog).toContainText(`/mnt/pve/${dir}`)
    await dialog.getByRole('combobox', { name: '文件系统' }).click()
    await page.getByRole('option', { name: 'xfs' }).click()
    await dialog.getByRole('button', { name: '创建', exact: true }).click()
    const dirs = panel(page).getByRole('list', { name: '目录' })
    await expect(dirs).toContainText(`/mnt/pve/${dir}`, { timeout: 60_000 })
    await expect(dirs).toContainText('xfs')
    expect(await pve.get<{ type: string; path: string }>(`/storage/${dir}`)).toMatchObject({ type: 'dir', path: `/mnt/pve/${dir}` })
    await destroyViaUi(page, `删除目录 ${dir}`, dir)
    await expect(panel(page).getByText('没有由 PVE 管理的目录')).toBeVisible({ timeout: 60_000 })
  })
})

// ------------------------------------------------------------ phone layout

const GiB = 1024 ** 3
const MOCK_DISKS = [
  { devpath: '/dev/nvme0n1', type: 'nvme', size: 1000 * GiB, gpt: 1, used: 'partitions', health: 'PASSED', wearout: 3, model: 'Samsung SSD 990 PRO 1TB', serial: 'S7KHNJ0X123456A', osdid: -1 },
  { devpath: '/dev/nvme0n1p1', parent: '/dev/nvme0n1', type: 'partition', size: 1 * GiB, gpt: 1, used: 'EFI' },
  { devpath: '/dev/nvme0n1p2', parent: '/dev/nvme0n1', type: 'partition', size: 999 * GiB, gpt: 1, used: 'ZFS' },
  { devpath: '/dev/sda', type: 'hdd', size: 4000 * GiB, gpt: 0, health: 'PASSED', wearout: 'N/A', rpm: 7200, model: 'WDC WD40EFRX-68N32N0', serial: 'WD-WCC7K1234567', osdid: -1 },
]
const MOCK_SMART = {
  health: 'PASSED',
  type: 'ata',
  attributes: [
    { id: '  5', name: 'Reallocated_Sector_Ct', value: 200, worst: 200, threshold: 140, fail: '-', flags: 'PO--CK', raw: '0', normalized: 200 },
    { id: '194', name: 'Temperature_Celsius', value: 117, worst: 104, threshold: 0, fail: '-', flags: '-O---K', raw: '33', normalized: 117 },
  ],
}
const MOCK_POOL = {
  name: 'rpool',
  state: 'ONLINE',
  scan: 'scrub repaired 0B in 00:12:31 with 0 errors on Sun Oct 11 00:36:32 2026',
  errors: 'No known data errors',
  children: [
    {
      name: 'rpool',
      state: 'ONLINE',
      read: 0,
      write: 0,
      cksum: 0,
      children: [
        {
          name: 'mirror-0',
          state: 'ONLINE',
          read: 0,
          write: 0,
          cksum: 0,
          children: [
            { name: '/dev/disk/by-id/nvme-Samsung_SSD_990_PRO_1TB_S7KHNJ0X123456A-part3', state: 'ONLINE', read: 0, write: 0, cksum: 0, leaf: 1 },
            { name: '/dev/disk/by-id/nvme-Samsung_SSD_990_PRO_1TB_S7KHNJ0X654321B-part3', state: 'ONLINE', read: 0, write: 0, cksum: 0, leaf: 1 },
          ],
        },
      ],
    },
  ],
}

async function mockDisks(page: Page) {
  await page.route('**/api2/json/nodes/*/disks/list*', (route) => {
    const unused = new URL(route.request().url()).searchParams.get('type') === 'unused'
    return route.fulfill({ json: { data: unused ? [MOCK_DISKS[3], { ...MOCK_DISKS[3], devpath: '/dev/sdb', serial: 'WD-WCC7K7654321' }] : MOCK_DISKS } })
  })
  await page.route('**/api2/json/nodes/*/disks/smart*', (route) => route.fulfill({ json: { data: MOCK_SMART } }))
  await page.route('**/api2/json/nodes/*/disks/zfs', (route) =>
    route.fulfill({ json: { data: [{ name: 'rpool', size: 990 * GiB, alloc: 400 * GiB, free: 590 * GiB, frag: 12, dedup: 1, health: 'ONLINE' }] } }),
  )
  await page.route('**/api2/json/nodes/*/disks/zfs/rpool', (route) => route.fulfill({ json: { data: MOCK_POOL } }))
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test.describe('node disks (phone)', { tag: '@mobile' }, () => {
  test('disk list and detail sheet with SMART attributes', async ({ page, pve }) => {
    await mockDisks(page)
    await page.goto(`/node/${pve.node}/disks`)
    await expect(diskRow(page, '/dev/nvme0n1')).toContainText('寿命 97%')
    await expect(panel(page).getByRole('list', { name: '/dev/nvme0n1 的分区' })).toContainText('EFI')
    await noHorizontalScroll(page)

    await diskRow(page, '/dev/sda').click()
    const sheet = page.getByRole('dialog', { name: '/dev/sda' })
    await expect(sheet.getByRole('group', { name: '转速' })).toContainText('7200 rpm')
    const smart = sheet.getByRole('list', { name: 'S.M.A.R.T. 属性' })
    await expect(smart.getByRole('listitem')).toHaveCount(2)
    await expect(smart.getByRole('listitem').first()).toContainText('Reallocated_Sector_Ct')
    await expect(sheet.getByRole('button', { name: '初始化 GPT' })).toBeEnabled()
    await sheet.getByRole('button', { name: '擦除磁盘' }).click()
    const wipe = page.getByRole('alertdialog', { name: '擦除 /dev/sda？' })
    await expect(wipe).toContainText('WD-WCC7K1234567')
    await wipe.getByRole('button', { name: '取消' }).click()
    await expect(wipe).toBeHidden()
  })

  test('ZFS pool status and create form', async ({ page, pve }) => {
    await mockDisks(page)
    await page.goto(`/node/${pve.node}/disks?view=zfs`)
    await expect(page.getByRole('radio', { name: 'ZFS' })).toBeChecked()
    await panel(page).getByRole('button', { name: 'rpool，ONLINE' }).click()
    const detail = page.getByRole('dialog', { name: 'rpool' })
    await expect(detail.getByRole('list', { name: 'vdev' }).getByRole('listitem')).toHaveCount(4)
    await expect(detail.getByRole('group', { name: '数据校验（scrub）' })).toContainText('with 0 errors')
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()

    await panel(page).getByRole('button', { name: '创建 ZFS 池' }).click()
    const dialog = page.getByRole('dialog', { name: '创建 ZFS 池' })
    await dialog.getByRole('combobox', { name: 'RAID 级别' }).click()
    await page.getByRole('option', { name: /^RAID10/ }).click()
    await dialog.getByRole('checkbox', { name: /\/dev\/sdb/ }).click()
    await dialog.getByRole('checkbox', { name: /\/dev\/sda/ }).click()
    await expect(dialog.getByRole('checkbox', { name: /\/dev\/sdb/ })).toContainText('1')
    await expect(dialog).toContainText('至少需要 4 块')
    await expect(dialog.getByRole('button', { name: '创建', exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
  })
})
