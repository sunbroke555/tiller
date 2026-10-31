import { describe, expect, it } from 'vitest'

import {
  PropertyStringError,
  configChanges,
  configUpdateParams,
  parseDrive,
  parseListValue,
  parseMountPoint,
  parsePropertyString,
  parseQemuNet,
  parseVolumeId,
  propBool,
  propNumber,
  stringifyPropertyString,
  stringifyQemuNet,
  tryParsePropertyString,
  updatePropertyString,
} from './propstring'
import { bestSizeUnit, convertSize, formatPveSize, parsePveSize } from './size'

describe('parsePropertyString', () => {
  it('parses key=value pairs', () => {
    expect(parsePropertyString('bridge=vmbr0,firewall=1,tag=10')).toEqual({ bridge: 'vmbr0', firewall: '1', tag: '10' })
  })

  it('assigns a bare value to the default key wherever it appears', () => {
    expect(parsePropertyString('local-lvm:vm-100-disk-0,iothread=1,size=32G', 'file')).toEqual({
      file: 'local-lvm:vm-100-disk-0',
      iothread: '1',
      size: '32G',
    })
    expect(parsePropertyString('size=8G,local:subvol-200-disk-0', 'volume')).toEqual({
      size: '8G',
      volume: 'local:subvol-200-disk-0',
    })
  })

  it('keeps "=" inside values and ignores empty parts and whitespace', () => {
    expect(parsePropertyString(' a=b=c , ,d=')).toEqual({ a: 'b=c', d: '' })
  })

  it('returns {} for empty input', () => {
    expect(parsePropertyString('')).toEqual({})
    expect(parsePropertyString(undefined)).toEqual({})
    expect(parsePropertyString(null, 'file')).toEqual({})
  })

  it('rejects a bare value without default key, a duplicate default value or an empty key', () => {
    expect(() => parsePropertyString('host,flags=+aes')).toThrow(PropertyStringError)
    expect(() => parsePropertyString('a,b', 'file')).toThrow(PropertyStringError)
    expect(() => parsePropertyString('=1')).toThrow(PropertyStringError)
    expect(tryParsePropertyString('a,b', 'file')).toEqual({})
  })

  it('keeps ";" lists as one value', () => {
    const cpu = parsePropertyString('host,flags=+aes;-pcid', 'cputype')
    expect(cpu).toEqual({ cputype: 'host', flags: '+aes;-pcid' })
    expect(parseListValue(cpu.flags)).toEqual(['+aes', '-pcid'])
    expect(parseListValue(undefined)).toEqual([])
  })
})

describe('stringifyPropertyString', () => {
  it('writes the default key first without its name and keeps order', () => {
    expect(stringifyPropertyString({ size: '32G', file: 'local-lvm:vm-100-disk-0', iothread: 1 }, 'file')).toBe(
      'local-lvm:vm-100-disk-0,size=32G,iothread=1',
    )
  })

  it('drops empty values, encodes booleans and joins arrays with ";"', () => {
    expect(
      stringifyPropertyString({ a: '', b: null, c: undefined, d: true, e: false, f: ['10', 20], g: [] }),
    ).toBe('d=1,e=0,f=10;20')
  })

  it('can sort like the official UI', () => {
    expect(stringifyPropertyString({ z: 1, a: 2, cputype: 'host' }, { defaultKey: 'cputype', sort: true })).toBe(
      'host,a=2,z=1',
    )
  })

  it('refuses values with commas', () => {
    expect(() => stringifyPropertyString({ a: 'x,y' })).toThrow(PropertyStringError)
  })

  it('round-trips real config values', () => {
    for (const [value, key] of [
      ['local-lvm:vm-100-disk-0,discard=on,iothread=1,size=32G', 'file'],
      ['local:iso/debian-13.iso,media=cdrom,size=754M', 'file'],
      ['local-lvm:vm-200-disk-0,size=8G', 'volume'],
      ['name=eth0,bridge=vmbr0,firewall=1,hwaddr=BC:24:11:00:00:01,ip=dhcp,type=veth', undefined],
      ['order=scsi0;ide2;net0', undefined],
    ] as const) {
      expect(stringifyPropertyString(parsePropertyString(value, key), key)).toBe(value)
    }
  })
})

describe('updatePropertyString', () => {
  it('changes, adds and removes keys in place', () => {
    expect(updatePropertyString('bridge=vmbr0,firewall=1,tag=5', { bridge: 'vmbr1', tag: null, rate: 10 })).toBe(
      'bridge=vmbr1,firewall=1,rate=10',
    )
    expect(updatePropertyString('local-lvm:vm-100-disk-0,size=32G', { cache: 'writeback' }, 'file')).toBe(
      'local-lvm:vm-100-disk-0,size=32G,cache=writeback',
    )
  })
})

