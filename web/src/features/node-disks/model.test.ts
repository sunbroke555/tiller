import { describe, expect, it } from 'vitest'

import type { DiskEntry, ZfsPoolDetail } from '@/api/node-disks'

import {
  buildDiskTree,
  canInitGpt,
  createTaskTitle,
  destroyParams,
  destroyTaskTitle,
  diskInUse,
  diskUsageLabel,
  flattenZfsTree,
  lvmVolumeGroups,
  parseSmart,
  shortDevice,
  simpleCreateParams,
  smartHealthTone,
  storageIdError,
  wearoutLeft,
  zfsCreateParams,
  zfsDevicesError,
  zfsErrorCount,
  zfsHealthTone,
  zfsScanInfo,
  zpoolNameError,
} from './model'

// GET /nodes/pvelab-c3/disks/list?include-partitions=1 with a ZFS mirror on sdb + sdc.
const LIST: DiskEntry[] = [
  { devpath: '/dev/sda', gpt: 1, health: 'OK', model: 'QEMU_HARDDISK', osdid: -1, 'osdid-list': null, rpm: -1, serial: 'drive-scsi0', size: 34359738368, type: 'unknown', used: 'partitions', vendor: 'QEMU    ', wearout: 'N/A', wwn: 'unknown' },
  { devpath: '/dev/sda1', gpt: 1, osdid: -1, 'osdid-list': null, parent: '/dev/sda', size: 1031168, type: 'partition', used: 'BIOS boot' },
  { devpath: '/dev/sda3', gpt: 1, osdid: -1, 'osdid-list': null, parent: '/dev/sda', size: 33821801984, type: 'partition', used: 'LVM' },
  { devpath: '/dev/sda2', gpt: 1, osdid: -1, 'osdid-list': null, parent: '/dev/sda', size: 536870912, type: 'partition', used: 'EFI' },
  { devpath: '/dev/sdc', gpt: 0, health: 'OK', model: 'QEMU_HARDDISK', osdid: -1, serial: 'drive-scsi2', size: 17179869184, type: 'unknown', wearout: 'N/A' },
  { devpath: '/dev/sdb', gpt: 1, health: 'OK', model: 'QEMU_HARDDISK', osdid: -1, serial: 'drive-scsi1', size: 17179869184, type: 'unknown', used: 'partitions', wearout: 'N/A' },
  { devpath: '/dev/sdb9', gpt: 1, osdid: -1, parent: '/dev/sdb', size: 8388608, type: 'partition', used: 'ZFS reserved' },
  { devpath: '/dev/sdb1', gpt: 1, osdid: -1, parent: '/dev/sdb', size: 17169383424, type: 'partition', used: 'ZFS' },
]

