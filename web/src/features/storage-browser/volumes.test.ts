import { describe, expect, it } from 'vitest'

import type { ImportMetadata, PruneEntry, StorageVolume } from '@/api/storage-browser'

import {
  backupGroups,
  backupGuestType,
  deleteBlockedReason,
  diskImportParams,
  downloadDefaults,
  filenameFromUrl,
  filterVolumes,
  importKind,
  importParams,
  importRows,
  parseBackupConfig,
  parseOciReference,
  parsePruneBackups,
  pruneBackupsString,
  pruneKeepReasons,
  pruneParams,
  restoreParams,
  sortVolumes,
  uploadAccept,
  uploadFilename,
  validateChecksum,
  validateFilename,
  volumeName,
  volumeSize,
  volumeTime,
  volumeVmid,
} from './volumes'

// Real entries from the lab (PVE 9.2): dir storage "local" and lvmthin "local-lvm".
const backupZst: StorageVolume = {
  content: 'backup',
  ctime: 1793479752,
  format: 'vma.zst',
  notes: '每周备份',
  size: 3523,
  subtype: 'qemu',
  vmid: 3650,
  volid: 'local:backup/vzdump-qemu-3650-2026_11_01-04_49_12.vma.zst',
}
const backupProtected: StorageVolume = {
  content: 'backup',
  ctime: 1793479754,
  format: 'vma.lzo',
  protected: 1,
  size: 7185,
  subtype: 'qemu',
  vmid: 3650,
  volid: 'local:backup/vzdump-qemu-3650-2026_11_01-04_49_14.vma.lzo',
}
const ctBackup: StorageVolume = {
  content: 'backup',
  format: 'tar.zst',
  size: 10,
  vmid: 200,
  volid: 'local:backup/vzdump-lxc-200-2026_10_30-01_00_00.tar.zst',
}
const iso: StorageVolume = {
  content: 'iso',
  ctime: 1793471336,
  format: 'iso',
  size: 70254592,
  volid: 'local:iso/alpine-virt-3.24.3-x86_64.iso',
}
const lvDisk: StorageVolume = {
  content: 'images',
  ctime: '1793471379',
  format: 'raw',
  size: 1073741824,
  vmid: 100,
  volid: 'local-lvm:vm-100-disk-0',
}

