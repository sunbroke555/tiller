import { describe, expect, it } from 'vitest'

import type { UserEntry } from '@/api/access-users'

import {
  canSetPassword,
  createTokenParams,
  createUserParams,
  dateToExpire,
  emptyTokenForm,
  emptyUserForm,
  expireLabel,
  expireState,
  expireToDate,
  groupsWith,
  isTfaLocked,
  permissionRows,
  splitTokenid,
  splitUserid,
  tfaEditParams,
  tfaEntryLocked,
  tokenIdError,
  tokenRows,
  updateTokenParams,
  updateUserParams,
  userFormFromConfig,
  userFormReady,
  userNameError,
  userTfaStatus,
  validateUserForm,
} from './model'

const NOW = new Date(2026, 10, 1, 12, 0, 0).getTime()

describe('ids', () => {
  it('splits user and token ids at the last @ / first !', () => {
    expect(splitUserid('a@b@pve')).toEqual({ name: 'a@b', realm: 'pve' })
    expect(splitUserid('root@pam')).toEqual({ name: 'root', realm: 'pam' })
    expect(splitTokenid('alice@pve!ci')).toEqual({ userid: 'alice@pve', tokenid: 'ci' })
  })
  it('validates names', () => {
    expect(userNameError('alice')).toBeUndefined()
    expect(userNameError('alice@pve')).toMatch(/认证域/)
    expect(userNameError('a b')).toBeDefined()
    expect(tokenIdError('ci')).toBeUndefined()
    expect(tokenIdError('c')).toMatch(/2/)
    expect(tokenIdError('1ci')).toBeDefined()
  })
  it('password realms', () => {
    expect(canSetPassword('pve')).toBe(true)
    expect(canSetPassword('openid')).toBe(false)
    expect(canSetPassword(undefined)).toBe(false)
  })
})

describe('expire', () => {
  it('round-trips local dates and treats empty as never', () => {
    const e = dateToExpire('2027-03-04')
    expect(new Date(e * 1000).getHours()).toBe(0)
    expect(expireToDate(e)).toBe('2027-03-04')
    expect(dateToExpire('')).toBe(0)
    expect(expireToDate(0)).toBe('')
  })
  it('states', () => {
    expect(expireState(0, NOW)).toEqual({ kind: 'never' })
    expect(expireState(NOW / 1000 - 10, NOW).kind).toBe('expired')
    expect(expireState(NOW / 1000 + 3 * 86400, NOW).kind).toBe('soon')
    expect(expireState(NOW / 1000 + 60 * 86400, NOW).kind).toBe('later')
    expect(expireLabel(undefined)).toBe('永不过期')
  })
})

describe('user form → params', () => {
  it('create: pve realm sends the password, groups sorted, empty fields left out', () => {
    const f = { ...emptyUserForm(), name: ' alice ', password: 'secret123', confirm: 'secret123', groups: ['ops', 'admins'], email: 'a@b.c' }
    expect(userFormReady(f, true)).toBe(true)
    expect(createUserParams(f)).toEqual({
      userid: 'alice@pve',
      enable: 1,
      expire: 0,
      password: 'secret123',
      groups: 'admins,ops',
      email: 'a@b.c',
    })
  })
  it('create: other realms never send a password', () => {
    const f = { ...emptyUserForm('pam'), name: 'bob', password: 'ignored1', enable: false, expire: '2027-01-01' }
    const params = createUserParams(f)
    expect(params.password).toBeUndefined()
    expect(params).toMatchObject({ userid: 'bob@pam', enable: 0, expire: dateToExpire('2027-01-01') })
    expect(userFormReady({ ...f, password: '' }, true)).toBe(true)
  })
  it('create: pve realm needs a matching password of 8+ characters', () => {
    const f = { ...emptyUserForm(), name: 'alice', password: 'short', confirm: 'short' }
    expect(validateUserForm(f, true).password).toBeDefined()
    expect(userFormReady(f, true)).toBe(false)
    expect(userFormReady({ ...f, password: 'longenough', confirm: 'different' }, true)).toBe(false)
  })
  it('rejects bad emails', () => {
    expect(validateUserForm({ ...emptyUserForm(), email: 'nope' }, false).email).toBeDefined()
  })
  it('edit: only changed fields; cleared text sends ""; groups as one list', () => {
    const before = userFormFromConfig('alice@pve', { enable: 1, expire: 0, firstname: 'A', email: 'a@b.c', groups: ['ops', 'admins'], keys: 'x' })
    expect(before.keys).toBe('') // TFA marker is not a key id
    expect(updateUserParams(before, before)).toBeNull()
    const after = { ...before, firstname: '', enable: false, groups: ['ops'] }
    expect(updateUserParams(before, after)).toEqual({ enable: 0, groups: 'ops', firstname: '' })
    expect(updateUserParams(before, { ...before, groups: [] })).toEqual({ groups: '' })
    expect(updateUserParams(before, { ...before, groups: ['admins', 'ops'] })).toBeNull()
  })
})

