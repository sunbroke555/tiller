import { describe, expect, it } from 'vitest'

import type { HaManagerStatus, HaStatusEntry } from '@/api/ha'

import {
  crsForm,
  crsParams,
  newRuleId,
  parseHaStatus,
  parseRuleNodes,
  parseSid,
  resourceForm,
  resourceParams,
  ruleErrors,
  ruleForm,
  ruleFormErrors,
  ruleParams,
  serviceRows,
  statusParts,
  stringifyRuleNodes,
} from './logic'

// Captured from the 3-node lab (PVE 9.2) with one HA VM and c3 in maintenance.
const CURRENT: HaStatusEntry[] = [
  { id: 'quorum', node: 'pvelab-c1', quorate: 1, status: 'OK', type: 'quorum' },
  { id: 'master', node: 'pvelab-c3', status: 'pvelab-c3 (active, Sun Nov  1 17:35:44 2026)', timestamp: 1793525744, type: 'master' },
  { 'armed-state': 'armed', id: 'fencing', node: 'pvelab-c3', status: 'armed (CRM watchdog active)', type: 'fencing' },
  { id: 'lrm:pvelab-c1', node: 'pvelab-c1', status: 'pvelab-c1 (active, watchdog active, Sun Nov  1 17:35:44 2026)', timestamp: 1793525744, type: 'lrm' },
  { id: 'lrm:pvelab-c2', node: 'pvelab-c2', status: 'pvelab-c2 (idle, watchdog standby, Sun Nov  1 17:35:49 2026)', timestamp: 1793525749, type: 'lrm' },
  { id: 'lrm:pvelab-c3', node: 'pvelab-c3', status: 'pvelab-c3 (maintenance mode, watchdog standby, Sun Nov  1 17:35:47 2026)', timestamp: 1793525747, type: 'lrm' },
  {
    'auto-rebalance': 1,
    comment: 'probe',
    crm_state: 'stopped',
    failback: 1,
    id: 'service:vm:6200',
    max_relocate: 1,
    max_restart: 1,
    node: 'pvelab-c1',
    request_state: 'stopped',
    sid: 'vm:6200',
    state: 'stopped',
    status: 'vm:6200 (pvelab-c1, stopped)',
    type: 'service',
  },
]

const MANAGER: HaManagerStatus = {
  manager_status: {
    master_node: 'pvelab-c3',
    node_request: { 'pvelab-c3': { maintenance: 1 } },
    node_status: { 'pvelab-c1': 'online', 'pvelab-c2': 'online', 'pvelab-c3': 'maintenance' },
  },
  lrm_status: { 'pvelab-c3': { mode: 'maintenance', state: 'wait_for_agent_lock' } },
}

describe('HA status', () => {
  it('splits the parenthesised status text', () => {
    expect(statusParts('pvelab-c1 (active, watchdog active, Sun Nov  1 17:35:44 2026)')).toEqual(['active', 'watchdog active', 'Sun Nov  1 17:35:44 2026'])
    expect(statusParts('OK')).toEqual([])
  })

  it('parses quorum, master, fencing, LRMs and services', () => {
    const o = parseHaStatus(CURRENT, MANAGER)
    expect(o.quorate).toBe(true)
    expect(o.master).toBe('pvelab-c3')
    expect(o.armed).toBe('armed')
    expect(o.lrms.map((l) => [l.node, l.kind, l.watchdog, l.maintenance])).toEqual([
      ['pvelab-c1', 'active', true, false],
      ['pvelab-c2', 'idle', false, false],
      ['pvelab-c3', 'maintenance', false, true],
    ])
    expect(o.services).toHaveLength(1)
  })

  it('marks a requested maintenance before the LRM reports it', () => {
    const entries = CURRENT.map((e) => (e.id === 'lrm:pvelab-c3' ? { ...e, status: 'pvelab-c3 (active, watchdog active, x)' } : e))
    const lrm = parseHaStatus(entries, MANAGER).lrms.find((l) => l.node === 'pvelab-c3')!
    expect(lrm.kind).toBe('maintenance')
    expect(lrm.label).toBe('维护模式')
  })

  it('handles a cluster without HA resources (no master, standby)', () => {
    const o = parseHaStatus([
      { id: 'quorum', node: 'n1', quorate: 1, status: 'OK', type: 'quorum' },
      { 'armed-state': 'standby', id: 'fencing', node: 'n1', status: 'standby (CRM watchdog standby)', type: 'fencing' },
    ])
    expect(o.master).toBeUndefined()
    expect(o.armed).toBe('standby')
    expect(o.lrms).toEqual([])
  })

  it('treats a dead master and LRM as not active', () => {
    const o = parseHaStatus([
      { id: 'master', node: 'n1', status: 'n1 (old timestamp - dead?, Sun Nov  1 17:00:00 2026)', type: 'master' },
      { id: 'lrm:n2', node: 'n2', status: 'n2 (old timestamp - dead?, Sun Nov  1 17:00:00 2026)', type: 'lrm' },
    ])
    expect(o.master).toBeUndefined()
    expect(o.lrms[0]?.kind).toBe('dead')
    expect(o.lrms[0]?.tone).toBe('error')
  })

  it('merges live services with configs and lists not yet seen ones', () => {
    const rows = serviceRows(parseHaStatus(CURRENT).services, [
      { sid: 'vm:6200', state: 'stopped', comment: 'probe', digest: 'd1' },
      { sid: 'ct:6201', state: 'started', max_restart: 3 },
    ])
    expect(rows.map((r) => [r.sid, r.state.label, r.requestState, r.node])).toEqual([
      ['vm:6200', '已停止', 'stopped', 'pvelab-c1'],
      ['ct:6201', '等待 CRM', 'started', undefined],
    ])
    expect(rows[0]?.config?.digest).toBe('d1')
    expect(rows[1]?.maxRestart).toBe(3)
    expect(rows[1]?.kind).toBe('ct')
  })
})

