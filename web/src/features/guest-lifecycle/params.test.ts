import { describe, expect, it } from 'vitest'

import { normalizeMigratePrecondition } from '@/api/guest-lifecycle'

import { guestLifecycleActions } from './actions'
import {
  blockingResources,
  bulkCandidate,
  cloneParams,
  clusterBulkParams,
  destroyParams,
  haParams,
  migrateParams,
  movableLocalDisks,
  nameError,
  nodeBulkParams,
  targetProblems,
} from './params'

describe('migrateParams', () => {
  const withDisk = {
    running: 1 as const,
    local_disks: [
      { volid: 'local-lvm:vm-100-disk-0', size: 1024 },
      { volid: 'local:iso/a.iso', cdrom: 1 as const },
    ],
    local_resources: [],
  }

  it('online VM with local disks and target storage', () => {
    expect(migrateParams('qemu', { target: 'pve2', online: true, targetStorage: 'local-zfs', conntrack: true }, withDisk)).toEqual({
      target: 'pve2',
      online: 1,
      'with-local-disks': 1,
      targetstorage: 'local-zfs',
      'with-conntrack-state': 1,
    })
  })

  it('offline VM without local disks; force for local resources', () => {
    expect(migrateParams('qemu', { target: 'pve2', online: false, force: true, conntrack: true }, { local_disks: [] })).toEqual({
      target: 'pve2',
      force: 1,
    })
  })

  it('running CT uses restart mode with timeout; target-storage spelling', () => {
    expect(migrateParams('lxc', { target: 'pve2', online: true, timeout: 60, targetStorage: 'tank', bwlimit: 1000 }, undefined)).toEqual({
      target: 'pve2',
      restart: 1,
      timeout: 60,
      'target-storage': 'tank',
      bwlimit: 1000,
    })
  })

  it('ignores CD-ROMs as local disks', () => {
    expect(movableLocalDisks(withDisk).map((d) => d.volid)).toEqual(['local-lvm:vm-100-disk-0'])
  })

  it('reports blocking resources and target problems', () => {
    expect(blockingResources({ local_resources: ['hostpci0', 'usb0'], 'mapped-resource-info': { usb0: {} } })).toEqual(['hostpci0'])
    expect(
      targetProblems(
        {
          not_allowed_nodes: {
            pve2: { unavailable_storages: ['local-zfs'], 'blocking-ha-resources': [{ sid: 'vm:101', cause: 'resource-affinity' }] },
          },
        },
        'pve2',
      ),
    ).toEqual(['目标节点缺少存储：local-zfs', 'HA 资源 vm:101 阻止迁移（资源亲和规则）'])
    expect(targetProblems({ running: 0, allowed_nodes: ['pve3'] }, 'pve2')).toEqual(['目标节点不满足迁移条件'])
    expect(targetProblems(undefined, 'pve2')).toEqual([])
  })
})

describe('cloneParams', () => {
  it('full clone of a VM with storage and format', () => {
    expect(
      cloneParams(
        'qemu',
        { newid: 3301, name: ' web-2 ', target: 'pve', full: true, storage: 'local', format: 'qcow2', pool: 'lab', snapname: 'current' },
        { sourceNode: 'pve', isTemplate: false },
      ),
    ).toEqual({ newid: 3301, name: 'web-2', pool: 'lab', full: 1, storage: 'local', format: 'qcow2' })
  })

  it('linked clone of a template to another node; CT uses hostname', () => {
    expect(
      cloneParams('lxc', { newid: 3302, name: 'ct', target: 'pve2', full: false, storage: 'x', format: 'raw', snapname: 's1' }, { sourceNode: 'pve', isTemplate: true }),
    ).toEqual({ newid: 3302, hostname: 'ct', target: 'pve2', snapname: 's1', full: 0 })
  })

  it('non-templates are always full clones', () => {
    expect(cloneParams('qemu', { newid: 3303, full: false }, { sourceNode: 'pve', isTemplate: false })).toEqual({ newid: 3303, full: 1 })
  })

  it('validates DNS names', () => {
    expect(nameError('web-01.lab')).toBeNull()
    expect(nameError('')).toBeNull()
    expect(nameError('-bad')).not.toBeNull()
    expect(nameError('has space')).not.toBeNull()
  })
})

describe('destroyParams', () => {
  it('sends purge and destroy-unreferenced-disks as 0/1; force only for CTs', () => {
    expect(destroyParams('qemu', { purge: true, destroyUnreferenced: false, force: true })).toEqual({
      purge: 1,
      'destroy-unreferenced-disks': 0,
    })
    expect(destroyParams('lxc', { purge: false, destroyUnreferenced: true, force: true })).toEqual({
      purge: 0,
      'destroy-unreferenced-disks': 1,
      force: 1,
    })
  })
})

