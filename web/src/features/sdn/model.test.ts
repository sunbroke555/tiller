import { describe, expect, it } from 'vitest'

import type { RouteMapEntry, SdnFabric, SdnFabricNode, SdnSubnet, SdnVnet, SdnZone } from '@/api/sdn'

import {
  controllerCreateParams,
  controllerForm,
  dnsCreateParams,
  dnsForm,
  fabricCreateParams,
  fabricForm,
  fabricNodeCreateParams,
  fabricNodeForm,
  fabricNodeUpdateParams,
  fabricUpdateParams,
  groupIpam,
  ipamCreateParams,
  ipamForm,
  nextPrefixSeq,
  parseDhcpRanges,
  parsePrefixListEntries,
  prefixEntryForm,
  prefixEntryParams,
  prefixEntryUpdateParams,
  routeMapCreateParams,
  routeMapForm,
  routeMapUpdateParams,
  subnetCreateParams,
  subnetForm,
  subnetUpdateParams,
  validateController,
  validateFabric,
  validateFabricNode,
  validatePrefixEntry,
  validateSdnId,
  validateSubnet,
  validateVnet,
  validateZone,
  vnetCreateParams,
  vnetForm,
  vnetTagMode,
  vnetUpdateParams,
  zoneCreateParams,
  zoneForm,
  zoneUpdateParams,
} from './model'
import { countPending, effective, pendingChanges } from './pending'

describe('pending state', () => {
  it('new objects take every value from pending', () => {
    const z = { zone: 'z1', type: 'simple', state: 'new', digest: null, pending: { ipam: 'pve', dhcp: 'dnsmasq' } } as unknown as SdnZone
    expect(effective(z)).toMatchObject({ zone: 'z1', ipam: 'pve', dhcp: 'dnsmasq' })
    expect(pendingChanges(z).map((c) => c.key).sort()).toEqual(['dhcp', 'ipam'])
  })

  it('new fabrics have even the id only in pending', () => {
    const f = { state: 'new', pending: { id: 'f1', protocol: 'openfabric', ip_prefix: '10.0.0.0/24' } } as unknown as SdnFabric
    expect(effective(f).id).toBe('f1')
  })

  it('changed objects: changed and removed keys; unchanged ones are not listed', () => {
    const z = { zone: 'z1', type: 'vlan', bridge: 'vmbr0', mtu: 1500, state: 'changed', pending: { bridge: 'vmbr0', mtu: 'deleted', nodes: 'a' } } as unknown as SdnZone
    const e = effective(z)
    expect(e.mtu).toBeUndefined()
    expect(e.nodes).toBe('a')
    expect(pendingChanges(z)).toEqual([
      { key: 'mtu', before: 1500, after: undefined },
      { key: 'nodes', before: undefined, after: 'a' },
    ])
  })

  it('deleted objects keep their running values and list no changes', () => {
    const v = { vnet: 'v1', zone: 'z1', state: 'deleted', pending: { zone: 'z2' } } as unknown as SdnVnet
    expect(effective(v).zone).toBe('z1')
    expect(pendingChanges(v)).toEqual([])
  })

  it('counts objects with a state across lists', () => {
    expect(countPending([{ state: 'new' }, {}], undefined, [{ state: 'deleted' }])).toBe(2)
  })
})