describe('sid', () => {
  it('parses guest sids only', () => {
    expect(parseSid('vm:100')).toEqual({ kind: 'vm', vmid: 100 })
    expect(parseSid('ct:200')).toEqual({ kind: 'ct', vmid: 200 })
    expect(parseSid('fa:1')).toBeNull()
  })
})

describe('resource params', () => {
  it('leaves defaults out on create', () => {
    expect(resourceParams({ ...resourceForm(null), sid: 'vm:6200' }, null)).toEqual({ sid: 'vm:6200', state: 'started' })
    expect(
      resourceParams({ sid: 'ct:1', state: 'stopped', maxRestart: 3, maxRelocate: 0, failback: false, autoRebalance: false, comment: ' db ' }, null),
    ).toEqual({ sid: 'ct:1', state: 'stopped', max_restart: 3, max_relocate: 0, failback: 0, 'auto-rebalance': 0, comment: 'db' })
  })

  it('deletes defaults and a cleared comment on edit, with digest', () => {
    const existing = { sid: 'vm:1', state: 'started' as const, max_restart: 3, failback: 0 as const, comment: 'x', digest: 'abc' }
    const f = resourceForm(existing)
    expect(f).toMatchObject({ maxRestart: 3, failback: false, comment: 'x' })
    expect(resourceParams({ ...f, maxRestart: 1, failback: true, comment: '', state: 'disabled' }, existing)).toEqual({
      state: 'disabled',
      delete: 'max_restart,max_relocate,failback,auto-rebalance,comment',
      digest: 'abc',
    })
  })

  it('maps the "enabled" alias to started', () => {
    expect(resourceForm({ sid: 'vm:1', state: 'enabled' }).state).toBe('started')
  })
})

describe('rules', () => {
  it('parses and prints node priorities', () => {
    expect(parseRuleNodes('pvelab-c1:2,pvelab-c2')).toEqual([{ node: 'pvelab-c1', priority: 2 }, { node: 'pvelab-c2', priority: undefined }])
    expect(stringifyRuleNodes([{ node: 'a', priority: 2 }, { node: 'b' }, { node: 'c', priority: 0 }])).toBe('a:2,b,c')
  })

  it('builds node affinity create params', () => {
    const f = { ...ruleForm('node-affinity'), rule: 'e2e-ha-pin', resources: ['vm:1', 'ct:2'], nodes: [{ node: 'n1', priority: 2 }, { node: 'n2' }], strict: true, comment: 'pin' }
    expect(ruleParams(f, null)).toEqual({ type: 'node-affinity', rule: 'e2e-ha-pin', resources: 'vm:1,ct:2', nodes: 'n1:2,n2', strict: 1, comment: 'pin' })
  })

  it('builds resource affinity update params (re-enable, clear comment)', () => {
    const existing = { rule: 'r', type: 'resource-affinity' as const, resources: 'vm:1,vm:2', affinity: 'negative' as const, disable: 1 as const, comment: 'c', digest: 'd' }
    const f = { ...ruleForm('resource-affinity', existing), enabled: true, comment: '', affinity: 'positive' as const }
    expect(f.resources).toEqual(['vm:1', 'vm:2'])
    expect(ruleParams(f, existing)).toEqual({ type: 'resource-affinity', resources: 'vm:1,vm:2', affinity: 'positive', delete: 'disable,comment', digest: 'd' })
  })

  it('turns strict off explicitly on edit and disables', () => {
    const existing = { rule: 'r', type: 'node-affinity' as const, resources: 'vm:1', nodes: 'n1', strict: 1 as const }
    const f = { ...ruleForm('node-affinity', existing), strict: false, enabled: false }
    expect(ruleParams(f, existing)).toMatchObject({ strict: 0, disable: 1 })
  })

  it('validates the form', () => {
    expect(ruleFormErrors({ ...ruleForm('resource-affinity'), rule: 'x y', resources: ['vm:1'] }, true)).toEqual({
      rule: expect.any(String),
      resources: '至少选择 2 个 HA 资源',
    })
    expect(ruleFormErrors({ ...ruleForm('node-affinity'), resources: ['vm:1'] }, false)).toEqual({ nodes: '至少选择 1 个节点' })
    expect(newRuleId('node-affinity', () => 0)).toBe('node-rule-000000')
  })

  it('flattens rule errors', () => {
    expect(ruleErrors({ errors: { resources: ['conflict A', 'conflict B'], nodes: ['bad'] } })).toEqual([
      'resources: conflict A',
      'resources: conflict B',
      'nodes: bad',
    ])
    expect(ruleErrors({})).toEqual([])
  })
})

describe('CRS', () => {
  it('round-trips the crs property string', () => {
    const f = crsForm('ha=static,ha-rebalance-on-start=1,ha-auto-rebalance=1,ha-auto-rebalance-method=topsis,ha-auto-rebalance-threshold=40')
    expect(f).toMatchObject({ mode: 'static', rebalanceOnStart: true, autoRebalance: true, method: 'topsis', threshold: 40 })
    expect(crsParams(f)).toEqual({ crs: 'ha=static,ha-rebalance-on-start=1,ha-auto-rebalance=1,ha-auto-rebalance-threshold=40,ha-auto-rebalance-method=topsis' })
  })

  it('drops auto rebalance for basic mode and deletes an all-default value', () => {
    expect(crsParams({ ...crsForm('ha=basic,ha-auto-rebalance=1'), mode: 'basic' })).toEqual({ crs: 'ha=basic' })
    expect(crsParams(crsForm(undefined))).toEqual({ delete: 'crs' })
  })
})
