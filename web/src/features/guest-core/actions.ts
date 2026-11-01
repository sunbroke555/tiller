// Guest power actions (area guest-summary-power). Order range 100–199.
// Registered in features/guest/registry.ts.
//
// Running guest: 关机 and 重启 are primary (with 控制台 from the console area
// that fills the mobile dock's three slots); the other modes sit in "更多".
// 关机 / 重启 / 强制停止 / 暂停 / 休眠 / 重置 all open the power sheet
// (PowerDialog) with that mode preselected, so the user can still switch
// between the normal and the forceful way.

import { lazy } from 'react'
import { Bug, CirclePause, Moon, Play, Power, RotateCcw, Square, Zap } from 'lucide-react'

import { powerCommand } from '@/api/guest-core'
import { runTask } from '@/components/tasks/tracker'
import { LXC, QEMU, type GuestActionContext, type GuestActionDef } from '@/features/guest/types'

import { canReboot, canResume, canShutdown, canStart, canStop, debugStartParams, powerState, powerTitle } from './power'

const dialogs = {
  shutdown: lazy(() => import('./PowerDialog').then((m) => ({ default: m.ShutdownDialog }))),
  stop: lazy(() => import('./PowerDialog').then((m) => ({ default: m.StopDialog }))),
  pause: lazy(() => import('./PowerDialog').then((m) => ({ default: m.PauseDialog }))),
  hibernate: lazy(() => import('./PowerDialog').then((m) => ({ default: m.HibernateDialog }))),
  reboot: lazy(() => import('./PowerDialog').then((m) => ({ default: m.RebootDialog }))),
  reset: lazy(() => import('./PowerDialog').then((m) => ({ default: m.ResetDialog }))),
}

const state = (ctx: GuestActionContext) => powerState(ctx.guest)
const locked = (ctx: GuestActionContext) => {
  const lock = state(ctx).blockingLock
  return lock ? `已锁定（${lock}）` : false
}

export const guestCoreActions: GuestActionDef[] = [
  {
    id: 'start',
    label: '启动',
    icon: Play,
    order: 100,
    placement: 'primary',
    section: '电源',
    visible: (ctx) => canStart(state(ctx)),
    disabled: locked,
    run: ({ node, type, vmid, name }) => runTask(powerCommand(node, type, vmid, 'start'), { title: powerTitle('start', name) }),
  },
  {
    // CT only (lxc status/start debug=1): very verbose lxc-start log in the
    // task log, to find out why a container does not start.
    id: 'start-debug',
    label: '调试模式启动',
    icon: Bug,
    order: 102,
    section: '电源',
    types: LXC,
    visible: (ctx) => canStart(state(ctx)),
    disabled: locked,
    confirm: ({ name }) => ({
      title: `以调试模式启动 ${name}？`,
      description: '启动时记录非常详细的调试日志（lxc-start 调试级别），可在任务日志里查看，用来排查容器无法启动的原因。',
      confirmLabel: '启动',
    }),
    run: ({ node, type, vmid, name }) =>
      runTask(powerCommand(node, type, vmid, 'start', debugStartParams()), { title: `调试模式启动 ${name}` }),
  },
  {
    id: 'resume',
    label: '恢复',
    icon: Play,
    order: 101,
    placement: 'primary',
    section: '电源',
    visible: (ctx) => canResume(state(ctx)),
    run: ({ node, type, vmid, name }) => runTask(powerCommand(node, type, vmid, 'resume'), { title: powerTitle('resume', name) }),
  },
  {
    id: 'shutdown',
    label: '关机',
    icon: Power,
    order: 110,
    placement: 'primary',
    section: '电源',
    visible: (ctx) => canShutdown(state(ctx)),
    disabled: locked,
    dialog: dialogs.shutdown,
  },
  {
    id: 'reboot',
    label: '重启',
    icon: RotateCcw,
    order: 120,
    placement: 'primary',
    section: '电源',
    visible: (ctx) => canReboot(state(ctx)),
    disabled: locked,
    dialog: dialogs.reboot,
  },
  {
    id: 'stop',
    label: '强制停止',
    icon: Square,
    order: 130,
    section: '电源',
    destructive: true,
    visible: (ctx) => canStop(state(ctx)),
    dialog: dialogs.stop,
  },
  {
    id: 'pause',
    label: '暂停',
    icon: CirclePause,
    order: 140,
    section: '电源',
    types: QEMU,
    visible: (ctx) => state(ctx).running,
    disabled: locked,
    dialog: dialogs.pause,
  },
  {
    id: 'hibernate',
    label: '休眠',
    icon: Moon,
    order: 145,
    section: '电源',
    types: QEMU,
    visible: (ctx) => state(ctx).running,
    disabled: locked,
    dialog: dialogs.hibernate,
  },
  {
    id: 'reset',
    label: '重置',
    icon: Zap,
    order: 150,
    section: '电源',
    destructive: true,
    types: QEMU,
    visible: (ctx) => state(ctx).running,
    disabled: locked,
    dialog: dialogs.reset,
  },
]
