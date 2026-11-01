import { describe, expect, it } from 'vitest'

import { cephErrorState, type CephOsdTree, type CephStatus } from '@/api/ceph'

import {
  activeOsdFlags,
  buildServices,
  cephFsCreateParams,
  compareCephVersions,
  crushDeviceClasses,
  defaultPoolForm,
  defaultRelease,
  flagChanges,
  healthChecks,
  initFormError,
  initParams,
  installCmdOpts,
  isCidr,
  logLevel,
  minSizeFor,
  minSizeWarning,
  networkOfCidr,
  osdCounts,
  osdCreateError,
  osdCreateParams,
  osdDestroyBlocker,
  osdHosts,
  parseCephVersion,
  pgCategory,
  pgSummary,
  poolCreateParams,
  poolFormError,
  poolFormFromStatus,
  poolUpdateParams,
  recoveryInfo,
} from './model'

describe('health', () => {
  it('sorts checks worst first and joins details', () => {
    const rows = healthChecks({
      checks: {
        TOO_FEW_OSDS: { severity: 'HEALTH_WARN', summary: { message: 'OSD count 1 < osd_pool_default_size 3' }, detail: [] },
        PG_AVAILABILITY: {
          severity: 'HEALTH_ERR',
          summary: { message: 'Reduced data availability: 1 pg inactive' },
          detail: [{ message: 'pg 1.0 is stuck inactive' }],
          muted: true,
        },
        AUTH_INSECURE: { severity: 'HEALTH_WARN', summary: { message: 'insecure' } },
      },
    })
    expect(rows.map((r) => r.id)).toEqual(['PG_AVAILABILITY', 'AUTH_INSECURE', 'TOO_FEW_OSDS'])
    expect(rows[0]).toMatchObject({ tone: 'err', detail: ['pg 1.0 is stuck inactive'], muted: true })
    expect(rows[2]!.detail).toEqual([])
    expect(healthChecks(undefined)).toEqual([])
  })

  it('maps API errors to install states', () => {
    expect(cephErrorState(new Error('binary not installed: /usr/bin/ceph-mon'))).toBe('not-installed')
    expect(cephErrorState(new Error("pveceph configuration not initialized - missing '/etc/pve/ceph.conf'"))).toBe('not-initialized')
    expect(cephErrorState(new Error('rados_connect failed - No such file or directory'))).toBe('unreachable')
    expect(cephErrorState(new Error('got timeout'))).toBe('unreachable')
    expect(cephErrorState(new Error('permission denied'))).toBe('error')
  })
})

describe('PG states', () => {
  it('categorises by the worst state word', () => {
    expect(pgCategory('active+clean')).toBe('clean')
    expect(pgCategory('active+clean+scrubbing+deep')).toBe('busy')
    expect(pgCategory('active+undersized+degraded')).toBe('warning')
    expect(pgCategory('stale+active+clean')).toBe('critical')
    expect(pgCategory('active+recovery_wait+degraded')).toBe('warning')
    expect(pgCategory('backfill_toofull')).toBe('critical')
    expect(pgCategory('unknown')).toBe('unknown')
  })

  it('sums categories and sorts states', () => {
    const s = pgSummary([
      { state_name: 'active+undersized', count: 3 },
      { state_name: 'active+clean', count: 30 },
      { state_name: 'active+clean+scrubbing', count: 1 },
    ])
    expect(s.total).toBe(34)
    expect(s.states.map((x) => x.state_name)).toEqual(['active+clean', 'active+clean+scrubbing', 'active+undersized'])
    expect(Object.fromEntries(s.categories.map((c) => [c.category, c.count]))).toEqual({ unknown: 0, clean: 30, busy: 1, warning: 3, critical: 0 })
    expect(pgSummary(undefined).total).toBe(0)
  })
})

