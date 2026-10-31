import { describe, expect, it } from 'vitest'

import { configUpdateParams } from '@/lib/propstring'

import { formatKeyValue, keyLabel, tabOfKey } from './labels'
import {
  deviceToForm,
  describeFeatures,
  describeIp,
  describeStartup,
  diskKeys,
  formToDevice,
  formToMount,
  formToNet,
  isDnsName,
  isIPv4Cidr,
  isIPv6,
  isIPv6Cidr,
  isUnicastMac,
  liveAddresses,
  mountFlags,
  mountKind,
  mountPaths,
  mountToForm,
  netNames,
  netToForm,
  newMountForm,
  newNetForm,
  nextFreeIndex,
  normalizeNameservers,
  parseEnv,
  parseFeatures,
  parseIdMap,
  parseLxcMount,
  parseLxcNet,
  parsePending,
  parseStartup,
  stringifyEnv,
  stringifyFeatures,
  stringifyIdMap,
  stringifyStartup,
  validateDeviceForm,
  validateEnv,
  validateMountForm,
  validateNameservers,
  validateNetForm,
} from './model'

// Real responses from the lab (CT 200, PVE 9.2).
const CT200_PENDING = [
  { key: 'onboot', value: 0 },
  { key: 'digest', value: 'ec141c53f3869d12e45e10ffde9a17ee4369758b' },
  { key: 'memory', value: 128 },
  { key: 'swap', value: 0 },
  { key: 'arch', value: 'amd64' },
  { key: 'unprivileged', value: 1 },
  { key: 'cores', value: 1 },
  { key: 'hostname', value: 'alpine-ct' },
  { key: 'rootfs', value: 'local-lvm:vm-200-disk-0,size=1G' },
  { key: 'net0', value: 'name=eth0,bridge=vmbr0,hwaddr=BC:24:11:C8:B8:4B,ip=manual,type=veth' },
  { key: 'ostype', value: 'alpine' },
]

describe('parsePending', () => {
  it('splits digest, current and effective config', () => {
    const c = parsePending(CT200_PENDING)
    expect(c.digest).toBe('ec141c53f3869d12e45e10ffde9a17ee4369758b')
    expect(c.current.memory).toBe('128')
    expect(c.effective.rootfs).toBe('local-lvm:vm-200-disk-0,size=1G')
    expect(c.effective).not.toHaveProperty('digest')
    expect(c.changes).toEqual([])
  })

  it('reports pending values and deletes', () => {
    const c = parsePending([
      { key: 'memory', value: 512, pending: 1024 },
      { key: 'mp0', value: 'local-lvm:vm-1-disk-1,mp=/data', delete: 1 },
      { key: 'mp1', pending: 'local-lvm:vm-1-disk-2,mp=/new' },
      { key: 'swap', value: 0, pending: 0 },
    ])
    expect(c.effective.memory).toBe('1024')
    expect(c.current.memory).toBe('512')
    expect(c.effective).not.toHaveProperty('mp0')
    expect(c.current.mp0).toContain('mp=/data')
    expect(c.effective.mp1).toContain('mp=/new')
    expect(c.changes).toEqual([
      { key: 'memory', current: '512', next: '1024', delete: false },
      { key: 'mp0', current: 'local-lvm:vm-1-disk-1,mp=/data', next: undefined, delete: true },
      { key: 'mp1', current: undefined, next: 'local-lvm:vm-1-disk-2,mp=/new', delete: false },
    ])
  })

  it('handles an empty response', () => {
    expect(parsePending(undefined)).toEqual({ digest: undefined, current: {}, effective: {}, changes: [] })
  })
})

describe('config updates from the effective config', () => {
  const { effective, digest } = parsePending(CT200_PENDING)

  it('sends only changed keys with the digest', () => {
    expect(configUpdateParams(effective, { memory: 256, swap: 0 }, { digest })).toEqual({ memory: '256', digest })
  })

  it('deletes cleared keys (cpulimit 0 → unset)', () => {
    const cfg = { ...effective, cpulimit: '2', cpuunits: '200' }
    expect(configUpdateParams(cfg, { cores: 1, cpulimit: undefined, cpuunits: undefined })).toEqual({
      delete: 'cpulimit,cpuunits',
    })
  })

  it('returns null when nothing changed', () => {
    expect(configUpdateParams(effective, { hostname: 'alpine-ct' }, { digest })).toBeNull()
  })
})