describe('zones', () => {
  it('validates ids (PVE: letter first, ≤ 8)', () => {
    expect(validateSdnId('e2esz1')).toBeNull()
    expect(validateSdnId('1abc')).not.toBeNull()
    expect(validateSdnId('abcdefghi')).not.toBeNull()
    expect(validateSdnId('ab-c')).not.toBeNull()
  })

  it('simple: automatic DHCP maps to dhcp=dnsmasq', () => {
    const f = { ...zoneForm(undefined, 'simple'), zone: 'e2esz1', dhcp: true, mtu: '1450' }
    expect(zoneCreateParams('simple', f)).toEqual({ type: 'simple', zone: 'e2esz1', ipam: 'pve', dhcp: 'dnsmasq', mtu: '1450' })
  })

  it('vlan needs a bridge; qinq a tag', () => {
    expect(validateZone('vlan', zoneForm(undefined, 'vlan'), false)).toHaveProperty('bridge')
    expect(validateZone('qinq', { ...zoneForm(undefined, 'qinq'), bridge: 'vmbr0' }, false)).toHaveProperty('tag')
  })

  it('qinq params', () => {
    const f = { ...zoneForm(undefined, 'qinq'), zone: 'q1', bridge: 'vmbr0', tag: '100', 'vlan-protocol': '802.1ad' }
    expect(zoneCreateParams('qinq', f)).toEqual({ type: 'qinq', zone: 'q1', ipam: 'pve', bridge: 'vmbr0', tag: '100', 'vlan-protocol': '802.1ad' })
  })

  it('vxlan normalizes the peer list', () => {
    const f = { ...zoneForm(undefined, 'vxlan'), zone: 'x1', peers: '10.0.0.1, 10.0.0.2  10.0.0.3' }
    expect(zoneCreateParams('vxlan', f).peers).toBe('10.0.0.1,10.0.0.2,10.0.0.3')
  })

  it('evpn requires controller and VRF VNI, checks the MAC', () => {
    const errs = validateZone('evpn', { ...zoneForm(undefined, 'evpn'), zone: 'ev1', mac: 'zz' }, true)
    expect(Object.keys(errs).sort()).toEqual(['controller', 'mac', 'vrf-vxlan'])
    const f = { ...zoneForm(undefined, 'evpn'), zone: 'ev1', controller: 'evpn1', 'vrf-vxlan': '10000', exitnodes: 'a,b', 'advertise-subnets': true }
    expect(zoneCreateParams('evpn', f)).toEqual({
      type: 'evpn',
      zone: 'ev1',
      ipam: 'pve',
      controller: 'evpn1',
      'vrf-vxlan': '10000',
      exitnodes: 'a,b',
      'advertise-subnets': 1,
    })
  })

  it('update sends changes and deletes cleared fields', () => {
    const before = { zone: 'z1', type: 'simple', ipam: 'pve', mtu: 1450, dhcp: 'dnsmasq', digest: 'abc' } as SdnZone
    const f = { ...zoneForm(before, 'simple'), mtu: '', dhcp: false, dnszone: 'lab.example' }
    expect(zoneUpdateParams(before, f)).toEqual({ dnszone: 'lab.example', delete: 'mtu,dhcp', digest: 'abc' })
    expect(zoneUpdateParams(before, zoneForm(before, 'simple'))).toBeNull()
  })
})

describe('vnets', () => {
  it('tag mode follows the zone type', () => {
    expect(vnetTagMode('simple')).toBe('none')
    expect(vnetTagMode('qinq')).toBe('optional')
    expect(vnetTagMode('vlan')).toBe('required')
    expect(vnetTagMode('evpn')).toBe('required')
  })

  it('create on a VLAN zone requires the tag', () => {
    const f = { ...vnetForm(undefined), vnet: 'e2ev1', zone: 'e2esz2' }
    expect(validateVnet(f, 'vlan', true)).toHaveProperty('tag')
    expect(vnetCreateParams({ ...f, tag: '3901', vlanaware: true }, 'vlan')).toEqual({ type: 'vnet', vnet: 'e2ev1', zone: 'e2esz2', tag: '3901', vlanaware: 1 })
  })

  it('simple zones drop the tag; evpn drops VLAN aware', () => {
    const before = { vnet: 'v1', type: 'vnet', zone: 'z1', tag: 5, vlanaware: 1 } as SdnVnet
    expect(vnetUpdateParams(before, vnetForm(before), 'simple')).toEqual({ delete: 'tag' })
    expect(vnetUpdateParams(before, vnetForm(before), 'evpn')).toEqual({ delete: 'vlanaware' })
  })
})

