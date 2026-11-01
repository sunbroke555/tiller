import { describe, expect, it } from 'vitest'

import type { StorageDef, StorageType } from '@/api/storage-config'

import {
  createParams,
  fixedFields,
  formatHostPort,
  initialForm,
  parseHostPort,
  pbsKeyError,
  retentionSummary,
  storageLocation,
  toggleParams,
  updateParams,
  validateForm,
  zfsBlocksizeError,
  type StorageForm,
} from './model'

const form = (type: StorageType, patch: Partial<StorageForm> = {}): StorageForm => ({ ...initialForm(type), ...patch })

describe('create params per type', () => {
  it('dir: path, content, shared, preallocation, keep-all by default', () => {
    const f = form('dir', { storage: 'e2e-sc-a', path: '/var/lib/e2e-sc-a', content: ['iso', 'images', 'backup'], shared: true, preallocation: 'off' })
    expect(createParams(f)).toEqual({
      storage: 'e2e-sc-a',
      type: 'dir',
      path: '/var/lib/e2e-sc-a',
      content: 'images,iso,backup',
      shared: 1,
      preallocation: 'off',
      'prune-backups': 'keep-all=1',
    })
  })

  it('dir: disabled, node restriction, retention, snapshot chain; preallocation dropped without images', () => {
    const f = form('dir', {
      storage: 'd1',
      path: '/srv/d1',
      content: ['backup'],
      enable: false,
      nodes: ['n1', 'n2'],
      keepAll: false,
      keep: { 'keep-last': 3, 'keep-daily': 7 },
      maxProtected: -1,
      preallocation: 'full',
      snapshotChain: true,
    })
    expect(createParams(f)).toEqual({
      storage: 'd1',
      type: 'dir',
      path: '/srv/d1',
      content: 'backup',
      disable: 1,
      nodes: 'n1,n2',
      'prune-backups': 'keep-last=3,keep-daily=7',
      'max-protected-backups': -1,
      'snapshot-as-volume-chain': 1,
    })
  })

  it('no retention and no keep-all sends nothing for prune-backups', () => {
    const p = createParams(form('nfs', { storage: 'n', server: 'nas', export: '/x', keepAll: false }))
    expect(p['prune-backups']).toBeUndefined()
  })

  it('nfs: server, export and vers= in options', () => {
    expect(createParams(form('nfs', { storage: 'nas', server: '10.0.0.2', export: '/export/pve', nfsversion: '4.2' }))).toEqual({
      storage: 'nas',
      type: 'nfs',
      server: '10.0.0.2',
      export: '/export/pve',
      content: 'images',
      options: 'vers=4.2',
      'prune-backups': 'keep-all=1',
    })
  })

  it('cifs: credentials are optional, password write-only, smbversion', () => {
    const p = createParams(
      form('cifs', { storage: 'smb', server: 'nas', share: 'pve', username: 'bob', password: 's3cret', domain: 'LAN', subdir: '/vz', smbversion: '3.11' }),
    )
    expect(p).toMatchObject({ server: 'nas', share: 'pve', username: 'bob', password: 's3cret', domain: 'LAN', subdir: '/vz', smbversion: '3.11' })
    const guest = createParams(form('cifs', { storage: 'smb', server: 'nas', share: 'pub' }))
    expect(guest.username).toBeUndefined()
    expect(guest.password).toBeUndefined()
    expect(guest.smbversion).toBeUndefined()
  })

  it('lvm: existing VG or a base volume on iSCSI; no retention', () => {
    expect(createParams(form('lvm', { storage: 'vg', vgname: 'data', saferemove: true }))).toEqual({
      storage: 'vg',
      type: 'lvm',
      vgname: 'data',
      content: 'images,rootdir',
      saferemove: 1,
    })
    const base = createParams(form('lvm', { storage: 'san', baseStorage: 'iscsi1', base: 'iscsi1:0.0.1.scsi-36', vgname: 'sanvg', shared: true }))
    expect(base).toMatchObject({ base: 'iscsi1:0.0.1.scsi-36', vgname: 'sanvg', shared: 1 })
    expect(createParams(form('lvm', { storage: 'x', vgname: 'v', base: 'stale' })).base).toBeUndefined()
  })

  it('lvmthin and zfspool', () => {
    expect(createParams(form('lvmthin', { storage: 't', vgname: 'pve', thinpool: 'data', content: ['rootdir'] }))).toEqual({
      storage: 't',
      type: 'lvmthin',
      vgname: 'pve',
      thinpool: 'data',
      content: 'rootdir',
    })
    expect(createParams(form('zfspool', { storage: 'z', pool: 'rpool/data', sparse: true, blocksize: '16k' }))).toEqual({
      storage: 'z',
      type: 'zfspool',
      pool: 'rpool/data',
      content: 'images,rootdir',
      sparse: 1,
      blocksize: '16k',
    })
  })

  it('iscsi: luns on → images, off → none; iscsidirect always images', () => {
    expect(createParams(form('iscsi', { storage: 'i', portal: '10.0.0.9', target: 'iqn.x' }))).toEqual({
      storage: 'i',
      type: 'iscsi',
      portal: '10.0.0.9',
      target: 'iqn.x',
      content: 'images',
    })
    expect(createParams(form('iscsi', { storage: 'i', portal: 'p', target: 't', luns: false })).content).toBe('none')
    expect(createParams(form('iscsidirect', { storage: 'd', portal: 'p', target: 't' }))).toEqual({
      storage: 'd',
      type: 'iscsidirect',
      portal: 'p',
      target: 't',
      content: 'images',
    })
  })

  it('zfs over iscsi: provider-specific fields and write cache', () => {
    const comstar = createParams(form('zfs', { storage: 'zi', portal: 'p', pool: 'tank', target: 't', comstar_tg: 'tg', comstar_hg: 'hg', writecache: false }))
    expect(comstar).toEqual({
      storage: 'zi',
      type: 'zfs',
      content: 'images',
      portal: 'p',
      pool: 'tank',
      blocksize: '4k',
      target: 't',
      iscsiprovider: 'comstar',
      comstar_tg: 'tg',
      comstar_hg: 'hg',
      nowritecache: 1,
    })
    const lio = createParams(form('zfs', { storage: 'zi', portal: 'p', pool: 'tank', target: 't', iscsiprovider: 'LIO', lio_tpg: 'tpg1', comstar_tg: 'x', writecache: false }))
    expect(lio.lio_tpg).toBe('tpg1')
    expect(lio.comstar_tg).toBeUndefined()
    expect(lio.nowritecache).toBeUndefined() // LIO has no write cache switch
  })

  it('cephfs / rbd: external cluster vs PVE-managed', () => {
    expect(createParams(form('cephfs', { storage: 'cfs', monhost: '10.0.0.1 10.0.0.2', keyring: 'KEY', fsName: 'cephfs' }))).toEqual({
      storage: 'cfs',
      type: 'cephfs',
      content: 'backup',
      monhost: '10.0.0.1 10.0.0.2',
      username: 'admin',
      keyring: 'KEY',
      'fs-name': 'cephfs',
      'prune-backups': 'keep-all=1',
    })
    const managed = createParams(form('cephfs', { storage: 'cfs', pveceph: true, monhost: 'ignored', fsName: 'cephfs' }))
    expect(managed.monhost).toBeUndefined()
    expect(managed.username).toBeUndefined()
    expect(managed['fs-name']).toBe('cephfs')

    expect(createParams(form('rbd', { storage: 'r', monhost: 'm1', keyring: 'K', krbd: true, namespace: 'ns' }))).toEqual({
      storage: 'r',
      type: 'rbd',
      content: 'images',
      monhost: 'm1',
      pool: 'rbd',
      namespace: 'ns',
      username: 'admin',
      keyring: 'K',
      krbd: 1,
    })
  })

  it('pbs: host:port split, content backup, fingerprint, encryption modes', () => {
    const fp = Array.from({ length: 32 }, () => 'AB').join(':')
    const base = { storage: 'pbs1', server: 'pbs.lan:8008', username: 'root@pam', password: 'pw', datastore: 'store1', fingerprint: fp }
    expect(createParams(form('pbs', base))).toEqual({
      storage: 'pbs1',
      type: 'pbs',
      content: 'backup',
      server: 'pbs.lan',
      port: 8008,
      username: 'root@pam',
      password: 'pw',
      datastore: 'store1',
      fingerprint: fp,
      'prune-backups': 'keep-all=1',
    })
    expect(createParams(form('pbs', { ...base, cryptMode: 'autogen' }))['encryption-key']).toBe('autogen')
    const key = '{"kdf":null,"data":"abc"}'
    expect(createParams(form('pbs', { ...base, cryptMode: 'upload', cryptKey: ` ${key}\n` }))['encryption-key']).toBe(key)
    const master = createParams(form('pbs', { ...base, cryptMode: 'autogen', masterPubkey: '-----BEGIN PUBLIC KEY-----\nAA\n-----END PUBLIC KEY-----' }))
    expect(atob(String(master['master-pubkey']))).toBe('-----BEGIN PUBLIC KEY-----\nAA\n-----END PUBLIC KEY-----\n')
    expect(createParams(form('pbs', { ...base, masterPubkey: 'x' }))['master-pubkey']).toBeUndefined() // no encryption
    expect(createParams(form('pbs', { ...base, server: '[fe80::1]:8007' }))).toMatchObject({ server: 'fe80::1', port: 8007 })
    expect(createParams(form('pbs', { ...base, server: 'pbs.lan' })).port).toBeUndefined()
  })

  it('esxi: server/port, credentials, skip cert verification', () => {
    expect(createParams(form('esxi', { storage: 'esx', server: 'esx.lan:4443', username: 'root', password: 'pw', skipCertVerification: true }))).toEqual({
      storage: 'esx',
      type: 'esxi',
      server: 'esx.lan',
      port: 4443,
      username: 'root',
      password: 'pw',
      'skip-cert-verification': 1,
    })
  })

  it('btrfs keeps its default content', () => {
    expect(createParams(form('btrfs', { storage: 'b', path: '/mnt/b' }))).toMatchObject({ content: 'images,rootdir', path: '/mnt/b' })
  })
})