describe('OSD counts and recovery', () => {
  it('derives the up/in matrix from the map and OSD_DOWN', () => {
    const status: CephStatus = {
      osdmap: { num_osds: 4, num_up_osds: 2, num_in_osds: 3 },
      health: { status: 'HEALTH_WARN', checks: { OSD_DOWN: { severity: 'HEALTH_WARN', summary: { message: '1 osds down' } } } },
    }
    expect(osdCounts(status)).toEqual({ total: 4, upIn: 2, upOut: 0, downIn: 1, downOut: 1 })
    expect(osdCounts(undefined)).toEqual({ total: 0, upIn: 0, upOut: 0, downIn: 0, downOut: 0 })
  })

  it('computes recovery progress only while objects move', () => {
    expect(recoveryInfo({ bytes_total: 1 })).toBeNull()
    const r = recoveryInfo({ degraded_objects: 25, degraded_total: 100, recovering_bytes_per_sec: 4 * 1024 * 1024, recovering_objects_per_sec: 1 })
    expect(r).toEqual({ ratio: 0.75, speed: 4 * 1024 * 1024, eta: 25 })
  })
})

describe('versions', () => {
  it('parses and compares', () => {
    expect(parseCephVersion({ ceph_version_short: '19.2.6' })).toBe('19.2.6')
    expect(parseCephVersion({ ceph_version: 'ceph version 19.2.3 (abc) squid (stable)' })).toBe('19.2.3')
    expect(parseCephVersion({})).toBeUndefined()
    expect(compareCephVersions('19.2.10', '19.2.6')).toBeGreaterThan(0)
    expect(compareCephVersions(['19', '2', '6'], '19.2.6')).toBe(0)
    expect(compareCephVersions('19.2', '19.2.1')).toBeLessThan(0)
  })

  it('preselects the release the cluster runs', () => {
    expect(defaultRelease('19.2.6')).toBe('squid')
    expect(defaultRelease('20.2.0')).toBe('tentacle')
    expect(defaultRelease(undefined)).toBe('tentacle')
  })
})

describe('install wizard', () => {
  it('builds the pveceph install options', () => {
    expect(installCmdOpts('squid', 'no-subscription')).toBe('--version\0squid\0--repository\0no-subscription')
  })

  it('validates networks and builds init params', () => {
    expect(isCidr('192.168.0.0/24')).toBe(true)
    expect(isCidr('fd00::/64')).toBe(true)
    expect(isCidr('192.168.0.0')).toBe(false)
    expect(networkOfCidr('192.168.0.246/24')).toBe('192.168.0.0/24')
    expect(networkOfCidr('10.1.2.3/8')).toBe('10.0.0.0/8')
    const f = { network: ' 192.168.0.0/24 ', clusterNetwork: '', size: null, minSize: null }
    expect(initFormError(f)).toBeNull()
    expect(initParams(f)).toEqual({ network: '192.168.0.0/24' })
    expect(initParams({ ...f, clusterNetwork: '10.0.0.0/24', size: 3, minSize: 2 })).toEqual({
      network: '192.168.0.0/24',
      'cluster-network': '10.0.0.0/24',
      size: 3,
      min_size: 2,
    })
    expect(initFormError({ ...f, network: '' })).toMatch(/公共网络/)
    expect(initFormError({ ...f, size: 2, minSize: 3 })).toMatch(/最小副本数/)
  })
})

const TREE: CephOsdTree = {
  flags: 'noout,sortbitwise,recovery_deletes,purged_snapdirs,pglog_hardlimit',
  root: {
    children: [
      {
        id: '-1',
        name: 'default',
        type: 'root',
        children: [
          {
            id: '-5',
            name: 'pvelab-c2',
            type: 'host',
            version: '19.2.6',
            children: [
              { id: '1', name: 'osd.1', type: 'osd', status: 'down', in: 0, host: 'pvelab-c2', ceph_version_short: '19.2.3', percent_used: 50, device_class: 'hdd' },
            ],
          },
          {
            id: '-3',
            name: 'pvelab-c1',
            type: 'host',
            version: '19.2.6',
            children: [
              { id: '2', name: 'osd.2', type: 'osd', status: 'up', in: 1, host: 'pvelab-c1', ceph_version_short: '19.2.6', percent_used: 25, total_space: 100 },
              { id: '0', name: 'osd.0', type: 'osd', status: 'up', in: 1, host: 'pvelab-c1', ceph_version_short: '19.2.6' },
            ],
          },
        ],
      },
    ],
  },
}

