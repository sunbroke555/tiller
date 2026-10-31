import { describe, expect, it } from 'vitest'

import { backupGuestType, decodeFilePath, encodeFilePath, type Snapshot } from '@/api/guest-backup'

import {
  agentEnabled,
  allStoragesAvailable,
  backupFileName,
  buildSnapshotRows,
  countSnapshots,
  currentParent,
  describeRetention,
  escapeNotesTemplate,
  firstLine,
  formatBackupFormat,
  notificationModeFromDefaults,
  parseBackupConfig,
  parseRetention,
  restoreParams,
  suggestSnapshotName,
  unescapeNotesTemplate,
  validateGuestName,
  validateSnapshotName,
  vzdumpParams,
  type BackupNowForm,
  type RestoreForm,
} from './logic'

const snap = (name: string, parent?: string, snaptime?: number, extra: Partial<Snapshot> = {}): Snapshot => ({
  name,
  ...(parent ? { parent } : {}),
  ...(snaptime ? { snaptime } : {}),
  ...extra,
})

describe('buildSnapshotRows', () => {
  it('shows only "current" when there are no snapshots', () => {
    const rows = buildSnapshotRows([snap('current', undefined, undefined, { running: 1 })])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ isCurrent: true, depth: 0, first: true, hasNext: false })
  })

  it('lays a linear history out as one line ending at current (lab response order)', () => {
    // Real lab order: s1, s2, current (current.parent = s2).
    const rows = buildSnapshotRows([snap('s1', undefined, 10), snap('s2', 's1', 20), snap('current', 's2')])
    expect(rows.map((r) => r.snap.name)).toEqual(['s1', 's2', 'current'])
    expect(rows.map((r) => r.depth)).toEqual([0, 0, 0])
    expect(rows.map((r) => r.first)).toEqual([true, false, false])
    expect(rows.map((r) => r.hasNext)).toEqual([true, true, false])
    expect(rows.every((r) => r.rails.length === 0)).toBe(true)
  })

  it('puts the branch leading to current on the main line, others as side branches', () => {
    // base ─┬─ old-a ── old-b
    //       └─ new ── current
    const list = [
      snap('current', 'new'),
      snap('base', undefined, 1),
      snap('old-a', 'base', 2),
      snap('old-b', 'old-a', 3),
      snap('new', 'base', 4),
    ]
    const rows = buildSnapshotRows(list)
    expect(rows.map((r) => [r.snap.name, r.depth])).toEqual([
      ['base', 0],
      ['old-a', 1],
      ['old-b', 1],
      ['new', 0],
      ['current', 0],
    ])
    // The main line passes through the side-branch rows.
    expect(rows[1]).toMatchObject({ first: true, hasNext: true, rails: [0] })
    expect(rows[2]).toMatchObject({ first: false, hasNext: false, rails: [0] })
    expect(rows[3]).toMatchObject({ first: false, hasNext: true, rails: [] })
  })

  it('sorts siblings by time and copes with a missing parent', () => {
    const rows = buildSnapshotRows([snap('b', 'gone', 5), snap('a', undefined, 1), snap('current', 'a')])
    // "b" lost its parent: listed as its own root before the main line.
    expect(rows.map((r) => r.snap.name)).toEqual(['b', 'a', 'current'])
    expect(rows[0]).toMatchObject({ depth: 0, first: true, hasNext: false })
  })

  it('counts snapshots and finds the current parent', () => {
    const list = [snap('s1', undefined, 1), snap('current', 's1')]
    expect(countSnapshots(list)).toBe(1)
    expect(currentParent(list)).toBe('s1')
    expect(countSnapshots(undefined)).toBe(0)
  })
})

describe('snapshot names', () => {
  it('validates like pve-configid', () => {
    expect(validateSnapshotName('')).toMatch(/请输入/)
    expect(validateSnapshotName('a')).toMatch(/至少/)
    expect(validateSnapshotName('1abc')).toMatch(/字母开头/)
    expect(validateSnapshotName('my snap')).toMatch(/只能包含/)
    expect(validateSnapshotName('Before-Upgrade_1')).toBeNull()
    expect(validateSnapshotName('current')).toMatch(/保留/)
    expect(validateSnapshotName('x'.repeat(41))).toMatch(/最多/)
    expect(validateSnapshotName('s1', ['s1'])).toMatch(/已存在/)
  })

  it('suggests a valid unique name', () => {
    const d = new Date(2026, 10, 1, 8, 5)
    expect(suggestSnapshotName(d)).toBe('snap-20261101-0805')
    expect(suggestSnapshotName(d, ['snap-20261101-0805'])).toBe('snap-20261101-0805-2')
    expect(validateSnapshotName(suggestSnapshotName(d))).toBeNull()
  })

  it('detects the guest agent', () => {
    expect(agentEnabled('1')).toBe(true)
    expect(agentEnabled('enabled=1,fstrim_cloned_disks=1')).toBe(true)
    expect(agentEnabled('0')).toBe(false)
    expect(agentEnabled(undefined)).toBe(false)
  })
})