describe('disk list', () => {
  it('nests partitions under their disk, sorted naturally', () => {
    const tree = buildDiskTree(LIST)
    expect(tree.map((d) => d.devpath)).toEqual(['/dev/sda', '/dev/sdb', '/dev/sdc'])
    expect(tree[0]!.partitions.map((p) => p.devpath)).toEqual(['/dev/sda1', '/dev/sda2', '/dev/sda3'])
    expect(tree[1]!.partitions.map((p) => p.devpath)).toEqual(['/dev/sdb1', '/dev/sdb9'])
    expect(tree[2]!.partitions).toEqual([])
  })

  it('sorts sdb10 after sdb2 and keeps orphaned partitions', () => {
    const tree = buildDiskTree([
      { devpath: '/dev/nvme0n1p10', parent: '/dev/nvme0n1' },
      { devpath: '/dev/nvme0n1' },
      { devpath: '/dev/nvme0n1p2', parent: '/dev/nvme0n1' },
      { devpath: '/dev/sdz1', parent: '/dev/sdz' },
    ])
    expect(tree.map((d) => d.devpath)).toEqual(['/dev/nvme0n1', '/dev/sdz1'])
    expect(tree[0]!.partitions.map((p) => p.devpath)).toEqual(['/dev/nvme0n1p2', '/dev/nvme0n1p10'])
  })

  it('labels usage like the official list, with Ceph details', () => {
    expect(diskUsageLabel(LIST[4]!)).toBe('未使用')
    expect(diskUsageLabel(LIST[0]!)).toBe('分区')
    expect(diskUsageLabel(LIST[1]!)).toBe('BIOS 启动')
    expect(diskUsageLabel(LIST[6]!)).toBe('ZFS 保留')
    expect(diskUsageLabel({ devpath: '/dev/sdd1', used: 'filesystem', filesystem: 'ext4' })).toBe('ext4')
    expect(diskUsageLabel({ devpath: '/dev/sde', used: 'LVM', 'osdid-list': [3, 1], db: 1 })).toBe('LVM, Ceph (OSD.1, OSD.3, DB)')
    expect(diskUsageLabel({ devpath: '/dev/sdf', osdid: 2 })).toBe('Ceph (OSD.2)')
  })

  it('allows GPT only on unused whole disks', () => {
    expect(canInitGpt(LIST[4]!)).toBe(true)
    expect(canInitGpt(LIST[0]!)).toBe(false)
    expect(canInitGpt(LIST[1]!)).toBe(false)
    expect(canInitGpt({ devpath: '/dev/sdg', osdid: 0 })).toBe(false)
    expect(diskInUse({ devpath: '/dev/sdh', used: 'unused' })).toBe(false)
  })

  it('turns wearout into remaining life', () => {
    expect(wearoutLeft(3)).toBe(97)
    expect(wearoutLeft('12')).toBe(88)
    expect(wearoutLeft('N/A')).toBeNull()
    expect(wearoutLeft(undefined)).toBeNull()
  })

  it('classifies SMART health', () => {
    expect(smartHealthTone('PASSED')).toBe('ok')
    expect(smartHealthTone('OK')).toBe('ok')
    expect(smartHealthTone('FAILED!')).toBe('bad')
    expect(smartHealthTone('UNKNOWN')).toBe('unknown')
    expect(smartHealthTone(undefined)).toBe('unknown')
  })
})

describe('SMART', () => {
  it('parses ATA attributes (padded ids, raw / normalized, failing)', () => {
    const view = parseSmart({
      health: 'PASSED',
      type: 'ata',
      attributes: [
        { id: '194', name: 'Temperature_Celsius', value: 64, worst: 45, threshold: 0, fail: '-', flags: '-O---K', raw: '36 (Min/Max 18/55)', normalized: 64 },
        { id: '  5', name: 'Reallocated_Sector_Ct', value: 100, worst: 100, threshold: 10, fail: 'FAILING_NOW', flags: 'PO--CK', raw: '8', normalized: 100 },
      ],
    })
    expect(view.kind).toBe('attributes')
    if (view.kind !== 'attributes') return
    expect(view.attributes.map((a) => a.id)).toEqual([5, 194])
    expect(view.attributes[0]).toMatchObject({ name: 'Reallocated_Sector_Ct', value: '8', normalized: '100', threshold: '10', failing: true })
    expect(view.attributes[1]).toMatchObject({ value: '36 (Min/Max 18/55)', failing: false })
  })

  it('falls back to `value` for old APIs without raw / normalized', () => {
    const view = parseSmart({ health: 'PASSED', attributes: [{ id: 9, name: 'Power_On_Hours', value: '12345', worst: 99, threshold: 0, fail: '' }] })
    expect(view.kind === 'attributes' && view.attributes[0]).toMatchObject({ value: '12345', normalized: '12345', failing: false })
  })

  it('shows the text output for NVMe / SAS', () => {
    const view = parseSmart({ health: 'OK', text: 'Current Drive Temperature:     0 C\n', type: 'text' })
    expect(view).toEqual({ kind: 'text', health: 'OK', text: 'Current Drive Temperature:     0 C\n' })
    expect(parseSmart({ health: 'UNKNOWN' }).kind).toBe('empty')
  })
})

