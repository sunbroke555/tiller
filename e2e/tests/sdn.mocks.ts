import type { Page } from '@playwright/test'

// Mocked SDN API for the phone checks and the screenshots: a running simple
// zone with a VNet, subnet and IPAM entries, a pending VLAN zone, a changed
// EVPN zone, controllers, external IPAM/DNS plugins, an OpenFabric fabric,
// a route map and a prefix list. Writes answer 403 (phones never write).

export const SDN_MOCK = {
  zones: [
    { zone: 'lab', type: 'simple', ipam: 'pve', dhcp: 'dnsmasq', digest: 'a' },
    { zone: 'tenants', type: 'vlan', state: 'new', digest: null, pending: { bridge: 'vmbr0', ipam: 'pve', mtu: 1500 } },
    { zone: 'evpn1', type: 'evpn', controller: 'evpnctl', 'vrf-vxlan': 10000, ipam: 'pve', mtu: 1450, state: 'changed', pending: { mtu: 1400, exitnodes: 'pvelab-c1' } },
  ],
  vnets: [
    { vnet: 'labnet', type: 'vnet', zone: 'lab', alias: '实验网', digest: 'b' },
    { vnet: 'tenant1', type: 'vnet', state: 'new', digest: null, pending: { zone: 'tenants', tag: 3901 } },
    { vnet: 'web', type: 'vnet', zone: 'evpn1', tag: 20000, digest: 'c' },
  ],
  subnets: {
    labnet: [
      {
        subnet: 'lab-10.20.0.0-24',
        id: 'lab-10.20.0.0-24',
        type: 'subnet',
        cidr: '10.20.0.0/24',
        vnet: 'labnet',
        zone: 'lab',
        gateway: '10.20.0.1',
        snat: 1,
        'dhcp-range': [{ 'start-address': '10.20.0.100', 'end-address': '10.20.0.199' }],
        digest: 'd',
      },
    ],
    web: [{ subnet: 'evpn1-10.30.0.0-24', type: 'subnet', cidr: '10.30.0.0/24', vnet: 'web', zone: 'evpn1', gateway: '10.30.0.1', digest: 'e' }],
  } as Record<string, unknown[]>,
  controllers: [
    { controller: 'evpnctl', type: 'evpn', asn: 65000, peers: '10.0.0.1,10.0.0.2,10.0.0.3', digest: 'f' },
    { controller: 'bgppvelab-c1', type: 'bgp', node: 'pvelab-c1', asn: 65001, peers: '192.0.2.1', ebgp: 1, state: 'new', pending: {} },
  ],
  ipams: [
    { ipam: 'pve', type: 'pve', digest: 'g' },
    { ipam: 'netbox', type: 'netbox', url: 'https://netbox.example/api', token: 'x', digest: 'h' },
  ],
  dns: [{ dns: 'pdns', type: 'powerdns', url: 'http://pdns.example:8081/api/v1/servers/localhost', key: 'k', ttl: 300, digest: 'i' }],
  ipamStatus: [
    { zone: 'lab', vnet: 'labnet', subnet: '10.20.0.0/24', ip: '10.20.0.1', gateway: 1 },
    { zone: 'lab', vnet: 'labnet', subnet: '10.20.0.0/24', ip: '10.20.0.101', mac: 'BC:24:11:AA:00:01', vmid: 100, hostname: 'tiny-vm' },
    { zone: 'lab', vnet: 'labnet', subnet: '10.20.0.0/24', ip: '10.20.0.102', mac: 'BC:24:11:AA:00:02', vmid: 101, hostname: 'tiny-vm-2' },
  ],
  fabrics: {
    fabrics: [
      { id: 'under', protocol: 'openfabric', ip_prefix: '10.10.0.0/24', hello_interval: 3, digest: 'j' },
      { state: 'new', digest: 'k', pending: { id: 'ospf1', protocol: 'ospf', ip_prefix: '10.11.0.0/24', area: '0', redistribute: ['source=connected'] } },
    ],
    nodes: [
      { fabric_id: 'under', node_id: 'pvelab-c1', protocol: 'openfabric', ip: '10.10.0.1', interfaces: ['name=ens19', 'name=ens20'], digest: 'j' },
      { fabric_id: 'under', node_id: 'pvelab-c2', protocol: 'openfabric', ip: '10.10.0.2', interfaces: ['name=ens19', 'name=ens20'], digest: 'j' },
      { fabric_id: 'under', node_id: 'pvelab-c3', protocol: 'openfabric', ip: '10.10.0.3', interfaces: ['name=ens19', 'name=ens20'], digest: 'j' },
    ],
  },
  routeMaps: [
    { 'route-map-id': 'rm-out', order: 10, action: 'permit', match: ['key=ip-address-prefix-list,value=lan'], set: ['key=metric,value=50'], digest: 'l' },
    { 'route-map-id': 'rm-out', order: 20, action: 'deny', digest: 'l' },
  ],
  prefixLists: [{ id: 'lan', type: 'prefix-list', entries: ['action=permit,prefix=10.0.0.0/8,le=24,seq=5', 'action=deny,prefix=0.0.0.0/0,seq=10'], digest: 'm' }],
  routes: [
    { route: '10.10.0.2/32', via: ['10.10.0.2'] },
    { route: '10.10.0.3/32', via: ['10.10.0.3'] },
  ],
  neighbors: [
    { neighbor: 'pvelab-c2', status: 'Up', uptime: '2h13m' },
    { neighbor: 'pvelab-c3', status: 'Up', uptime: '2h12m' },
  ],
}

