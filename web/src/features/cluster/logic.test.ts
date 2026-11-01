import { describe, expect, it } from 'vitest'

import type { ClusterJoinData } from '@/api/cluster'
import type { ClusterStatusEntry } from '@/api/types'

import {
  addressCandidates,
  buildJoinInfo,
  clusterNodeRows,
  createParams,
  decodeJoinInfo,
  encodeJoinInfo,
  joinLinkRows,
  joinParams,
  linkErrors,
  linkPriority,
  nextFreeLinkNumber,
  nodeLinks,
  totemFacts,
  totemLinkNumbers,
  validateClusterName,
  validateFingerprint,
  voteSummary,
  type LinkRow,
} from './logic'

const FP = Array.from({ length: 32 }, (_, i) => (i * 7).toString(16).padStart(2, '0').toUpperCase()).join(':')

// Shape of the lab cluster's GET /cluster/config/join (pvecm returns strings).
const join: ClusterJoinData = {
  config_digest: '9d568a9e',
  preferred_node: 'pvelab-c1',
  nodelist: [
    { name: 'pvelab-c2', nodeid: '3', pve_addr: '192.168.0.247', pve_fp: 'AA', quorum_votes: '1', ring0_addr: '192.168.0.247' },
    { name: 'pvelab-c1', nodeid: '1', pve_addr: '192.168.0.246', pve_fp: FP, quorum_votes: '1', ring0_addr: '192.168.0.246', ring1_addr: '10.0.0.1' },
  ],
  totem: {
    cluster_name: 'pve-web-lab',
    config_version: '3',
    interface: { '0': { linknumber: '0' }, '1': { linknumber: '1', knet_link_priority: '20' } },
    link_mode: 'passive',
    secauth: 'on',
    version: '2',
  },
}

describe('join information', () => {
  it('builds the official object for the preferred node', () => {
    const info = buildJoinInfo(join)!
    expect(info).toEqual({
      ipAddress: '192.168.0.246',
      fingerprint: FP,
      peerLinks: { 0: '192.168.0.246', 1: '10.0.0.1' },
      ring_addr: ['192.168.0.246', '10.0.0.1'],
      totem: join.totem,
    })
    expect(Object.keys(info)).toEqual(['ipAddress', 'fingerprint', 'peerLinks', 'ring_addr', 'totem'])
    expect(buildJoinInfo({ ...join, preferred_node: 'gone' })).toBeNull()
  })

  it('round-trips through base64 JSON, ignoring pasted line breaks', () => {
    const info = buildJoinInfo(join)!
    const encoded = encodeJoinInfo(info)
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(JSON.parse(atob(encoded))).toEqual(info)
    const wrapped = encoded.replace(/(.{60})/g, '$1\n  ')
    expect(decodeJoinInfo(wrapped)).toEqual(info)
  })

  it('decodes what the official UI produces (Ext.util.Base64 of Ext.JSON)', () => {
    const official = btoa(
      JSON.stringify({ ipAddress: '10.1.1.1', fingerprint: FP, peerLinks: { 0: '10.1.1.1' }, ring_addr: ['10.1.1.1'], totem: { cluster_name: 'prod', interface: { 0: { linknumber: '0' } } } }),
    )
    const info = decodeJoinInfo(official)!
    expect(info.ipAddress).toBe('10.1.1.1')
    expect(info.totem.cluster_name).toBe('prod')
  })

  it('keeps non-ASCII text intact (UTF-8)', () => {
    const info = { ...buildJoinInfo(join)!, totem: { ...join.totem, note: '集群' } }
    expect(decodeJoinInfo(encodeJoinInfo(info))?.totem.note).toBe('集群')
  })

  it('rejects anything that is not base64 JSON with a totem section', () => {
    expect(decodeJoinInfo('')).toBeNull()
    expect(decodeJoinInfo('not base64 !!')).toBeNull()
    expect(decodeJoinInfo(btoa('hello'))).toBeNull()
    expect(decodeJoinInfo(btoa('[1,2]'))).toBeNull()
    expect(decodeJoinInfo(btoa(JSON.stringify({ ipAddress: '1.2.3.4' })))).toBeNull()
  })

  it('makes one link row per cluster link with the peer address as hint', () => {
    const rows = joinLinkRows(buildJoinInfo(join)!)
    expect(rows).toEqual([
      { number: 0, address: '', priority: '', peer: '192.168.0.246' },
      { number: 1, address: '', priority: '', peer: '10.0.0.1' },
    ])
  })

  it('lets a single link on the API address stay empty (hostname fallback)', () => {
    const single = decodeJoinInfo(
      btoa(JSON.stringify({ ipAddress: '192.168.0.246', fingerprint: FP, peerLinks: { 0: '192.168.0.246' }, ring_addr: ['192.168.0.246'], totem: { interface: { 0: { linknumber: '0' } } } })),
    )!
    expect(joinLinkRows(single)).toEqual([{ number: 0, address: '', priority: '', peer: '192.168.0.246', optional: true }])
    expect(linkErrors(joinLinkRows(single))).toEqual({})
  })
})

