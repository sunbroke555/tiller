import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchSpiceConfig, startTermProxy, startVncProxy, targetKey, type ConsoleTarget } from '@/api/console'
import type { AptRepositories, AptUpdate } from '@/api/node-updates'

import { nodeUpgradePath, parseUpdatesView } from './paths'
import {
  classifyOrigin,
  componentNotice,
  filterUpdates,
  formatRepoOptions,
  groupUpdates,
  isKernelPackage,
  repoFileGroups,
  repoState,
  standardRepoFlags,
  standardRepoStatus,
} from './updates'

const upd = (Package: string, Origin: string, extra: Partial<AptUpdate> = {}): AptUpdate => ({
  Package,
  Origin,
  Version: '2.0',
  OldVersion: '1.0',
  Title: `${Package} title`,
  ...extra,
})

describe('package list', () => {
  const list = [
    upd('pve-docs', 'Proxmox', { Version: '9.2.13', OldVersion: '9.2.1', Description: 'Proxmox VE Documentation files' }),
    upd('cifs-utils', 'Debian'),
    upd('librados2', 'Proxmox'),
    upd('foo', ''),
    upd('bar', 'Ubuntu'),
    upd('proxmox-kernel-7.0', 'Proxmox'),
  ]

  it('groups by origin: Proxmox, Debian, others A–Z, unknown last; packages A–Z', () => {
    const groups = groupUpdates(list)
    expect(groups.map((g) => g.origin)).toEqual(['Proxmox', 'Debian', 'Ubuntu', ''])
    expect(groups[0]!.items.map((u) => u.Package)).toEqual(['librados2', 'proxmox-kernel-7.0', 'pve-docs'])
  })

  it('filters on name, title and versions; the long description only when shown', () => {
    expect(filterUpdates(list, '').length).toBe(list.length)
    expect(filterUpdates(list, 'RADOS').map((u) => u.Package)).toEqual(['librados2'])
    expect(filterUpdates(list, '9.2.13').map((u) => u.Package)).toEqual(['pve-docs'])
    expect(filterUpdates(list, 'documentation')).toEqual([])
    expect(filterUpdates(list, 'documentation', { description: true }).map((u) => u.Package)).toEqual(['pve-docs'])
    // all terms must match
    expect(filterUpdates(list, 'pve docs').map((u) => u.Package)).toEqual(['pve-docs'])
    expect(filterUpdates(list, 'pve nothing')).toEqual([])
  })

  it('flags kernel packages', () => {
    expect(isKernelPackage('proxmox-kernel-7.0')).toBe(true)
    expect(isKernelPackage('pve-kernel-6.2')).toBe(true)
    expect(isKernelPackage('proxmox-kernel-7.0.14-26-pve-signed')).toBe(true)
    expect(isKernelPackage('proxmox-kernel-helper')).toBe(false)
    expect(isKernelPackage('pve-manager')).toBe(false)
  })
})

/** Shape of the lab's answer (pvelab-c3): no-subscription + Ceph no-subscription, enterprise disabled. */
function labRepos(overrides: Partial<AptRepositories> = {}): AptRepositories {
  const src = (path: string, Components: string[], Enabled: 0 | 1, URIs = ['http://download.proxmox.com/debian/pve']) => ({
    path,
    'file-type': 'sources' as const,
    repositories: [
      {
        Types: ['deb'],
        URIs,
        Suites: ['trixie'],
        Components,
        Options: [{ Key: 'Signed-By', Values: ['/usr/share/keyrings/proxmox-archive-keyring.gpg'] }],
        FileType: 'sources' as const,
        Enabled,
      },
    ],
  })
  return {
    digest: 'abc',
    errors: [],
    files: [
      src('/etc/apt/sources.list.d/proxmox.sources', ['pve-no-subscription'], 1),
      src('/etc/apt/sources.list.d/pve-enterprise.sources', ['pve-enterprise'], 0, ['https://enterprise.proxmox.com/debian/pve']),
      {
        path: '/etc/apt/sources.list.d/debian.sources',
        'file-type': 'sources',
        repositories: [
          { Types: ['deb'], URIs: ['http://deb.debian.org/debian/'], Suites: ['trixie', 'trixie-updates'], Components: ['main', 'contrib'], FileType: 'sources', Enabled: 1 },
          { Types: ['deb'], URIs: ['http://security.debian.org/debian-security/'], Suites: ['trixie-security'], Components: ['main'], FileType: 'sources', Enabled: 1 },
        ],
      },
      src('/etc/apt/sources.list.d/ceph-no-subscription.sources', ['no-subscription'], 1, ['http://download.proxmox.com/debian/ceph-squid']),
    ],
    infos: [
      { path: '/etc/apt/sources.list.d/proxmox.sources', index: 0, kind: 'origin', message: 'Proxmox' },
      { path: '/etc/apt/sources.list.d/pve-enterprise.sources', index: 0, kind: 'origin', message: 'Proxmox' },
      { path: '/etc/apt/sources.list.d/debian.sources', index: 0, kind: 'origin', message: 'Debian' },
      { path: '/etc/apt/sources.list.d/debian.sources', index: 1, kind: 'origin', message: 'Debian' },
    ],
    'standard-repos': [
      { handle: 'enterprise', name: 'Enterprise', status: 0 },
      { handle: 'no-subscription', name: 'No-Subscription', status: 1 },
      { handle: 'test', name: 'Test' },
      { handle: 'ceph-squid-enterprise', name: 'Ceph Squid Enterprise', status: 0 },
      { handle: 'ceph-squid-no-subscription', name: 'Ceph Squid No-Subscription', status: 1 },
      { handle: 'ceph-tentacle-enterprise', name: 'Ceph Tentacle Enterprise' },
    ],
    ...overrides,
  }
}