describe('notes template', () => {
  it('escapes newlines and backslashes like the official UI', () => {
    expect(escapeNotesTemplate('{{guestname}}\nC:\\x')).toBe('{{guestname}}\\nC:\\\\x')
    expect(unescapeNotesTemplate('{{guestname}}\\nC:\\\\x')).toBe('{{guestname}}\nC:\\x')
  })
})

describe('vzdumpParams', () => {
  const form: BackupNowForm = {
    storage: 'local',
    mode: 'snapshot',
    compress: 'zstd',
    protected: false,
    notesTemplate: '{{guestname}}\nnightly',
    notificationMode: 'notification-system',
    mailto: '',
    prune: false,
  }

  it('builds the official parameters and always sends remove', () => {
    expect(vzdumpParams(100, form, { type: 'qemu', pbs: false })).toEqual({
      vmid: 100,
      storage: 'local',
      mode: 'snapshot',
      remove: 0,
      compress: 'zstd',
      'notification-mode': 'notification-system',
      'notes-template': '{{guestname}}\\nnightly',
    })
  })

  it('handles protection, prune, sendmail and no compression', () => {
    const p = vzdumpParams(
      200,
      { ...form, compress: '0', protected: true, prune: true, notificationMode: 'legacy-sendmail', mailto: ' a@b.c ', notesTemplate: ' ' },
      { type: 'lxc', pbs: false },
    )
    expect(p).toMatchObject({ compress: '0', protected: 1, remove: 1, mailto: 'a@b.c', 'notification-mode': 'legacy-sendmail' })
    expect(p).not.toHaveProperty('notes-template')
  })

  it('omits compression for PBS and sends change detection for CTs only', () => {
    const pbsForm = { ...form, pbsChangeDetection: 'metadata' as const }
    const ct = vzdumpParams(200, pbsForm, { type: 'lxc', pbs: true })
    expect(ct).not.toHaveProperty('compress')
    expect(ct['pbs-change-detection-mode']).toBe('metadata')
    expect(vzdumpParams(100, pbsForm, { type: 'qemu', pbs: true })).not.toHaveProperty('pbs-change-detection-mode')
    expect(vzdumpParams(200, pbsForm, { type: 'lxc', pbs: false })).not.toHaveProperty('pbs-change-detection-mode')
  })

  it('derives the notification mode from defaults', () => {
    expect(notificationModeFromDefaults(undefined)).toBe('notification-system')
    expect(notificationModeFromDefaults({ 'notification-mode': 'auto', mailto: 'x@y' })).toBe('legacy-sendmail')
    expect(notificationModeFromDefaults({ 'notification-mode': 'auto' })).toBe('notification-system')
    expect(notificationModeFromDefaults({ 'notification-mode': 'legacy-sendmail' })).toBe('legacy-sendmail')
  })
})

describe('retention', () => {
  it('parses property strings and objects', () => {
    expect(parseRetention('keep-all=1')).toEqual({ keepAll: true, keeps: [] })
    const r = parseRetention('keep-daily=7,keep-last=3')!
    expect(r.keeps.map((k) => k.key)).toEqual(['keep-last', 'keep-daily'])
    expect(describeRetention(r)).toBe('保留最近 3 个、每天 7 个')
    expect(parseRetention({ 'keep-weekly': 2 })?.keeps).toEqual([{ key: 'keep-weekly', label: '每周', value: 2 }])
    expect(parseRetention(undefined)).toBeNull()
    expect(describeRetention({ keepAll: true, keeps: [] })).toBe('保留全部备份')
  })
})

describe('parseBackupConfig', () => {
  // Real /vzdump/extractconfig output from the lab.
  const qemu = `boot: order=scsi0;net0
cores: 1
memory: 64
name: e2e-guest-backup-probe
net0: virtio=BC:24:11:6C:B2:3E,bridge=vmbr0
scsi0: local-lvm:vm-3690-disk-0,size=104858K
#qmdump#map:scsi0:drive-scsi0:local-lvm:raw:
`
  it('reads name, sizes and disk storages of a VM backup', () => {
    const info = parseBackupConfig(qemu)
    expect(info).toMatchObject({ name: 'e2e-guest-backup-probe', memory: '64', cores: '1', storages: ['local-lvm'] })
    expect(info.lines[0]).toEqual({ key: 'boot', value: 'order=scsi0;net0' })
    expect(allStoragesAvailable(info, ['local', 'local-lvm'])).toBe(true)
    expect(allStoragesAvailable(info, ['local'])).toBe(false)
  })

  it('treats raw device disks as unknown storage', () => {
    const info = parseBackupConfig('#qmdump#map:scsi1:drive-scsi1:::\n')
    expect(info.storages).toEqual([''])
    expect(allStoragesAvailable(info, ['local-lvm'])).toBe(false)
  })

  it('reads a CT backup and ignores snapshot sections', () => {
    const info = parseBackupConfig(`arch: amd64
hostname: alpine-ct
memory: 128
rootfs: local-lvm:vm-200-disk-0,size=1G
mp0: /srv/data,mp=/data
unprivileged: 1

[before]
hostname: old-name
`)
    expect(info).toMatchObject({ name: 'alpine-ct', memory: '128', unprivileged: true, storages: ['local-lvm'] })
  })

  it('copes with empty input', () => {
    expect(parseBackupConfig(undefined)).toEqual({ lines: [], storages: [] })
  })
})