describe('subnets', () => {
  it('parses DHCP ranges in both shapes', () => {
    expect(parseDhcpRanges([{ 'start-address': '10.0.0.10', 'end-address': '10.0.0.20' }, 'start-address=10.0.0.30,end-address=10.0.0.40'])).toEqual([
      { 'start-address': '10.0.0.10', 'end-address': '10.0.0.20' },
      { 'start-address': '10.0.0.30', 'end-address': '10.0.0.40' },
    ])
  })

  it('create params with gateway, SNAT, ranges and DNS', () => {
    const f = {
      ...subnetForm(undefined),
      cidr: '10.250.1.0/24',
      gateway: '10.250.1.1',
      snat: true,
      dnszoneprefix: 'adm',
      'dhcp-dns-server': '10.250.1.1',
      ranges: [{ 'start-address': '10.250.1.10', 'end-address': '10.250.1.20' }],
    }
    expect(validateSubnet(f, true)).toEqual({})
    expect(subnetCreateParams(f)).toEqual({
      type: 'subnet',
      subnet: '10.250.1.0/24',
      gateway: '10.250.1.1',
      snat: 1,
      dnszoneprefix: 'adm',
      'dhcp-dns-server': '10.250.1.1',
      'dhcp-range': ['start-address=10.250.1.10,end-address=10.250.1.20'],
    })
  })

  it('validates CIDR, gateway and ranges', () => {
    const f = { ...subnetForm(undefined), cidr: '10.0.0.0', gateway: 'x', ranges: [{ 'start-address': '1.2.3.4', 'end-address': '' }] }
    expect(Object.keys(validateSubnet(f, true)).sort()).toEqual(['gateway', 'range-0', 'subnet'])
  })

  it('update: removing all ranges deletes dhcp-range', () => {
    const before = {
      subnet: 'z-10.0.0.0-24',
      type: 'subnet',
      vnet: 'v',
      gateway: '10.0.0.1',
      'dhcp-range': [{ 'start-address': '10.0.0.10', 'end-address': '10.0.0.20' }],
      digest: 'd',
    } as SdnSubnet
    expect(subnetUpdateParams(before, { ...subnetForm(before), ranges: [] })).toEqual({ delete: 'dhcp-range', digest: 'd' })
    expect(subnetUpdateParams(before, { ...subnetForm(before), gateway: '', snat: true })).toEqual({ snat: '1', delete: 'gateway', digest: 'd' })
    expect(subnetUpdateParams(before, subnetForm(before))).toBeNull()
  })
})

describe('controllers, IPAM, DNS', () => {
  it('bgp and isis ids derive from the node', () => {
    const f = { ...controllerForm(undefined, 'bgp'), node: 'pvelab-c1', peers: '192.0.2.1' }
    expect(controllerCreateParams('bgp', f)).toMatchObject({ type: 'bgp', controller: 'bgppvelab-c1', node: 'pvelab-c1', asn: '65000' })
    const isis = { ...controllerForm(undefined, 'isis'), node: 'n1', 'isis-domain': 'd', 'isis-net': '49.0001.1921.6800.1001.00', 'isis-ifaces': 'ens19 ens20' }
    expect(validateController('isis', isis, true)).toEqual({})
    expect(controllerCreateParams('isis', isis)).toMatchObject({ controller: 'isisn1', 'isis-ifaces': 'ens19,ens20' })
  })

  it('evpn validates id and asn', () => {
    expect(Object.keys(validateController('evpn', { ...controllerForm(undefined, 'evpn'), asn: '' }, true)).sort()).toEqual(['asn', 'controller'])
  })

  it('netbox / phpipam / powerdns create params', () => {
    expect(ipamCreateParams('netbox', { ...ipamForm(undefined, 'netbox'), ipam: 'nb', url: 'https://nb/api', token: 't' })).toEqual({
      type: 'netbox',
      ipam: 'nb',
      url: 'https://nb/api',
      token: 't',
    })
    expect(ipamCreateParams('phpipam', { ...ipamForm(undefined, 'phpipam'), ipam: 'php', url: 'u', token: 't', section: '3' })).toMatchObject({ section: '3' })
    expect(dnsCreateParams({ ...dnsForm(undefined), dns: 'pdns', url: 'http://pdns/api', key: 'k', ttl: '300' })).toEqual({
      type: 'powerdns',
      dns: 'pdns',
      url: 'http://pdns/api',
      key: 'k',
      ttl: '300',
    })
  })
})

