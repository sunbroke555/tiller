import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures'

// Visual QA of the disks tab (not a regression test), dark theme, with mocked
// data so every view has content. Read-only. Runs only with E2E_SCREENSHOTS=1;
// images land in e2e/test-results/disks-shots/.

const GiB = 1024 ** 3
const DISKS = [
  { devpath: '/dev/nvme0n1', type: 'nvme', size: 1000 * GiB, gpt: 1, used: 'partitions', health: 'PASSED', wearout: 3, model: 'Samsung SSD 990 PRO 1TB', serial: 'S7KHNJ0X123456A', vendor: 'Samsung', osdid: -1, by_id_link: '/dev/disk/by-id/nvme-Samsung_SSD_990_PRO_1TB_S7KHNJ0X123456A' },
  { devpath: '/dev/nvme0n1p1', parent: '/dev/nvme0n1', type: 'partition', size: 1031168, gpt: 1, used: 'BIOS boot' },
  { devpath: '/dev/nvme0n1p2', parent: '/dev/nvme0n1', type: 'partition', size: 1 * GiB, gpt: 1, used: 'EFI' },
  { devpath: '/dev/nvme0n1p3', parent: '/dev/nvme0n1', type: 'partition', size: 998 * GiB, gpt: 1, used: 'ZFS' },
  { devpath: '/dev/sda', type: 'hdd', size: 4000 * GiB, gpt: 1, used: 'LVM', health: 'PASSED', wearout: 'N/A', rpm: 7200, model: 'WDC WD40EFRX-68N32N0', serial: 'WD-WCC7K1234567', osdid: -1 },
  { devpath: '/dev/sdb', type: 'ssd', size: 480 * GiB, gpt: 0, health: 'FAILED!', wearout: 87, model: 'INTEL SSDSC2KB480G8', serial: 'PHYF8123004L480BGN', osdid: -1 },
  { devpath: '/dev/sdc', type: 'usb', size: 64 * GiB, gpt: 0, health: 'UNKNOWN', wearout: 'N/A', model: 'SanDisk Ultra', serial: '4C530001230817', osdid: -1 },
]
const SMART = {
  health: 'PASSED',
  type: 'ata',
  attributes: [
    { id: '  1', name: 'Raw_Read_Error_Rate', value: 200, worst: 200, threshold: 51, fail: '-', flags: 'POSR-K', raw: '0', normalized: 200 },
    { id: '  5', name: 'Reallocated_Sector_Ct', value: 200, worst: 200, threshold: 140, fail: '-', flags: 'PO--CK', raw: '0', normalized: 200 },
    { id: '  9', name: 'Power_On_Hours', value: 41, worst: 41, threshold: 0, fail: '-', flags: '-O--CK', raw: '43420', normalized: 41 },
    { id: '194', name: 'Temperature_Celsius', value: 117, worst: 104, threshold: 0, fail: '-', flags: '-O---K', raw: '33', normalized: 117 },
    { id: '197', name: 'Current_Pending_Sector', value: 200, worst: 200, threshold: 0, fail: 'In_the_past', flags: '-O--CK', raw: '2', normalized: 200 },
  ],
}
const POOL = {
  name: 'rpool',
  state: 'DEGRADED',
  status: 'One or more devices could not be used because the label is missing or invalid.',
  action: "Replace the device using 'zpool replace'.",
  scan: 'scrub repaired 0B in 00:12:31 with 0 errors on Sun Oct 11 00:36:32 2026',
  errors: 'No known data errors',
  children: [
    {
      name: 'rpool',
      state: 'DEGRADED',
      read: 0,
      write: 0,
      cksum: 0,
      children: [
        {
          name: 'mirror-0',
          state: 'DEGRADED',
          read: 0,
          write: 0,
          cksum: 0,
          children: [
            { name: '/dev/disk/by-id/nvme-Samsung_SSD_990_PRO_1TB_S7KHNJ0X123456A-part3', state: 'ONLINE', read: 0, write: 0, cksum: 0, leaf: 1 },
            { name: '9876543210123456789', state: 'UNAVAIL', read: 0, write: 0, cksum: 0, leaf: 1, msg: 'was /dev/disk/by-id/nvme-Samsung_SSD_990_PRO_1TB_S7KHNJ0X654321B-part3' },
          ],
        },
      ],
    },
  ],
}