describe('links', () => {
  it('reads ring/link addresses and totem link settings', () => {
    expect(nodeLinks({ name: 'a', ring1_addr: 'b', ring0_addr: 'a', link2_addr: 'c', other: 'x' })).toEqual([
      { number: 0, address: 'a' },
      { number: 1, address: 'b' },
      { number: 2, address: 'c' },
    ])
    expect(totemLinkNumbers(join.totem)).toEqual([0, 1])
    expect(totemLinkNumbers(undefined)).toEqual([0])
    expect(linkPriority(join.totem, 1)).toBe(20)
    expect(linkPriority(join.totem, 0)).toBeUndefined()
  })

  it('lists IPv4 and IPv6 addresses of the node as candidates', () => {
    expect(
      addressCandidates([
        { iface: 'eno1', type: 'eth' },
        { iface: 'vmbr0', type: 'bridge', address: '192.168.0.246', address6: 'fd00::1' },
      ]),
    ).toEqual([
      { address: '192.168.0.246', iface: 'vmbr0' },
      { address: 'fd00::1', iface: 'vmbr0' },
    ])
  })

  it('validates link rows', () => {
    const rows: LinkRow[] = [
      { number: 0, address: '10.0.0.1', priority: '' },
      { number: 0, address: '10.0.0.2', priority: '' },
      { number: 2, address: '', priority: '' },
      { number: 3, address: '10.0.0.1', priority: '' },
      { number: 4, address: '10.0.0.4,x', priority: '' },
      { number: 5, address: '10.0.0.5', priority: '300' },
    ]
    expect(linkErrors(rows, { priority: true })).toEqual({
      0: '链路号 0 重复',
      1: '链路号 0 重复',
      2: '请输入本节点在这条链路上的地址',
      3: '地址重复',
      4: '地址格式不正确',
      5: '优先级是 0–255 的整数',
    })
    expect(nextFreeLinkNumber(rows)).toBe(1)
    expect(nextFreeLinkNumber(Array.from({ length: 8 }, (_, number) => ({ number, address: '', priority: '' })))).toBeNull()
  })
})

describe('form → params', () => {
  it('create: links with optional priority, advanced fields only when set', () => {
    expect(
      createParams({
        clustername: ' prod ',
        links: [
          { number: 0, address: '10.0.0.1', priority: '' },
          { number: 1, address: ' 10.1.0.1 ', priority: '20' },
          { number: 3, address: '', priority: '5' },
        ],
        nodeid: '',
        votes: '',
      }),
    ).toEqual({ clustername: 'prod', link0: '10.0.0.1', link1: 'address=10.1.0.1,priority=20', nodeid: undefined, votes: undefined })
    expect(createParams({ clustername: 'c', links: [{ number: 0, address: 'a', priority: '' }], nodeid: '4', votes: '2' })).toMatchObject({ nodeid: 4, votes: 2 })
  })

  it('join: never sends a priority (ignored on join) and normalises the fingerprint', () => {
    expect(
      joinParams({
        hostname: '192.168.0.246',
        fingerprint: FP.toLowerCase(),
        password: ' secret ',
        links: [
          { number: 0, address: '192.168.0.250', priority: '9' },
          { number: 1, address: '', priority: '', optional: true },
        ],
        nodeid: '',
        votes: '',
        force: false,
      }),
    ).toEqual({ hostname: '192.168.0.246', fingerprint: FP, password: ' secret ', link0: '192.168.0.250', nodeid: undefined, votes: undefined, force: undefined })
  })

  it('validates names and fingerprints like PVE', () => {
    expect(validateClusterName('pve-web-lab')).toBeNull()
    expect(validateClusterName('')).toMatch(/请输入/)
    expect(validateClusterName('a-very-long-name-1')).toMatch(/15/)
    expect(validateClusterName('-bad')).toMatch(/字母/)
    expect(validateClusterName('bad_name')).toMatch(/字母/)
    expect(validateFingerprint(FP)).toBeNull()
    expect(validateFingerprint(FP.toLowerCase())).toBeNull()
    expect(validateFingerprint('AA:BB')).toMatch(/32 组/)
  })
})

describe('overview', () => {
  const status: ClusterStatusEntry[] = [
    { type: 'cluster', id: 'cluster', name: 'pve-web-lab', nodes: 3, quorate: 1, version: 3 },
    { type: 'node', id: 'node/pvelab-c1', name: 'pvelab-c1', nodeid: 1, online: 1, local: 1, ip: '192.168.0.246' },
    { type: 'node', id: 'node/pvelab-c2', name: 'pvelab-c2', nodeid: 3, online: 0, ip: '192.168.0.247' },
    { type: 'node', id: 'node/pvelab-c3', name: 'pvelab-c3', nodeid: 2, online: 1, ip: '192.168.0.248' },
  ]
  const nodes = [
    { name: 'pvelab-c2', node: 'pvelab-c2', nodeid: '3', quorum_votes: '1', ring0_addr: '192.168.0.247' },
    { name: 'pvelab-c1', node: 'pvelab-c1', nodeid: '1', quorum_votes: '1', ring0_addr: '192.168.0.246' },
    { name: 'pvelab-c3', node: 'pvelab-c3', nodeid: '2', quorum_votes: '2', ring0_addr: '192.168.0.248' },
  ]

  it('merges corosync nodes with their state, sorted by node id', () => {
    const rows = clusterNodeRows(nodes, status, join.nodelist)
    expect(rows.map((r) => [r.name, r.nodeid, r.votes, r.online, r.local, r.address])).toEqual([
      ['pvelab-c1', 1, 1, true, true, '192.168.0.246'],
      ['pvelab-c3', 2, 2, true, false, '192.168.0.248'],
      ['pvelab-c2', 3, 1, false, false, '192.168.0.247'],
    ])
    expect(voteSummary(rows)).toEqual({ present: 3, total: 4, quorum: 3 })
  })

  it('labels totem settings without the per-link sections', () => {
    const facts = totemFacts(join.totem)
    expect(facts.map((f) => f.key)).toEqual(['config_version', 'version', 'link_mode', 'secauth'])
    expect(facts.find((f) => f.key === 'link_mode')?.value).toMatch(/被动/)
  })
})
