import { expect, test, type PveApi } from '../fixtures'

// Area guest-snapshots-backup: snapshot timeline (take / edit / rollback /
// delete) and the guest backup tab (backup now, protection, notes, config,
// restore over the guest and as a new guest, delete).
//
// Writes only touch guests in the area's VMID range 3600–3699, named
// "e2e-guest-backup-…": mobile uses 3610+, desktop 3630+ so a crashed run of
// one layout never collides with the other. Backups of those VMIDs on
// `local` are removed in teardown (destroying a guest keeps its backups).

const STORAGE = 'local'

interface BackupEntry {
  volid: string
  notes?: string
  protected?: number
  vmid?: number
}

function base(mobile: boolean) {
  return mobile ? 3610 : 3630
}

async function backupsOf(pve: PveApi, vmid: number): Promise<BackupEntry[]> {
  return pve.get<BackupEntry[]>(`/nodes/${pve.node}/storage/${STORAGE}/content`, { content: 'backup', vmid })
}

async function removeBackups(pve: PveApi, vmid: number) {
  for (const b of await backupsOf(pve, vmid)) {
    const path = `/nodes/${pve.node}/storage/${STORAGE}/content/${encodeURIComponent(b.volid)}`
    if (b.protected) await pve.put(path, { protected: 0 })
    await pve.run('DELETE', path)
  }
}

/** Fresh tiny VM with a 100 MB disk on local-lvm (snapshots need a snapshot-capable disk). */
async function freshVm(pve: PveApi, vmid: number, name: string) {
  const existing = (await pve.guests()).find((g) => g.vmid === vmid)
  if (existing) {
    if (!existing.name?.startsWith('e2e-')) throw new Error(`VMID ${vmid} 被非测试客户机占用`)
    await pve.destroyGuest(vmid)
  }
  await removeBackups(pve, vmid)
  return pve.createTestVm({
    vmid,
    name,
    params: { scsihw: 'virtio-scsi-single', scsi0: 'local-lvm:0.1' },
  })
}

