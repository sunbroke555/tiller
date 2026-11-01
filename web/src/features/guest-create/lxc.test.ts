import { describe, expect, it } from 'vitest'

import {
  buildLxcParams,
  initialLxcForm,
  lxcNetParam,
  lxcStepOfParam,
  mountPointParam,
  newMountPoint,
  quotaAllowed,
  rootfsParam,
  validateLxcStep,
  type LxcForm,
} from './lxc'

const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl user@host'

function form(patch: Partial<LxcForm> = {}): LxcForm {
  return {
    ...initialLxcForm('pve-lab'),
    vmid: 3710,
    password: 'secret1',
    confirmPassword: 'secret1',
    templateStorage: 'local',
    ostemplate: 'local:vztmpl/alpine-3.24-default_20260714_amd64.tar.xz',
    rootStorage: 'local-lvm',
    bridge: 'vmbr0',
    ...patch,
  }
}

describe('buildLxcParams', () => {
  it('maps a default container like the official wizard', () => {
    expect(buildLxcParams(form({ hostname: 'ct-01' }))).toEqual({
      vmid: 3710,
      hostname: 'ct-01',
      unprivileged: 1,
      features: 'nesting=1',
      password: 'secret1',
      ostemplate: 'local:vztmpl/alpine-3.24-default_20260714_amd64.tar.xz',
      rootfs: 'local-lvm:8',
      cores: 1,
      memory: 512,
      swap: 512,
      net0: 'name=eth0,bridge=vmbr0,firewall=1,ip=dhcp',
    })
  })

  it('privileged: unprivileged=0 and no nesting feature', () => {
    const p = buildLxcParams(form({ unprivileged: false, nesting: true }))
    expect(p.unprivileged).toBe(0)
    expect(p).not.toHaveProperty('features')
  })

  it('SSH keys only: no password, keys newline separated', () => {
    const p = buildLxcParams(form({ password: '', confirmPassword: '', sshKeys: `  ${KEY}\n\n${KEY}  ` }))
    expect(p).not.toHaveProperty('password')
    expect(p['ssh-public-keys']).toBe(`${KEY}\n${KEY}\n`)
  })

  it('general extras, CPU limits, DNS and start', () => {
    const p = buildLxcParams(
      form({ pool: 'lab', tags: ['a', 'b'], haManaged: true, cores: undefined, cpulimit: 1.5, cpuunits: 50, searchdomain: 'lan', nameserver: '1.1.1.1, 8.8.8.8', start: true }),
    )
    expect(p).toMatchObject({ pool: 'lab', tags: 'a;b', 'ha-managed': 1, cpulimit: 1.5, cpuunits: 50, searchdomain: 'lan', nameserver: '1.1.1.1 8.8.8.8', start: 1 })
    expect(p).not.toHaveProperty('cores')
  })

  it('mount points are added as mpN', () => {
    const f = form()
    const mp = { ...newMountPoint(f, 'local-lvm'), size: 4, path: '/srv' }
    const p = buildLxcParams({ ...f, mountPoints: [mp] })
    expect(p[`mp${mp.index}`]).toBe('local-lvm:4,mp=/srv,backup=1')
  })
})

describe('volume helpers', () => {
  it('rootfs with options; quota only for privileged, mount options filtered', () => {
    expect(rootfsParam(form({ rootSize: 16, rootAcl: '1', rootMountOptions: ['noatime', 'nodev', 'discard'] }))).toBe(
      'local-lvm:16,acl=1,mountoptions=noatime;discard',
    )
    expect(rootfsParam(form({ rootQuota: true }))).toBe('local-lvm:8')
    expect(rootfsParam(form({ rootQuota: true, unprivileged: false, rootNoReplicate: true }))).toBe('local-lvm:8,quota=1,replicate=0')
  })

  it('mount point options', () => {
    const mp = { ...newMountPoint({ mountPoints: [] }, 'x'), size: 2, path: '/data', backup: false, readonly: true, acl: '0' as const, quota: true, mountoptions: ['noexec'], noReplicate: true }
    expect(mountPointParam(mp, false)).toBe('x:2,mp=/data,ro=1,acl=0,quota=1,mountoptions=noexec,replicate=0')
    expect(mountPointParam(mp, true)).toBe('x:2,mp=/data,ro=1,acl=0,mountoptions=noexec,replicate=0')
  })

  it('net0 modes', () => {
    expect(lxcNetParam(form({ ipv4Mode: 'static', ip: '10.0.0.5/24', gw: '10.0.0.1', ipv6Mode: 'auto' }))).toBe(
      'name=eth0,bridge=vmbr0,firewall=1,ip=10.0.0.5/24,gw=10.0.0.1,ip6=auto',
    )
    expect(lxcNetParam(form({ ipv4Mode: 'none', ipv6Mode: 'static', ip6: '2001:db8::5/64', gw6: '2001:db8::1', firewall: false }))).toBe(
      'name=eth0,bridge=vmbr0,ip6=2001:db8::5/64,gw6=2001:db8::1',
    )
    expect(lxcNetParam(form({ hwaddr: 'bc:24:11:00:00:01', vlan: 10, mtu: 1400, rate: 5, disconnect: true, ipv6Mode: 'dhcp' }))).toBe(
      'name=eth0,bridge=vmbr0,hwaddr=BC:24:11:00:00:01,tag=10,firewall=1,ip=dhcp,ip6=dhcp,mtu=1400,rate=5,link_down=1',
    )
  })

  it('quotaAllowed', () => {
    expect(quotaAllowed(true, 'dir')).toBe(false)
    expect(quotaAllowed(false, 'zfspool')).toBe(false)
    expect(quotaAllowed(false, 'lvmthin')).toBe(true)
  })

  it('newMountPoint takes the next free index', () => {
    const a = newMountPoint({ mountPoints: [] })
    const b = newMountPoint({ mountPoints: [a] })
    expect([a.index, b.index]).toEqual([0, 1])
    expect(b.path).toBe('/mnt/data1')
  })
})

