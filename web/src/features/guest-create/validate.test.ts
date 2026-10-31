import { describe, expect, it } from 'vitest'

import { isOciImage, volumeLabel } from '@/api/guest-create'

import { isAddressList, isCpuSet, isDnsName, isIPv4Cidr, isIPv6, isIPv6Cidr, isMountPath, isSshKey, isTag, isUnicastMac, sshKeysValid } from './validate'

describe('validators', () => {
  it('DNS names', () => {
    expect(isDnsName('web-01')).toBe(true)
    expect(isDnsName('web.lan')).toBe(true)
    expect(isDnsName('-web')).toBe(false)
    expect(isDnsName('web_01')).toBe(false)
  })

  it('tags', () => {
    expect(isTag('prod')).toBe(true)
    expect(isTag('k8s.node+1')).toBe(true)
    expect(isTag('-x')).toBe(false)
    expect(isTag('a b')).toBe(false)
  })

  it('MAC addresses must be unicast', () => {
    expect(isUnicastMac('BC:24:11:12:34:56')).toBe(true)
    expect(isUnicastMac('01:00:5e:00:00:01')).toBe(false)
    expect(isUnicastMac('BC:24:11:12:34')).toBe(false)
  })

  it('IP addresses and CIDRs', () => {
    expect(isIPv4Cidr('192.168.1.10/24')).toBe(true)
    expect(isIPv4Cidr('192.168.1.10')).toBe(false)
    expect(isIPv4Cidr('256.1.1.1/24')).toBe(false)
    expect(isIPv4Cidr('10.0.0.1/33')).toBe(false)
    expect(isIPv6('::1')).toBe(true)
    expect(isIPv6('2001:db8::1')).toBe(true)
    expect(isIPv6('fe80::1:2:3:4:5:6')).toBe(true)
    expect(isIPv6('fe80::1:2:3:4:5:6:7')).toBe(false)
    expect(isIPv6('::ffff:10.0.0.1')).toBe(true)
    expect(isIPv6('2001:db8:::1')).toBe(false)
    expect(isIPv6('1:2:3:4:5:6:7')).toBe(false)
    expect(isIPv6Cidr('2001:db8::5/64')).toBe(true)
    expect(isIPv6Cidr('2001:db8::5/129')).toBe(false)
    expect(isAddressList('1.1.1.1 8.8.8.8')).toBe(true)
    expect(isAddressList('1.1.1.1,dns')).toBe(false)
  })

  it('cpusets and mount paths', () => {
    expect(isCpuSet('0-3,8')).toBe(true)
    expect(isCpuSet('0-')).toBe(false)
    expect(isMountPath('/mnt/data')).toBe(true)
    expect(isMountPath('/')).toBe(false)
    expect(isMountPath('mnt')).toBe(false)
    expect(isMountPath('/a,b')).toBe(false)
  })

  it('SSH keys', () => {
    expect(isSshKey('ssh-ed25519 AAAAC3Nza user@host')).toBe(true)
    expect(isSshKey('from="10.0.0.1" ssh-rsa AAAAB3 c')).toBe(true)
    expect(isSshKey('ecdsa-sha2-nistp256 AAAAE2')).toBe(true)
    expect(isSshKey('hello world')).toBe(false)
    expect(sshKeysValid('ssh-ed25519 AAAA a\n\nssh-rsa BBBB b')).toBe(true)
    expect(sshKeysValid('ssh-ed25519 AAAA a\nnope')).toBe(false)
  })
})

describe('volume helpers', () => {
  it('volumeLabel', () => {
    expect(volumeLabel('local:iso/alpine-virt.iso')).toBe('alpine-virt.iso')
    expect(volumeLabel('local:vztmpl/debian.tar.zst')).toBe('debian.tar.zst')
    expect(volumeLabel('cephfs:abc')).toBe('abc')
  })

  it('isOciImage', () => {
    expect(isOciImage({ volid: 'local:vztmpl/nginx_latest.tar', format: 'tar' })).toBe(true)
    expect(isOciImage({ volid: 'local:vztmpl/alpine.tar.xz', format: 'txz' })).toBe(false)
  })
})
