import { describe, expect, it } from 'vitest'

import type { ClusterResource } from '@/api/types'

import { DEFAULT_TREE_PREFS, buildTree, loadTreePrefs, saveTreePrefs } from './resourceTree'

const R: ClusterResource[] = [
  { id: 'node/b', type: 'node', node: 'b', status: 'online' },
  { id: 'node/a', type: 'node', node: 'a', status: 'online' },
  { id: 'qemu/101', type: 'qemu', vmid: 101, node: 'a', name: 'web', status: 'running', pool: 'prod', tags: 'web;prod' },
  { id: 'qemu/100', type: 'qemu', vmid: 100, node: 'a', name: 'db', status: 'stopped', tags: 'prod' },
  { id: 'lxc/200', type: 'lxc', vmid: 200, node: 'b', name: 'proxy', status: 'running' },
  { id: 'qemu/9000', type: 'qemu', vmid: 9000, node: 'b', name: 'tpl', status: 'stopped', template: 1 },
  { id: 'storage/a/local', type: 'storage', node: 'a', storage: 'local', status: 'available' },
  { id: '/pool/prod', type: 'pool', pool: 'prod' },
  { id: '/pool/empty', type: 'pool', pool: 'empty' },
]

const shape = (groups: ReturnType<typeof buildTree>) =>
  groups.map((g) => [g.label, g.guests.map((x) => x.vmid), g.storages.map((s) => s.storage)])

describe('resource tree', () => {
  it('groups by node with guests and storage', () => {
    expect(shape(buildTree(R, DEFAULT_TREE_PREFS))).toEqual([
      ['a', [100, 101], ['local']],
      ['b', [200, 9000], []],
    ])
    expect(shape(buildTree(R, { ...DEFAULT_TREE_PREFS, showStorage: false, showTemplates: false }))).toEqual([
      ['a', [100, 101], []],
      ['b', [200], []],
    ])
  })

  it('groups by pool (empty pools kept, loose guests last)', () => {
    expect(shape(buildTree(R, { ...DEFAULT_TREE_PREFS, group: 'pool' }))).toEqual([
      ['empty', [], []],
      ['prod', [101], []],
      ['不在资源池中', [100, 200, 9000], []],
    ])
  })

  it('groups by tag (a guest under each of its tags)', () => {
    expect(shape(buildTree(R, { ...DEFAULT_TREE_PREFS, group: 'tag' }))).toEqual([
      ['prod', [100, 101], []],
      ['web', [101], []],
      ['没有标签', [200, 9000], []],
    ])
  })

  it('filters by search text', () => {
    expect(shape(buildTree(R, DEFAULT_TREE_PREFS, 'web'))).toEqual([['a', [101], []]])
    // A node name match keeps all its children.
    expect(shape(buildTree(R, DEFAULT_TREE_PREFS, 'b'))).toEqual([
      ['a', [100, 101], []], // "db", "web"
      ['b', [200, 9000], []],
    ])
    expect(shape(buildTree(R, { ...DEFAULT_TREE_PREFS, group: 'pool' }, 'prod'))).toEqual([['prod', [101], []], ['不在资源池中', [100], []]])
    expect(shape(buildTree(R, { ...DEFAULT_TREE_PREFS, group: 'tag' }, 'zzz'))).toEqual([])
  })

  it('persists prefs and tolerates junk', () => {
    saveTreePrefs({ ...DEFAULT_TREE_PREFS, group: 'tag', collapsed: { 'node:a': true } })
    expect(loadTreePrefs()).toMatchObject({ group: 'tag', collapsed: { 'node:a': true } })
    localStorage.setItem('tiller:resource-tree', '{"group":"weird"}')
    expect(loadTreePrefs().group).toBe('node')
    localStorage.setItem('tiller:resource-tree', 'not json')
    expect(loadTreePrefs()).toEqual(DEFAULT_TREE_PREFS)
  })
})