describe('IPAM view', () => {
  it('groups entries zone → vnet → subnet, gateway first, IPs numerically', () => {
    const tree = groupIpam([
      { zone: 'z', vnet: 'v', subnet: '10.0.0.0/24', ip: '10.0.0.100', mac: 'aa', vmid: 101 },
      { zone: 'z', vnet: 'v', subnet: '10.0.0.0/24', ip: '10.0.0.9', mac: 'bb', vmid: 100 },
      { zone: 'z', vnet: 'v', subnet: '10.0.0.0/24', ip: '10.0.0.1', gateway: 1 },
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0]!.vnets[0]!.subnets[0]!.entries.map((e) => e.ip)).toEqual(['10.0.0.1', '10.0.0.9', '10.0.0.100'])
  })
})

describe('fabrics', () => {
  it('openfabric create with prefixes and intervals', () => {
    const f = fabricForm(undefined, 'openfabric')
    f.id = 'e2ef1'
    f.values.ip_prefix = '10.251.0.0/24'
    f.values.hello_interval = '3'
    expect(validateFabric('openfabric', f, true)).toEqual({})
    expect(fabricCreateParams('openfabric', f)).toEqual({ id: 'e2ef1', protocol: 'openfabric', ip_prefix: '10.251.0.0/24', hello_interval: '3' })
  })

  it('ospf needs an area and has no IPv6; redistribution as property strings', () => {
    const f = fabricForm(undefined, 'ospf')
    expect(f.values.area).toBe('0')
    expect(f.values).not.toHaveProperty('ip6_prefix')
    f.id = 'o1'
    f.values.ip_prefix = '10.0.0.0/24'
    f.redistribute = [{ source: 'connected' }, { source: 'static', 'route-map': 'rm1' }]
    expect(fabricCreateParams('ospf', f)).toEqual({
      id: 'o1',
      protocol: 'ospf',
      ip_prefix: '10.0.0.0/24',
      area: '0',
      redistribute: ['source=connected', 'source=static,route-map=rm1'],
    })
  })

  it('requires at least one prefix and a valid id', () => {
    const f = fabricForm(undefined, 'openfabric')
    f.id = '-x'
    expect(Object.keys(validateFabric('openfabric', f, true)).sort()).toEqual(['id', 'ip_prefix'])
  })

  it('update: delete as array, protocol always sent', () => {
    const before = { id: 'f', protocol: 'openfabric', ip_prefix: '10.0.0.0/24', hello_interval: 3, digest: 'd' } as SdnFabric
    const f = fabricForm(before, 'openfabric')
    f.values.hello_interval = ''
    f.values.csnp_interval = '10'
    expect(fabricUpdateParams(before, f)).toEqual({ csnp_interval: '10', delete: ['hello_interval'], protocol: 'openfabric', digest: 'd' })
    expect(fabricUpdateParams(before, fabricForm(before, 'openfabric'))).toBeNull()
  })

  it('fabric nodes: interfaces as property strings per protocol', () => {
    const f = fabricNodeForm(undefined)
    f.node_id = 'pvelab-c1'
    f.ip = '10.251.0.1'
    f.interfaces = [{ name: 'ens19', ip: '10.252.0.1/31', ip6: '', hello_multiplier: '10', listen_port: '', extra: {} }]
    expect(validateFabricNode('openfabric', f, true)).toEqual({})
    expect(fabricNodeCreateParams('openfabric', f)).toEqual({
      node_id: 'pvelab-c1',
      protocol: 'openfabric',
      ip: '10.251.0.1',
      interfaces: ['name=ens19,ip=10.252.0.1/31,hello_multiplier=10'],
    })
    expect(fabricNodeCreateParams('ospf', f).interfaces).toEqual(['name=ens19,ip=10.252.0.1/31'])
    expect(fabricNodeCreateParams('bgp', f).interfaces).toEqual(['name=ens19'])
  })

  it('fabric node update removes interfaces with delete', () => {
    const before = { fabric_id: 'f', node_id: 'n', protocol: 'openfabric', ip: '10.0.0.1', interfaces: ['name=ens19'] } as SdnFabricNode
    const f = fabricNodeForm(before)
    f.interfaces = []
    expect(fabricNodeUpdateParams(before, f)).toEqual({ delete: ['interfaces'], protocol: 'openfabric' })
  })

  it('wireguard external peers', () => {
    const f = { ...fabricNodeForm(undefined), node_id: 'ext1', role: 'external' as const, public_key: 'abc=', endpoint: '198.51.100.1:51820', allowed_ips: '10.9.0.0/24, 10.8.0.0/24' }
    expect(validateFabricNode('wireguard', f, true)).toEqual({})
    expect(fabricNodeCreateParams('wireguard', f)).toEqual({
      node_id: 'ext1',
      protocol: 'wireguard',
      endpoint: '198.51.100.1:51820',
      public_key: 'abc=',
      role: 'external',
      allowed_ips: ['10.9.0.0/24', '10.8.0.0/24'],
    })
  })
})