// Shaped like GET /nodes/{node}/disks/zfs/{name} on the lab, with a failed mirror leg and a log device.
const ZPOOL: ZfsPoolDetail = {
  name: 'tank',
  state: 'DEGRADED',
  status: 'One or more devices could not be used.',
  action: 'Attach the missing device and online it.',
  scan: 'scrub repaired 0B in 00:00:00 with 0 errors on Sun Nov  1 14:27:37 2026',
  errors: 'No known data errors',
  children: [
    {
      name: 'tank',
      state: 'DEGRADED',
      read: 0,
      write: 0,
      cksum: 0,
      leaf: 0,
      msg: '',
      children: [
        {
          name: 'mirror-0',
          state: 'DEGRADED',
          read: 0,
          write: 0,
          cksum: 0,
          leaf: 0,
          msg: '',
          children: [
            { name: '/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_drive-scsi1-part1', state: 'ONLINE', read: 0, write: 0, cksum: 2, leaf: 1, msg: '' },
            { name: '1234567890', state: 'UNAVAIL', read: 0, write: 0, cksum: 0, leaf: 1, msg: 'was /dev/sdc1' },
          ],
        },
      ],
    },
    { name: 'logs', leaf: 0, children: [{ name: 'sdd', state: 'ONLINE', read: 1, write: 0, cksum: 0, leaf: 1 }] },
  ],
}

describe('zpool status', () => {
  it('flattens the vdev tree with depth', () => {
    const rows = flattenZfsTree(ZPOOL)
    expect(rows.map((r) => [r.name, r.depth, r.leaf])).toEqual([
      ['tank', 0, false],
      ['mirror-0', 1, false],
      ['/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_drive-scsi1-part1', 2, true],
      ['1234567890', 2, true],
      ['logs', 0, false],
      ['sdd', 1, true],
    ])
    expect(rows[3]!.msg).toBe('was /dev/sdc1')
    expect(rows[0]!.msg).toBeUndefined()
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
    expect(zfsErrorCount(rows)).toBe(3)
    expect(flattenZfsTree(undefined)).toEqual([])
  })

  it('maps states to tones and shortens by-id names', () => {
    expect(zfsHealthTone('ONLINE')).toBe('ok')
    expect(zfsHealthTone('DEGRADED')).toBe('warn')
    expect(zfsHealthTone('UNAVAIL')).toBe('bad')
    expect(zfsHealthTone(undefined)).toBe('unknown')
    expect(shortDevice('/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_drive-scsi1-part1')).toBe('scsi-0QEMU_QEMU_HARDDISK_drive-scsi1-part1')
    expect(shortDevice('/dev/sdb')).toBe('/dev/sdb')
  })

  it('reads scrub / resilver info', () => {
    expect(zfsScanInfo(ZPOOL.scan)).toMatchObject({ kind: 'scrub', inProgress: false })
    expect(zfsScanInfo('scrub in progress since Sun Nov  1 14:27:37 2026')).toMatchObject({ kind: 'scrub', inProgress: true })
    expect(zfsScanInfo('resilver in progress since …')).toMatchObject({ kind: 'resilver', inProgress: true })
    expect(zfsScanInfo('none requested').kind).toBe('none')
    expect(zfsScanInfo(undefined).kind).toBe('none')
  })
})

describe('LVM', () => {
  it('lists volume groups with their physical volumes', () => {
    const vgs = lvmVolumeGroups({
      leaf: 0,
      children: [
        { name: 'pve', size: 100, free: 8, lvcount: 3, leaf: 0, children: [{ name: '/dev/sda3', size: 100, free: 8, leaf: 1 }] },
        { name: 'data', size: 50, free: 50, lvcount: 0, leaf: 1 },
      ],
    })
    expect(vgs.map((v) => v.name)).toEqual(['data', 'pve'])
    expect(vgs[0]!.children).toEqual([])
    expect(vgs[1]!.children.map((p) => p.name)).toEqual(['/dev/sda3'])
  })
})

