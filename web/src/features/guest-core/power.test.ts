import { describe, expect, it } from 'vitest'

import { guestCoreActions } from './actions'
import { canResume, canStart, canStop, groupOf, powerModes, powerRequest, powerState, powerTitle } from './power'

const g = (status: string, extra: { lock?: string; template?: 0 | 1 } = {}) => ({ status, ...extra })

describe('powerState', () => {
  it('treats a stopped VM with lock=suspended as hibernated', () => {
    const s = powerState(g('stopped', { lock: 'suspended' }))
    expect(s).toMatchObject({ hibernated: true, stopped: false, blockingLock: null })
    expect(canStart(s)).toBe(false)
    expect(canResume(s)).toBe(true)
  })

  it('paused / suspended / prelaunch are resumable and stoppable', () => {
    for (const status of ['paused', 'suspended', 'prelaunch']) {
      const s = powerState(g(status))
      expect(canResume(s)).toBe(true)
      expect(canStop(s)).toBe(true)
      expect(canStart(s)).toBe(false)
    }
  })

  it('templates cannot be started', () => {
    expect(canStart(powerState(g('stopped', { template: 1 })))).toBe(false)
  })

  it('reports blocking locks', () => {
    expect(powerState(g('running', { lock: 'backup' })).blockingLock).toBe('backup')
  })
})

describe('powerModes', () => {
  const running = powerState(g('running'))

  it('offers shutdown, stop, pause and hibernate for a running VM', () => {
    expect(powerModes('off', 'qemu', running).map((m) => m.mode)).toEqual(['shutdown', 'stop', 'pause', 'hibernate'])
  })

  it('offers only shutdown and stop for a running CT', () => {
    expect(powerModes('off', 'lxc', running).map((m) => m.mode)).toEqual(['shutdown', 'stop'])
    expect(powerModes('restart', 'lxc', running).map((m) => m.mode)).toEqual(['reboot'])
  })

  it('offers reboot and reset for a running VM', () => {
    expect(powerModes('restart', 'qemu', running).map((m) => m.mode)).toEqual(['reboot', 'reset'])
  })

  it('a paused VM can only be force-stopped', () => {
    expect(powerModes('off', 'qemu', powerState(g('paused'))).map((m) => m.mode)).toEqual(['stop'])
    expect(powerModes('restart', 'qemu', powerState(g('paused')))).toEqual([])
  })

  it('marks the forceful modes destructive', () => {
    const modes = powerModes('off', 'qemu', running)
    expect(modes.find((m) => m.mode === 'stop')?.destructive).toBe(true)
    expect(modes.find((m) => m.mode === 'shutdown')?.recommended).toBe(true)
  })

  it('maps modes to their group', () => {
    expect(groupOf('reset')).toBe('restart')
    expect(groupOf('hibernate')).toBe('off')
  })
})

describe('powerRequest', () => {
  it('shutdown with timeout and forceStop', () => {
    expect(powerRequest('shutdown', { timeout: 60, forceStop: true })).toEqual({
      command: 'shutdown',
      params: { timeout: 60, forceStop: 1 },
    })
    expect(powerRequest('shutdown')).toEqual({ command: 'shutdown', params: {} })
  })

  it('stop can overrule a running shutdown', () => {
    expect(powerRequest('stop', { overruleShutdown: true })).toEqual({ command: 'stop', params: { 'overrule-shutdown': 1 } })
    expect(powerRequest('stop')).toEqual({ command: 'stop', params: {} })
  })

  it('pause and hibernate both use suspend', () => {
    expect(powerRequest('pause')).toEqual({ command: 'suspend', params: {} })
    expect(powerRequest('hibernate', { statestorage: 'local-lvm' })).toEqual({
      command: 'suspend',
      params: { todisk: 1, statestorage: 'local-lvm' },
    })
    expect(powerRequest('hibernate')).toEqual({ command: 'suspend', params: { todisk: 1 } })
  })

  it('reset and reboot', () => {
    expect(powerRequest('reset')).toEqual({ command: 'reset', params: {} })
    expect(powerRequest('reboot')).toEqual({ command: 'reboot', params: {} })
  })

  it('titles tasks in Chinese', () => {
    expect(powerTitle('stop', 'web-01')).toBe('强制停止 web-01')
  })
})

describe('guestCoreActions', () => {
  const ctx = (status: string, type: 'qemu' | 'lxc' = 'qemu', extra: { lock?: string; template?: 0 | 1 } = {}) => ({
    node: 'pve',
    type,
    vmid: 100,
    name: 'web',
    navigate: () => undefined,
    guest: { id: `${type}/100`, type, vmid: 100, node: 'pve', status, ...extra },
  })
  const visible = (c: ReturnType<typeof ctx>) =>
    guestCoreActions.filter((a) => (!a.types || a.types.includes(c.type)) && (a.visible?.(c) ?? true)).map((a) => a.id)
  const primary = (c: ReturnType<typeof ctx>) =>
    guestCoreActions
      .filter((a) => a.placement === 'primary' && (!a.types || a.types.includes(c.type)) && (a.visible?.(c) ?? true))
      .map((a) => a.id)

  it('stopped VM: only start', () => {
    expect(visible(ctx('stopped'))).toEqual(['start'])
  })

  it('running VM: two primary buttons, leaving room for the console', () => {
    expect(primary(ctx('running'))).toEqual(['shutdown', 'reboot'])
    expect(visible(ctx('running'))).toEqual(['shutdown', 'reboot', 'stop', 'pause', 'hibernate', 'reset'])
  })

  it('running CT has no pause / hibernate / reset', () => {
    expect(visible(ctx('running', 'lxc'))).toEqual(['shutdown', 'reboot', 'stop'])
  })

  it('hibernated VM resumes instead of starting', () => {
    expect(visible(ctx('stopped', 'qemu', { lock: 'suspended' }))).toEqual(['resume'])
  })

  it('template has no power actions', () => {
    expect(visible(ctx('stopped', 'qemu', { template: 1 }))).toEqual([])
  })

  it('locked guest: start disabled with the reason', () => {
    const c = ctx('stopped', 'qemu', { lock: 'backup' })
    expect(guestCoreActions.find((a) => a.id === 'start')!.disabled!(c)).toBe('已锁定（backup）')
  })
})