describe('repositories', () => {
  it('attaches index, origin and enabled state per file', () => {
    const groups = repoFileGroups(labRepos())
    expect(groups.map((g) => g.rows.length)).toEqual([1, 1, 2, 1])
    const debian = groups[2]!
    expect(debian.rows.map((r) => [r.index, r.origin, r.enabled])).toEqual([
      [0, 'Debian', true],
      [1, 'Debian', true],
    ])
    expect(groups[1]!.rows[0]!.enabled).toBe(false)
    expect(groups[3]!.rows[0]!.origin).toBe('')
  })

  it('collects warnings (also the pre-upgrade hint) and parse errors', () => {
    const data = labRepos({
      infos: [
        { path: '/etc/apt/sources.list.d/proxmox.sources', index: 0, kind: 'warning', property: 'Suites', message: "suite 'bookworm' should not be used" },
        { path: '/etc/apt/sources.list.d/proxmox.sources', index: 0, kind: 'ignore-pre-upgrade-warning', property: 'Suites', message: 'pre-upgrade' },
      ],
      errors: [{ path: '/etc/apt/sources.list.d/broken.list', error: 'malformed entry' }],
    })
    const groups = repoFileGroups(data)
    expect(groups[0]!.rows[0]!.warnings.map((w) => w.message)).toEqual(["suite 'bookworm' should not be used", 'pre-upgrade'])
    expect(groups.at(-1)).toMatchObject({ path: '/etc/apt/sources.list.d/broken.list', rows: [], error: 'malformed entry', fileType: 'list' })
  })

  it('formats options per file type and flags no-subscription / test components', () => {
    const opts = [{ Key: 'Signed-By', Values: ['/a.gpg', '/b.gpg'] }]
    expect(formatRepoOptions(opts, 'sources')).toEqual(['Signed-By: /a.gpg /b.gpg'])
    expect(formatRepoOptions(opts, 'list')).toEqual(['Signed-By=/a.gpg,/b.gpg'])
    expect(componentNotice(['pve-no-subscription'])?.kind).toBe('no-subscription')
    expect(componentNotice(['no-subscription'])?.kind).toBe('no-subscription')
    expect(componentNotice(['pvetest'])?.kind).toBe('test')
    expect(componentNotice(['main', 'contrib'])).toBeNull()
    expect(componentNotice(['pve-enterprise'])).toBeNull()
  })

  it('classifies origins like the official grid', () => {
    expect(classifyOrigin('Proxmox')).toBe('Proxmox')
    expect(classifyOrigin(' Debian Backports')).toBe('Debian')
    expect(classifyOrigin('Ubuntu')).toBe('Other')
    expect(classifyOrigin(undefined)).toBe('Other')
  })

  it('standard repository flags and status', () => {
    expect(standardRepoFlags(labRepos()['standard-repos'])).toEqual({
      enterprise: false,
      noSubscription: true,
      test: false,
      cephEnterprise: false,
      cephNoSubscription: true,
      cephTest: false,
    })
    expect(standardRepoStatus({ handle: 'test', name: 'Test' })).toBe('missing')
    expect(standardRepoStatus({ handle: 'enterprise', name: 'E', status: 0 })).toBe('disabled')
    expect(standardRepoStatus({ handle: 'x', name: 'X', status: 1 })).toBe('enabled')
  })
})

