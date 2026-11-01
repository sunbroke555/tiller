import { describe, expect, it } from 'vitest'

import type { AclEntry, RealmConfig, SyncJob } from '@/api/access-control'
import type { ClusterResource } from '@/api/types'

import {
  aclAddParams,
  aclModifyCheck,
  aclPathError,
  aclPathOptions,
  aclRemoveParams,
  buildSyncDefaults,
  describeAclPath,
  generateSyncJobId,
  groupPrivileges,
  parseSyncDefaults,
  parseTfa,
  poolCommentParams,
  poolIdError,
  poolMembersParams,
  realmParams,
  realmToForm,
  roleIdError,
  roleUpdateParams,
  stringifyTfa,
  syncFormFromDefaults,
  syncJobCreateParams,
  syncJobRunParams,
  syncJobToForm,
  syncJobUpdateParams,
  syncParams,
  validateRealmForm,
} from './logic'

describe('ACL', () => {
  it('builds add parameters per subject type', () => {
    expect(aclAddParams({ path: '/vms/100/', type: 'user', subject: 'bob@pve', role: 'PVEVMUser', propagate: true })).toEqual({
      path: '/vms/100',
      roles: 'PVEVMUser',
      users: 'bob@pve',
      propagate: 1,
    })
    expect(aclAddParams({ path: '/', type: 'group', subject: 'ops', role: 'PVEAuditor', propagate: false })).toMatchObject({ groups: 'ops', propagate: 0 })
    expect(aclAddParams({ path: '/', type: 'token', subject: 'a@pve!ci', role: 'NoAccess', propagate: true })).toMatchObject({ tokens: 'a@pve!ci' })
  })

  it('removes exactly one entry', () => {
    const e: AclEntry = { path: '/storage/local', type: 'group', ugid: 'ops', roleid: 'PVEDatastoreUser', propagate: 1 }
    expect(aclRemoveParams(e)).toEqual({ delete: 1, path: '/storage/local', roles: 'PVEDatastoreUser', groups: 'ops' })
  })

  it('validates paths', () => {
    expect(aclPathError('')).toBeTruthy()
    expect(aclPathError('vms/100')).toBeTruthy()
    expect(aclPathError('/vms/1 00')).toBeTruthy()
    expect(aclPathError('/pool/a/b')).toBeNull()
  })

  it('knows the allocate privilege that also allows changing an ACL', () => {
    expect(aclModifyCheck('/vms/100')).toEqual({ privs: ['Permissions.Modify', 'VM.Allocate'], any: true, path: '/vms/100' })
    expect(aclModifyCheck('/storage/local').privs).toContain('Datastore.Allocate')
    expect(aclModifyCheck('/pool/x').privs).toContain('Pool.Allocate')
    expect(aclModifyCheck('/').privs).toEqual(['Permissions.Modify'])
  })

  it('offers the fixed paths and the cluster objects', () => {
    const res = [
      { id: 'qemu/101', type: 'qemu', vmid: 101, node: 'n1', status: 'running', name: 'b' },
      { id: 'qemu/100', type: 'qemu', vmid: 100, node: 'n1', status: 'stopped', name: 'a' },
      { id: 'node/n1', type: 'node', node: 'n1', status: 'online' },
      { id: 'storage/n1/local', type: 'storage', node: 'n1', storage: 'local', status: 'available' },
      { id: 'storage/n2/local', type: 'storage', node: 'n2', storage: 'local', status: 'available' },
      { id: 'pool/lab', type: 'pool', pool: 'lab' },
    ] as ClusterResource[]
    const opts = aclPathOptions(res, ['lab', 'other'])
    const values = opts.map((o) => o.value)
    expect(values[0]).toBe('/')
    expect(values.filter((v) => v === '/storage/local')).toHaveLength(1)
    expect(values.indexOf('/vms/100')).toBeLessThan(values.indexOf('/vms/101'))
    expect(values).toContain('/pool/other')
    expect(opts.find((o) => o.value === '/vms/100')?.label).toBe('客户机 100 · a')
  })

  it('describes paths in Chinese', () => {
    expect(describeAclPath('/')).toBe('整个数据中心')
    expect(describeAclPath('/pool/a/b')).toBe('资源池 a/b')
    expect(describeAclPath('/access/realm/ldap1')).toBe('认证域 ldap1')
  })
})

describe('roles', () => {
  it('groups privileges by prefix in a fixed order', () => {
    const g = groupPrivileges(['Sys.Audit', 'VM.Config.CPU', 'Datastore.Audit', 'VM.Audit', 'Foo.Bar'])
    expect(g.map((x) => x.id)).toEqual(['VM', 'Datastore', 'Sys', 'Foo'])
    expect(g[0]!.privs).toEqual(['VM.Audit', 'VM.Config.CPU'])
  })

  it('validates role ids', () => {
    expect(roleIdError('PVEFoo')).toMatch(/PVE/)
    expect(roleIdError('pvefoo')).toMatch(/PVE/)
    expect(roleIdError('a b')).toBeTruthy()
    expect(roleIdError('Ops', ['ops'])).toMatch(/同名/)
    expect(roleIdError('e2e-ac.role_1')).toBeNull()
  })

  it('replaces the privilege list only when it changed', () => {
    expect(roleUpdateParams(['A', 'B'], ['B', 'A'])).toBeNull()
    expect(roleUpdateParams(['A'], ['C', 'A'])).toEqual({ privs: 'A,C' })
  })
})

