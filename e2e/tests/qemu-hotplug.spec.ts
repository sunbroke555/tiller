import { expect, test } from '../fixtures'

test('pending: apply only online-eligible hardware and retain restart-only changes', { tag: '@lab' }, async ({ page, pve, cleanup }) => {
  const used = new Set((await pve.guests()).map((g) => g.vmid))
  let vmid: number | undefined
  for (let id = 3498; id >= 3400; id--) {
    if (used.has(id)) continue
    try { await pve.get('/cluster/nextid', { vmid: id }); vmid = id; break } catch { /* occupied */ }
  }
  if (!vmid) throw new Error('qemu-config test VMID range is full')
  await pve.createTestVm({ vmid, name: `e2e-qemu-config-hotplug-${vmid}`, params: { hotplug: '0', ostype: 'l26' } })
  cleanup.guest(vmid)
  const base = `/nodes/${pve.node}/qemu/${vmid}`
  await pve.run('POST', `${base}/status/start`)
  await pve.waitForGuest(vmid, (g) => g.status === 'running')
  // First save leaves both changes pending. Enabling network hotplug is
  // itself live, but PVE does not retry unrelated pending net1 automatically.
  await pve.put(`${base}/config`, { net1: 'virtio=BC:24:11:34:98:01,bridge=vmbr0', memory: 96 })
  await pve.put(`${base}/config`, { hotplug: 'disk,network,usb' })
  const before = await pve.get<{ key: string; pending?: unknown }[]>(`${base}/pending`)
  expect(before.find((v) => v.key === 'net1')?.pending).toBeTruthy()
  await page.goto(`/guest/${pve.node}/qemu/${vmid}/hardware`)
  const banner = page.getByTestId('pending-changes')
  await expect(banner).toContainText('2 项更改尚未生效')
  await expect(banner).toContainText('其中 1 项参数可尝试在线应用')
  await banner.getByText('查看应用方式', { exact: true }).click()
  await expect(banner).toContainText('当前未启用内存热插拔')
  await expect(banner.getByRole('button', { name: '尝试在线应用' })).toBeEnabled()
  await page.screenshot({ path: 'test-results/hotplug-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(banner.getByRole('button', { name: '尝试在线应用' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/hotplug-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })

  const request = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`${base}/config`))
  await banner.getByRole('button', { name: '尝试在线应用' }).click()
  const body = new URLSearchParams((await request).postData() ?? '')
  expect(body.get('net1')).toContain('bridge=vmbr0')
  expect(body.get('digest')).toBeTruthy()
  expect(body.has('memory')).toBe(false)
  expect(body.has('force')).toBe(false)
  await expect(page.getByText('1 项参数已在线应用', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(banner).toContainText('1 项更改尚未生效')
  await expect(banner.getByRole('button', { name: '尝试在线应用' })).toHaveCount(0)
  const after = await pve.get<{ key: string; value?: unknown; pending?: unknown }[]>(`${base}/pending`)
  expect(after.find((v) => v.key === 'net1')?.pending).toBeUndefined()
  expect(after.find((v) => v.key === 'net1')?.value).toContain('bridge=vmbr0')
  expect(Number(after.find((v) => v.key === 'memory')?.value)).toBe(64)
  expect(Number(after.find((v) => v.key === 'memory')?.pending)).toBe(96)
})
