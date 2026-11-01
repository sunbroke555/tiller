import { describe, expect, it } from 'vitest'

import type { GuestRrdPoint } from '@/api/guest-core'
import { createPermissionChecker } from '@/lib/permissions'

import { buildCharts } from './GuestCharts'
import { configMemoryMiB } from './TemplateSummary'
import { fromAgent, fromLxc, isMinorAddress, primaryAddress, visibleInterfaces } from './ips'
import { downsample, field, hasData, lastValue, niceBytesMax, niceMax, timeLabel } from './rrd'
import {
  bypassesTagAccess,
  contrastText,
  joinTags,
  orderTags,
  parseColorMap,
  parseTagStyle,
  parseUserTagAccess,
  splitTags,
  stringToRgb,
  tagError,
  tagOverride,
} from './tags'
import { configDisks } from './TemplateSummary'

describe('rrd helpers', () => {
  const pts: GuestRrdPoint[] = [
    { time: 1, cpu: 0.1, mem: 100 },
    { time: 2 },
    { time: 3, cpu: 0.3, mem: 300 },
  ]

  it('extracts fields with gaps and mapping', () => {
    expect(field(pts, 'cpu', (v) => v * 100)).toEqual([10, null, 30])
    expect(hasData(field(pts, 'netin'))).toBe(false)
    expect(lastValue([1, 2, null])).toBe(2)
    expect(lastValue([null])).toBeNull()
  })

  it('treats numeric strings as numbers (PSI comes as strings for CTs)', () => {
    expect(field([{ time: 1, pressurecpusome: '0.50' as unknown as number }], 'pressurecpusome')).toEqual([0.5])
  })

  it('downsamples by averaging buckets', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ time: i, cpu: i }))
    const out = downsample(many, 5)
    expect(out).toHaveLength(5)
    expect(out[0]).toEqual({ time: 1, cpu: 0.5 })
    expect(out[4]).toEqual({ time: 9, cpu: 8.5 })
    expect(downsample(pts, 10)).toHaveLength(3)
  })

  it('rounds axis maxima', () => {
    expect(niceMax(0.37)).toBe(0.5)
    expect(niceMax(7)).toBe(10)
    expect(niceMax(2.2)).toBe(2.5)
    expect(niceMax(0)).toBe(1)
    expect(niceBytesMax(3 * 1024 ** 2)).toBe(5 * 1024 ** 2)
  })

  it('formats time labels by range', () => {
    const t = new Date(2026, 10, 1, 8, 5).getTime() / 1000
    expect(timeLabel(t, 'hour')).toBe('08:05')
    expect(timeLabel(t, 'week')).toBe('11/1')
    expect(timeLabel(t, 'year')).toBe('2026/11')
  })
})

describe('buildCharts', () => {
  it('has CPU, memory, network and disk IO; CTs add root disk; PSI only with data', () => {
    const qemu = buildCharts([{ time: 1, cpu: 0.5, mem: 1, maxmem: 2 }], 'qemu').map((c) => c.key)
    expect(qemu).toEqual(['cpu', 'mem', 'net', 'io'])
    const lxc = buildCharts([{ time: 1, pressurecpusome: 1 }], 'lxc').map((c) => c.key)
    expect(lxc).toEqual(['cpu', 'mem', 'net', 'io', 'disk', 'psi'])
  })

  it('shows CPU as percent and QEMU host memory', () => {
    const [cpu, mem] = buildCharts([{ time: 1, cpu: 0.25, memhost: 5 }], 'qemu')
    expect(cpu!.series[0]!.values).toEqual([25])
    expect(mem!.series.map((s) => s.key)).toEqual(['mem', 'memhost', 'maxmem'])
  })
})

