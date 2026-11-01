import type { Page } from '@playwright/test'

// Mocked HA API for the phone checks and the screenshots: three nodes (the
// third in maintenance), three resources, three rules (one with a conflict).

const now = () => Math.floor(Date.now() / 1000)

export function mockHa(page: Page, node: string) {
  const nodes = [node, 'pvelab-c2', 'pvelab-c3']
  const status = [
    { id: 'quorum', node, quorate: 1, status: 'OK', type: 'quorum' },
    { id: 'master', node: nodes[1], status: `${nodes[1]} (active, x)`, timestamp: now() - 4, type: 'master' },
    { 'armed-state': 'armed', id: 'fencing', node: nodes[1], status: 'armed (CRM watchdog active)', type: 'fencing' },
    { id: `lrm:${nodes[0]}`, node: nodes[0], status: `${nodes[0]} (active, watchdog active, x)`, timestamp: now() - 3, type: 'lrm' },
    { id: `lrm:${nodes[1]}`, node: nodes[1], status: `${nodes[1]} (active, watchdog active, x)`, timestamp: now() - 5, type: 'lrm' },
    { id: `lrm:${nodes[2]}`, node: nodes[2], status: `${nodes[2]} (maintenance mode, watchdog standby, x)`, timestamp: now() - 2, type: 'lrm' },
    { id: 'service:vm:101', sid: 'vm:101', node, state: 'started', request_state: 'started', crm_state: 'started', type: 'service', max_restart: 1, max_relocate: 1, failback: 1, 'auto-rebalance': 1 },
    { id: 'service:ct:200', sid: 'ct:200', node: nodes[1], state: 'migrate', request_state: 'started', crm_state: 'migrate', type: 'service', comment: '数据库', max_restart: 3, max_relocate: 2, failback: 0 },
    { id: 'service:vm:100', sid: 'vm:100', node, state: 'stopped', request_state: 'stopped', crm_state: 'stopped', type: 'service' },
  ]
  const manager = { manager_status: { master_node: nodes[1], node_status: { [nodes[0]]: 'online', [nodes[1]]: 'online', [nodes[2]]: 'maintenance' } } }
  const resources = [
    { sid: 'vm:101', state: 'started', type: 'vm', digest: 'a' },
    { sid: 'ct:200', state: 'started', type: 'ct', comment: '数据库', max_restart: 3, max_relocate: 2, failback: 0, digest: 'a' },
    { sid: 'vm:100', state: 'stopped', type: 'vm', digest: 'a' },
  ]
  const rules = [
    { rule: 'pin-web', type: 'node-affinity', resources: 'vm:101,ct:200', nodes: `${nodes[0]}:2,${nodes[1]}`, strict: 1, comment: '优先本机', order: 1, digest: 'r' },
    { rule: 'keep-apart', type: 'resource-affinity', resources: 'vm:100,vm:101', affinity: 'negative', order: 2, digest: 'r' },
    {
      rule: 'together',
      type: 'resource-affinity',
      resources: 'vm:100,vm:101',
      affinity: 'positive',
      order: 3,
      digest: 'r',
      errors: { resources: ['rule shares two or more resources with a negative resource affinity rule'] },
    },
  ]
  return Promise.all([
    page.route('**/api2/json/cluster/ha/status/current', (r) => r.fulfill({ json: { data: status } })),
    page.route('**/api2/json/cluster/ha/status/manager_status', (r) => r.fulfill({ json: { data: manager } })),
    page.route('**/api2/json/cluster/ha/resources', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { data: resources } }) : r.fallback())),
    page.route('**/api2/json/cluster/ha/rules', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { data: rules } }) : r.fallback())),
    page.route('**/api2/json/cluster/ha/groups', (r) => r.fulfill({ status: 500, json: { data: null, message: 'cannot index groups: ha groups have been migrated to rules\n' } })),
  ])
}