describe('repoState (APTRepositories.updateState)', () => {
  it('lab: updates available, no-subscription warnings for PVE and Ceph', () => {
    const s = repoState(labRepos(), false)
    expect(s.status).toBe('warning')
    expect(s.text).toBe('2 条警告')
    expect(s.messages).toEqual([
      { status: 'good', message: '可以获取 Proxmox VE 的更新' },
      { status: 'warning', message: '不建议在生产环境使用 no-subscription 软件源！' },
      { status: 'warning', message: '不建议在生产环境使用 Ceph no-subscription/main 软件源！' },
    ])
  })

  it('no PVE repository enabled is critical', () => {
    const data = labRepos({
      'standard-repos': [
        { handle: 'enterprise', name: 'Enterprise', status: 0 },
        { handle: 'no-subscription', name: 'No-Subscription', status: 0 },
      ],
    })
    const s = repoState(data, false)
    expect(s.status).toBe('critical')
    expect(s.text).toBe('没有启用 Proxmox VE 软件源')
    expect(s.messages[0]).toEqual({ status: 'critical', message: '没有启用任何 Proxmox VE 软件源，无法获取更新！' })
  })

  it('enterprise with and without a subscription', () => {
    const data = labRepos({ 'standard-repos': [{ handle: 'enterprise', name: 'Enterprise', status: 1 }] })
    const ok = repoState(data, true)
    expect(ok.status).toBe('good')
    expect(ok.text).toBe('一切正常，已配置可用于生产环境的软件源。')
    expect(ok.messages).toEqual([{ status: 'good', message: '可以获取 Proxmox VE 的受支持更新' }])
    const nosub = repoState(data, false)
    expect(nosub.status).toBe('warning')
    expect(nosub.messages).toEqual([{ status: 'warning', message: '已启用 enterprise 软件源，但没有有效订阅！' }])
  })

  it('test repository and misconfigured suites warn; parse errors are critical', () => {
    const data = labRepos({
      'standard-repos': [{ handle: 'test', name: 'Test', status: 1 }],
      infos: [{ path: '/etc/apt/sources.list.d/proxmox.sources', index: 0, kind: 'warning', property: 'Suites', message: 'x' }],
    })
    expect(repoState(data, false).messages.map((m) => m.message)).toEqual([
      '可以获取 Proxmox VE 的更新',
      '部分软件源的套件（Suites）配置有误',
      'test 软件源可能带来不稳定的更新，不建议在生产环境使用！',
    ])
    const broken = repoState(labRepos({ errors: [{ path: '/etc/apt/sources.list', error: 'bad line' }] }), false)
    expect(broken.status).toBe('critical')
    expect(broken.text).toBe('至少一个软件源文件解析失败')
    expect(broken.messages[0]).toEqual({ status: 'critical', message: '/etc/apt/sources.list - bad line' })
    // no "you get updates" while a file is broken
    expect(broken.messages.some((m) => m.status === 'good')).toBe(false)
  })
})

describe('upgrade shell', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('links to the node shell with cmd=upgrade', () => {
    expect(nodeUpgradePath('pvelab-c3')).toBe('/console/pvelab-c3/shell?cmd=upgrade')
    const t: ConsoleTarget = { kind: 'node', node: 'pve', cmd: 'upgrade' }
    expect(targetKey(t)).toBe('node:pve:upgrade')
    expect(targetKey({ kind: 'node', node: 'pve' })).toBe('node:pve')
  })

  it('passes cmd=upgrade to termproxy, vncshell and spiceshell', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url} ${String(init.body ?? '')}`)
        return new Response(JSON.stringify({ data: { port: 5900, ticket: 't', user: 'root@pam', upid: 'u' } }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    const t: ConsoleTarget = { kind: 'node', node: 'pve', cmd: 'upgrade' }
    await startTermProxy(t)
    await startVncProxy(t, { width: 640, height: 480 })
    await fetchSpiceConfig(t)
    expect(calls).toEqual([
      'POST /api2/json/nodes/pve/termproxy cmd=upgrade',
      'POST /api2/json/nodes/pve/vncshell websocket=1&width=640&height=480&cmd=upgrade',
      'POST /api2/json/nodes/pve/spiceshell cmd=upgrade',
    ])
  })

  it('picks the view from ?view=, defaulting by permission', () => {
    expect(parseUpdatesView(null, true)).toBe('updates')
    expect(parseUpdatesView(null, false)).toBe('repositories')
    expect(parseUpdatesView('versions', true)).toBe('versions')
    expect(parseUpdatesView('bogus', true)).toBe('updates')
  })
})