describe('slots', () => {
  it('finds the next free index', () => {
    expect(nextFreeIndex({ mp0: 'x', mp1: 'y', mp3: 'z' }, 'mp')).toBe(2)
    expect(nextFreeIndex({}, 'dev')).toBe(0)
    expect(nextFreeIndex({ net0: 'a' }, 'net', ['net1'])).toBe(2)
    const full = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`net${i}`, 'x']))
    expect(nextFreeIndex(full, 'net')).toBeNull()
  })

  it('orders disks: rootfs, mount points, unused (numerically)', () => {
    expect(diskKeys({ unused0: 'a', mp10: 'b', mp2: 'c', rootfs: 'd', memory: '1' })).toEqual(['rootfs', 'mp2', 'mp10', 'unused0'])
  })
})

describe('validators', () => {
  it('IPv4 / IPv6 with prefix', () => {
    expect(isIPv4Cidr('192.168.1.10/24')).toBe(true)
    expect(isIPv4Cidr('192.168.1.10')).toBe(false)
    expect(isIPv4Cidr('256.1.1.1/24')).toBe(false)
    expect(isIPv4Cidr('10.0.0.1/33')).toBe(false)
    expect(isIPv6Cidr('fd00::10/64')).toBe(true)
    expect(isIPv6Cidr('2001:db8:0:0:0:0:0:1/128')).toBe(true)
    expect(isIPv6Cidr('fd00::10/129')).toBe(false)
    expect(isIPv6('::1')).toBe(true)
    expect(isIPv6('::ffff:192.168.1.1')).toBe(true)
    expect(isIPv6('fe80::1::2')).toBe(false)
    expect(isIPv6('1:2:3:4:5:6:7:8:9')).toBe(false)
    expect(isIPv6('fd00:')).toBe(false)
    expect(isIPv6('1.2.3.4')).toBe(false)
  })

  it('MAC addresses must be unicast', () => {
    expect(isUnicastMac('BC:24:11:C8:B8:4B')).toBe(true)
    expect(isUnicastMac('01:00:5e:00:00:01')).toBe(false)
    expect(isUnicastMac('BC:24:11:C8:B8')).toBe(false)
  })

  it('host names', () => {
    expect(isDnsName('alpine-ct')).toBe(true)
    expect(isDnsName('web.example.com')).toBe(true)
    expect(isDnsName('-bad')).toBe(false)
    expect(isDnsName('under_score')).toBe(false)
  })

  it('normalizes and validates DNS servers', () => {
    expect(normalizeNameservers(' 1.1.1.1, 8.8.8.8;fd00::53 ')).toBe('1.1.1.1 8.8.8.8 fd00::53')
    expect(normalizeNameservers(undefined)).toBe('')
    expect(validateNameservers('1.1.1.1 fe80::1%eth0')).toBeNull()
    expect(validateNameservers('1.1.1.1 dns.google')).toBe('不是有效的 IP 地址：dns.google')
  })
})

