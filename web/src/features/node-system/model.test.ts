import { describe, expect, it } from 'vitest'

import {
  checkHosts,
  clockSkew,
  dnsParams,
  dnsToForm,
  formatClock,
  formatUtcOffset,
  locationMapUrl,
  locationValue,
  normalizeHostsText,
  optionsParams,
  parseLocation,
  parseWakeOnLan,
  searchTimezones,
  splitZone,
  validateDnsForm,
  validateLocation,
  validateWol,
  wakeOnLanValue,
  zoneOffset,
} from './model'
import { TIMEZONES } from './timezones'

// Shapes are trimmed copies of lab answers (pvelab-c3, PVE 9.2.2).

describe('DNS', () => {
  const dns = { search: 'lan', dns1: '192.168.0.2' }

  it('form round trip and unchanged → null', () => {
    const form = dnsToForm(dns)
    expect(form).toEqual({ search: 'lan', servers: ['192.168.0.2', '', ''] })
    expect(dnsParams(dns, form)).toBeNull()
    expect(dnsParams(dns, { ...form, search: ' lan ' })).toBeNull()
  })

  it('sends search plus the set servers, moved up, never empty strings', () => {
    expect(dnsParams(dns, { search: 'lan', servers: ['', '1.1.1.1', ' 2001:db8::1 '] })).toEqual({
      search: 'lan',
      dns1: '1.1.1.1',
      dns2: '2001:db8::1',
    })
    expect(dnsParams(dns, { search: 'example.com', servers: ['192.168.0.2', '', ''] })).toEqual({
      search: 'example.com',
      dns1: '192.168.0.2',
    })
    // Clearing a server = leaving it out (the API rewrites resolv.conf).
    expect(dnsParams({ search: 'lan', dns1: 'a', dns2: '8.8.8.8' }, { search: 'lan', servers: ['8.8.8.8', '', ''] })).toEqual({
      search: 'lan',
      dns1: '8.8.8.8',
    })
  })

  it('validates search domain and addresses', () => {
    expect(validateDnsForm({ search: '', servers: ['', '', ''] })).toEqual({ search: '必填' })
    expect(validateDnsForm({ search: 'example.com', servers: ['192.168.0.2', 'fe80::1', ''] })).toEqual({})
    expect(validateDnsForm({ search: 'lan example.com', servers: ['', '', ''] })).toEqual({ search: '只能填一个域名' })
    const bad = validateDnsForm({ search: 'a,b', servers: ['300.1.1.1', '', 'dns.google'] })
    expect(Object.keys(bad).sort()).toEqual(['dns1', 'dns3', 'search'])
  })
})

describe('hosts', () => {
  const text =
    '127.0.0.1 localhost.localdomain localhost\n192.168.0.248 pvelab-c3.lan pvelab-c3\n\n# IPv6\n::1     ip6-localhost ip6-loopback\nff02::1 ip6-allnodes\n'

  it('finds entries and the node entry', () => {
    const c = checkHosts(text, 'pvelab-c3')
    expect(c.entries).toHaveLength(4)
    expect(c.entries[1]).toEqual({ line: 2, address: '192.168.0.248', names: ['pvelab-c3.lan', 'pvelab-c3'] })
    expect(c.missingNode).toBe(false)
    expect(c.invalidLines).toEqual([])
    // FQDN alone also counts; case-insensitive.
    expect(checkHosts('10.0.0.3 PVELAB-C3.lan\n', 'pvelab-c3').missingNode).toBe(false)
  })

  it('flags a missing node entry and malformed lines', () => {
    const c = checkHosts(text.replace(/^192.*\n/m, '# 192.168.0.248 pvelab-c3\nnot-an-ip foo\n10.0.0.1\n'), 'pvelab-c3')
    expect(c.missingNode).toBe(true)
    expect(c.invalidLines).toEqual([3, 4])
    // Another node's name is not ours.
    expect(checkHosts('10.0.0.4 pvelab-c30\n', 'pvelab-c3').missingNode).toBe(true)
  })

  it('normalizes line endings and the final newline', () => {
    expect(normalizeHostsText('a\r\nb')).toBe('a\nb\n')
    expect(normalizeHostsText('a\n')).toBe('a\n')
    expect(normalizeHostsText('')).toBe('')
  })
})

describe('time', () => {
  it('formats node time and offsets', () => {
    // Lab answer: time 1793514283, localtime 1793543083 (Asia/Shanghai).
    expect(formatClock(1793543083)).toBe('2026-11-01 14:24:43')
    expect(formatClock(1793514283)).toBe('2026-11-01 06:24:43')
    expect(formatUtcOffset(1793543083 - 1793514283)).toBe('UTC+08:00')
    expect(formatUtcOffset(-12600)).toBe('UTC-03:30')
    expect(formatUtcOffset(0)).toBe('UTC')
  })

  it('zone offsets from the browser tz data', () => {
    expect(zoneOffset('Asia/Shanghai')).toBe('UTC+08:00')
    expect(zoneOffset('UTC')).toBe('UTC')
    expect(zoneOffset('Not/AZone')).toBeNull()
  })

  it('clock skew beyond the tolerance', () => {
    expect(clockSkew(1000, 1_000_000 + 3000)).toBeNull()
    expect(clockSkew(1060, 1_000_000)).toBe(60)
    expect(clockSkew(940, 1_000_000)).toBe(-60)
  })

  it('searches zones by id, city and Chinese alias', () => {
    expect(TIMEZONES).toContain('Asia/Shanghai')
    expect(TIMEZONES).toContain('UTC')
    expect(searchTimezones('')).toHaveLength(TIMEZONES.length)
    expect(searchTimezones('上海')).toEqual(['Asia/Shanghai'])
    expect(searchTimezones('new york')).toEqual(['America/New_York'])
    expect(searchTimezones('asia toky')).toEqual(['Asia/Tokyo'])
    expect(splitZone('America/Argentina/Rio_Gallegos')).toEqual({ region: 'America', city: 'Argentina / Rio Gallegos' })
    expect(splitZone('UTC')).toEqual({ region: '', city: 'UTC' })
  })
})