describe('volume helpers', () => {
  it('names volumes like the official UI', () => {
    expect(volumeName(iso)).toBe('alpine-virt-3.24.3-x86_64.iso')
    expect(volumeName(lvDisk)).toBe('vm-100-disk-0')
    expect(volumeName(backupZst)).toBe('vzdump-qemu-3650-2026_11_01-04_49_12.vma.zst')
    expect(volumeName({ content: 'import', volid: 'local:import/appliance.ova/disk1.vmdk' })).toBe('appliance.ova/disk1.vmdk')
    expect(volumeName({ content: 'import', volid: 'esxi1:ha-datacenter/ds1/web/web.vmx' })).toBe(
      'ha-datacenter/ds1/web/web.vmx',
    )
  })

  it('takes backup times from the name and other times from ctime (also as string)', () => {
    expect(volumeTime(backupZst)).toBe(Math.floor(new Date(2026, 10, 1, 4, 49, 12).getTime() / 1000))
    expect(volumeTime(lvDisk)).toBe(1793471379)
    expect(volumeTime(iso)).toBe(1793471336)
    expect(volumeTime({ content: 'iso', volid: 'x', ctime: undefined })).toBeUndefined()
  })

  it('reads VMIDs and backup guest types', () => {
    expect(volumeVmid(lvDisk)).toBe(100)
    expect(volumeVmid({ vmid: '3650' })).toBe(3650)
    expect(volumeVmid({})).toBeUndefined()
    expect(backupGuestType(backupZst)).toBe('qemu')
    expect(backupGuestType(ctBackup)).toBe('lxc')
    expect(backupGuestType({ volid: 'pbs:backup/vm/100/2026-01-01T00:00:00Z', format: 'pbs-vm' })).toBe('qemu')
    expect(backupGuestType({ volid: 'pbs:backup/ct/200/x', format: 'pbs-ct' })).toBe('lxc')
    expect(backupGuestType({ volid: 'local:backup/other.tar', format: 'tar' })).toBeNull()
  })

  it('falls back to the approximate size', () => {
    expect(volumeSize({ size: 5 })).toEqual({ bytes: 5, approximate: false })
    expect(volumeSize({ 'approximate-size': 9 })).toEqual({ bytes: 9, approximate: true })
    expect(volumeSize({})).toEqual({ approximate: false })
  })

  it('sorts backups newest first and the rest by name', () => {
    expect(sortVolumes([ctBackup, backupZst, backupProtected], 'backup').map((v) => v.volid)).toEqual([
      backupProtected.volid,
      backupZst.volid,
      ctBackup.volid,
    ])
    const a = { ...iso, volid: 'local:iso/a10.iso' }
    const b = { ...iso, volid: 'local:iso/a9.iso' }
    expect(sortVolumes([a, b], 'iso').map(volumeName)).toEqual(['a9.iso', 'a10.iso'])
  })

  it('filters by text (name, format, notes) and VMID', () => {
    const all = [backupZst, backupProtected, ctBackup]
    expect(filterVolumes(all, '每周')).toEqual([backupZst])
    expect(filterVolumes(all, 'LZO')).toEqual([backupProtected])
    expect(filterVolumes(all, '', 200)).toEqual([ctBackup])
    expect(filterVolumes(all, '  ')).toHaveLength(3)
  })

  it('groups backups by guest', () => {
    expect(backupGroups([backupZst, backupProtected, ctBackup, iso])).toEqual([
      { type: 'lxc', vmid: 200, count: 1 },
      { type: 'qemu', vmid: 3650, count: 2 },
    ])
  })

  it('blocks deleting protected backups and disks of existing guests', () => {
    const ctx = { guests: new Map([[100, 'pve-lab']]), node: 'pve-lab', shared: false }
    expect(deleteBlockedReason(backupProtected, ctx)).toMatch(/受保护/)
    expect(deleteBlockedReason(backupZst, ctx)).toBeNull()
    expect(deleteBlockedReason(lvDisk, ctx)).toMatch(/客户机 100/)
    // Orphan: no such guest.
    expect(deleteBlockedReason({ ...lvDisk, vmid: 3899 }, ctx)).toBeNull()
    // Local storage, guest on another node: allowed (official ImageView).
    expect(deleteBlockedReason(lvDisk, { ...ctx, guests: new Map([[100, 'other']]) })).toBeNull()
    expect(deleteBlockedReason(lvDisk, { ...ctx, guests: new Map([[100, 'other']]), shared: true })).not.toBeNull()
  })

  it('classifies import volumes', () => {
    expect(importKind('ova')).toBe('guest')
    expect(importKind('vmx')).toBe('guest')
    expect(importKind('qcow2')).toBe('disk')
    expect(importKind('iso')).toBeNull()
  })
})

describe('upload and download', () => {
  it('accepts the official extensions and renames .img for imports', () => {
    expect(uploadAccept('iso')).toBe('.iso,.img')
    expect(uploadAccept('import')).toBe('.ova,.qcow2,.raw,.vmdk,.img')
    expect(uploadFilename('C:\\Users\\me\\disk.img', 'import')).toBe('disk.img.raw')
    expect(uploadFilename('debian.iso', 'iso')).toBe('debian.iso')
  })

  it('validates target file names', () => {
    expect(validateFilename('debian.iso', 'iso')).toBeNull()
    expect(validateFilename('DEBIAN.ISO', 'iso')).toBeNull()
    expect(validateFilename('x.tar.zst', 'vztmpl')).toBeNull()
    expect(validateFilename('x.zip', 'vztmpl')).toMatch(/扩展名/)
    expect(validateFilename('', 'iso')).toMatch(/文件名/)
    expect(validateFilename('a/b.iso', 'iso')).toMatch(/路径/)
  })

  it('validates checksums by algorithm length', () => {
    expect(validateChecksum(undefined, '')).toBeNull()
    expect(validateChecksum('sha256', 'a'.repeat(64))).toBeNull()
    expect(validateChecksum('sha256', 'a'.repeat(63))).toMatch(/64 位/)
    expect(validateChecksum('md5', 'z'.repeat(32))).toMatch(/十六进制/)
    expect(validateChecksum('sha512', '')).toMatch(/请输入/)
  })

  it('derives file name and decompression from URL metadata', () => {
    expect(downloadDefaults({ filename: 'debian.iso.gz' }, 'iso')).toEqual({ filename: 'debian.iso', compression: 'gz' })
    expect(downloadDefaults({ filename: 'x.iso.ZST' }, 'iso')).toEqual({ filename: 'x.iso', compression: 'zst' })
    expect(downloadDefaults({ filename: 'disk.img' }, 'import')).toEqual({ filename: 'disk.img.raw', compression: undefined })
    expect(downloadDefaults({ filename: 'x.tar.gz' }, 'vztmpl')).toEqual({ filename: 'x.tar.gz', compression: undefined })
    expect(filenameFromUrl('https://a.b/path/my%20file.iso?x=1')).toBe('my file.iso')
    expect(filenameFromUrl('not a url')).toBe('')
  })

  it('parses OCI references like the official dialog', () => {
    expect(parseOciReference('docker.io/library/nginx')).toEqual({ repository: 'docker.io/library/nginx' })
    expect(parseOciReference('nginx:1.27-alpine')).toEqual({ repository: 'nginx', tag: '1.27-alpine' })
    expect(parseOciReference('registry.local:5000/team/app:v2')).toEqual({ repository: 'registry.local:5000/team/app', tag: 'v2' })
    expect(parseOciReference('Bad/Name')).toBeNull()
    expect(parseOciReference('')).toBeNull()
  })
})

