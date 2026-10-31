// Console actions (area console). Order range 200–249 (guest), 200–249 (node).
// Registered in features/guest/registry.ts and features/node/registry.ts.

import { lazy } from 'react'
import { Keyboard, MonitorDown, ScreenShare, SquareTerminal } from 'lucide-react'

import type { GuestActionDef } from '@/features/guest/types'
import { QEMU } from '@/features/guest/types'
import type { NodeActionDef } from '@/features/node/types'
import { consolePath, nodeShellPath } from '@/lib/resources'

const running = ({ guest }: { guest: { status: string; template?: 0 | 1 } }) =>
  guest.status === 'running' && guest.template !== 1

export const consoleGuestActions: GuestActionDef[] = [
  {
    id: 'console',
    label: '控制台',
    icon: SquareTerminal,
    order: 200,
    placement: 'primary',
    visible: running,
    run: ({ guest, navigate }) => navigate(consolePath(guest)),
  },
  {
    id: 'sendkey',
    label: '发送按键…',
    icon: Keyboard,
    order: 210,
    section: '控制台',
    types: QEMU,
    visible: running,
    dialog: lazy(() => import('./SendKeyDialog')),
  },
  {
    id: 'spice',
    label: 'SPICE 远程查看…',
    icon: MonitorDown,
    order: 220,
    section: '控制台',
    visible: running,
    dialog: lazy(() => import('./SpiceDialog').then((m) => ({ default: m.GuestSpiceDialog }))),
  },
]

export const consoleNodeActions: NodeActionDef[] = [
  {
    id: 'shell',
    label: 'Shell',
    icon: SquareTerminal,
    order: 200,
    placement: 'primary',
    visible: ({ resource }) => resource?.status === 'online',
    run: ({ node, navigate }) => navigate(nodeShellPath(node)),
  },
  {
    id: 'spice-shell',
    label: 'SPICE Shell…',
    icon: ScreenShare,
    order: 210,
    section: '控制台',
    visible: ({ resource }) => resource?.status === 'online',
    dialog: lazy(() => import('./SpiceDialog').then((m) => ({ default: m.NodeSpiceDialog }))),
  },
]