describe('OSD tree', () => {
  it('groups OSDs by host, sorted', () => {
    const hosts = osdHosts(TREE)
    expect(hosts.map((h) => h.name)).toEqual(['pvelab-c1', 'pvelab-c2'])
    expect(hosts[0]!.osds.map((o) => o.id)).toEqual([0, 2])
    expect(hosts[0]!.path).toEqual(['default'])
    expect(hosts[0]!.osds[1]).toMatchObject({ up: true, in: true, usage: 0.25, total: 100, outdated: false })
    expect(hosts[1]!.osds[0]).toMatchObject({ id: 1, up: false, in: false, usage: 0.5, outdated: true, deviceClass: 'hdd' })
    expect(osdHosts(undefined)).toEqual([])
  })

  it('lists only user-visible OSD map flags', () => {
    expect(activeOsdFlags(TREE)).toEqual(['noout'])
    expect(activeOsdFlags({ root: {} })).toEqual([])
  })

  it('explains why an OSD cannot be destroyed yet', () => {
    expect(osdDestroyBlocker({ up: true, in: true })).toMatch(/out.*停止/)
    expect(osdDestroyBlocker({ up: false, in: true })).toMatch(/out/)
    expect(osdDestroyBlocker({ up: true, in: false })).toMatch(/停止/)
    expect(osdDestroyBlocker({ up: false, in: false })).toBeNull()
  })
})

describe('services', () => {
  it('marks quorum, active manager and outdated daemons', () => {
    const s = buildServices(
      {
        mon: {
          'a@n1': { name: 'a', addr: '10.0.0.1', ceph_version_short: '19.2.6', service: true },
          'b@n2': { name: 'b', addr: '10.0.0.2', ceph_version_short: '19.2.3', service: true },
          'c@n3': { name: 'c', service: true },
        },
        mgr: { 'n1@n1': { name: 'n1', addr: '10.0.0.1', ceph_version_short: '19.2.6' }, 'n2@n2': { name: 'n2', addr: '10.0.0.2', ceph_version_short: '19.2.6' } },
        mds: {},
        node: { n1: { version: { str: '19.2.6' } }, n2: { version: { str: '19.2.6' } } },
      },
      {
        quorum_names: ['a', 'b'],
        mgrmap: { active_name: 'n1', standbys: [] },
        health: {
          status: 'HEALTH_WARN',
          checks: { MON_DOWN: { severity: 'HEALTH_WARN', summary: { message: '1/3 mons down' }, detail: [{ message: 'mon.c (rank 2) addr is down (out of quorum)' }] } },
        },
      },
    )
    expect(s.mon.map((m) => [m.name, m.tone, m.state])).toEqual([
      ['a', 'ok', '运行中'],
      ['b', 'old', '运行中'],
      ['c', 'unknown', '已停止'],
    ])
    expect(s.mon[1]!.messages[0]).toMatch(/仍在运行旧版本/)
    expect(s.mon[2]!.messages).toEqual(['mon.c (rank 2) addr is down (out of quorum)'])
    expect(s.mgr.map((m) => [m.name, m.tone, m.state])).toEqual([
      ['n1', 'ok', '活动'],
      ['n2', 'warn', '未连接'],
    ])
    expect(s.mds).toEqual([])
  })
})

describe('flags', () => {
  it('sends only changed flags', () => {
    const cur = [
      { name: 'noout', description: '', value: 0 as const },
      { name: 'noscrub', description: '', value: 1 as const },
    ]
    expect(flagChanges(cur, { noout: true, noscrub: true })).toEqual({ noout: 1 })
    expect(flagChanges(cur, { noout: false, noscrub: false })).toEqual({ noscrub: 0 })
    expect(flagChanges(cur, { noout: false })).toBeNull()
  })
})