describe('prune', () => {
  it('round-trips the retention property string', () => {
    expect(parsePruneBackups('keep-last=3,keep-daily=7,keep-all=0')).toEqual({ 'keep-last': 3, 'keep-daily': 7 })
    expect(parsePruneBackups(undefined)).toEqual({})
    expect(pruneBackupsString({ 'keep-daily': 7, 'keep-last': 3, 'keep-weekly': 0 })).toBe('keep-last=3,keep-daily=7')
  })

  it('sends keep-all=1 when nothing is set, and the group', () => {
    expect(pruneParams({})).toEqual({ 'prune-backups': 'keep-all=1' })
    expect(pruneParams({ 'keep-last': 2 }, { type: 'qemu', vmid: 100 })).toEqual({
      'prune-backups': 'keep-last=2',
      type: 'qemu',
      vmid: 100,
    })
  })

  it('explains why backups are kept, per group', () => {
    const e = (volid: string, ctime: number, mark: PruneEntry['mark'], vmid = 100): PruneEntry => ({
      volid,
      ctime,
      mark,
      type: 'qemu',
      vmid,
    })
    const entries = [e('a', 5, 'keep'), e('b', 4, 'keep'), e('c', 3, 'keep'), e('d', 2, 'remove'), e('x', 9, 'keep', 101)]
    const reasons = pruneKeepReasons(entries, { 'keep-last': 2, 'keep-daily': 1 })
    expect(reasons.get('a')).toBe('最近 1')
    expect(reasons.get('b')).toBe('最近 2')
    expect(reasons.get('c')).toBe('每天 1')
    expect(reasons.has('d')).toBe(false)
    expect(reasons.get('x')).toBe('最近 1')
    expect(pruneKeepReasons([e('a', 1, 'keep')], {}).get('a')).toBe('全部保留')
  })
})

describe('restore', () => {
  const qemuConfig = [
    'boot: order=scsi0',
    'cores: 2',
    'memory: 2048',
    'name: web-01',
    'sockets: 1',
    'scsi0: local-lvm:vm-100-disk-0,size=1G',
    '#qmdump#map:scsi0:drive-scsi0:local-lvm:raw:',
    '',
    '[base]',
    'name: old-name',
  ].join('\n')

  it('reads defaults and storages from the backup config', () => {
    expect(parseBackupConfig(qemuConfig, new Set(['local-lvm']))).toEqual({
      name: 'web-01',
      cores: 2,
      memory: 2048,
      sockets: 1,
      storages: ['local-lvm'],
      storagesKnown: true,
    })
    expect(parseBackupConfig(qemuConfig, new Set(['local'])).storagesKnown).toBe(false)
    expect(parseBackupConfig('#qmdump#map:scsi0:drive-scsi0::raw:\n').storagesKnown).toBe(false)
    expect(parseBackupConfig('hostname: ct1\nmemory: 512\n').name).toBe('ct1')
  })

  it('builds VM restore parameters', () => {
    expect(
      restoreParams({
        type: 'qemu',
        volid: backupZst.volid,
        vmid: 3801,
        unique: true,
        start: true,
        name: ' restored ',
        memory: 128,
        sockets: 1,
      }),
    ).toEqual({ vmid: 3801, unique: 1, start: 1, memory: 128, sockets: 1, name: 'restored', archive: backupZst.volid })
  })

  it('builds CT restore parameters (hostname, ostemplate, restore=1, privilege)', () => {
    expect(
      restoreParams({
        type: 'lxc',
        volid: ctBackup.volid,
        vmid: 3802,
        storage: 'local-lvm',
        unique: false,
        start: false,
        unprivileged: '1',
        name: 'ct-copy',
        bwlimit: 0,
      }),
    ).toEqual({
      vmid: 3802,
      storage: 'local-lvm',
      bwlimit: 0,
      hostname: 'ct-copy',
      ostemplate: ctBackup.volid,
      restore: 1,
      unprivileged: 1,
    })
    expect(restoreParams({ type: 'lxc', volid: 'v', vmid: 1, unique: false, start: false, unprivileged: 'keep' })).not.toHaveProperty(
      'unprivileged',
    )
  })

  it('does not start a live restore twice', () => {
    expect(restoreParams({ type: 'qemu', volid: 'v', vmid: 1, unique: false, start: true, liveRestore: true })).toEqual({
      vmid: 1,
      'live-restore': 1,
      archive: 'v',
    })
  })
})

