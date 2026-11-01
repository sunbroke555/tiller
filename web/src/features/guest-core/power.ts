// Power state and power modes of a guest, independent of React.
//
// The action bar, the power sheet and the command palette all decide from the
// /cluster/resources entry (status, lock, template), which already reports
// QEMU's paused state ("paused", "suspended", "prelaunch"). A VM hibernated to
// disk is "stopped" with lock "suspended" and is resumed, not started.

import type { PowerCommand } from '@/api/guest-core'
import type { Params } from '@/api/client'
import type { GuestResource, GuestType } from '@/api/types'

export interface PowerState {
  running: boolean
  /** QEMU paused in RAM (pause) or not yet started (prelaunch). */
  paused: boolean
  /** QEMU hibernated to disk: stopped with lock=suspended. */
  hibernated: boolean
  stopped: boolean
  template: boolean
  /** A lock that blocks power commands (backup, migrate, clone, snapshot…). */
  blockingLock: string | null
}

export function powerState(g: Pick<GuestResource, 'status' | 'lock' | 'template'>): PowerState {
  const template = g.template === 1
  const hibernated = g.status === 'stopped' && g.lock === 'suspended'
  const paused = g.status === 'paused' || g.status === 'suspended' || g.status === 'prelaunch'
  return {
    running: g.status === 'running',
    paused,
    hibernated,
    stopped: g.status === 'stopped' && !hibernated,
    template,
    blockingLock: g.lock && g.lock !== 'suspended' ? g.lock : null,
  }
}

export const canStart = (s: PowerState) => s.stopped && !s.template
export const canResume = (s: PowerState) => !s.template && (s.paused || s.hibernated)
export const canShutdown = (s: PowerState) => s.running
export const canReboot = (s: PowerState) => s.running
/** Stop works for every non-stopped state (also paused). */
export const canStop = (s: PowerState) => !s.template && (s.running || s.paused)

// ------------------------------------------------------------------ modes

/** What the power sheet can do. */
export type PowerMode = 'shutdown' | 'stop' | 'pause' | 'hibernate' | 'reboot' | 'reset'

/** Which family the sheet shows: turning off, or restarting. */
export type PowerGroup = 'off' | 'restart'

export interface PowerModeInfo {
  mode: PowerMode
  label: string
  description: string
  /** Data loss possible: red confirm button. */
  destructive?: boolean
  /** Shown first and marked "推荐". */
  recommended?: boolean
}

export const POWER_MODES: Record<PowerMode, Omit<PowerModeInfo, 'mode'>> = {
  shutdown: { label: '正常关机', description: '通知系统关机（ACPI 或 Guest Agent）', recommended: true },
  stop: { label: '强制停止', description: '立即断电，未保存的数据会丢失', destructive: true },
  pause: { label: '暂停', description: '冻结运行，内存保留在主机上，可随时恢复' },
  hibernate: { label: '休眠', description: '把内存写入磁盘后停止，下次恢复时继续运行' },
  reboot: { label: '重启', description: '通知系统重新启动', recommended: true },
  reset: { label: '重置', description: '立即硬重启，相当于按下复位键，未保存的数据会丢失', destructive: true },
}

/** Modes offered for a group, guest type and state, in display order. */
export function powerModes(group: PowerGroup, type: GuestType, s: PowerState): PowerModeInfo[] {
  const list: PowerMode[] = []
  if (group === 'off') {
    if (s.running) list.push('shutdown')
    if (canStop(s)) list.push('stop')
    if (type === 'qemu' && s.running) list.push('pause', 'hibernate')
  } else if (s.running) {
    list.push('reboot')
    if (type === 'qemu') list.push('reset')
  }
  return list.map((mode) => ({ mode, ...POWER_MODES[mode] }))
}

export function groupOf(mode: PowerMode): PowerGroup {
  return mode === 'reboot' || mode === 'reset' ? 'restart' : 'off'
}

export interface PowerOptions {
  /** shutdown: seconds before giving up (or force-stopping). */
  timeout?: number
  /** shutdown: hard stop after the timeout. */
  forceStop?: boolean
  /** stop: abort a running shutdown task first. */
  overruleShutdown?: boolean
  /** hibernate: storage for the RAM image; empty = automatic. */
  statestorage?: string
}

/** The API call for a mode: POST .../status/{command} with params. */
export function powerRequest(mode: PowerMode, opts: PowerOptions = {}): { command: PowerCommand; params: Params } {
  switch (mode) {
    case 'shutdown': {
      const params: Params = {}
      if (opts.timeout !== undefined) params.timeout = opts.timeout
      if (opts.forceStop) params.forceStop = 1
      return { command: 'shutdown', params }
    }
    case 'stop':
      return { command: 'stop', params: opts.overruleShutdown ? { 'overrule-shutdown': 1 } : {} }
    case 'pause':
      return { command: 'suspend', params: {} }
    case 'hibernate':
      return { command: 'suspend', params: { todisk: 1, ...(opts.statestorage ? { statestorage: opts.statestorage } : {}) } }
    case 'reboot':
      return { command: 'reboot', params: opts.timeout !== undefined ? { timeout: opts.timeout } : {} }
    case 'reset':
      return { command: 'reset', params: {} }
  }
}

/** CT start with lxc-start's debug log level (POST .../lxc/{vmid}/status/start). */
export function debugStartParams(): Params {
  return { debug: 1 }
}

/** Task title for the toast: "关机 web-01". */
export function powerTitle(mode: PowerMode | 'start' | 'resume', name: string): string {
  const verb: Record<PowerMode | 'start' | 'resume', string> = {
    start: '启动',
    resume: '恢复',
    shutdown: '关机',
    stop: '强制停止',
    pause: '暂停',
    hibernate: '休眠',
    reboot: '重启',
    reset: '重置',
  }
  return `${verb[mode]} ${name}`
}

/** Task types of a running shutdown that "强制停止" can overrule. */
export function shutdownTaskType(type: GuestType): string {
  return type === 'qemu' ? 'qmshutdown' : 'vzshutdown'
}
