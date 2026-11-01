import { describe, expect, it } from 'vitest'

import type { ClusterResource, ClusterStatusEntry } from '@/api/types'

import { clusterUsage, guestCounts, healthReport, subscriptionLevel, subscriptionSummary } from './summary'

const resources: ClusterResource[] = [
  { id: 'node/a', type: 'node', node: 'a', status: 'online', cpu: 0.5, maxcpu: 4, mem: 2, maxmem: 8 },
  { id: 'node/b', type: 'node', node: 'b', status: 'offline', cpu: 0, maxcpu: 4, mem: 0, maxmem: 8 },
  { id: 'qemu/100', type: 'qemu', vmid: 100, node: 'a', status: 'running' },
  { id: 'qemu/101', type: 'qemu', vmid: 101, node: 'a', status: 'stopped' },
  { id: 'qemu/9000', type: 'qemu', vmid: 9000, node: 'a', status: 'stopped', template: 1 },
  { id: 'lxc/200', type: 'lxc', vmid: 200, node: 'a', status: 'running' },
  { id: 'storage/a/local', type: 'storage', node: 'a', storage: 'local', status: 'available', disk: 10, maxdisk: 100 },
  { id: 'storage/a/nfs', type: 'storage', node: 'a', storage: 'nfs', status: 'available', disk: 50, maxdisk: 1000, shared: 1 },
  { id: 'storage/b/nfs', type: 'storage', node: 'b', storage: 'nfs', status: 'available', disk: 50, maxdisk: 1000, shared: 1 },
  { id: 'storage/b/local', type: 'storage', node: 'b', storage: 'local', status: 'unknown', disk: 0, maxdisk: 100 },
]

describe('datacenter summary', () => {
  it('counts guests per type', () => {
    expect(guestCounts(resources)).toEqual({
      qemu: { running: 1, stopped: 1, templates: 1, total: 3 },
      lxc: { running: 1, stopped: 0, templates: 0, total: 1 },
    })
  })

  it('sums online nodes and counts shared storage once', () => {
    expect(clusterUsage(resources)).toEqual({
      cpu: { used: 2, total: 4 },
      mem: { used: 2, total: 8 },
      storage: { used: 60, total: 1100, count: 2 },
    })
  })

  it('summarises subscriptions', () => {
    const status: ClusterStatusEntry[] = [
      { type: 'node', id: 'node/b', name: 'b', nodeid: 2, online: 1, level: 'c' },
      { type: 'node', id: 'node/a', name: 'a', nodeid: 1, online: 1, level: '' },
      { type: 'node', id: 'node/c', name: 'c', nodeid: 3, online: 0, level: 'c' },
    ]
    expect(subscriptionSummary(status)).toEqual([
      { level: 'c', nodes: ['b', 'c'] },
      { level: 'none', nodes: ['a'] },
    ])
    expect(subscriptionLevel('P')).toBe('p')
    expect(subscriptionLevel(undefined)).toBe('none')
  })

  it('derives health', () => {
    const single: ClusterStatusEntry[] = [{ type: 'node', id: 'node/a', name: 'a', nodeid: 0, online: 1, level: '' }]
    expect(healthReport(single, null)).toEqual({ health: 'ok', cluster: null, quorate: null, nodesOnline: 1, nodesTotal: 1, ceph: null })
    const cluster: ClusterStatusEntry[] = [
      { type: 'cluster', id: 'cluster', name: 'c1', nodes: 2, quorate: 1, version: 3 },
      { type: 'node', id: 'node/a', name: 'a', nodeid: 1, online: 1 },
      { type: 'node', id: 'node/b', name: 'b', nodeid: 2, online: 0 },
    ]
    expect(healthReport(cluster, 'HEALTH_OK').health).toBe('warning')
    expect(healthReport([{ ...cluster[0]!, quorate: 0 } as ClusterStatusEntry, cluster[1]!], null).health).toBe('critical')
    expect(healthReport(single, 'HEALTH_ERR').health).toBe('critical')
    expect(healthReport(single, 'HEALTH_WARN').health).toBe('warning')
  })
})