describe('guest interfaces', () => {
  it('normalises guest agent output and hides loopback / link-local', () => {
    const list = fromAgent([
      { name: 'lo', 'hardware-address': '00:00:00:00:00:00', 'ip-addresses': [{ 'ip-address': '127.0.0.1', 'ip-address-type': 'ipv4', prefix: 8 }] },
      {
        name: 'eth0',
        'hardware-address': 'bc:24:11:00:00:01',
        'ip-addresses': [
          { 'ip-address': 'fe80::1', 'ip-address-type': 'ipv6', prefix: 64 },
          { 'ip-address': '2001:db8::5', 'ip-address-type': 'ipv6', prefix: 64 },
          { 'ip-address': '192.168.1.5', 'ip-address-type': 'ipv4', prefix: 24 },
        ],
      },
    ])
    expect(list[0]!.loopback).toBe(true)
    expect(list[0]!.mac).toBeUndefined()
    expect(list[1]!.addresses.map((a) => a.address)).toEqual(['192.168.1.5', '2001:db8::5', 'fe80::1'])
    const shown = visibleInterfaces(list, false)
    expect(shown).toHaveLength(1)
    expect(shown[0]!.addresses.map((a) => a.address)).toEqual(['192.168.1.5', '2001:db8::5'])
    expect(visibleInterfaces(list, true)).toHaveLength(2)
    expect(primaryAddress(list)).toBe('192.168.1.5')
  })

  it('reads LXC interfaces (ip-addresses or inet/inet6)', () => {
    const lab = fromLxc([
      {
        name: 'eth0',
        hwaddr: 'bc:24:11:c8:b8:4b',
        inet6: 'fe80::be24:11ff:fec8:b84b/64',
        'ip-addresses': [
          { 'ip-address': '2409:8a28::b84b', 'ip-address-type': 'inet6', prefix: '64' },
          { 'ip-address': 'fe80::be24:11ff:fec8:b84b', 'ip-address-type': 'inet6', prefix: '64' },
        ],
      },
    ])
    expect(lab[0]!.addresses[0]).toMatchObject({ address: '2409:8a28::b84b', prefix: 64, family: 6, minor: false })
    const old = fromLxc([{ name: 'eth0', inet: '10.0.0.2/24', inet6: 'fe80::1/64' }])
    expect(old[0]!.addresses.map((a) => [a.address, a.prefix, a.family])).toEqual([
      ['10.0.0.2', 24, 4],
      ['fe80::1', 64, 6],
    ])
  })

  it('classifies minor addresses', () => {
    expect(isMinorAddress('169.254.3.4', 4)).toBe(true)
    expect(isMinorAddress('fe80::1', 6)).toBe(true)
    expect(isMinorAddress('fd00::1', 6)).toBe(false)
  })
})