export const SDN_STATUS = ['pvelab-c1', 'pvelab-c2', 'pvelab-c3'].flatMap((node) => [
  { id: `network/${node}/zone/localnetwork`, type: 'network', network: 'localnetwork', 'network-type': 'zone', node, status: 'ok' },
  { id: `network/${node}/zone/lab`, type: 'network', network: 'lab', 'network-type': 'zone', node, status: 'ok' },
  { id: `network/${node}/zone/evpn1`, type: 'network', network: 'evpn1', 'network-type': 'zone', node, status: node === 'pvelab-c3' ? 'error' : 'ok' },
  { id: `network/${node}/fabric/under`, type: 'network', network: 'under', 'network-type': 'fabric', node, status: 'ok' },
])

/** Route the SDN API to the mock (and add the SDN status entries to /cluster/resources). */
export async function mockSdn(page: Page) {
  await page.route('**/api2/json/cluster/resources*', async (route) => {
    const res = await route.fetch()
    const body = (await res.json()) as { data: { type: string }[] }
    await route.fulfill({ response: res, json: { data: [...body.data.filter((r) => r.type !== 'network' && r.type !== 'sdn'), ...SDN_STATUS] } })
  })
  await page.route('**/api2/json/cluster/sdn/**', (route) => {
    const req = route.request()
    if (req.method() !== 'GET') return route.fulfill({ status: 403, json: { data: null, message: 'mock: read-only' } })
    const path = new URL(req.url()).pathname.replace('/api2/json/cluster/sdn/', '')
    const data = (() => {
      if (path === 'zones') return SDN_MOCK.zones
      if (path === 'vnets') return SDN_MOCK.vnets
      const sub = /^vnets\/([^/]+)\/subnets$/.exec(path)
      if (sub) return SDN_MOCK.subnets[sub[1]!] ?? []
      if (path === 'controllers') return SDN_MOCK.controllers
      if (path === 'ipams') return SDN_MOCK.ipams
      if (path === 'ipams/pve/status') return SDN_MOCK.ipamStatus
      if (path === 'dns') return SDN_MOCK.dns
      if (path === 'fabrics/all') return SDN_MOCK.fabrics
      if (path === 'route-maps/entries') return SDN_MOCK.routeMaps
      if (path === 'prefix-lists') return SDN_MOCK.prefixLists
      if (path === 'dry-run') return { 'frr-diff': '--- a\n+++ b\n@@ -1 +1,2 @@\n frr version 10\n+router openfabric under', 'interfaces-diff': '--- a\n+++ b\n+auto tenant1\n+iface tenant1' }
      return null
    })()
    if (data === null) return route.fallback()
    return route.fulfill({ json: { data } })
  })
  await page.route('**/api2/json/nodes/*/sdn/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/routes')) return route.fulfill({ json: { data: SDN_MOCK.routes } })
    if (path.endsWith('/neighbors')) return route.fulfill({ json: { data: SDN_MOCK.neighbors } })
    if (path.endsWith('/interfaces')) return route.fulfill({ json: { data: [{ name: 'ens19', state: 'Up', type: 'Point-To-Point' }] } })
    if (path.endsWith('/content')) return route.fulfill({ json: { data: [{ vnet: 'labnet', status: 'available' }] } })
    if (path.endsWith('/bridges')) return route.fulfill({ json: { data: [{ name: 'labnet', vlan_filtering: '0', ports: [{ name: 'tap100i0', vmid: 100, index: '0' }] }] } })
    return route.fulfill({ json: { data: [] } })
  })
}
