// Palette commands for guest power (area guest-summary-power): "启动 web-01",
// "关机 web-01", "重启 web-01", "强制停止 web-01", "恢复 web-01", "暂停 web-01".
// The palette has no sheet, so the forceful variants confirm first.

import { CirclePause, Play, Power, RotateCcw, Square } from 'lucide-react'

import { powerCommand } from '@/api/guest-core'
import type { GuestResource } from '@/api/types'
import { runTask } from '@/components/tasks/tracker'
import type { CommandDef } from '@/features/command/types'
import { guestName } from '@/lib/resources'

import { canReboot, canResume, canShutdown, canStart, canStop, powerRequest, powerState, powerTitle, type PowerMode } from './power'

const st = (g: GuestResource) => powerState(g)
const kind = (g: GuestResource) => (g.type === 'qemu' ? 'VM' : 'CT')

function runMode(g: GuestResource, mode: PowerMode) {
  const { command, params } = powerRequest(mode)
  return runTask(powerCommand(g.node, g.type, g.vmid, command, params), { title: powerTitle(mode, guestName(g)) })
}

export const guestCoreCommands: CommandDef[] = [
  {
    scope: 'guest',
    id: 'guest-start',
    label: '启动',
    icon: Play,
    order: 100,
    keywords: ['start', 'power on', 'boot', 'qidong'],
    visible: (g) => canStart(st(g)) && !st(g).blockingLock,
    run: (g) => runTask(powerCommand(g.node, g.type, g.vmid, 'start'), { title: powerTitle('start', guestName(g)) }),
  },
  {
    scope: 'guest',
    id: 'guest-resume',
    label: '恢复',
    icon: Play,
    order: 101,
    keywords: ['resume', 'continue', 'unpause'],
    visible: (g) => canResume(st(g)),
    run: (g) => runTask(powerCommand(g.node, g.type, g.vmid, 'resume'), { title: powerTitle('resume', guestName(g)) }),
  },
  {
    scope: 'guest',
    id: 'guest-shutdown',
    label: '关机',
    icon: Power,
    order: 110,
    keywords: ['shutdown', 'power off', 'stop'],
    visible: (g) => canShutdown(st(g)) && !st(g).blockingLock,
    confirm: (g) => ({
      title: `关闭 ${guestName(g)}？`,
      description: `${kind(g)} ${g.vmid} 会收到关机通知（ACPI 或 Guest Agent），由系统自行关机。`,
      confirmLabel: '关机',
    }),
    run: (g) => runMode(g, 'shutdown'),
  },
  {
    scope: 'guest',
    id: 'guest-reboot',
    label: '重启',
    icon: RotateCcw,
    order: 120,
    keywords: ['reboot', 'restart'],
    visible: (g) => canReboot(st(g)) && !st(g).blockingLock,
    confirm: (g) => ({
      title: `重启 ${guestName(g)}？`,
      description: `${kind(g)} ${g.vmid} 会收到重启通知，由系统自行重新启动。`,
      confirmLabel: '重启',
    }),
    run: (g) => runMode(g, 'reboot'),
  },
  {
    scope: 'guest',
    id: 'guest-stop',
    label: '强制停止',
    icon: Square,
    order: 130,
    destructive: true,
    keywords: ['stop', 'kill', 'force', 'power off'],
    visible: (g) => canStop(st(g)),
    confirm: (g) => ({
      title: `强制停止 ${guestName(g)}？`,
      description: '相当于直接拔掉电源，未保存的数据会丢失。',
      confirmLabel: '强制停止',
      destructive: true,
    }),
    run: (g) => runMode(g, 'stop'),
  },
  {
    scope: 'guest',
    id: 'guest-pause',
    label: '暂停',
    icon: CirclePause,
    order: 140,
    types: ['qemu'],
    keywords: ['pause', 'suspend', 'freeze'],
    visible: (g) => st(g).running && !st(g).blockingLock,
    confirm: (g) => ({
      title: `暂停 ${guestName(g)}？`,
      description: '虚拟机会被冻结，内存保留在主机上，之后可以恢复。',
      confirmLabel: '暂停',
    }),
    run: (g) => runMode(g, 'pause'),
  },
]
