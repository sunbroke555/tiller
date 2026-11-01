import { describe, expect, it } from 'vitest'

import {
  bwlimitValue,
  canonicalOption,
  colorMapValue,
  crsValue,
  decodeBase64Utf8,
  describeOption,
  encodeBase64Utf8,
  formatRate,
  locationValue,
  networkSettingValue,
  nextIdValue,
  optionMap,
  optionParams,
  optionText,
  overlap,
  parseBwlimit,
  parseColorOverrides,
  parseCrs,
  parseLocationForm,
  parseNetworkSetting,
  parseNextId,
  parseTagList,
  parseTagStyleForm,
  parseUserTagAccessForm,
  parseWebauthn,
  tagListError,
  tagListValue,
  tagStyleValue,
  userTagAccessValue,
  validateCidr,
  validateColorOverrides,
  validateEmail,
  validateHttpProxy,
  validateLocationForm,
  validateMacPrefix,
  validateNextId,
  validateWebauthn,
  webauthnValue,
} from './model'
import { cidrNetwork } from './dialogs'

// Shapes as GET /cluster/options returns them on PVE 9.2 (lab, recorded).
const OPTIONS = {
  'allowed-tags': ['a', 'b', 'demo', 'test', 'x', 'y'],
  bwlimit: 'default=1024,restore=2048',
  crs: { ha: 'static', 'ha-rebalance-on-start': 1 },
  description: '',
  fencing: 'watchdog',
  ha: { shutdown_policy: 'migrate' },
  keyboard: 'en-us',
  location: 'latitude=1.5,longitude=2.25,name=Lab',
  mac_prefix: 'BC:24:11',
  max_workers: '3',
  migration: { type: 'secure' },
  'next-id': { lower: '200', upper: '3000' },
  notify: { fencing: 'always' },
  'registered-tags': ['x', 'y'],
  'tag-style': { 'case-sensitive': 1, 'color-map': 'zz:FF0000:FFFFFF;yy:00FF00' },
  u2f: { appid: 'https://x.lan' },
  'user-tag-access': { 'user-allow': 'list', 'user-allow-list': ['a', 'b'] },
}

describe('normalising GET values', () => {
  it('turns objects, arrays and numbers into PUT strings', () => {
    expect(optionText(OPTIONS.crs)).toBe('ha=static,ha-rebalance-on-start=1')
    expect(optionText(OPTIONS['user-tag-access'])).toBe('user-allow=list,user-allow-list=a;b')
    expect(optionText(OPTIONS['registered-tags'])).toBe('x;y')
    expect(optionText(3)).toBe('3')
    expect(optionText('')).toBeUndefined()
    expect(optionText([])).toBeUndefined()
  })

  it('parses strings and objects alike', () => {
    expect(optionMap(OPTIONS.bwlimit)).toEqual({ default: '1024', restore: '2048' })
    expect(optionMap(OPTIONS['tag-style'])).toEqual({ 'case-sensitive': '1', 'color-map': 'zz:FF0000:FFFFFF;yy:00FF00' })
    expect(optionMap('secure,network=10.0.0.0/24', 'type')).toEqual({ type: 'secure', network: '10.0.0.0/24' })
  })

  it('compares property strings regardless of key order and default key', () => {
    expect(canonicalOption('crs', 'ha-rebalance-on-start=1,ha=static')).toBe(canonicalOption('crs', OPTIONS.crs))
    expect(canonicalOption('migration', 'secure')).toBe(canonicalOption('migration', OPTIONS.migration))
    expect(canonicalOption('keyboard', 'en-us')).toBe('en-us')
  })
})

describe('optionParams', () => {
  it('sends only changed keys and deletes cleared ones', () => {
    expect(
      optionParams(OPTIONS, {
        keyboard: 'de',
        crs: 'ha-rebalance-on-start=1,ha=static', // same as loaded
        bwlimit: undefined,
        'next-id': '',
      }),
    ).toEqual({ keyboard: 'de', delete: 'bwlimit,next-id' })
  })

  it('returns null when nothing changed', () => {
    expect(optionParams(OPTIONS, { 'tag-style': 'color-map=zz:FF0000:FFFFFF;yy:00FF00,case-sensitive=1', max_workers: '3' })).toBeNull()
  })

  it('does not delete what was never set', () => {
    expect(optionParams(OPTIONS, { http_proxy: undefined, description: '' })).toBeNull()
  })

  it('sets new keys', () => {
    expect(optionParams({}, { http_proxy: ' http://proxy:3128/ ' })).toEqual({ http_proxy: 'http://proxy:3128/' })
  })
})