describe('realms', () => {
  it('round-trips the TFA setting', () => {
    expect(parseTfa('type=oath,step=30,digits=8')).toMatchObject({ type: 'oath', step: '30', digits: '8' })
    expect(stringifyTfa({ type: 'oath', step: '', digits: '7', id: '', key: '', url: '' })).toBe('type=oath,digits=7')
    expect(stringifyTfa({ type: 'yubico', step: '', digits: '', id: '1', key: 'k', url: '' })).toBe('type=yubico,id=1,key=k')
    expect(stringifyTfa(parseTfa(''))).toBe('')
  })

  it('keeps unknown sync defaults', () => {
    const d = parseSyncDefaults('scope=both,enable-new=0,remove-vanished=acl;entry,full=1')
    expect(d).toMatchObject({ scope: 'both', enableNew: '0', removeVanished: { acl: true, entry: true, properties: false }, rest: { full: '1' } })
    expect(buildSyncDefaults('full=1,scope=users', { scope: 'groups', enableNew: '', removeVanished: { acl: false, entry: false, properties: true } })).toBe(
      'full=1,scope=groups,remove-vanished=properties',
    )
  })

  it('creates an LDAP realm with only the set options', () => {
    const f = realmToForm(null, '')
    Object.assign(f, {
      realm: 'e2e-ac-ldap',
      base_dn: 'dc=example,dc=com',
      user_attr: 'uid',
      server1: 'ldap.example.com',
      mode: 'ldaps',
      verify: true,
      bind_dn: 'cn=admin,dc=example,dc=com',
      password: 's3cret',
      emailAttr: 'mail',
      default: false,
      checkConnection: false,
    })
    f.syncDefaults = { scope: 'both', enableNew: '1', removeVanished: { acl: true, entry: false, properties: false } }
    f.tfa = { ...f.tfa, type: 'oath' }
    expect(realmParams('ldap', f, null)).toEqual({
      realm: 'e2e-ac-ldap',
      type: 'ldap',
      base_dn: 'dc=example,dc=com',
      user_attr: 'uid',
      server1: 'ldap.example.com',
      mode: 'ldaps',
      verify: '1',
      bind_dn: 'cn=admin,dc=example,dc=com',
      password: 's3cret',
      sync_attributes: 'email=mail',
      'sync-defaults-options': 'scope=both,enable-new=1,remove-vanished=acl',
      tfa: 'type=oath',
    })
  })

  it('edits an LDAP realm: changed keys, deletes, secure migration, digest', () => {
    const before: RealmConfig = {
      type: 'ldap',
      digest: 'abc',
      base_dn: 'dc=x',
      user_attr: 'uid',
      server1: 'a',
      server2: 'b',
      secure: 1,
      sync_attributes: 'email=mail,firstname=gn',
      comment: 'old',
    }
    const f = realmToForm(before, 'corp')
    expect(f.mode).toBe('ldaps')
    expect(f.checkConnection).toBe(true)
    f.checkConnection = false
    // Nothing touched: only the secure → mode migration is written.
    expect(realmParams('ldap', f, before)).toEqual({ mode: 'ldaps', delete: 'secure', digest: 'abc' })
    f.server2 = ''
    f.comment = 'new'
    f.emailAttr = ''
    f.checkConnection = true
    expect(realmParams('ldap', f, before)).toEqual({
      comment: 'new',
      mode: 'ldaps',
      sync_attributes: 'firstname=gn',
      delete: 'server2,secure',
      'check-connection': 1,
      digest: 'abc',
    })
  })

  it('ignores a different key order of stored property strings', () => {
    const before: RealmConfig = { type: 'ldap', base_dn: 'dc=x', user_attr: 'uid', server1: 'a', 'sync-defaults-options': 'remove-vanished=acl,scope=both', tfa: 'digits=8,type=oath' }
    const f = realmToForm(before, 'corp')
    f.checkConnection = false
    expect(realmParams('ldap', f, before)).toBeNull()
  })

  it('returns null for an unchanged PAM realm and clears the default flag with 0', () => {
    const before: RealmConfig = { type: 'pam', comment: 'Linux PAM', default: 1, digest: 'd' }
    const f = realmToForm(before, 'pam')
    expect(realmParams('pam', f, before)).toBeNull()
    f.default = false
    expect(realmParams('pam', f, before)).toEqual({ default: '0', digest: 'd' })
  })

  it('creates AD and OpenID realms with non-default flags only', () => {
    const ad = realmToForm(null)
    Object.assign(ad, { realm: 'corp', domain: 'corp.example', server1: 'dc1', caseSensitive: false })
    expect(realmParams('ad', ad, null)).toEqual({ realm: 'corp', type: 'ad', domain: 'corp.example', 'case-sensitive': '0', server1: 'dc1', 'check-connection': 1 })

    const oid = realmToForm(null)
    Object.assign(oid, { realm: 'sso', issuerUrl: 'https://id.example', clientId: 'pve', autocreate: true, usernameClaim: 'email', queryUserinfo: false, prompt: 'login' })
    expect(realmParams('openid', oid, null)).toEqual({
      realm: 'sso',
      type: 'openid',
      'issuer-url': 'https://id.example',
      'client-id': 'pve',
      autocreate: '1',
      'username-claim': 'email',
      prompt: 'login',
      'query-userinfo': '0',
    })
    // username-claim is fixed after creation.
    const before: RealmConfig = { type: 'openid', 'issuer-url': 'https://id.example', 'client-id': 'pve', 'username-claim': 'email' }
    const edit = realmToForm(before, 'sso')
    edit.usernameClaim = 'subject'
    expect(realmParams('openid', edit, before)).toBeNull()
  })

  it('validates the per-type required fields', () => {
    const f = realmToForm(null)
    expect(Object.keys(validateRealmForm('ldap', f, true)).sort()).toEqual(['base_dn', 'realm', 'server1', 'user_attr'])
    expect(Object.keys(validateRealmForm('openid', f, true)).sort()).toEqual(['client-id', 'issuer-url', 'realm'])
    f.tfa = { ...f.tfa, type: 'yubico' }
    expect(validateRealmForm('pve', f, false)).toEqual({ tfaId: expect.any(String), tfaKey: expect.any(String) })
  })
})