describe('node options', () => {
  const config = { digest: 'abc', 'startall-onboot-delay': 10, acme: 'account=default' }

  it('sends only changed keys, deletes cleared ones, with digest', () => {
    expect(optionsParams(config, { 'startall-onboot-delay': 10 })).toBeNull()
    expect(optionsParams(config, { 'startall-onboot-delay': 30 })).toEqual({ 'startall-onboot-delay': '30', digest: 'abc' })
    expect(optionsParams(config, { 'startall-onboot-delay': undefined })).toEqual({ delete: 'startall-onboot-delay', digest: 'abc' })
    expect(optionsParams(config, { 'ballooning-target': 70 })).toEqual({ 'ballooning-target': '70', digest: 'abc' })
    expect(optionsParams(config, { 'ballooning-target': undefined })).toBeNull()
  })

  it('wake-on-LAN property string', () => {
    expect(parseWakeOnLan('mac=AA:BB:CC:DD:EE:FF,bind-interface=vmbr0')).toEqual({
      mac: 'AA:BB:CC:DD:EE:FF',
      bindInterface: 'vmbr0',
      broadcast: '',
    })
    expect(parseWakeOnLan('aa:bb:cc:dd:ee:ff').mac).toBe('aa:bb:cc:dd:ee:ff')
    expect(parseWakeOnLan(undefined)).toEqual({ mac: '', bindInterface: '', broadcast: '' })

    expect(wakeOnLanValue(undefined, { mac: 'aa:bb:cc:dd:ee:ff', bindInterface: '', broadcast: '' })).toBe('aa:bb:cc:dd:ee:ff')
    expect(
      wakeOnLanValue('mac=aa:bb:cc:dd:ee:ff,bind-interface=eno1', {
        mac: 'aa:bb:cc:dd:ee:01',
        bindInterface: '',
        broadcast: '192.168.0.255',
      }),
    ).toBe('aa:bb:cc:dd:ee:01,broadcast-address=192.168.0.255')
    expect(wakeOnLanValue('aa:bb:cc:dd:ee:ff', { mac: '', bindInterface: 'eno1', broadcast: '' })).toBe('')
    expect(optionsParams({ wakeonlan: 'aa:bb:cc:dd:ee:ff' }, { wakeonlan: '' })).toEqual({ delete: 'wakeonlan' })
  })

  it('validates wake-on-LAN', () => {
    expect(validateWol({ mac: '', bindInterface: '', broadcast: '' })).toEqual({})
    expect(validateWol({ mac: 'aa:bb:cc:dd:ee:ff', bindInterface: 'vmbr0', broadcast: '10.0.0.255' })).toEqual({})
    expect(Object.keys(validateWol({ mac: 'aa-bb', bindInterface: '', broadcast: 'x' })).sort()).toEqual(['broadcast', 'mac'])
    expect(validateWol({ mac: '', bindInterface: 'eno1', broadcast: '' }).mac).toBeTruthy()
  })

  it('location property string', () => {
    expect(parseLocation('latitude=48.2,longitude=16.37,name=Vienna')).toEqual({ name: 'Vienna', latitude: 48.2, longitude: 16.37 })
    expect(parseLocation(undefined)).toEqual({ name: '', latitude: undefined, longitude: undefined })
    expect(locationValue(undefined, { name: ' Rack A ', latitude: 31.2304, longitude: 121.4737 })).toBe(
      'latitude=31.2304,longitude=121.4737,name=Rack A',
    )
    expect(locationValue('latitude=1,longitude=2,name=x', { name: '', latitude: 1.1234567, longitude: 2 })).toBe(
      'latitude=1.123457,longitude=2',
    )
    expect(locationValue('latitude=1,longitude=2', { name: '', latitude: undefined, longitude: undefined })).toBe('')
    expect(locationMapUrl({ name: '', latitude: 48.2, longitude: 16.37 })).toContain('mlat=48.2&mlon=16.37')
  })

  it('validates location', () => {
    expect(validateLocation({ name: '', latitude: undefined, longitude: undefined })).toEqual({})
    expect(validateLocation({ name: 'a=b', latitude: 91, longitude: undefined })).toEqual({
      name: '不能包含逗号和等号',
      latitude: '范围 -90 ~ 90',
      longitude: '必填',
    })
    expect(validateLocation({ name: '机房', latitude: 1, longitude: 2 }).name).toContain('PVE 无法正确保存')
  })
})