describe('validateLxcStep', () => {
  it('general: password or SSH key, length, confirmation, key format', () => {
    expect(validateLxcStep('general', form())).toEqual({})
    expect(validateLxcStep('general', form({ password: '', confirmPassword: '' }))).toHaveProperty('password')
    expect(validateLxcStep('general', form({ password: '', confirmPassword: '', sshKeys: KEY }))).toEqual({})
    expect(validateLxcStep('general', form({ password: 'abc', confirmPassword: 'abc' })).password).toMatch(/至少 5/)
    expect(validateLxcStep('general', form({ confirmPassword: 'other' }))).toHaveProperty('confirmPassword')
    expect(validateLxcStep('general', form({ sshKeys: 'not a key' }))).toHaveProperty('ssh-public-keys')
    expect(validateLxcStep('general', form({ hostname: 'bad_host' }))).toHaveProperty('hostname')
    expect(validateLxcStep('general', form(), { vmidState: 'taken' })).toHaveProperty('vmid')
  })

  it('template and disks', () => {
    expect(validateLxcStep('template', form({ ostemplate: '' }))).toHaveProperty('ostemplate')
    expect(validateLxcStep('template', form({ templateStorage: '' }))).toHaveProperty('templateStorage')
    expect(validateLxcStep('disks', form({ rootStorage: '' }))).toHaveProperty('rootfs')
    const f = form()
    const mp = { ...newMountPoint(f, 'local-lvm'), path: 'relative' }
    expect(validateLxcStep('disks', { ...f, mountPoints: [mp] })).toHaveProperty(`mp${mp.index}`)
    const ok = { ...mp, path: '/srv' }
    const dup = { ...newMountPoint({ mountPoints: [ok] }, 'local-lvm'), path: '/srv' }
    expect(validateLxcStep('disks', { ...f, mountPoints: [ok, dup] })).toHaveProperty(`mp${dup.index}`)
  })

  it('network: static addresses, MAC, VLAN; DNS list', () => {
    expect(validateLxcStep('network', form({ ipv4Mode: 'static', ip: '10.0.0.5' }))).toHaveProperty('ip')
    expect(validateLxcStep('network', form({ ipv4Mode: 'static', ip: '10.0.0.5/24', gw: 'x' }))).toHaveProperty('gw')
    expect(validateLxcStep('network', form({ ipv4Mode: 'static', ip: '10.0.0.5/24', gw: '10.0.0.1' }))).toEqual({})
    expect(validateLxcStep('network', form({ ipv6Mode: 'static', ip6: '2001:db8::5/64' }))).toEqual({})
    expect(validateLxcStep('network', form({ ipv6Mode: 'static', ip6: '2001:db8::5' }))).toHaveProperty('ip6')
    expect(validateLxcStep('network', form({ hwaddr: 'zz' }))).toHaveProperty('hwaddr')
    expect(validateLxcStep('network', form({ netName: 'eth 0' }))).toHaveProperty('netName')
    expect(validateLxcStep('dns', form({ nameserver: '1.1.1.1 2606:4700::1111' }))).toEqual({})
    expect(validateLxcStep('dns', form({ nameserver: 'dns.example' }))).toHaveProperty('nameserver')
  })
})

describe('lxcStepOfParam', () => {
  it('maps API parameters to steps', () => {
    expect(lxcStepOfParam('password')).toBe('general')
    expect(lxcStepOfParam('ostemplate')).toBe('template')
    expect(lxcStepOfParam('mp3')).toBe('disks')
    expect(lxcStepOfParam('swap')).toBe('memory')
    expect(lxcStepOfParam('net0')).toBe('network')
    expect(lxcStepOfParam('nameserver')).toBe('dns')
  })
})