describe('tags', () => {
  it('parses the colour map and tag style', () => {
    expect(parseColorMap('prod:FF0000:FFFFFF;dev:00ff00;bad:zz')).toEqual({
      prod: { bg: [255, 0, 0], fg: [255, 255, 255] },
      dev: { bg: [0, 255, 0] },
    })
    const style = parseTagStyle({ 'tag-style': { 'color-map': 'Prod:112233', ordering: 'alphabetical', shape: 'circle' } })
    expect(style).toMatchObject({ ordering: 'alphabetical', shape: 'circle', caseSensitive: false })
    expect(tagOverride('prod', style)).toEqual({ bg: [0x11, 0x22, 0x33] })
    expect(parseTagStyle({ 'tag-style': 'shape=dense,case-sensitive=1' })).toMatchObject({ shape: 'dense', caseSensitive: true })
    expect(parseTagStyle({}).ordering).toBe('config')
  })

  it('orders alphabetically when configured', () => {
    expect(orderTags(['b', 'A', 'c'], { ...parseTagStyle({}), ordering: 'alphabetical' })).toEqual(['A', 'b', 'c'])
    expect(orderTags(['b', 'A'], parseTagStyle({}))).toEqual(['b', 'A'])
  })

  it('matches the official colour hash', () => {
    // Proxmox.Utils.stringToRGB('test') in the official UI
    const [r, g, b] = stringToRgb('test')
    expect([r, g, b].every((c) => c >= 76.5 && c <= 255)).toBe(true)
    expect(stringToRgb('test')).toEqual(stringToRgb('test'))
    expect(stringToRgb('a')).not.toEqual(stringToRgb('b'))
    expect(contrastText([255, 255, 255])).toBe('dark')
    expect(contrastText([0, 0, 0])).toBe('light')
  })

  it('splits, joins and validates tags', () => {
    expect(splitTags('a;b, c  a')).toEqual(['a', 'b', 'c'])
    expect(joinTags(['a', 'b'])).toBe('a;b')
    expect(tagError('ok_1.2-x+', [])).toBeNull()
    expect(tagError('has space', [])).toMatch(/只能/)
    expect(tagError('Prod', ['prod'])).toBe('标签已存在')
    expect(tagError('Prod', ['prod'], true)).toBeNull()
    expect(tagError(' ', [])).toBe('请输入标签')
  })

  it('reads user-tag-access in both shapes', () => {
    expect(parseUserTagAccess({ 'user-tag-access': 'user-allow=list,user-allow-list=a;b' })).toEqual({ mode: 'list', list: ['a', 'b'] })
    expect(parseUserTagAccess({ 'user-tag-access': { 'user-allow': 'existing' } })).toEqual({ mode: 'existing', list: [] })
    expect(parseUserTagAccess({})).toEqual({ mode: 'free', list: [] })
  })

  it('bypasses user-tag-access only with Sys.Modify on "/"', () => {
    // Sys.Modify on one node is "Sys.Modify somewhere under /nodes" in the ticket caps,
    // but PVE checks "/": the restricted picker must stay.
    const nodeOnly = createPermissionChecker({ '/nodes/pve-lab': { 'Sys.Modify': 1 }, '/vms/100': { 'VM.Config.Options': 1 } }, {
      nodes: { 'Sys.Modify': 1 },
    })
    expect(bypassesTagAccess(nodeOnly, 'alice@pve')).toBe(false)
    expect(bypassesTagAccess(createPermissionChecker({ '/': { 'Sys.Modify': 1 } }, undefined), 'alice@pve')).toBe(true)
    expect(bypassesTagAccess(createPermissionChecker({}, undefined), 'root@pam')).toBe(true)
  })
})

describe('configDisks', () => {
  it('lists QEMU disks without CD-ROMs', () => {
    const disks = configDisks(
      {
        scsi0: 'local-lvm:base-9000-disk-0,size=1G',
        ide2: 'local:iso/alpine.iso,media=cdrom',
        efidisk0: 'local-lvm:vm-9000-disk-1,size=4M',
        net0: 'virtio=BC:24:11:00:00:01,bridge=vmbr0',
      },
      'qemu',
    )
    expect(disks.map((d) => [d.key, d.volume, d.size])).toEqual([
      ['efidisk0', 'local-lvm:vm-9000-disk-1', '4M'],
      ['scsi0', 'local-lvm:base-9000-disk-0', '1G'],
    ])
  })

  it('lists LXC rootfs first, then mount points', () => {
    const disks = configDisks({ mp0: 'local-lvm:vm-200-disk-1,mp=/data,size=2G', rootfs: 'local-lvm:vm-200-disk-0,size=1G' }, 'lxc')
    expect(disks.map((d) => d.key)).toEqual(['rootfs', 'mp0'])
  })
})

describe('configMemoryMiB', () => {
  it('falls back to the PVE default of 512 MiB for qemu and lxc', () => {
    expect(configMemoryMiB(undefined)).toBe(512)
    expect(configMemoryMiB('')).toBe(512)
    expect(configMemoryMiB('current=2048,min=1024')).toBe(2048)
    expect(configMemoryMiB(4096)).toBe(4096)
  })
})
