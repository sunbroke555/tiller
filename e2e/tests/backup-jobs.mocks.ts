// Mocked backup job API for the phone layout tests and the screenshots
// (backup-jobs.spec.ts, backup-jobs.visual.spec.ts).

import type { Page } from '@playwright/test'

const NOW = Math.floor(Date.now() / 1000)

export function mockJobs(node: string) {
  return [
    {
      id: 'e2e-bj-mock-nightly',
      type: 'vzdump',
      schedule: '21:00',
      enabled: 1,
      storage: 'local',
      comment: '每晚备份全部客户机',
      all: 1,
      exclude: '9000',
      mode: 'snapshot',
      compress: 'zstd',
      'prune-backups': { 'keep-daily': '7', 'keep-weekly': '4' },
      'notes-template': '{{guestname}} 每日备份',
      'next-run': NOW + 5 * 3600,
    },
    {
      id: 'e2e-bj-mock-weekly',
      type: 'vzdump',
      schedule: 'sun 01:00',
      enabled: 0,
      node,
      storage: 'local',
      comment: '数据库每周冷备',
      vmid: '100,200',
      mode: 'stop',
      compress: 'zstd',
      'next-run': NOW + 3 * 86400,
    },
    {
      id: 'backup-6f1c2a9e-1b2c',
      type: 'vzdump',
      schedule: 'mon..fri 7..18:00/15',
      enabled: 1,
      storage: 'local',
      pool: 'lab-pool',
      mode: 'snapshot',
      compress: 'lzo',
      'notification-mode': 'legacy-sendmail',
      mailto: 'ops@example.com',
      mailnotification: 'failure',
      'next-run': NOW - 60,
    },
  ]
}

export const MOCK_INCLUDED = {
  children: [
    {
      id: 100,
      name: 'tiny-vm',
      type: 'qemu',
      leaf: 0,
      children: [
        { id: '100:scsi0', name: 'local-lvm:vm-100-disk-0', included: 1, leaf: 1, reason: 'backup=yes' },
        { id: '100:scsi1', name: 'local-lvm:vm-100-disk-1', included: 0, leaf: 1, reason: 'backup=no' },
      ],
    },
    { id: 101, name: 'tiny-vm-2', type: 'qemu', leaf: 0, children: [] },
    {
      id: 200,
      name: 'alpine-ct',
      type: 'lxc',
      leaf: 0,
      children: [{ id: '200:rootfs', name: 'local-lvm:vm-200-disk-0', included: 1, leaf: 1, reason: 'rootfs' }],
    },
  ],
}

export const MOCK_UNCOVERED = [
  { vmid: 9000, name: 'tpl-tiny', type: 'qemu' },
  { vmid: 5801, name: 'e2e-bj-db', type: 'lxc' },
]

/** Serve the job list, job configs, included volumes and uncovered guests from mocks (GET only). */
export async function mockBackupApi(page: Page, node: string) {
  const list = mockJobs(node)
  await page.route(/\/api2\/json\/cluster\/backup(\/[^/?]+)?(\/included_volumes)?(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const m = /\/cluster\/backup(?:\/([^/?]+))?(\/included_volumes)?/.exec(new URL(route.request().url()).pathname)!
    if (!m[1]) return route.fulfill({ json: { data: list } })
    const job = list.find((j) => j.id === decodeURIComponent(m[1]!))
    if (!job) return route.fulfill({ status: 404, json: { data: null, message: 'no such job' } })
    if (m[2]) return route.fulfill({ json: { data: MOCK_INCLUDED } })
    const { 'next-run': _nextRun, ...config } = job
    return route.fulfill({ json: { data: config } })
  })
  await page.route('**/api2/json/cluster/backup-info/not-backed-up', (route) => route.fulfill({ json: { data: MOCK_UNCOVERED } }))
}