async function mock(page: Page) {
  const json = (data: unknown) => ({ json: { data } })
  await page.route('**/api2/json/nodes/*/disks/list*', (route) => {
    const unused = new URL(route.request().url()).searchParams.get('type') === 'unused'
    return route.fulfill(json(unused ? DISKS.slice(5) : DISKS))
  })
  await page.route('**/api2/json/nodes/*/disks/smart*', (route) => route.fulfill(json(SMART)))
  await page.route('**/api2/json/nodes/*/disks/zfs', (route) =>
    route.fulfill(
      json([
        { name: 'rpool', size: 990 * GiB, alloc: 610 * GiB, free: 380 * GiB, frag: 12, dedup: 1, health: 'DEGRADED' },
        { name: 'tank', size: 7200 * GiB, alloc: 1900 * GiB, free: 5300 * GiB, frag: 3, dedup: 1.05, health: 'ONLINE' },
      ]),
    ),
  )
  await page.route('**/api2/json/nodes/*/disks/zfs/rpool', (route) => route.fulfill(json(POOL)))
  await page.route('**/api2/json/nodes/*/disks/lvm', (route) =>
    route.fulfill(
      json({
        leaf: 0,
        children: [
          { name: 'pve', size: 999 * GiB, free: 16 * GiB, lvcount: 6, leaf: 0, children: [{ name: '/dev/nvme0n1p3', size: 999 * GiB, free: 16 * GiB, leaf: 1 }] },
          { name: 'vmdata', size: 4000 * GiB, free: 3700 * GiB, lvcount: 2, leaf: 0, children: [{ name: '/dev/sda', size: 4000 * GiB, free: 3700 * GiB, leaf: 1 }] },
        ],
      }),
    ),
  )
  await page.route('**/api2/json/nodes/*/disks/lvmthin', (route) =>
    route.fulfill(
      json([
        { lv: 'data', vg: 'pve', lv_size: 870 * GiB, used: 640 * GiB, metadata_size: 9 * GiB, metadata_used: 0.4 * GiB },
        { lv: 'thin', vg: 'vmdata', lv_size: 300 * GiB, used: 290 * GiB, metadata_size: 2 * GiB, metadata_used: 1.9 * GiB },
      ]),
    ),
  )
  await page.route('**/api2/json/nodes/*/disks/directory', (route) =>
    route.fulfill(
      json([
        { path: '/mnt/pve/backup', device: '/dev/disk/by-uuid/5e1b6a3c-8a7e-4d8f-9a3c-2b1e0f6d7c8a', type: 'xfs', options: 'defaults', unitfile: '/etc/systemd/system/mnt-pve-backup.mount' },
      ]),
    ),
  )
}

test.describe('node disks screenshots', () => {
  test('dark theme', async ({ page, pve, mobile }) => {
    test.setTimeout(180_000)
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => {
      localStorage.setItem('pve-web:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
    })
    await mock(page)
    const dir = `test-results/disks-shots/${mobile ? 'phone' : 'desktop'}`
    const shot = async (name: string, fullPage = false) => {
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${dir}-${name}.png`, fullPage })
    }
    const panel = page.getByRole('tabpanel', { name: '磁盘' })

    await page.goto(`/node/${pve.node}/disks`)
    await expect(panel.getByRole('list', { name: '磁盘' })).toContainText('/dev/sdc')
    await shot('list', true)
    await panel.getByRole('button', { name: /^\/dev\/sda，/ }).click()
    await expect(page.getByRole('list', { name: 'S.M.A.R.T. 属性' })).toContainText('Temperature')
    await shot('disk-sheet')
    await page.getByRole('button', { name: '擦除磁盘' }).click()
    await shot('wipe-confirm')
    await page.getByRole('button', { name: '取消' }).click()
    await page.keyboard.press('Escape')

    await page.goto(`/node/${pve.node}/disks?view=zfs`)
    await expect(panel.getByRole('list', { name: 'ZFS 池' })).toContainText('tank')
    await shot('zfs')
    await panel.getByRole('button', { name: 'rpool，DEGRADED' }).click()
    await expect(page.getByRole('list', { name: 'vdev' })).toContainText('mirror-0')
    await shot('zfs-detail')
    await page.keyboard.press('Escape')
    await panel.getByRole('button', { name: '创建 ZFS 池' }).click()
    const create = page.getByRole('dialog', { name: '创建 ZFS 池' })
    await create.getByLabel('名称').fill('tank2')
    await create.getByRole('combobox', { name: 'RAID 级别' }).click()
    await page.getByRole('option', { name: /^Mirror/ }).click()
    await create.getByRole('checkbox', { name: /\/dev\/sdc/ }).click()
    await create.getByRole('checkbox', { name: /\/dev\/sdb/ }).click()
    await shot('zfs-create')
    await create.getByRole('button', { name: '取消' }).click()

    await page.goto(`/node/${pve.node}/disks?view=lvm`)
    await expect(panel.getByRole('list', { name: 'LVM 卷组' })).toContainText('vmdata')
    await shot('lvm')
    await panel.getByRole('button', { name: '删除卷组 vmdata' }).click()
    await shot('destroy')
    await page.getByRole('button', { name: '取消' }).click()

    await page.goto(`/node/${pve.node}/disks?view=lvmthin`)
    await expect(panel.getByRole('list', { name: 'LVM-Thin 池' })).toContainText('vmdata')
    await shot('lvmthin')
    await panel.getByRole('button', { name: '创建 Thin 池' }).click()
    await expect(page.getByRole('dialog', { name: '创建 LVM-Thin 池' })).toBeVisible()
    await shot('lvmthin-create')
    await page.getByRole('button', { name: '取消' }).click()

    await page.goto(`/node/${pve.node}/disks?view=directory`)
    await expect(panel.getByRole('list', { name: '目录' })).toContainText('/mnt/pve/backup')
    await shot('directory')
  })
})