describe('network', () => {
  const lab = 'name=eth0,bridge=vmbr0,hwaddr=BC:24:11:C8:B8:4B,ip=manual,type=veth'

  it('parses net[n]', () => {
    expect(parseLxcNet(lab)).toMatchObject({ name: 'eth0', bridge: 'vmbr0', ip: 'manual', firewall: false, type: 'veth' })
    expect(parseLxcNet('name=eth1,bridge=vmbr1,firewall=1,tag=20,trunks=10;20,link_down=1').trunks).toEqual(['10', '20'])
  })

  it('maps the address modes', () => {
    expect(netToForm(lab)).toMatchObject({ ip4mode: 'manual', ip: '', ip6mode: 'none' })
    expect(netToForm('name=eth0,bridge=vmbr0,ip=dhcp,ip6=auto')).toMatchObject({ ip4mode: 'dhcp', ip6mode: 'auto' })
    expect(netToForm('name=eth0,bridge=vmbr0,ip=10.0.0.5/24,gw=10.0.0.1,ip6=dhcp')).toMatchObject({
      ip4mode: 'static',
      ip: '10.0.0.5/24',
      gw: '10.0.0.1',
      ip6mode: 'dhcp',
    })
  })

  it('round-trips an unchanged NIC exactly', () => {
    expect(formToNet(netToForm(lab), lab)).toBe(lab)
  })

  it('edits keep unknown keys and order, drop cleared ones', () => {
    const form = { ...netToForm(lab), ip4mode: 'static' as const, ip: '192.168.0.50/24', gw: '192.168.0.1', tag: 30, firewall: true }
    expect(formToNet(form, lab)).toBe(
      'name=eth0,bridge=vmbr0,hwaddr=BC:24:11:C8:B8:4B,ip=192.168.0.50/24,type=veth,gw=192.168.0.1,tag=30,firewall=1',
    )
    const off = { ...netToForm('name=eth0,bridge=vmbr0,ip=dhcp,firewall=1,rate=5'), ip4mode: 'none' as const, firewall: false, rate: undefined }
    expect(formToNet(off, 'name=eth0,bridge=vmbr0,ip=dhcp,firewall=1,rate=5')).toBe('name=eth0,bridge=vmbr0')
  })

  it('builds a new NIC', () => {
    const form = { ...newNetForm('eth1'), bridge: 'vmbr0', ip4mode: 'dhcp' as const, ip6mode: 'auto' as const, mtu: 1400, trunks: '10; 20', linkDown: true }
    expect(formToNet(form)).toBe('name=eth1,bridge=vmbr0,ip=dhcp,ip6=auto,firewall=1,link_down=1,mtu=1400,trunks=10;20')
  })

  it('validates the form', () => {
    const ok = { ...newNetForm('eth1'), bridge: 'vmbr0' }
    expect(validateNetForm(ok, ['eth0'])).toEqual({})
    expect(validateNetForm({ ...ok, name: 'eth0' }, ['eth0']).name).toBeTruthy()
    expect(validateNetForm({ ...ok, bridge: '' }, []).bridge).toBeTruthy()
    expect(validateNetForm({ ...ok, ip4mode: 'static', ip: '10.0.0.1' }, []).ip).toBeTruthy()
    expect(validateNetForm({ ...ok, ip6mode: 'static', ip6: 'fd00::1/64', gw6: 'nope' }, []).gw6).toBeTruthy()
    expect(validateNetForm({ ...ok, tag: 5000 }, []).tag).toBeTruthy()
    expect(validateNetForm({ ...ok, mtu: 100 }, []).mtu).toBeTruthy()
    expect(validateNetForm({ ...ok, trunks: '10;abc' }, []).trunks).toBeTruthy()
    expect(validateNetForm({ ...ok, hwaddr: '01:00:00:00:00:01' }, []).hwaddr).toBeTruthy()
  })

  it('lists NIC names of other NICs', () => {
    expect(netNames({ net0: 'name=eth0,bridge=vmbr0', net1: 'name=eth1', memory: '1' }, 'net1')).toEqual(['eth0'])
  })

  it('matches live addresses by MAC', () => {
    // GET /interfaces of CT 200 in the lab.
    const ifaces = [
      { name: 'lo', 'hardware-address': '00:00:00:00:00:00', 'ip-addresses': [{ 'ip-address': '127.0.0.1', 'ip-address-type': 'inet', prefix: '8' }] },
      {
        name: 'eth0',
        'hardware-address': 'bc:24:11:c8:b8:4b',
        'ip-addresses': [
          { 'ip-address': '2409:8a28:20c3:ed50:be24:11ff:fec8:b84b', 'ip-address-type': 'inet6', prefix: '64' },
          { 'ip-address': 'fe80::be24:11ff:fec8:b84b', 'ip-address-type': 'inet6', prefix: '64' },
        ],
      },
    ]
    const live = liveAddresses(parseLxcNet(lab), ifaces)
    expect(live).toEqual([
      { address: '2409:8a28:20c3:ed50:be24:11ff:fec8:b84b/64', family: 6, static: false, linkLocal: false },
      { address: 'fe80::be24:11ff:fec8:b84b/64', family: 6, static: false, linkLocal: true },
    ])
    expect(liveAddresses(parseLxcNet('name=eth0,bridge=vmbr0,ip=10.0.0.2/24,hwaddr=AA:00:00:00:00:01'), [
      { name: 'eth0', hwaddr: 'aa:00:00:00:00:01', 'ip-addresses': [{ 'ip-address': '10.0.0.2', 'ip-address-type': 'inet', prefix: 24 }] },
    ])?.[0]?.static).toBe(true)
    expect(liveAddresses(parseLxcNet(lab), undefined)).toBeNull()
  })

  it('describes address settings', () => {
    expect(describeIp('')).toBe('无')
    expect(describeIp('dhcp')).toBe('DHCP')
    expect(describeIp('auto', true)).toBe('SLAAC')
    expect(describeIp('manual')).toBe('手动')
    expect(describeIp('10.0.0.1/24')).toBe('10.0.0.1/24')
  })
})