describe('drives and volumes', () => {
  it('parses volume ids', () => {
    expect(parseVolumeId('local-lvm:vm-100-disk-0')).toEqual({ storage: 'local-lvm', volume: 'vm-100-disk-0' })
    expect(parseVolumeId('local:iso/a:b.iso')).toEqual({ storage: 'local', volume: 'iso/a:b.iso' })
    expect(parseVolumeId('/dev/disk/by-id/ata-x')).toBeNull()
    expect(parseVolumeId('none')).toBeNull()
    expect(parseVolumeId(undefined)).toBeNull()
  })

  it('parses drive and mount point strings', () => {
    expect(parseDrive('none,media=cdrom')).toEqual({ file: 'none', media: 'cdrom' })
    expect(parseMountPoint('local-lvm:vm-200-disk-1,mp=/data,backup=1,size=4G')).toEqual({
      volume: 'local-lvm:vm-200-disk-1',
      mp: '/data',
      backup: '1',
      size: '4G',
    })
  })

  it('converts flag and number values', () => {
    expect(propBool('1')).toBe(true)
    expect(propBool('0', true)).toBe(false)
    expect(propBool('on')).toBe(true)
    expect(propBool(undefined, true)).toBe(true)
    expect(propNumber('12')).toBe(12)
    expect(propNumber('x', 3)).toBe(3)
    expect(propNumber(undefined)).toBeUndefined()
  })
})

describe('QEMU net', () => {
  it('reads the model=MAC short form', () => {
    expect(parseQemuNet('virtio=BC:24:11:AA:BB:CC,bridge=vmbr0,firewall=1')).toEqual({
      model: 'virtio',
      macaddr: 'BC:24:11:AA:BB:CC',
      options: { bridge: 'vmbr0', firewall: '1' },
    })
  })

  it('reads a model without MAC and the canonical form', () => {
    expect(parseQemuNet('e1000,bridge=vmbr1,tag=20')).toEqual({ model: 'e1000', macaddr: '', options: { bridge: 'vmbr1', tag: '20' } })
    expect(parseQemuNet('model=vmxnet3,macaddr=AA:BB:CC:DD:EE:FF,bridge=vmbr0')).toEqual({
      model: 'vmxnet3',
      macaddr: 'AA:BB:CC:DD:EE:FF',
      options: { bridge: 'vmbr0' },
    })
    expect(parseQemuNet('bridge=vmbr0')).toBeNull()
    expect(parseQemuNet('')).toBeNull()
  })

  it('writes the short form', () => {
    expect(stringifyQemuNet({ model: 'virtio', macaddr: 'BC:24:11:AA:BB:CC', options: { bridge: 'vmbr0', firewall: '1' } })).toBe(
      'virtio=BC:24:11:AA:BB:CC,bridge=vmbr0,firewall=1',
    )
    expect(stringifyQemuNet({ model: 'virtio', macaddr: '', options: { bridge: 'vmbr0' } })).toBe('virtio,bridge=vmbr0')
  })
})

describe('config updates', () => {
  const config = { memory: 2048, balloon: 1024, name: 'web', onboot: 1, digest: 'abc' }

  it('reports set and deleted keys, comparing as strings', () => {
    expect(configChanges(config, { memory: '2048', balloon: '', name: 'web2', onboot: true, cores: 2 })).toEqual({
      set: { name: 'web2', cores: '2' },
      delete: ['balloon'],
    })
  })

  it('does not touch keys the form does not manage', () => {
    expect(configChanges(config, { name: 'web' })).toEqual({ set: {}, delete: [] })
  })

  it('deletes keys listed in opts.keys that are missing from after', () => {
    expect(configChanges(config, {}, { keys: ['balloon', 'cores'] })).toEqual({ set: {}, delete: ['balloon'] })
  })

  it('builds PUT params with delete and digest', () => {
    expect(configUpdateParams(config, { memory: 4096, balloon: null, onboot: false })).toEqual({
      memory: '4096',
      onboot: '0',
      delete: 'balloon',
      digest: 'abc',
    })
    expect(configUpdateParams(config, { name: 'web' })).toBeNull()
    expect(configUpdateParams(undefined, { name: 'x' }, { digest: 'd1', extra: { skiplock: 1 } })).toEqual({
      name: 'x',
      digest: 'd1',
      skiplock: 1,
    })
  })
})

describe('sizes', () => {
  it('parses PVE size strings', () => {
    expect(parsePveSize('32G')).toBe(32 * 1024 ** 3)
    expect(parsePveSize('512M')).toBe(512 * 1024 ** 2)
    expect(parsePveSize('1.5T')).toBe(1.5 * 1024 ** 4)
    expect(parsePveSize('4096')).toBe(4096)
    expect(parsePveSize('8GiB')).toBe(8 * 1024 ** 3)
    expect(parsePveSize('10 GB')).toBe(10 * 1024 ** 3)
    expect(parsePveSize(1234)).toBe(1234)
    expect(parsePveSize('big')).toBeNull()
    expect(parsePveSize(undefined)).toBeNull()
  })

  it('formats bytes as PVE size strings', () => {
    expect(formatPveSize(32 * 1024 ** 3)).toBe('32G')
    expect(formatPveSize(1536 * 1024 ** 2)).toBe('1536M')
    expect(formatPveSize(2 * 1024 ** 4)).toBe('2T')
    expect(formatPveSize(1000)).toBe('1000')
  })

  it('converts and picks display units', () => {
    expect(convertSize(2, 'GiB', 'MiB')).toBe(2048)
    expect(bestSizeUnit(4096, 'MiB', ['MiB', 'GiB'])).toBe('GiB')
    expect(bestSizeUnit(1536, 'MiB', ['MiB', 'GiB'])).toBe('MiB')
    expect(bestSizeUnit(undefined, 'MiB', ['MiB', 'GiB'])).toBe('MiB')
    expect(bestSizeUnit(0, 'GiB', ['MiB', 'GiB'])).toBe('GiB')
  })
})