describe('form → params', () => {
  it('validates storage IDs and pool names', () => {
    expect(storageIdError('e2e-disks-lvm')).toBeNull()
    expect(storageIdError('')).toBe('请输入名称')
    expect(storageIdError('1abc')).not.toBeNull()
    expect(storageIdError('abc-')).not.toBeNull()
    expect(storageIdError('a')).not.toBeNull()
    expect(storageIdError('a b')).not.toBeNull()
    expect(zpoolNameError('tank')).toBeNull()
    expect(zpoolNameError('mirror1')).toMatch(/保留/)
    expect(zpoolNameError('log')).toMatch(/保留/)
    expect(zpoolNameError('logs')).toBeNull()
  })

  it('checks device counts like the API', () => {
    expect(zfsDevicesError('single', 0)).toBe('请选择磁盘')
    expect(zfsDevicesError('single', 1)).toBeNull()
    expect(zfsDevicesError('single', 2)).toMatch(/只能选择 1 块/)
    expect(zfsDevicesError('mirror', 1)).toMatch(/至少需要 2 块/)
    expect(zfsDevicesError('mirror', 2)).toBeNull()
    expect(zfsDevicesError('raid10', 5)).toMatch(/偶数/)
    expect(zfsDevicesError('raid10', 4)).toBeNull()
    expect(zfsDevicesError('raidz2', 3)).toMatch(/至少需要 4 块/)
    expect(zfsDevicesError('draid', 3, { data: 2, spares: 1 })).toMatch(/至少需要 4 块/)
    expect(zfsDevicesError('draid', 4, { data: 2, spares: 1 })).toBeNull()
  })

  it('builds ZFS create params (devices in picked order, dRAID config)', () => {
    expect(
      zfsCreateParams({ name: ' tank ', raidlevel: 'mirror', devices: ['/dev/sdc', '/dev/sdb'], ashift: 12, compression: 'lz4', addStorage: true }),
    ).toEqual({ name: 'tank', raidlevel: 'mirror', devices: '/dev/sdc,/dev/sdb', ashift: 12, compression: 'lz4', add_storage: 1 })
    const draid = zfsCreateParams({
      name: 'd',
      raidlevel: 'draid2',
      devices: ['/dev/a', '/dev/b', '/dev/c', '/dev/d', '/dev/e'],
      ashift: 13,
      compression: 'on',
      addStorage: false,
      draidData: 2,
      draidSpares: 1,
    })
    expect(draid['draid-config']).toBe('data=2,spares=1')
    expect(draid.add_storage).toBe(0)
    // dRAID numbers are ignored for other levels.
    expect(zfsCreateParams({ name: 'x', raidlevel: 'single', devices: ['/dev/a'], ashift: 12, compression: 'on', addStorage: true, draidData: 2 })).not.toHaveProperty(
      'draid-config',
    )
  })

  it('builds LVM / thin / directory params', () => {
    expect(simpleCreateParams('lvm', { name: 'vg1', device: '/dev/sdb', addStorage: true })).toEqual({ name: 'vg1', device: '/dev/sdb', add_storage: 1 })
    expect(simpleCreateParams('lvmthin', { name: 'tp', device: '/dev/sdb1', addStorage: false, filesystem: 'xfs' })).toEqual({
      name: 'tp',
      device: '/dev/sdb1',
      add_storage: 0,
    })
    expect(simpleCreateParams('directory', { name: 'backup', device: '/dev/sdc', addStorage: true, filesystem: 'xfs' })).toEqual({
      name: 'backup',
      device: '/dev/sdc',
      add_storage: 1,
      filesystem: 'xfs',
    })
  })

  it('titles tasks with a space only before Latin text', () => {
    expect(createTaskTitle('zfs', 'tank')).toBe('创建 ZFS 池 tank')
    expect(destroyTaskTitle('directory', 'backup')).toBe('删除目录 backup')
  })

  it('builds destroy params with explicit cleanup flags', () => {
    expect(destroyParams({ cleanupDisks: true, cleanupConfig: false })).toEqual({ 'cleanup-disks': 1, 'cleanup-config': 0 })
    expect(destroyParams({ cleanupDisks: false, cleanupConfig: true, volumeGroup: 'pve' })).toEqual({
      'cleanup-disks': 0,
      'cleanup-config': 1,
      'volume-group': 'pve',
    })
  })
})