describe('forms', () => {
  it('migration / replication', () => {
    expect(parseNetworkSetting(OPTIONS.migration)).toEqual({ type: 'secure', network: '' })
    expect(parseNetworkSetting('insecure,network=10.1.0.0/16')).toEqual({ type: 'insecure', network: '10.1.0.0/16' })
    expect(networkSettingValue({ type: 'secure', network: '10.0.0.0/24' })).toBe('type=secure,network=10.0.0.0/24')
    expect(networkSettingValue({ type: undefined, network: ' ' })).toBeUndefined()
    expect(validateCidr('10.0.0.0/24')).toBeUndefined()
    expect(validateCidr('fd00::/64')).toBeUndefined()
    expect(validateCidr('10.0.0.0')).toBeDefined()
    expect(validateCidr('300.0.0.0/8')).toBeDefined()
    expect(cidrNetwork('192.168.0.245/24')).toBe('192.168.0.0/24')
    expect(cidrNetwork('fd00::5/64')).toBe('fd00::5/64')
  })

  it('bandwidth limits (KiB/s)', () => {
    expect(parseBwlimit(OPTIONS.bwlimit)).toEqual({ default: 1024, restore: 2048 })
    expect(bwlimitValue({ migration: 51200, default: 1024.4 })).toBe('default=1024,migration=51200')
    expect(bwlimitValue({})).toBeUndefined()
    expect(formatRate(2048)).toBe('2 MiB/s')
    expect(formatRate(512)).toBe('512 KiB/s')
    expect(formatRate(1536)).toBe('1.5 MiB/s')
    expect(formatRate(0)).toBe('不限速')
  })

  it('next-id', () => {
    expect(parseNextId(OPTIONS['next-id'])).toEqual({ lower: 200, upper: 3000 })
    expect(nextIdValue({ lower: 200, upper: undefined })).toBe('lower=200')
    expect(nextIdValue({ lower: undefined, upper: undefined })).toBeUndefined()
    expect(validateNextId({ lower: 5000, upper: 3000 }).upper).toBeDefined()
    expect(validateNextId({ lower: 50, upper: undefined }).lower).toBeDefined()
    expect(validateNextId({ lower: undefined, upper: 99 }).upper).toBeDefined()
    expect(validateNextId({ lower: 200, upper: 3000 })).toEqual({})
  })

  it('CRS drops auto-rebalance settings it cannot use', () => {
    const f = parseCrs(OPTIONS.crs)
    expect(f).toMatchObject({ ha: 'static', rebalanceOnStart: true, autoRebalance: false })
    expect(crsValue({ ...f, autoRebalance: true, threshold: 40, method: 'topsis' })).toBe(
      'ha=static,ha-rebalance-on-start=1,ha-auto-rebalance=1,ha-auto-rebalance-threshold=40,ha-auto-rebalance-method=topsis',
    )
    expect(crsValue({ ...f, ha: 'basic', autoRebalance: true, threshold: 40 })).toBe('ha=basic,ha-rebalance-on-start=1')
    expect(crsValue({ ha: undefined, rebalanceOnStart: false, autoRebalance: false, threshold: 1, method: undefined, holdDuration: undefined, margin: undefined })).toBeUndefined()
  })

  it('webauthn', () => {
    const f = parseWebauthn({ rp: 'pve.lan', id: 'pve.lan', 'allow-subdomains': 1 })
    expect(f).toEqual({ rp: 'pve.lan', origin: '', id: 'pve.lan', allowSubdomains: true })
    expect(webauthnValue({ ...f, origin: 'https://pve.lan:8006' })).toBe('rp=pve.lan,origin=https://pve.lan:8006,id=pve.lan,allow-subdomains=1')
    expect(webauthnValue({ rp: '', origin: '', id: '', allowSubdomains: false })).toBeUndefined()
    expect(validateWebauthn({ rp: '', origin: '', id: '', allowSubdomains: false })).toEqual({})
    expect(validateWebauthn({ rp: 'x', origin: 'https://a/b', id: 'bad id', allowSubdomains: false })).toMatchObject({ origin: expect.any(String), id: expect.any(String) })
  })

  it('location', () => {
    expect(parseLocationForm(OPTIONS.location)).toEqual({ name: 'Lab', latitude: 1.5, longitude: 2.25 })
    expect(locationValue({ name: '', latitude: 31.23041234567, longitude: 121.4737 })).toBe('latitude=31.230412,longitude=121.4737')
    expect(locationValue({ name: '', latitude: undefined, longitude: undefined })).toBeUndefined()
    expect(validateLocationForm({ name: 'x', latitude: undefined, longitude: 200 })).toMatchObject({ latitude: '必填', longitude: expect.any(String) })
  })

  it('simple validators', () => {
    expect(validateMacPrefix('02:8f')).toBeUndefined()
    expect(validateMacPrefix('BC:24:11')).toBeUndefined()
    expect(validateMacPrefix('01:00')).toBeDefined() // multicast
    expect(validateMacPrefix('02:8f:00:11')).toBeDefined()
    expect(validateHttpProxy('http://u:p@host:3128/')).toBeUndefined()
    expect(validateHttpProxy('https://host')).toBeDefined()
    expect(validateEmail('pve@example.com')).toBeUndefined()
    expect(validateEmail('nope')).toBeDefined()
  })

  it('consent text is base64 UTF-8', () => {
    const text = '仅限授权人员 — **Authorized** only'
    expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(text)
    expect(encodeBase64Utf8('hi')).toBe('aGk=')
  })
})