describe('route maps', () => {
  it('create params with match, set and exit action', () => {
    const f = routeMapForm(undefined)
    Object.assign(f, {
      id: 'e2erm',
      order: '10',
      match: [{ key: 'ip-address-prefix-list', value: 'e2epl' }],
      set: [{ key: 'metric', value: '10' }, { key: 'ip-next-hop-unchanged', value: 'x' }],
      exitKey: 'on-match-goto',
      exitValue: '20',
    })
    expect(routeMapCreateParams(f)).toEqual({
      'route-map-id': 'e2erm',
      order: 10,
      action: 'permit',
      match: ['key=ip-address-prefix-list,value=e2epl'],
      set: ['key=metric,value=10', 'key=ip-next-hop-unchanged'],
      'exit-action': 'key=on-match-goto,value=20',
    })
  })

  it('update clears lists with delete', () => {
    const before = { 'route-map-id': 'rm', order: 10, action: 'permit', match: ['key=metric,value=5'], set: ['key=tag,value=1'], digest: 'd' } as RouteMapEntry
    const f = routeMapForm(before)
    expect(f.match).toEqual([{ key: 'metric', value: '5' }])
    f.match = []
    f.action = 'deny'
    expect(routeMapUpdateParams(before, f)).toEqual({ action: 'deny', delete: ['match'], digest: 'd' })
    expect(routeMapUpdateParams(before, routeMapForm(before))).toBeNull()
  })
})

describe('prefix lists', () => {
  it('parses and sorts entries; next seq steps by 5', () => {
    const entries = parsePrefixListEntries(['action=deny,prefix=10.1.0.0/16,seq=10', 'action=permit,prefix=10.0.0.0/8,le=24,seq=5'])
    expect(entries).toEqual([
      { seq: 5, action: 'permit', prefix: '10.0.0.0/8', le: 24 },
      { seq: 10, action: 'deny', prefix: '10.1.0.0/16' },
    ])
    expect(nextPrefixSeq(entries)).toBe(15)
  })

  it('validates ge/le against the prefix length', () => {
    expect(validatePrefixEntry({ ...prefixEntryForm(undefined), prefix: '10.0.0.0/8', ge: '4', le: '33' })).toEqual({ ge: '不能小于前缀长度 8', le: '0–32' })
    expect(validatePrefixEntry({ ...prefixEntryForm(undefined), prefix: '10.0.0.0/8', ge: '24', le: '16' })).toEqual({ le: '不能小于 ge' })
  })

  it('entry params and updates', () => {
    expect(prefixEntryParams({ seq: '5', action: 'permit', prefix: '10.0.0.0/8', ge: '', le: '24' })).toEqual({ seq: 5, action: 'permit', prefix: '10.0.0.0/8', le: 24 })
    const before = { seq: 5, action: 'permit' as const, prefix: '10.0.0.0/8', le: 24 }
    expect(prefixEntryUpdateParams(before, { ...prefixEntryForm(before), le: '', action: 'deny' })).toEqual({ action: 'deny', delete: ['le'] })
  })
})