describe('bulk params', () => {
  it('node endpoints: comma separated vms, startall forces', () => {
    expect(nodeBulkParams({ action: 'start', vmids: [100, 101] })).toEqual({ action: 'startall', params: { vms: '100,101', force: 1 } })
    expect(nodeBulkParams({ action: 'shutdown', vmids: [100], timeout: 30, forceStop: false, maxWorkers: 2 })).toEqual({
      action: 'stopall',
      params: { vms: '100', 'force-stop': 0, timeout: 30, 'max-workers': 2 },
    })
    expect(nodeBulkParams({ action: 'migrate', vmids: [100], target: 'pve2' })).toEqual({
      action: 'migrateall',
      params: { vms: '100', target: 'pve2', 'with-local-disks': 1, 'max-workers': 1 },
    })
    expect(nodeBulkParams({ action: 'suspend', vmids: [100] }).action).toBe('suspendall')
  })

  it('cluster endpoint: vms as an array', () => {
    expect(clusterBulkParams({ action: 'start', vmids: [100, 200] })).toEqual({ vms: [100, 200] })
    expect(clusterBulkParams({ action: 'suspend', vmids: [100], toDisk: true, statestorage: 'local-lvm' })).toEqual({
      vms: [100],
      'to-disk': 1,
      statestorage: 'local-lvm',
    })
    expect(clusterBulkParams({ action: 'migrate', vmids: [100], target: 'pve2', online: true })).toEqual({
      vms: [100],
      target: 'pve2',
      online: 1,
      'with-local-disks': 1,
      'max-workers': 1,
    })
    expect(clusterBulkParams({ action: 'shutdown', vmids: [1] })).toEqual({ vms: [1], 'force-stop': 1 })
  })

  it('default candidates follow the official status map', () => {
    expect(bulkCandidate('start', { status: 'stopped', type: 'qemu' })).toBe(true)
    expect(bulkCandidate('start', { status: 'running', type: 'qemu' })).toBe(false)
    expect(bulkCandidate('shutdown', { status: 'running', type: 'lxc' })).toBe(true)
    expect(bulkCandidate('suspend', { status: 'running', type: 'lxc' })).toBe(false)
    expect(bulkCandidate('start', { status: 'stopped', type: 'qemu', template: 1 })).toBe(false)
    expect(bulkCandidate('migrate', { status: 'stopped', type: 'qemu', template: 1 })).toBe(true)
  })
})

describe('haParams', () => {
  it('create and update', () => {
    expect(haParams({ state: 'started', maxRestart: 2, maxRelocate: undefined, failback: false, comment: ' web ' }, null)).toEqual({
      state: 'started',
      max_restart: 2,
      max_relocate: 1,
      failback: 0,
      comment: 'web',
    })
    expect(haParams({ state: 'ignored', failback: true, comment: '' }, { comment: 'old', digest: 'd1' })).toEqual({
      state: 'ignored',
      max_restart: 1,
      max_relocate: 1,
      failback: 1,
      delete: 'comment',
      digest: 'd1',
    })
  })
})

describe('guestLifecycleActions', () => {
  const ctx = (status: string, extra: { lock?: string; template?: 0 | 1; hastate?: string } = {}) => ({
    node: 'pve',
    type: 'qemu' as const,
    vmid: 100,
    name: 'web',
    navigate: () => undefined,
    guest: { id: 'qemu/100', type: 'qemu' as const, vmid: 100, node: 'pve', status, ...extra },
  })
  const action = (id: string) => guestLifecycleActions.find((a) => a.id === id)!

  it('convert to template needs a stopped, unlocked guest', () => {
    expect(action('template').disabled!(ctx('running'))).toBe('需要先停止')
    expect(action('template').disabled!(ctx('stopped'))).toBe(false)
    expect(action('template').visible!(ctx('stopped', { template: 1 }))).toBe(false)
  })

  it('locked guests cannot be migrated, cloned or deleted', () => {
    for (const id of ['migrate', 'clone', 'remove']) expect(action(id).disabled!(ctx('stopped', { lock: 'backup' }))).toBe('已锁定（backup）')
  })

  it('HA label reflects the HA state', () => {
    const label = action('ha').label as (c: ReturnType<typeof ctx>) => string
    expect(label(ctx('running'))).toBe('加入 HA')
    expect(label(ctx('running', { hastate: 'started' }))).toBe('HA 设置')
  })
})

describe('normalizeMigratePrecondition', () => {
  it('reads the kebab-case node lists of the lxc endpoint', () => {
    const pre = normalizeMigratePrecondition({
      running: 1,
      'allowed-nodes': ['pve3'],
      'not-allowed-nodes': { pve2: { 'blocking-ha-resources': [{ sid: 'ct:200', cause: 'resource-affinity' }] } },
    })
    expect(pre.allowed_nodes).toEqual(['pve3'])
    expect(targetProblems(pre, 'pve2')).toEqual(['HA 资源 ct:200 阻止迁移（资源亲和规则）'])
    expect(pre).not.toHaveProperty('not-allowed-nodes')
  })

  it('keeps the qemu snake_case lists', () => {
    const pre = normalizeMigratePrecondition({ running: 0, allowed_nodes: ['pve3'], not_allowed_nodes: {} })
    expect(pre.allowed_nodes).toEqual(['pve3'])
    expect(targetProblems(pre, 'pve2')).toEqual(['目标节点不满足迁移条件'])
  })
})
