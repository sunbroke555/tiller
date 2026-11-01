import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  bootModeLabel,
  cpuModelLabel,
  fetchJournal,
  formatPackageVersions,
  journalLineText,
  journalParams,
  journalSupportsStructured,
  kernelLabel,
  managerVersion,
  nodeGuestRows,
  notesUpdateParams,
  packageRows,
  parseJournal,
  parseLoadavg,
  repoStatus,
  serviceCommands,
  serviceState,
  type AptPackageVersion,
  type NodeService,
} from '@/api/node-summary'

import { needsConfirm } from './ServicesTab'
import { mergeLines, rangeToEpoch } from './useJournal'

// Shapes below are trimmed copies of real lab (PVE 9.2.2) / production (9.2.21) answers.

describe('status display', () => {
  const status = {
    'current-kernel': {
      machine: 'x86_64',
      release: '7.0.2-6-pve',
      sysname: 'Linux',
      version: '#1 SMP PREEMPT_DYNAMIC PMX 7.0.2-6 (2026-05-20T08:55Z)',
    },
    kversion: 'Linux 7.0.2-6-pve #1 SMP PREEMPT_DYNAMIC PMX 7.0.2-6 (2026-05-20T08:55Z)',
  }

  it('kernel like the official UI, falling back to kversion', () => {
    expect(kernelLabel(status)).toBe('Linux 7.0.2-6-pve (2026-05-20T08:55Z)')
    expect(kernelLabel({ kversion: 'Linux 6.8.12-1-pve #1 SMP' })).toBe('Linux 6.8.12-1-pve #1 SMP')
    expect(kernelLabel({})).toBeNull()
  })

  it('boot mode', () => {
    expect(bootModeLabel({ mode: 'legacy-bios' })).toBe('Legacy BIOS')
    expect(bootModeLabel({ mode: 'efi', secureboot: 0 })).toBe('EFI')
    expect(bootModeLabel({ mode: 'efi', secureboot: 1 })).toBe('EFI（安全启动）')
    expect(bootModeLabel(undefined)).toBeNull()
  })

  it('cpu model', () => {
    expect(cpuModelLabel({ cpus: 8, cores: 8, sockets: 1, model: 'Intel(R) Core(TM) i3-N305' })).toBe(
      '8 × Intel(R) Core(TM) i3-N305（1 插槽）',
    )
    expect(cpuModelLabel(undefined)).toBeNull()
  })

  it('manager version and load average', () => {
    expect(managerVersion('pve-manager/9.2.2/b9984c6d90a4bd80')).toBe('9.2.2')
    expect(parseLoadavg(['0.54', '0.49', '0.47'])).toEqual([0.54, 0.49, 0.47])
    expect(parseLoadavg(['x', '1', '2'])).toBeNull()
    expect(parseLoadavg(undefined)).toBeNull()
  })
})

describe('package versions', () => {
  const list: AptPackageVersion[] = [
    { Package: 'proxmox-ve', OldVersion: '9.2.0', Version: '9.2.0', CurrentState: 'Installed', RunningKernel: '7.0.2-6-pve' },
    {
      Package: 'pve-manager',
      OldVersion: '9.2.2',
      Version: '9.2.24',
      CurrentState: 'Installed',
      ManagerVersion: '9.2.2/b9984c6d90a4bd80',
    },
    { Package: 'libpve-common-perl', OldVersion: '9.1.0', Version: '9.1.0', CurrentState: 'Installed' },
    { Package: 'zfsutils-linux', Version: '2.3.4-pve1', CurrentState: 'ConfigFiles' },
  ]

  it('copy text matches the official window', () => {
    expect(formatPackageVersions(list)).toBe(
      [
        'proxmox-ve: 9.2.0 (running kernel: 7.0.2-6-pve)',
        'pve-manager: 9.2.2 (running version: 9.2.2/b9984c6d90a4bd80)',
        'libpve-common-perl: 9.1.0',
        'zfsutils-linux: not correctly installed',
      ].join('\n'),
    )
  })

  it('rows note updates and broken installs', () => {
    const rows = packageRows(list)
    expect(rows[0]).toEqual({ key: '0:proxmox-ve', name: 'proxmox-ve', version: '9.2.0', note: '运行内核 7.0.2-6-pve' })
    expect(rows[1]).toMatchObject({ version: '9.2.2', candidate: '9.2.24', note: '运行版本 9.2.2/b9984c6d90a4bd80' })
    expect(rows[3]).toEqual({ key: '3:zfsutils-linux', name: 'zfsutils-linux', version: null })
  })
})