describe('realm sync', () => {
  it('starts from the realm defaults and sends none when nothing is removed', () => {
    const f = syncFormFromDefaults({ type: 'ldap', 'sync-defaults-options': 'scope=users,enable-new=0' })
    expect(f).toEqual({ scope: 'users', enableNew: '0', removeVanished: { acl: false, entry: false, properties: false } })
    expect(syncParams(f, true)).toEqual({ scope: 'users', 'enable-new': 0, 'remove-vanished': 'none', 'dry-run': 1 })
    expect(syncParams({ ...f, removeVanished: { acl: true, entry: true, properties: true } }, false)).toMatchObject({
      'remove-vanished': 'acl;entry;properties',
      'dry-run': 0,
    })
  })

  it('creates, edits and runs sync jobs', () => {
    expect(generateSyncJobId(() => 0.5)).toBe('realmsync-88888888-88888')
    const { id, params } = syncJobCreateParams({
      id: 'e2e-ac-job',
      realm: 'corp',
      schedule: 'daily',
      enabled: true,
      comment: '',
      scope: 'both',
      enableNew: '1',
      removeVanished: { acl: false, entry: true, properties: false },
    })
    expect(id).toBe('e2e-ac-job')
    expect(params).toEqual({ realm: 'corp', schedule: 'daily', enabled: '1', scope: 'both', 'enable-new': '1', 'remove-vanished': 'entry' })

    const job: SyncJob = { id: 'j', realm: 'corp', schedule: 'daily', scope: 'both', 'remove-vanished': 'entry', comment: 'x', enabled: 1 }
    const f = syncJobToForm(job)
    expect(syncJobUpdateParams(job, f)).toBeNull()
    f.enabled = false
    f.comment = ''
    f.removeVanished = { acl: false, entry: false, properties: false }
    expect(syncJobUpdateParams(job, f)).toEqual({ enabled: '0', 'remove-vanished': 'none', delete: 'comment' })
    expect(syncJobRunParams(job)).toEqual({ scope: 'both', 'enable-new': undefined, 'remove-vanished': 'entry' })
  })
})

describe('pools', () => {
  it('validates pool ids incl. nesting', () => {
    expect(poolIdError('')).toBeTruthy()
    expect(poolIdError('a/b/c/d')).toMatch(/3 层/)
    expect(poolIdError('a b')).toBeTruthy()
    expect(poolIdError('lab', ['lab'])).toMatch(/同名/)
    expect(poolIdError('x/y', ['lab'])).toMatch(/上级/)
    expect(poolIdError('lab/y', ['lab'])).toBeNull()
  })

  it('builds member and comment parameters', () => {
    expect(poolMembersParams('p', { vms: [100, 101] }, 'add')).toEqual({ poolid: 'p', vms: '100,101', 'allow-move': 1 })
    expect(poolMembersParams('p', { storage: ['local'] }, 'add')).toEqual({ poolid: 'p', storage: 'local' })
    expect(poolMembersParams('p', { vms: [100] }, 'remove')).toEqual({ poolid: 'p', vms: '100', delete: 1 })
    expect(poolCommentParams('p', 'a', ' a ')).toBeNull()
    expect(poolCommentParams('p', 'a', '')).toEqual({ poolid: 'p', comment: '' })
  })
})