describe('update params', () => {
  const dir: StorageDef = {
    storage: 'local',
    type: 'dir',
    path: '/var/lib/vz',
    content: 'iso,vztmpl,backup',
    'prune-backups': 'keep-daily=7,keep-last=3',
    digest: 'abc',
  }

  it('unchanged form → null (lists compared as sets, prune order ignored)', () => {
    expect(updateParams(initialForm('dir', dir), dir)).toBeNull()
  })

  it('sends only changes, deletes cleared keys, carries the digest, never the fixed path', () => {
    const f = { ...initialForm('dir', dir), content: ['iso', 'backup'], keepAll: true, enable: false, path: '/elsewhere' }
    expect(updateParams(f, dir)).toEqual({ content: 'iso,backup', 'prune-backups': 'keep-all=1', disable: '1', digest: 'abc' })
    const cleared = { ...initialForm('dir', dir), keep: {}, keepAll: false }
    expect(updateParams(cleared, dir)).toEqual({ delete: 'prune-backups', digest: 'abc' })
  })

  it('local cannot get a node restriction', () => {
    expect(updateParams({ ...initialForm('dir', dir), nodes: ['n1'] }, dir)).toBeNull()
    const other = { ...dir, storage: 'data' }
    expect(updateParams({ ...initialForm('dir', other), nodes: ['n1'] }, other)).toMatchObject({ nodes: 'n1' })
  })

  it('re-enable deletes disable; shared off deletes shared', () => {
    const d: StorageDef = { storage: 'x', type: 'dir', path: '/x', content: 'images', disable: 1, shared: 1, digest: 'd' }
    expect(updateParams({ ...initialForm('dir', d), enable: true, shared: false }, d)).toEqual({ delete: 'disable,shared', digest: 'd' })
  })

  it('snapshot chain is fixed for dir, editable for lvm', () => {
    const d: StorageDef = { storage: 'x', type: 'dir', path: '/x', content: 'images' }
    expect(updateParams({ ...initialForm('dir', d), snapshotChain: true }, d)).toBeNull()
    const l: StorageDef = { storage: 'v', type: 'lvm', vgname: 'v', content: 'images' }
    expect(updateParams({ ...initialForm('lvm', l), snapshotChain: true }, l)).toEqual({ 'snapshot-as-volume-chain': '1' })
  })

  it('nfs: version change keeps other mount options', () => {
    const n: StorageDef = { storage: 'n', type: 'nfs', server: 's', export: '/e', content: 'images', options: 'soft,vers=3' }
    const f = initialForm('nfs', n)
    expect(f.nfsversion).toBe('3')
    expect(f.otherOptions).toEqual(['soft'])
    expect(updateParams({ ...f, nfsversion: '4.2' }, n)).toEqual({ options: 'soft,vers=4.2' })
    expect(updateParams({ ...f, nfsversion: '', otherOptions: [] }, n)).toEqual({ delete: 'options' })
  })

  it('iscsi: luns switch maps to content', () => {
    const i: StorageDef = { storage: 'i', type: 'iscsi', portal: 'p', target: 't', content: 'images' }
    expect(initialForm('iscsi', i).luns).toBe(true)
    expect(updateParams({ ...initialForm('iscsi', i), luns: false }, i)).toEqual({ content: 'none' })
    expect(initialForm('iscsi', { ...i, content: 'none' }).luns).toBe(false)
  })

  it('pbs: fingerprint clear, encryption keep / delete / replace, optional new password', () => {
    const pbs: StorageDef = {
      storage: 'pbs',
      type: 'pbs',
      server: 'pbs.lan',
      port: 8007,
      username: 'root@pam',
      datastore: 'ds',
      content: 'backup',
      fingerprint: 'AA',
      'encryption-key': '12:34:56',
      digest: 'g',
    }
    const f = initialForm('pbs', pbs)
    expect(f.server).toBe('pbs.lan:8007')
    expect(f.cryptMode).toBe('keep')
    expect(updateParams(f, pbs)).toBeNull()
    expect(updateParams({ ...f, fingerprint: '' }, pbs)).toEqual({ delete: 'fingerprint', digest: 'g' })
    expect(updateParams({ ...f, cryptMode: 'none' }, pbs)).toEqual({ delete: 'encryption-key', digest: 'g' })
    expect(updateParams({ ...f, cryptMode: 'autogen' }, pbs)).toEqual({ 'encryption-key': 'autogen', digest: 'g' })
    expect(updateParams({ ...f, password: 'new' }, pbs)).toEqual({ password: 'new', digest: 'g' })
    // No key yet: "none" deletes nothing.
    const plain = { ...pbs, 'encryption-key': undefined }
    expect(updateParams({ ...initialForm('pbs', plain), cryptMode: 'none' }, plain)).toBeNull()
  })

  it('ceph: external monitors editable, managed cluster has none', () => {
    const ext: StorageDef = { storage: 'r', type: 'rbd', pool: 'rbd', monhost: 'a b', content: 'images', username: 'admin' }
    const f = initialForm('rbd', ext)
    expect(f.pveceph).toBe(false)
    expect(updateParams({ ...f, monhost: 'a b c', krbd: true }, ext)).toEqual({ monhost: 'a b c', krbd: '1' })
    const managed: StorageDef = { storage: 'c', type: 'cephfs', content: 'backup', 'fs-name': 'cephfs' }
    expect(initialForm('cephfs', managed).pveceph).toBe(true)
    expect(updateParams({ ...initialForm('cephfs', managed), content: ['iso', 'backup'] }, managed)).toEqual({ content: 'backup,iso' })
  })

  it('zfs over iscsi: write cache only for comstar/istgt', () => {
    const z: StorageDef = { storage: 'z', type: 'zfs', iscsiprovider: 'istgt', pool: 'p', portal: 'p', target: 't', blocksize: '4k', content: 'images' }
    expect(updateParams({ ...initialForm('zfs', z), writecache: false }, z)).toEqual({ nowritecache: '1' })
    const lio = { ...z, iscsiprovider: 'LIO' }
    expect(updateParams({ ...initialForm('zfs', lio), writecache: false }, lio)).toBeNull()
  })

  it('max protected backups: set and clear', () => {
    const d: StorageDef = { storage: 'x', type: 'dir', path: '/x', content: 'backup', 'prune-backups': 'keep-all=1', 'max-protected-backups': 5 }
    expect(initialForm('dir', d).maxProtected).toBe(5)
    expect(updateParams({ ...initialForm('dir', d), maxProtected: undefined }, d)).toEqual({ delete: 'max-protected-backups' })
  })

  it('types without backups never send retention', () => {
    const l: StorageDef = { storage: 'v', type: 'lvmthin', vgname: 'pve', thinpool: 'data', content: 'images,rootdir' }
    expect(updateParams({ ...initialForm('lvmthin', l), keepAll: false, keep: { 'keep-last': 1 } }, l)).toBeNull()
  })

  it('esxi: username editable, empty password unchanged', () => {
    const e: StorageDef = { storage: 'e', type: 'esxi', server: 'esx', username: 'root', content: 'import' }
    expect(updateParams({ ...initialForm('esxi', e), username: 'admin' }, e)).toEqual({ username: 'admin' })
    expect(updateParams({ ...initialForm('esxi', e), skipCertVerification: true, password: 'x' }, e)).toEqual({
      'skip-cert-verification': '1',
      password: 'x',
    })
  })

  it('toggle enable/disable', () => {
    expect(toggleParams({ storage: 'x', type: 'dir', digest: 'q' }, false)).toEqual({ disable: 1, digest: 'q' })
    expect(toggleParams({ storage: 'x', type: 'dir' }, true)).toEqual({ delete: 'disable' })
  })
})