describe('repoStatus (NodeInfoRepoStatus)', () => {
  const repos = (enterprise?: 0 | 1, noSub?: 0 | 1, test?: 0 | 1) => [
    { handle: 'enterprise', name: 'Enterprise', status: enterprise },
    { handle: 'no-subscription', name: 'No-Subscription', status: noSub },
    { handle: 'test', name: 'Test', status: test },
  ]
  it.each([
    [repos(0, 1), false, 'non-production'], // the lab
    [repos(1, 0), true, 'ok'],
    [repos(1, 0), false, 'no-sub'],
    [repos(0, 0), false, 'no-repo'],
    [repos(undefined, undefined, 1), true, 'non-production'],
  ] as const)('%#', (r, active, expected) => {
    expect(repoStatus(r, active)).toBe(expected)
  })
})

describe('services', () => {
  const svc = (over: Partial<NodeService>): NodeService => ({
    service: 'cron',
    name: 'cron',
    state: 'running',
    'unit-state': 'enabled',
    'active-state': 'active',
    ...over,
  })

  it('commands follow the official button rules', () => {
    expect(serviceCommands(svc({}))).toEqual(['reload', 'restart', 'stop'])
    expect(serviceCommands(svc({ service: 'pveproxy', name: 'pveproxy' }))).toEqual(['reload', 'restart'])
    expect(serviceCommands(svc({ state: 'dead', 'active-state': 'inactive' }))).toEqual(['start'])
    expect(serviceCommands(svc({ state: 'dead', 'unit-state': 'not-found' }))).toEqual([])
    expect(serviceCommands(svc({ state: 'dead', 'unit-state': 'masked' }))).toEqual([])
  })

  it('state labels', () => {
    expect(serviceState(svc({}))).toEqual({ label: '运行中', tone: 'ok' })
    expect(serviceState(svc({ state: 'dead', 'active-state': 'inactive' }))).toEqual({ label: '已停止', tone: 'off' })
    expect(serviceState(svc({ state: 'dead', 'active-state': 'failed' })).tone).toBe('bad')
    expect(serviceState(svc({ state: 'dead', 'unit-state': 'not-found' })).label).toBe('未安装')
  })

  it('asks before stopping anything or restarting pveproxy', () => {
    expect(needsConfirm('cron', 'stop')).toBe(true)
    expect(needsConfirm('cron', 'restart')).toBe(false)
    expect(needsConfirm('pveproxy', 'restart')).toBe(true)
    expect(needsConfirm('pveproxy', 'reload')).toBe(false)
  })
})

describe('notes', () => {
  it('sends the text, or deletes the key when empty', () => {
    expect(notesUpdateParams('# hi\n\n', 'abc')).toEqual({ description: '# hi', digest: 'abc' })
    expect(notesUpdateParams('   \n', 'abc')).toEqual({ delete: 'description', digest: 'abc' })
  })
})