describe('mount points', () => {
  it('parses rootfs and mount points', () => {
    expect(parseLxcMount('local-lvm:vm-200-disk-0,size=1G')).toEqual({ volume: 'local-lvm:vm-200-disk-0', size: '1G' })
    expect(parseLxcMount('volume=local:200/vm-200-disk-1.raw,mp=/data').volume).toBe('local:200/vm-200-disk-1.raw')
    expect(mountKind('local-lvm:vm-200-disk-0')).toBe('volume')
    expect(mountKind('/srv/share')).toBe('bind')
    expect(mountKind('/dev/sdb1')).toBe('device')
  })

  it('creates a new volume as storage:GiB', () => {
    const form = { ...newMountForm(), storage: 'local-lvm', sizeGiB: 0.5, mp: '/data', backup: true }
    expect(formToMount(form, { key: 'mp0' })).toBe('local-lvm:0.5,mp=/data,backup=1')
  })

  it('creates a bind mount', () => {
    const form = { ...newMountForm(), kind: 'bind' as const, hostPath: '/srv/share', mp: '/mnt/share', backup: true, ro: true, shared: true, acl: '1' as const }
    // backup and acl do not apply to bind mounts.
    expect(formToMount(form, { key: 'mp1' })).toBe('/srv/share,mp=/mnt/share,ro=1,shared=1')
  })

  it('attaches an unused volume', () => {
    const form = { ...newMountForm(), mp: '/old', backup: false }
    expect(formToMount(form, { key: 'mp2', volume: 'local-lvm:vm-200-disk-3' })).toBe('local-lvm:vm-200-disk-3,mp=/old')
  })

  it('edits keep volume, size and unknown keys', () => {
    const prev = 'local-lvm:vm-200-disk-1,mp=/data,backup=1,size=8G,mountoptions=noatime'
    const form = mountToForm(prev)
    expect(form).toMatchObject({ kind: 'volume', storage: 'local-lvm', mp: '/data', backup: true, mountoptions: ['noatime'] })
    expect(formToMount(form, { key: 'mp0', previous: prev })).toBe(prev)
    const changed = { ...form, mp: '/srv', backup: false, ro: true, mountoptions: ['noatime', 'nosuid'], acl: '0' as const, skipReplication: true }
    expect(formToMount(changed, { key: 'mp0', previous: prev })).toBe(
      'local-lvm:vm-200-disk-1,mp=/srv,size=8G,mountoptions=noatime;nosuid,ro=1,acl=0,replicate=0',
    )
  })

  it('rootfs never gets mp/backup and drops nodev/noexec', () => {
    const prev = 'local-lvm:vm-200-disk-0,size=1G'
    const form = { ...mountToForm(prev), mp: '/x', mountoptions: ['noatime', 'nodev', 'noexec', 'discard'], quota: true }
    expect(formToMount(form, { key: 'rootfs', previous: prev })).toBe('local-lvm:vm-200-disk-0,size=1G,quota=1,mountoptions=noatime;discard')
  })

  it('writes idmap entries', () => {
    expect(parseIdMap('u:0:100000:65536;g:0:100000:65536')).toEqual([
      { type: 'u', ct: 0, host: 100000, length: 65536 },
      { type: 'g', ct: 0, host: 100000, length: 65536 },
    ])
    expect(parseIdMap('')).toEqual([])
    expect(parseIdMap('x:1:2:3')).toBeNull()
    expect(stringifyIdMap([{ type: 'u', ct: 1000, host: 1000, length: 1 }])).toBe('u:1000:1000:1')
    const form = { ...newMountForm(), storage: 'st', sizeGiB: 1, mp: '/a', idmap: 'passthrough' }
    expect(formToMount(form, { key: 'mp0' })).toBe('st:1,mp=/a,backup=1,idmap=passthrough')
  })

  it('validates', () => {
    const base = { ...newMountForm(), storage: 'local-lvm', mp: '/data' }
    expect(validateMountForm(base, { isRoot: false, isCreate: true, otherPaths: [] })).toEqual({})
    expect(validateMountForm({ ...base, mp: 'data' }, { isRoot: false, isCreate: true, otherPaths: [] }).mp).toBeTruthy()
    expect(validateMountForm({ ...base, mp: '/data/' }, { isRoot: false, isCreate: true, otherPaths: ['/data'] }).mp).toBeTruthy()
    expect(validateMountForm({ ...base, sizeGiB: 0 }, { isRoot: false, isCreate: true, otherPaths: [] }).sizeGiB).toBeTruthy()
    expect(validateMountForm({ ...base, kind: 'bind', hostPath: 'rel' }, { isRoot: false, isCreate: true, otherPaths: [] }).hostPath).toBeTruthy()
    expect(validateMountForm({ ...base, mp: '' }, { isRoot: true, isCreate: false, otherPaths: [] })).toEqual({})
    expect(validateMountForm({ ...base, idmap: 'u:0' }, { isRoot: false, isCreate: true, otherPaths: [] }).idmap).toBeTruthy()
  })

  it('collects flags and paths for display', () => {
    expect(mountFlags(parseLxcMount('local-lvm:vm-1-disk-1,mp=/d,backup=1,ro=1,mountoptions=noatime'), false)).toEqual([
      '备份',
      '只读',
      'noatime',
    ])
    expect(mountFlags(parseLxcMount('local-lvm:vm-1-disk-0,size=1G'), true)).toEqual([])
    expect(mountPaths({ mp0: 's:1,mp=/a/', mp1: '/srv,mp=/b', rootfs: 'x' }, 'mp1')).toEqual(['/a'])
  })
})