test.describe('guest snapshots', () => {
  test('take, describe, roll back and delete a snapshot', async ({ page, pve, cleanup, mobile }) => {
    test.setTimeout(240_000)
    const vmid = base(mobile)
    await freshVm(pve, vmid, `e2e-guest-backup-snap-${mobile ? 'm' : 'd'}`)
    cleanup.guest(vmid)
    const guestApi = `/nodes/${pve.node}/qemu/${vmid}`

    await page.goto(`/guest/${pve.node}/qemu/${vmid}/snapshots`)
    const panel = page.getByRole('tabpanel', { name: '快照' })
    await expect(panel.getByText('还没有快照').first()).toBeVisible()
    await expect(panel.getByTestId('snapshot-current')).toHaveCount(0)

    // Take a snapshot through the dialog.
    await panel.getByRole('button', { name: '创建快照' }).first().click()
    let dialog = page.getByRole('dialog', { name: '创建快照' })
    await expect(dialog).toBeVisible()
    const nameBox = dialog.getByLabel('名称')
    await expect(nameBox).toHaveValue(/^snap-\d{8}-\d{4}/)
    // Invalid names are rejected inline.
    await nameBox.fill('1bad name')
    await expect(dialog.getByText('名称需以字母开头')).toBeVisible()
    await expect(dialog.getByRole('button', { name: '创建快照' })).toBeDisabled()
    await nameBox.fill('e2e-before')
    await dialog.getByLabel('描述').fill('升级前')
    await dialog.getByRole('button', { name: '创建快照' }).click()
    await expect(dialog).toBeHidden()

    const row = panel.locator('[data-snapshot="e2e-before"]')
    await expect(row).toBeVisible({ timeout: 60_000 })
    await expect(row).toContainText('升级前')
    const current = panel.getByTestId('snapshot-current')
    await expect(current).toContainText('当前状态')
    await expect(current).toContainText('基于 e2e-before')

    // Change the config after the snapshot, so the rollback has something to undo.
    await pve.put(`${guestApi}/config`, { memory: 96 })

    // Details: edit the description.
    await row.getByRole('button').first().click()
    dialog = page.getByRole('dialog', { name: 'e2e-before' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('包含内存')
    await dialog.getByLabel('描述').fill('升级前（已验证）')
    await dialog.getByRole('button', { name: '保存描述' }).click()
    await expect(page.getByText('描述已保存')).toBeVisible()
    await expect
      .poll(async () => (await pve.get<{ description?: string }>(`${guestApi}/snapshot/e2e-before/config`)).description)
      .toBe('升级前（已验证）')

    // The snapshot's stored config.
    await dialog.getByRole('button', { name: '快照中的配置' }).click()
    await expect(dialog.getByText('memory', { exact: true })).toBeVisible()

    // Roll back from the details sheet.
    await dialog.getByRole('button', { name: '回滚到此快照' }).click()
    dialog = page.getByRole('dialog', { name: '回滚到 e2e-before？' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('当前状态会丢失')
    await expect(dialog.getByRole('switch', { name: '回滚后启动' })).not.toBeChecked()
    await dialog.getByRole('button', { name: '回滚', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect
      .poll(async () => Number((await pve.get<{ memory: string | number }>(`${guestApi}/config`)).memory), { timeout: 60_000 })
      .toBe(64)

    // Delete it.
    await row.getByRole('button').first().click()
    dialog = page.getByRole('dialog', { name: 'e2e-before' })
    await dialog.getByRole('button', { name: '删除' }).click()
    dialog = page.getByRole('dialog', { name: '删除快照 e2e-before？' })
    await expect(dialog.getByRole('checkbox', { name: '强制删除' })).not.toBeChecked()
    await expect(dialog.getByRole('button', { name: '删除', exact: true })).toBeDisabled()
    await dialog.getByRole('textbox').fill('e2e-before')
    await dialog.getByRole('button', { name: '删除', exact: true }).click()
    await expect(row).toHaveCount(0, { timeout: 60_000 })
    await expect(panel.getByText('还没有快照').first()).toBeVisible()
    expect((await pve.get<{ name: string }[]>(`${guestApi}/snapshot`)).map((s) => s.name)).toEqual(['current'])
  })

  test('snapshot action in the page action menu opens the dialog', async ({ page, pve, mobile }) => {
    // Read-only: the shared sample VM 100 (never submitted).
    const vm = (await pve.guests()).find((g) => g.vmid === 100 && g.type === 'qemu')
    test.skip(!vm, '实验机里没有 VM 100')
    await page.goto(`/guest/${pve.node}/qemu/100/snapshots`)
    const panel = page.getByRole('tabpanel', { name: '快照' })
    // The sample VM has a "base" snapshot: timeline with the current marker.
    await expect(panel.locator('[data-snapshot="base"]')).toBeVisible()
    await expect(panel.getByTestId('snapshot-current')).toContainText('基于 base')

    if (mobile) await page.getByRole('toolbar', { name: '操作' }).getByRole('button', { name: '更多' }).click()
    else await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '创建快照' }).click()
    const dialog = page.getByRole('dialog', { name: '创建快照' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
  })
})

test.describe('guest backups', () => {
  test('backup now, protect, notes, config, restore and delete', async ({ page, pve, cleanup, mobile }) => {
    test.setTimeout(300_000)
    const vmid = base(mobile) + 1
    const newVmid = base(mobile) + 2
    const name = `e2e-guest-backup-bk-${mobile ? 'm' : 'd'}`
    await freshVm(pve, vmid, name)
    cleanup.guest(vmid)
    cleanup.add(() => removeBackups(pve, vmid))
    // Restored copy (and leftovers of an earlier crashed run).
    await pve.destroyGuest(newVmid)
    cleanup.guest(newVmid)
    const guestApi = `/nodes/${pve.node}/qemu/${vmid}`

    await page.goto(`/guest/${pve.node}/qemu/${vmid}/backup`)
    const panel = page.getByRole('tabpanel', { name: '备份' })
    await expect(panel.getByText('还没有备份').first()).toBeVisible()

    // Backup now.
    await panel.getByRole('button', { name: '立即备份' }).first().click()
    let dialog = page.getByRole('dialog', { name: '立即备份' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('combobox', { name: '存储' })).toContainText(STORAGE)
    await expect(dialog.getByRole('radio', { name: /快照/ })).toBeChecked()
    await dialog.getByRole('radio', { name: /停止/ }).click()
    const notes = dialog.getByLabel('备注')
    await notes.fill('e2e ')
    await dialog.getByRole('button', { name: '{{vmid}}' }).click()
    await expect(notes).toHaveValue('e2e {{vmid}}')
    await dialog.getByRole('button', { name: '开始备份' }).click()
    await expect(dialog).toBeHidden()

    const row = panel.getByTestId('backup-row').first()
    await expect(row).toBeVisible({ timeout: 90_000 })
    await expect(row).toContainText(`e2e ${vmid}`)
    await expect(row).toContainText('VMA · ZSTD')
    const [entry] = await backupsOf(pve, vmid)
    expect(entry?.notes).toBe(`e2e ${vmid}`)

    // Details → protect.
    await row.getByRole('button').first().click()
    dialog = page.getByRole('dialog').filter({ hasText: '卷 ID' })
    await expect(dialog).toContainText(entry!.volid)
    await dialog.getByRole('button', { name: '设为受保护' }).click()
    await expect(page.getByText('已设为受保护')).toBeVisible()
    await expect.poll(async () => (await backupsOf(pve, vmid))[0]?.protected).toBe(1)

    // Protected backups cannot be deleted.
    await row.getByRole('button').first().click()
    dialog = page.getByRole('dialog').filter({ hasText: '卷 ID' })
    await expect(dialog.getByRole('button', { name: '删除' })).toBeDisabled()

    // Notes.
    await dialog.getByRole('button', { name: '编辑' }).click()
    dialog = page.getByRole('dialog', { name: '编辑备注' })
    await dialog.getByLabel('备注').fill('e2e 已编辑')
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toBeHidden()
    await expect(row).toContainText('e2e 已编辑')
    expect((await backupsOf(pve, vmid))[0]?.notes).toBe('e2e 已编辑')

    // Show the config stored in the backup.
    await row.getByRole('button').first().click()
    dialog = page.getByRole('dialog').filter({ hasText: '卷 ID' })
    await dialog.getByRole('button', { name: '显示配置' }).click()
    dialog = page.getByRole('dialog', { name: '备份中的配置' })
    await expect(dialog.getByText(name, { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(dialog.getByText('#qmdump#map')).toBeVisible()
    await dialog.getByRole('button', { name: '关闭' }).first().click()
    await expect(dialog).toBeHidden()

    // Restore as a new guest.
    await row.getByRole('button').first().click()
    dialog = page.getByRole('dialog').filter({ hasText: '卷 ID' })
    await dialog.getByRole('button', { name: '恢复', exact: true }).click()
    dialog = page.getByRole('dialog', { name: `恢复并覆盖 VM ${vmid}` })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('radio', { name: /恢复为新客户机/ }).click()
    dialog = page.getByRole('dialog', { name: '从备份恢复虚拟机' })
    const vmidBox = dialog.getByLabel('新 VM 的 ID')
    await expect(vmidBox).not.toHaveValue('')
    await vmidBox.fill(String(newVmid))
    await expect(dialog.getByText('可用', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('switch', { name: '唯一化' })).toBeChecked()
    await dialog.getByRole('button', { name: '覆盖设置' }).click()
    await expect(dialog.getByLabel('名称')).toHaveAttribute('placeholder', name)
    await dialog.getByLabel('名称').fill(`${name}-copy`)
    await dialog.getByRole('button', { name: '恢复', exact: true }).click()
    await expect(dialog).toBeHidden()
    const copy = await pve.waitForGuest(newVmid, (g) => g.name === `${name}-copy`, 90_000)
    expect(copy.type).toBe('qemu')

    // Restore over the existing guest: change it first, then type the VMID to confirm.
    await pve.put(`${guestApi}/config`, { memory: 128 })
    await row.getByRole('button').first().click()
    dialog = page.getByRole('dialog').filter({ hasText: '卷 ID' })
    await dialog.getByRole('button', { name: '恢复', exact: true }).click()
    dialog = page.getByRole('dialog', { name: `恢复并覆盖 VM ${vmid}` })
    const submit = dialog.getByRole('button', { name: '覆盖并恢复' })
    await expect(submit).toBeDisabled()
    await dialog.getByLabel(`请输入 ${vmid} 以确认覆盖`).fill(String(vmid))
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(dialog).toBeHidden()
    await expect
      .poll(async () => Number((await pve.get<{ memory: string | number }>(`${guestApi}/config`)).memory), { timeout: 90_000 })
      .toBe(64)
    // The restore keeps the guest's name.
    await pve.waitForGuest(vmid, (g) => g.name === name && g.status === 'stopped', 60_000)

    // Unprotect from the details, then delete.
    await page.goto(`/guest/${pve.node}/qemu/${vmid}/backup`)
    await panel.getByTestId('backup-row').first().getByRole('button').first().click()
    dialog = page.getByRole('dialog').filter({ hasText: '卷 ID' })
    await dialog.getByRole('button', { name: '取消保护' }).click()
    await expect.poll(async () => (await backupsOf(pve, vmid))[0]?.protected ?? 0).toBe(0)
    await panel.getByTestId('backup-row').first().getByRole('button').first().click()
    dialog = page.getByRole('dialog').filter({ hasText: '卷 ID' })
    await dialog.getByRole('button', { name: '删除' }).click()
    const confirm = page.getByRole('alertdialog', { name: '删除这个备份？' })
    await confirm.getByRole('textbox').fill(String(vmid))
    await confirm.getByRole('button', { name: '删除' }).click()
    await expect(confirm).toBeHidden({ timeout: 30_000 })
    await expect(panel.getByTestId('backup-row')).toHaveCount(0, { timeout: 30_000 })
    expect(await backupsOf(pve, vmid)).toHaveLength(0)
  })

  test('backup tab lists backups of the shared sample guests read-only', async ({ page, pve }) => {
    await page.goto(`/guest/${pve.node}/lxc/200/backup`)
    const panel = page.getByRole('tabpanel', { name: '备份' })
    // Either a list or the empty state, never an error.
    await expect(panel.getByRole('heading', { name: '备份', exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: '立即备份' }).first()).toBeEnabled()
    await expect(panel.getByRole('alert')).toHaveCount(0)
  })
})

test.describe('container snapshots and backups', () => {
  test('CT: snapshot without RAM, backup and restore as a new container', async ({ page, pve, cleanup, mobile }) => {
    test.setTimeout(300_000)
    const vmid = base(mobile) + 5
    const newVmid = base(mobile) + 6
    const hostname = `e2e-guest-backup-ct-${mobile ? 'm' : 'd'}`
    for (const id of [vmid, newVmid]) {
      const g = (await pve.guests()).find((x) => x.vmid === id)
      if (g && !g.name?.startsWith('e2e-')) throw new Error(`VMID ${id} 被非测试客户机占用`)
      await pve.destroyGuest(id)
      await removeBackups(pve, id)
    }
    const templates = await pve.get<{ volid: string }[]>(`/nodes/${pve.node}/storage/local/content`, { content: 'vztmpl' })
    const template = templates.find((t) => /_amd64\.tar/.test(t.volid))?.volid
    test.skip(!template, '实验机里没有 amd64 容器模板')
    await pve.run('POST', `/nodes/${pve.node}/lxc`, {
      vmid,
      hostname,
      ostemplate: template,
      memory: 64,
      swap: 0,
      rootfs: 'local-lvm:0.1',
      unprivileged: 1,
      net0: 'name=eth0,bridge=vmbr0,ip=manual',
    })
    cleanup.guest(vmid)
    cleanup.add(() => removeBackups(pve, vmid))
    cleanup.guest(newVmid)
    await pve.waitForGuest(vmid, (g) => g.name === hostname)

    // Snapshot: no RAM option for containers.
    await page.goto(`/guest/${pve.node}/lxc/${vmid}/snapshots`)
    const snapPanel = page.getByRole('tabpanel', { name: '快照' })
    await snapPanel.getByRole('button', { name: '创建快照' }).first().click()
    let dialog = page.getByRole('dialog', { name: '创建快照' })
    await expect(dialog).toContainText(`容器 ${hostname}`)
    await expect(dialog.getByRole('switch', { name: /包含内存/ })).toHaveCount(0)
    await dialog.getByLabel('名称').fill('e2e-ct-snap')
    await dialog.getByRole('button', { name: '创建快照' }).click()
    await expect(snapPanel.locator('[data-snapshot="e2e-ct-snap"]')).toBeVisible({ timeout: 60_000 })

    // Backup.
    await page.goto(`/guest/${pve.node}/lxc/${vmid}/backup`)
    const panel = page.getByRole('tabpanel', { name: '备份' })
    await panel.getByRole('button', { name: '立即备份' }).first().click()
    dialog = page.getByRole('dialog', { name: '立即备份' })
    await expect(dialog).toContainText(`容器 ${hostname}`)
    await dialog.getByRole('button', { name: '开始备份' }).click()
    const row = panel.getByTestId('backup-row').first()
    await expect(row).toBeVisible({ timeout: 120_000 })
    await expect(row).toContainText('TAR · ZSTD')

    // Restore as a new CT: storage is required and preselected, privilege kept.
    await row.getByRole('button').first().click()
    dialog = page.getByRole('dialog').filter({ hasText: '卷 ID' })
    await dialog.getByRole('button', { name: '恢复', exact: true }).click()
    dialog = page.getByRole('dialog', { name: `恢复并覆盖 CT ${vmid}` })
    await dialog.getByRole('radio', { name: /恢复为新客户机/ }).click()
    dialog = page.getByRole('dialog', { name: '从备份恢复容器' })
    await expect(dialog.getByRole('combobox', { name: '目标存储' })).toContainText('local-lvm')
    await expect(dialog.getByRole('radio', { name: /与备份相同/ })).toBeChecked()
    // Wait for the suggested ID first: it would overwrite a typed one (VmidInput autofill).
    const ctVmidBox = dialog.getByLabel('新 CT 的 ID')
    await expect(ctVmidBox).not.toHaveValue('')
    await ctVmidBox.fill(String(newVmid))
    await expect(dialog.getByText('可用', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '覆盖设置' }).click()
    await expect(dialog.getByLabel('主机名')).toHaveAttribute('placeholder', hostname)
    await dialog.getByLabel('主机名').fill(`${hostname}-copy`)
    await dialog.getByRole('button', { name: '恢复', exact: true }).click()
    await expect(dialog).toBeHidden()
    const copy = await pve.waitForGuest(newVmid, (g) => g.name === `${hostname}-copy`, 120_000)
    expect(copy.type).toBe('lxc')
    const cfg = await pve.get<{ unprivileged?: number; rootfs: string }>(`/nodes/${pve.node}/lxc/${newVmid}/config`)
    expect(cfg.unprivileged).toBe(1)
    expect(cfg.rootfs).toMatch(/^local-lvm:/)
  })
})