describe('TFA', () => {
  const u = (p: Partial<UserEntry>): UserEntry => ({ userid: 'a@pve', ...p })
  it('users list column (render_tfa)', () => {
    expect(userTfaStatus(u({}), NOW)).toEqual({ kind: 'none' })
    expect(userTfaStatus(u({ keys: 'x!oath' }), NOW)).toEqual({ kind: 'on', label: 'TOTP' })
    expect(userTfaStatus(u({ keys: 'x' }), NOW)).toEqual({ kind: 'on', label: '已开启' })
    expect(userTfaStatus(u({ keys: 'x', 'tfa-locked-until': NOW / 1000 + 60 }), NOW).kind).toBe('locked')
    expect(userTfaStatus(u({ keys: 'x', 'tfa-locked-until': NOW / 1000 - 60 }), NOW).kind).toBe('on')
    expect(userTfaStatus(u({ keys: 'x', 'totp-locked': 1 }), NOW).kind).toBe('totp-locked')
  })
  it('unlock is offered when either lock flag is set', () => {
    expect(isTfaLocked(u({}))).toBe(false)
    expect(isTfaLocked(u({ 'totp-locked': true }))).toBe(true)
    expect(isTfaLocked(u({ 'tfa-locked-until': 1 }))).toBe(true)
  })
  it('entry lock', () => {
    expect(tfaEntryLocked({ 'totp-locked': 1 }, { type: 'totp' }, NOW)).toBe(true)
    expect(tfaEntryLocked({ 'totp-locked': 1 }, { type: 'webauthn' }, NOW)).toBe(false)
    expect(tfaEntryLocked({ 'tfa-locked-until': NOW / 1000 + 5 }, { type: 'webauthn' }, NOW)).toBe(true)
  })
  it('edit params include the password only with a change', () => {
    const before = { description: 'phone', enable: true }
    expect(tfaEditParams(before, before, 'pw')).toBeNull()
    expect(tfaEditParams(before, { description: ' phone2 ', enable: false }, 'pw')).toEqual({ description: 'phone2', enable: 0, password: 'pw' })
    expect(tfaEditParams(before, { description: 'phone', enable: false }, undefined)).toEqual({ enable: 0 })
  })
})

describe('tokens', () => {
  it('flattens users → token rows', () => {
    const rows = tokenRows([
      { userid: 'b@pve', tokens: [{ tokenid: 'x', privsep: 0 }] },
      { userid: 'a@pve', tokens: [{ tokenid: 'y', privsep: 1, expire: 5 }] },
      { userid: 'c@pve', tokens: null },
    ])
    expect(rows.map((r) => r.id)).toEqual(['a@pve!y', 'b@pve!x'])
    expect(rows[0]).toMatchObject({ userid: 'a@pve', tokenid: 'y', expire: 5 })
  })
  it('create sends privsep and expire always (official form), comment when set', () => {
    expect(createTokenParams({ ...emptyTokenForm('a@pve'), tokenid: 'ci' })).toEqual({ privsep: 1, expire: 0 })
    expect(createTokenParams({ ...emptyTokenForm('a@pve'), tokenid: 'ci', privsep: false, comment: ' ci ' })).toEqual({ privsep: 0, expire: 0, comment: 'ci' })
  })
  it('update: changed fields; cleared comment → delete', () => {
    const before = { userid: 'a@pve', tokenid: 'ci', privsep: true, expire: '', comment: 'old' }
    expect(updateTokenParams(before, before)).toBeNull()
    expect(updateTokenParams(before, { ...before, comment: '' })).toEqual({ delete: 'comment' })
    expect(updateTokenParams(before, { ...before, privsep: false, expire: '2027-01-01' })).toEqual({ privsep: 0, expire: dateToExpire('2027-01-01') })
  })
})

describe('groups and permissions', () => {
  it('membership edits keep other groups', () => {
    expect(groupsWith(['b', 'a'], 'c', true)).toBe('a,b,c')
    expect(groupsWith(['a', 'c'], 'c', false)).toBe('a')
    expect(groupsWith(['c'], 'c', false)).toBe('')
  })
  it('permission rows: sorted, filtered, propagate flag', () => {
    const rows = permissionRows({ '/vms': { 'VM.Audit': 1 }, '/': { 'Sys.Audit': 0, 'Datastore.Audit': 1 } })
    expect(rows.map((r) => r.path)).toEqual(['/', '/vms'])
    expect(rows[0]!.privs).toEqual([
      { name: 'Datastore.Audit', propagate: true },
      { name: 'Sys.Audit', propagate: false },
    ])
    expect(permissionRows({ '/vms': { 'VM.Audit': 1 }, '/': { 'Sys.Audit': 1 } }, 'vm.audit').map((r) => r.path)).toEqual(['/vms'])
  })
})