describe('journal', () => {
  const C1 = 's=5e3c;i=879;b=8a0c;m=15acff477;t=65f286b5b8d8b;x=220d'
  const C2 = 's=5e3c;i=87d;b=8a0c;m=15ad01faa;t=65f286b5bb8be;x=184b'

  it('parses the plain format: cursors first and last', () => {
    const chunk = parseJournal([C1, 'Nov 01 04:04:24 pve-lab systemd[1]: session-28.scope: Deactivated successfully.', C2])
    expect(chunk.structured).toBe(false)
    expect(chunk.firstCursor).toBe(C1)
    expect(chunk.lastCursor).toBe(C2)
    expect(chunk.lines.map((l) => l.text)).toEqual(['Nov 01 04:04:24 pve-lab systemd[1]: session-28.scope: Deactivated successfully.'])
    expect(parseJournal([]).lines).toEqual([])
    expect(parseJournal([C1, C2]).lines).toEqual([])
  })

  it('parses the structured format', () => {
    const chunk = parseJournal([
      { ty: 'cursor', c: C1 },
      { ty: 'host', h: 'pve' },
      { ty: 'identifiers', ids: ['systemd', 'pveproxy'] },
      { ty: 'units', names: ['cron.service'] },
      { id: 'systemd', msg: 'session-19447.scope: Deactivated successfully.', p: 6, pid: 1, t: 1793477254103986 },
      { ty: 'reboot', t: 1793477254104000 },
      { id: 'kernel', msg: 'EXT4-fs error', p: 3, t: 1793477254105289 },
      { ty: 'cursor', c: C2 },
    ])
    expect(chunk.structured).toBe(true)
    expect(chunk.firstCursor).toBe(C1)
    expect(chunk.lastCursor).toBe(C2)
    expect(chunk.host).toBe('pve')
    expect(chunk.identifiers).toEqual(['systemd', 'pveproxy'])
    expect(chunk.units).toEqual(['cron.service'])
    expect(chunk.lines).toHaveLength(3)
    expect(chunk.lines[0]).toMatchObject({ identifier: 'systemd', pid: 1, priority: 6 })
    expect(chunk.lines[1]!.reboot).toBe(true)
    expect(chunk.lines[2]).toMatchObject({ identifier: 'kernel', priority: 3, pid: undefined })
    expect(journalLineText(chunk.lines[2]!, 'pve')).toMatch(/ pve kernel: EXT4-fs error$/)
  })

  it('builds params like the official viewer', () => {
    expect(journalParams({ mode: 'tail', lastentries: 500 }, { priority: '3', service: 'pve*' }, false)).toEqual({ lastentries: 500 })
    expect(journalParams({ mode: 'tail', lastentries: 500 }, { priority: '3', service: ' pve* ' }, true, true)).toEqual({
      lastentries: 500,
      structured: 1,
      identifiers: 1,
      units: 1,
      priority: '3',
      service: 'pve*',
    })
    expect(journalParams({ mode: 'follow', startcursor: C2 }, { unit: 'cron.service' }, true)).toEqual({
      startcursor: C2,
      structured: 1,
      unit: 'cron',
    })
    // kernel only overrides identifier / unit
    expect(journalParams({ mode: 'older', endcursor: C1, lastentries: 500 }, { kernel: true, service: 'x', unit: 'y' }, true)).toEqual({
      endcursor: C1,
      lastentries: 500,
      structured: 1,
      kernel: 1,
    })
    expect(journalParams({ mode: 'range', since: 1, until: 2 }, {}, true)).toEqual({ since: 1, until: 2, structured: 1 })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('falls back to the plain format on PVE without "structured" and remembers it', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const qs = new URL(url, 'http://x').searchParams
        calls.push(qs.toString())
        if (qs.has('structured')) {
          return new Response(
            JSON.stringify({
              data: null,
              message: 'Parameter verification failed.',
              errors: { structured: 'property is not defined in schema and the schema does not allow additional properties' },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify({ data: [C1, 'line', C2] }), { headers: { 'Content-Type': 'application/json' } })
      }),
    )
    const chunk = await fetchJournal('old', { mode: 'tail', lastentries: 10 }, { priority: '3' })
    expect(chunk.lines).toHaveLength(1)
    expect(journalSupportsStructured('old')).toBe(false)
    await fetchJournal('old', { mode: 'follow', startcursor: C2 })
    expect(calls).toEqual([
      'lastentries=10&structured=1&priority=3',
      'lastentries=10',
      `startcursor=${encodeURIComponent(C2).replace(/%20/g, '+')}`,
    ])
  })
})

describe('journal helpers', () => {
  it('range covers whole local days', () => {
    const r = rangeToEpoch({ since: '2026-10-30', until: '2026-11-01' })!
    expect(r.until - r.since).toBe(3 * 86400)
    expect(new Date(r.since * 1000).getHours()).toBe(0)
    expect(rangeToEpoch({ since: '2026-11-02', until: '2026-11-01' })).toBeNull()
    expect(rangeToEpoch({ since: 'nope', until: '2026-11-01' })).toBeNull()
  })

  it('keeps at most max lines', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ key: String(i), message: String(i) }))
    const appended = mergeLines(mk(4), mk(3), 'append', 5)
    expect(appended.lines).toHaveLength(5)
    expect(appended.dropped).toBe(true)
    const prepended = mergeLines(mk(4), mk(3), 'prepend', 5)
    expect(prepended.lines).toHaveLength(5)
    expect(prepended.dropped).toBe(false)
  })
})

describe('node guest index', () => {
  it('turns /nodes/{node}/qemu?full=1 and /lxc into resource rows', () => {
    const rows = nodeGuestRows(
      'pve-lab',
      [
        { vmid: 101, name: 'b', status: 'running', qmpstatus: 'running', cpu: 0.1, cpus: 1, mem: 10, maxmem: 64 },
        { vmid: 9000, name: 'tpl', status: 'stopped', qmpstatus: 'stopped', template: 1 },
        { vmid: 100, name: 'a', status: 'running', qmpstatus: 'paused', tags: 'test;demo', lock: 'backup' },
      ],
      [{ vmid: '200', name: 'ct', status: 'running', maxmem: 128 }],
    )
    expect(rows.map((r) => [r.id, r.status, r.template ?? 0])).toEqual([
      ['qemu/100', 'paused', 0],
      ['qemu/101', 'running', 0],
      ['lxc/200', 'running', 0],
      ['qemu/9000', 'stopped', 1],
    ])
    expect(rows[0]).toMatchObject({ type: 'qemu', vmid: 100, node: 'pve-lab', tags: 'test;demo', lock: 'backup' })
    expect(rows[1]).toMatchObject({ cpu: 0.1, maxcpu: 1, mem: 10, maxmem: 64 })
    expect(rows[2]).toMatchObject({ type: 'lxc', vmid: 200, maxmem: 128 })
  })
})