describe('import', () => {
  const meta: ImportMetadata = {
    type: 'vm',
    source: 'local:import/app.ova',
    'create-args': {
      name: 'app',
      memory: 2048,
      cores: 2,
      ostype: 'l26',
      ide2: 'none,media=cdrom',
      scsihw: 'lsi',
    },
    disks: {
      scsi0: { volid: 'local:import/app.ova/disk1.vmdk', size: 1024 },
      scsi1: { volid: 'local:import/app.ova/disk2.vmdk' },
    },
    net: { net0: { model: 'vmxnet3', macaddr: 'AA:BB:CC:00:11:22' } },
    warnings: [{ type: 'ova-needs-extracting' }],
  }

  it('turns metadata into disk and NIC rows', () => {
    const rows = importRows(meta)
    expect(rows.disks.map((d) => d.id)).toEqual(['scsi0', 'scsi1'])
    expect(rows.nets).toEqual([{ id: 'net0', model: 'vmxnet3', macaddr: 'AA:BB:CC:00:11:22', bridge: undefined, enabled: true }])
  })

  it('builds the create parameters with import-from disks', () => {
    const rows = importRows(meta)
    const params = importParams(meta, {
      vmid: 3810,
      name: 'app-imported',
      cores: 1,
      memory: 256,
      storage: 'local-lvm',
      storageType: 'lvmthin',
      bridge: 'vmbr0',
      liveImport: false,
      workingStorage: 'local-lvm',
      uniqueMacs: false,
      disks: rows.disks.map((d) => (d.id === 'scsi1' ? { ...d, enabled: false } : d)),
      nets: rows.nets,
    })
    expect(params).toEqual({
      name: 'app-imported',
      memory: 256,
      cores: 1,
      ostype: 'l26',
      ide2: 'none,media=cdrom',
      scsihw: 'lsi',
      vmid: 3810,
      scsi0: 'local-lvm:0,import-from=local:import/app.ova/disk1.vmdk,format=raw',
      net0: 'vmxnet3=AA:BB:CC:00:11:22,bridge=vmbr0',
      'import-working-storage': 'local-lvm',
    })
  })

  it('uses qcow2 on file storages, new MACs and live import when asked', () => {
    const rows = importRows(meta)
    const params = importParams(meta, {
      vmid: 3811,
      storage: 'local',
      storageType: 'dir',
      bridge: 'vmbr1',
      liveImport: true,
      uniqueMacs: true,
      disks: rows.disks,
      nets: rows.nets,
    })
    expect(params.scsi0).toBe('local:0,import-from=local:import/app.ova/disk1.vmdk,format=qcow2')
    expect(params.net0).toBe('vmxnet3,bridge=vmbr1')
    expect(params['live-restore']).toBe(1)
    expect(params.name).toBe('app')
  })

  it('wraps a single disk image in a new VM', () => {
    expect(
      diskImportParams({
        vmid: 3812,
        name: 'disk-vm',
        cores: 1,
        memory: 512,
        storage: 'local-lvm',
        storageType: 'lvmthin',
        bridge: 'vmbr0',
        volid: 'local:import/disk.qcow2',
      }),
    ).toEqual({
      vmid: 3812,
      name: 'disk-vm',
      cores: 1,
      memory: 512,
      ostype: 'l26',
      scsihw: 'virtio-scsi-single',
      scsi0: 'local-lvm:0,import-from=local:import/disk.qcow2,format=raw',
      net0: 'virtio,bridge=vmbr0',
      boot: 'order=scsi0',
    })
  })
})