describe('tags', () => {
  it('tag style round trip', () => {
    const f = parseTagStyleForm(OPTIONS['tag-style'])
    expect(f).toEqual({
      shape: undefined,
      ordering: undefined,
      caseSensitive: true,
      colors: [
        { tag: 'zz', bg: 'FF0000', fg: 'FFFFFF' },
        { tag: 'yy', bg: '00FF00', fg: '' },
      ],
    })
    expect(tagStyleValue({ ...f, shape: 'dense', ordering: 'config' })).toBe('color-map=zz:FF0000:FFFFFF;yy:00FF00,shape=dense,ordering=config,case-sensitive=1')
    expect(tagStyleValue({ shape: undefined, ordering: undefined, caseSensitive: false, colors: [] })).toBeUndefined()
    expect(colorMapValue([{ tag: ' prod ', bg: 'ff8800', fg: 'zz' }])).toBe('prod:FF8800')
    expect(parseColorOverrides('a:12345g;b')).toEqual([
      { tag: 'a', bg: 'FFFFFF', fg: '' },
      { tag: 'b', bg: 'FFFFFF', fg: '' },
    ])
  })

  it('colour override validation', () => {
    const rows = [
      { tag: 'Prod', bg: 'FF0000', fg: '' },
      { tag: 'prod', bg: '00FF00', fg: '' },
      { tag: '', bg: 'FF0000', fg: '' },
      { tag: 'a b', bg: 'FF0000', fg: '' },
    ]
    expect(validateColorOverrides(rows, false)).toEqual([undefined, '标签重复', '请输入标签', expect.any(String)])
    expect(validateColorOverrides(rows.slice(0, 2), true)).toEqual([undefined, undefined])
  })

  it('user tag access and registered tags', () => {
    expect(parseUserTagAccessForm(OPTIONS['user-tag-access'])).toEqual({ mode: 'list', list: ['a', 'b'] })
    expect(parseUserTagAccessForm('user-allow=existing,user-allow-list=c;d')).toEqual({ mode: 'existing', list: ['c', 'd'] })
    expect(userTagAccessValue({ mode: 'list', list: ['a', 'b'] })).toBe('user-allow=list,user-allow-list=a;b')
    expect(userTagAccessValue({ mode: undefined, list: [] })).toBeUndefined()
    expect(parseTagList(OPTIONS['registered-tags'])).toEqual(['x', 'y'])
    expect(parseTagList('x;y')).toEqual(['x', 'y'])
    expect(tagListValue([])).toBeUndefined()
    expect(tagListError('X', ['x'])).toBe('已在列表中')
    expect(tagListError('ok-1', ['x'])).toBeUndefined()
    expect(overlap(['a', 'B'], ['b', 'c'])).toEqual(['B'])
  })
})

describe('describeOption', () => {
  it('summarises set values and leaves defaults undefined', () => {
    expect(describeOption('keyboard', OPTIONS)).toBe('英语（美国）（en-us）')
    expect(describeOption('mac_prefix', OPTIONS)).toBeUndefined()
    expect(describeOption('description', OPTIONS)).toBeUndefined()
    expect(describeOption('bwlimit', OPTIONS)).toBe('默认 1 MiB/s，备份恢复 2 MiB/s')
    expect(describeOption('migration', OPTIONS)).toBe('加密（secure） · 默认网络')
    expect(describeOption('registered-tags', OPTIONS)).toBe('x、y')
    expect(describeOption('next-id', OPTIONS)).toBe('从 200 到 3000（不含）')
    expect(describeOption('http_proxy', OPTIONS)).toBeUndefined()
    expect(describeOption('tag-style', OPTIONS)).toContain('2 个颜色覆盖')
  })
})