describe('restoreParams', () => {
  const base: RestoreForm = {
    overwrite: false,
    vmid: 3601,
    unique: false,
    start: false,
    haManaged: false,
    liveRestore: false,
    unprivileged: 'keep',
  }

  it('restores a VM as a new guest', () => {
    expect(restoreParams('qemu', 'local:backup/vzdump-qemu-100.vma.zst', { ...base, storage: 'local-lvm', unique: true, start: true })).toEqual({
      vmid: 3601,
      archive: 'local:backup/vzdump-qemu-100.vma.zst',
      storage: 'local-lvm',
      unique: 1,
      start: 1,
    })
  })

  it('overwrites with force, converts bandwidth and overrides', () => {
    const p = restoreParams('qemu', 'v', { ...base, overwrite: true, bwlimitMiB: 10, name: ' web ', memory: 512, cores: 2, sockets: 1 })
    expect(p).toMatchObject({ force: 1, bwlimit: 10240, name: 'web', memory: 512, cores: 2, sockets: 1 })
    expect(restoreParams('qemu', 'v', { ...base, bwlimitMiB: 0 }).bwlimit).toBe(0)
  })

  it('live restore replaces start', () => {
    const p = restoreParams('qemu', 'pbs:backup/vm/100/x', { ...base, liveRestore: true, start: true })
    expect(p['live-restore']).toBe(1)
    expect(p).not.toHaveProperty('start')
  })

  it('restores a CT with ostemplate, restore=1, hostname and privilege', () => {
    const p = restoreParams('lxc', 'local:backup/vzdump-lxc-200.tar.zst', {
      ...base,
      storage: 'local-lvm',
      name: 'ct-new',
      unprivileged: '0',
      sockets: 2,
      liveRestore: true,
      start: true,
      haManaged: true,
    })
    expect(p).toEqual({
      vmid: 3601,
      storage: 'local-lvm',
      ostemplate: 'local:backup/vzdump-lxc-200.tar.zst',
      restore: 1,
      hostname: 'ct-new',
      unprivileged: 0,
      start: 1,
      'ha-managed': 1,
    })
  })

  it('validates name overrides', () => {
    expect(validateGuestName('')).toBeNull()
    expect(validateGuestName('web-01.lan')).toBeNull()
    expect(validateGuestName('-bad')).not.toBeNull()
    expect(validateGuestName('has space')).not.toBeNull()
  })
})

describe('display helpers', () => {
  it('formats backup formats and names', () => {
    expect(formatBackupFormat('vma.zst')).toBe('VMA · ZSTD')
    expect(formatBackupFormat('tar.gz')).toBe('TAR · GZIP')
    expect(formatBackupFormat('tgz')).toBe('TAR · GZIP')
    expect(formatBackupFormat('pbs-ct')).toBe('PBS')
    expect(backupFileName('local:backup/vzdump-qemu-100-2026_11_01-04_12_56.vma.zst')).toBe('vzdump-qemu-100-2026_11_01-04_12_56.vma.zst')
    expect(firstLine('\n  hello \nworld')).toBe('hello')
  })

  it('detects the guest type of backup volumes', () => {
    expect(backupGuestType({ volid: 'local:backup/vzdump-qemu-1-x.vma.zst', format: 'vma.zst' })).toBe('qemu')
    expect(backupGuestType({ volid: 'local:backup/vzdump-lxc-1-x.tar.zst', format: 'tar.zst' })).toBe('lxc')
    expect(backupGuestType({ volid: 'pbs:backup/vm/100/2026-01-01T00:00:00Z', format: 'pbs-vm' })).toBe('qemu')
    expect(backupGuestType({ volid: 'pbs:backup/ct/100/2026-01-01T00:00:00Z', format: 'pbs-ct' })).toBe('lxc')
    expect(backupGuestType({ volid: 'x:backup/foo', format: 'raw', subtype: 'lxc' })).toBe('lxc')
    expect(backupGuestType({ volid: 'x:backup/foo', format: 'raw' })).toBeNull()
  })

  it('round-trips file-restore paths as UTF-8 base64', () => {
    expect(encodeFilePath('/')).toBe('Lw==')
    expect(decodeFilePath(encodeFilePath('/drive-scsi0.img.fidx/part/1/etc/中文.conf'))).toBe('/drive-scsi0.img.fidx/part/1/etc/中文.conf')
  })
})