describe('OSD create form', () => {
  const base = { dev: '/dev/sdc', dbDev: '', dbSize: null, walDev: '', walSize: null, encrypted: false, deviceClass: '', osdsPerDevice: null }
  it('builds params, leaving defaults out', () => {
    expect(osdCreateParams(base)).toEqual({ dev: '/dev/sdc' })
    expect(
      osdCreateParams({ ...base, dbDev: '/dev/nvme0n1', dbSize: 10, walDev: '/dev/nvme1n1', walSize: 1, encrypted: true, deviceClass: 'ssd' }),
    ).toEqual({ dev: '/dev/sdc', db_dev: '/dev/nvme0n1', db_dev_size: 10, wal_dev: '/dev/nvme1n1', wal_dev_size: 1, encrypted: 1, 'crush-device-class': 'ssd' })
    expect(osdCreateParams({ ...base, walSize: 3, osdsPerDevice: 2 })).toEqual({ dev: '/dev/sdc', 'osds-per-device': 2 })
  })
  it('validates', () => {
    expect(osdCreateError({ ...base, dev: '' })).toMatch(/磁盘/)
    expect(osdCreateError({ ...base, dbDev: '/dev/sdc' })).toMatch(/DB/)
    expect(osdCreateError({ ...base, dbDev: '/dev/sdd', osdsPerDevice: 2 })).toMatch(/DB\/WAL/)
    expect(osdCreateError(base)).toBeNull()
  })
  it('reads custom device classes from the CRUSH map', () => {
    expect(crushDeviceClasses('device 0 osd.0 class hdd\ndevice 1 osd.1 class fast\ndevice 2 osd.2 class fast\n')).toEqual(['fast'])
  })
})

describe('pool form', () => {
  it('keeps min_size at half the size', () => {
    expect(minSizeFor(3, 2)).toBe(2)
    expect(minSizeFor(5, 2)).toBe(3)
    expect(minSizeFor(2, 2)).toBe(2)
    expect(minSizeFor(1, 1)).toBe(1)
    expect(minSizeWarning(3, 1)).toMatch(/min_size 为 1/)
    expect(minSizeWarning(5, 2)).toMatch(/一半/)
    expect(minSizeWarning(3, 2)).toBeNull()
  })

  it('validates names', () => {
    const f = { ...defaultPoolForm(), name: 'e2e-pool' }
    expect(poolFormError(f)).toBeNull()
    expect(poolFormError({ ...f, name: 'a b' })).toMatch(/空格/)
    expect(poolFormError(f, ['e2e-pool'])).toMatch(/同名/)
    expect(poolFormError({ ...f, minSize: 4 })).toMatch(/min_size/)
  })

  it('builds create params', () => {
    const f = { ...defaultPoolForm(3, 2), name: ' e2e-pool ', targetRatio: 0.5, targetSizeGiB: 10, pgNumMin: 16, addStorages: false }
    expect(poolCreateParams(f)).toEqual({
      name: 'e2e-pool',
      size: 3,
      min_size: 2,
      pg_num: 128,
      pg_autoscale_mode: 'on',
      application: 'rbd',
      add_storages: 0,
      crush_rule: 'replicated_rule',
      pg_num_min: 16,
      target_size_ratio: 0.5,
      target_size: '10G',
    })
    expect(poolCreateParams({ ...f, targetSizeGiB: 1.5 }).target_size).toBe('1536M')
  })

  it('sends only changed settings on edit', () => {
    const before = poolFormFromStatus({
      name: 'p',
      size: 3,
      min_size: 2,
      pg_num: 32,
      pg_autoscale_mode: 'on',
      crush_rule: 'replicated_rule',
      application: 'rbd',
      target_size: 10 * 1024 ** 3,
    })
    expect(before).toMatchObject({ targetSizeGiB: 10, targetRatio: null, pgNumMin: null })
    expect(poolUpdateParams(before, before)).toBeNull()
    expect(poolUpdateParams(before, { ...before, size: 2, minSize: 1, autoscale: 'warn' })).toEqual({ size: 2, min_size: 1, pg_autoscale_mode: 'warn' })
    expect(poolUpdateParams(before, { ...before, targetSizeGiB: null, targetRatio: 0.2 })).toEqual({ target_size: '0', target_size_ratio: 0.2 })
  })
})

describe('misc', () => {
  it('CephFS params and log levels', () => {
    expect(cephFsCreateParams({ pgNum: 32, addStorage: true })).toEqual({ pg_num: 32, 'add-storage': 1 })
    expect(logLevel('2026-11-01T17:38:19 mon.a (mon.0) 3 : cluster [WRN] Health check failed')).toBe('WRN')
    expect(logLevel('plain')).toBeNull()
  })
})