describe('devices', () => {
  it('round-trips dev[n]', () => {
    const form = deviceToForm('/dev/dri/renderD128,gid=104,mode=0660')
    expect(form).toEqual({ path: '/dev/dri/renderD128', uid: undefined, gid: 104, mode: '0660', denyWrite: false })
    expect(formToDevice({ ...form, denyWrite: true, uid: 0 })).toBe('/dev/dri/renderD128,deny-write=1,gid=104,mode=0660,uid=0')
  })

  it('validates', () => {
    expect(validateDeviceForm(deviceToForm('/dev/null'))).toEqual({})
    expect(validateDeviceForm(deviceToForm('/tmp/x')).path).toBeTruthy()
    expect(validateDeviceForm({ ...deviceToForm('/dev/null'), mode: '777' }).mode).toBeTruthy()
  })
})

describe('options', () => {
  it('startup', () => {
    expect(parseStartup('order=2,up=30')).toEqual({ order: 2, up: 30, down: undefined })
    expect(parseStartup('3,down=60')).toEqual({ order: 3, up: undefined, down: 60 })
    expect(stringifyStartup({ order: 1, up: undefined, down: 10 })).toBe('order=1,down=10')
    expect(stringifyStartup({ order: undefined, up: undefined, down: undefined })).toBe('')
    expect(describeStartup(undefined)).toBe('默认（顺序不限）')
    expect(describeStartup('order=2,up=30')).toBe('顺序 2 · 启动后等待 30 秒')
  })

  it('features keep unknown mount types', () => {
    const f = parseFeatures('nesting=1,mount=nfs;ext4')
    expect(f).toMatchObject({ nesting: true, nfs: true, cifs: false, otherMounts: ['ext4'] })
    expect(stringifyFeatures({ ...f, keyctl: true, cifs: true })).toBe('keyctl=1,mount=ext4;nfs;cifs,nesting=1')
    expect(stringifyFeatures(parseFeatures(''))).toBe('')
    expect(describeFeatures('nesting=1,keyctl=1')).toBe('嵌套、keyctl')
    expect(describeFeatures(undefined)).toBe('无')
  })

  it('env is a NUL separated list', () => {
    const vars = parseEnv('PATH=/usr/bin:/bin\0TZ=UTC\0EMPTY=')
    expect(vars).toEqual([
      { name: 'PATH', value: '/usr/bin:/bin' },
      { name: 'TZ', value: 'UTC' },
      { name: 'EMPTY', value: '' },
    ])
    expect(stringifyEnv([...vars, { name: ' ', value: '' }])).toBe('PATH=/usr/bin:/bin\0TZ=UTC\0EMPTY=')
    expect(validateEnv([{ name: 'A-B', value: '1' }, { name: 'X', value: '1' }, { name: 'X', value: '2' }, { name: '', value: 'v' }])).toEqual({
      0: '变量名只能包含字母、数字和下划线',
      2: '变量名重复',
      3: '请填写变量名',
    })
  })

  it('labels keys and routes them to tabs', () => {
    expect(keyLabel('mp3')).toBe('挂载点 mp3')
    expect(keyLabel('unused0')).toBe('未使用的磁盘 0')
    expect(keyLabel('memory')).toBe('内存')
    expect(formatKeyValue('memory', '512')).toBe('512 MiB')
    expect(formatKeyValue('onboot', '1')).toBe('是')
    expect(formatKeyValue('cmode', undefined)).toBe('（未设置）')
    expect(tabOfKey('net0')).toBe('network')
    expect(tabOfKey('unused1')).toBe('resources')
    expect(tabOfKey('nameserver')).toBe('dns')
    expect(tabOfKey('features')).toBe('options')
    expect(tabOfKey('description')).toBeNull()
  })
})