describe('validation', () => {
  it('storage id rules on create only', () => {
    expect(validateForm(form('dir', { storage: '', path: '/x' }), true).storage).toBeTruthy()
    expect(validateForm(form('dir', { storage: '1abc', path: '/x' }), true).storage).toBeTruthy()
    expect(validateForm(form('dir', { storage: 'ab-', path: '/x' }), true).storage).toBeTruthy()
    expect(validateForm(form('dir', { storage: 'e2e-sc.a_1', path: '/x' }), true)).toEqual({})
    expect(validateForm(form('dir', { storage: '', path: '' }), false)).toEqual({})
  })

  it('required per-type fields', () => {
    expect(Object.keys(validateForm(form('dir', { storage: 'a1', path: 'rel' }), true))).toEqual(['path'])
    expect(Object.keys(validateForm(form('nfs', { storage: 'a1' }), true)).sort()).toEqual(['export', 'server'])
    expect(Object.keys(validateForm(form('lvm', { storage: 'a1', baseStorage: 'i' }), true)).sort()).toEqual(['base', 'vgname'])
    expect(Object.keys(validateForm(form('zfs', { storage: 'a1', portal: 'p', pool: 'x', target: 't', iscsiprovider: 'LIO' }), true))).toEqual(['lio_tpg'])
    expect(Object.keys(validateForm(form('rbd', { storage: 'a1' }), true)).sort()).toEqual(['keyring', 'monhost'])
    expect(Object.keys(validateForm(form('rbd', { storage: 'a1', pveceph: true }), true))).toEqual([])
    expect(Object.keys(validateForm(form('cephfs', { storage: 'a1', pveceph: true }), true))).toEqual(['fs-name'])
    expect(Object.keys(validateForm(form('dir', { storage: 'a1', path: '/x', content: [] }), true))).toEqual(['content'])
  })

  it('pbs fields', () => {
    const e = validateForm(form('pbs', { storage: 'p1', server: 'bad host', username: 'root', fingerprint: 'zz' }), true)
    expect(Object.keys(e).sort()).toEqual(['datastore', 'fingerprint', 'password', 'server', 'username'])
    const ok = validateForm(form('pbs', { storage: 'p1', server: 'pbs:8007', username: 'u@pbs!tok', password: 'x', datastore: 'd' }), true)
    expect(ok).toEqual({})
    expect(validateForm(form('pbs', { storage: 'p1', server: 'pbs', username: 'u@pbs', password: 'x', datastore: 'd', cryptMode: 'upload', cryptKey: '{}' }), true)['encryption-key']).toBeTruthy()
  })

  it('zfs block size', () => {
    expect(zfsBlocksizeError('')).toBeNull()
    expect(zfsBlocksizeError('16k')).toBeNull()
    expect(zfsBlocksizeError('512')).toBeNull()
    expect(zfsBlocksizeError('16m')).toBeNull()
    expect(zfsBlocksizeError('32m')).toBeTruthy()
    expect(zfsBlocksizeError('12k')).toBeTruthy()
    expect(zfsBlocksizeError('256')).toBeTruthy()
    expect(zfsBlocksizeError('4K ')).toBeNull()
  })

  it('pbs key', () => {
    expect(pbsKeyError('{"data":"x"}')).toBeNull()
    expect(pbsKeyError('not json')).toBeTruthy()
    expect(pbsKeyError('')).toBeTruthy()
  })

  it('max protected ≥ -1', () => {
    expect(validateForm(form('dir', { storage: 'a1', path: '/x', maxProtected: -2 }), true)['max-protected-backups']).toBeTruthy()
  })
})

