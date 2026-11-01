import { describe, expect, it } from 'vitest'

import {
  aclAncestors,
  allowedFor,
  capAllows,
  createPermissionChecker,
  defaultPermission,
  hasPrivileges,
  normalizeAclPath,
  privilegesAt,
  resolvePermission,
  type PermissionMap,
} from './permissions'

// Shape of the lab's tester@pve: PVEAuditor on /, PVEVMUser on /vms/100.
const TESTER: PermissionMap = {
  '/': { 'VM.Audit': 1, 'Sys.Audit': 1, 'Datastore.Audit': 1 },
  '/vms': { 'VM.Audit': 1, 'Sys.Audit': 1 },
  '/vms/100': { 'VM.Audit': 1, 'VM.PowerMgmt': 1, 'VM.Console': 1, 'VM.Backup': 1 },
  '/nodes': { 'Sys.Audit': 1 },
  '/storage': { 'Datastore.Audit': 1 },
}

describe('ACL paths', () => {
  it('normalises and lists ancestors', () => {
    expect(normalizeAclPath('vms/100/')).toBe('/vms/100')
    expect(normalizeAclPath('')).toBe('/')
    expect(aclAncestors('/vms/100')).toEqual(['/vms/100', '/vms', '/'])
    expect(aclAncestors('/')).toEqual(['/'])
  })

  it('uses the exact entry, else inherited propagating privileges', () => {
    expect(privilegesAt(TESTER, '/vms/100').has('VM.PowerMgmt')).toBe(true)
    expect(privilegesAt(TESTER, '/vms/101').has('VM.PowerMgmt')).toBe(false)
    expect(privilegesAt(TESTER, '/vms/101').has('VM.Audit')).toBe(true)
    // Non-propagating privileges do not reach children.
    const map: PermissionMap = { '/': {}, '/vms': { 'VM.PowerMgmt': 0, 'VM.Audit': 1 } }
    expect(privilegesAt(map, '/vms').has('VM.PowerMgmt')).toBe(true)
    expect(privilegesAt(map, '/vms/5').has('VM.PowerMgmt')).toBe(false)
    expect(privilegesAt(map, '/vms/5').has('VM.Audit')).toBe(true)
  })

  it('checks all / any / several paths / anywhere below', () => {
    expect(hasPrivileges(TESTER, '/vms/100', ['VM.PowerMgmt', 'VM.Console'])).toBe(true)
    expect(hasPrivileges(TESTER, '/vms/100', ['VM.PowerMgmt', 'VM.Allocate'])).toBe(false)
    expect(hasPrivileges(TESTER, '/vms/100', ['VM.Allocate', 'VM.Console'], { any: true })).toBe(true)
    expect(hasPrivileges(TESTER, ['/vms/200', '/pool/web'], 'VM.PowerMgmt')).toBe(false)
    expect(hasPrivileges({ ...TESTER, '/pool/web': { 'VM.PowerMgmt': 1 } }, ['/vms/200', '/pool/web'], 'VM.PowerMgmt')).toBe(true)
    expect(hasPrivileges(TESTER, '/vms', 'VM.PowerMgmt')).toBe(false)
    expect(hasPrivileges(TESTER, '/vms', 'VM.PowerMgmt', { anywhere: true })).toBe(true)
  })
})

describe('ticket caps fallback', () => {
  const cap = { vms: { 'VM.PowerMgmt': 1 as const, 'VM.Audit': 1 as const }, nodes: { 'Sys.Audit': 1 as const }, dc: { 'Sys.Audit': 1 as const } }
  it('answers from the category of the path', () => {
    expect(capAllows(cap, '/vms/1', 'VM.PowerMgmt')).toBe(true)
    expect(capAllows(cap, '/nodes/pve', 'Sys.PowerMgmt')).toBe(false)
    expect(capAllows(undefined, '/', 'Sys.Modify')).toBeUndefined()
  })

  it('checker prefers the map, then caps, then allows', () => {
    expect(createPermissionChecker(TESTER, cap).can({ privs: 'VM.PowerMgmt' }, { kind: 'guest', vmid: 101 })).toBe(false)
    expect(createPermissionChecker(undefined, cap).can({ privs: 'VM.PowerMgmt' }, { kind: 'guest', vmid: 101 })).toBe(true)
    expect(createPermissionChecker(undefined, undefined).can({ privs: 'Sys.Modify' })).toBe(true)
    expect(createPermissionChecker(TESTER, cap).ready).toBe(true)
  })
})

describe('registry integration', () => {
  const checker = createPermissionChecker(TESTER, undefined)

  it('defaults by action / command id', () => {
    expect(defaultPermission('guest', 'start')?.privs).toBe('VM.PowerMgmt')
    expect(defaultPermission('guest', 'guest-start')?.privs).toBe('VM.PowerMgmt')
    expect(defaultPermission('node', 'node-shell')?.privs).toBe('Sys.Console')
    expect(defaultPermission('guest', 'something-custom')).toBeUndefined()
    expect(defaultPermission('guest', 'toString')).toBeUndefined()
  })

  it('own permission wins, null disables the check, functions get the context', () => {
    expect(resolvePermission({ id: 'start', permission: { privs: 'X' } }, {}, 'guest')?.privs).toBe('X')
    expect(resolvePermission({ id: 'start', permission: null }, {}, 'guest')).toBeNull()
    expect(resolvePermission({ id: 'x', permission: (c: { p: string }) => ({ privs: c.p }) }, { p: 'Y' }, 'guest')?.privs).toBe('Y')
  })

  it('hides power actions on guests without VM.PowerMgmt', () => {
    expect(allowedFor(checker, { id: 'start' }, {}, { kind: 'guest', vmid: 100 })).toBe(true)
    expect(allowedFor(checker, { id: 'start' }, {}, { kind: 'guest', vmid: 101 })).toBe(false)
    expect(allowedFor(checker, { id: 'my-thing' }, {}, { kind: 'guest', vmid: 101 })).toBe(true)
    expect(allowedFor(checker, { id: 'shell' }, {}, { kind: 'node', node: 'pve' })).toBe(false)
    expect(allowedFor(checker, { id: 'create-qemu' }, {}, { kind: 'global' })).toBe(false)
  })
})