describe('helpers', () => {
  it('host[:port]', () => {
    expect(parseHostPort('pbs.lan')).toEqual({ server: 'pbs.lan' })
    expect(parseHostPort('10.0.0.1:8007')).toEqual({ server: '10.0.0.1', port: 8007 })
    expect(parseHostPort('[::1]:8007')).toEqual({ server: '::1', port: 8007 })
    expect(parseHostPort('fe80::1')).toEqual({ server: 'fe80::1' })
    expect(parseHostPort('host:99999')).toBeNull()
    expect(parseHostPort('a b')).toBeNull()
    expect(formatHostPort('fe80::1', 8007)).toBe('[fe80::1]:8007')
    expect(formatHostPort('pbs', undefined)).toBe('pbs')
  })

  it('location column', () => {
    expect(storageLocation({ storage: 'a', type: 'nfs', server: 's', export: '/e' })).toBe('s:/e')
    expect(storageLocation({ storage: 'a', type: 'lvmthin', vgname: 'pve', thinpool: 'data' })).toBe('pve/data')
    expect(storageLocation({ storage: 'a', type: 'iscsi', target: 'iqn' })).toBe('iqn')
    expect(storageLocation({ storage: 'a', type: 'dir', path: '/var/lib/vz' })).toBe('/var/lib/vz')
    expect(storageLocation({ storage: 'a', type: 'pbs', server: 'pbs', datastore: 'ds', namespace: 'n' })).toBe('pbs:ds/n')
  })

  it('fixed fields for the edit dialog', () => {
    expect(fixedFields({ storage: 'local-lvm', type: 'lvmthin', vgname: 'pve', thinpool: 'data' })).toEqual([
      { label: '卷组', value: 'pve' },
      { label: '精简池', value: 'data' },
    ])
    expect(fixedFields({ storage: 'p', type: 'pbs', server: 'pbs', port: 8008, username: 'u@pbs', datastore: 'ds' }).map((r) => r.value)).toEqual([
      'pbs:8008',
      'u@pbs',
      'ds',
      '根',
    ])
  })

  it('retention summary', () => {
    expect(retentionSummary(undefined)).toBeNull()
    expect(retentionSummary('keep-all=1')).toBe('全部保留')
    expect(retentionSummary('keep-last=3,keep-weekly=2')).toBe('最近 3 · 每周 2')
  })
})
