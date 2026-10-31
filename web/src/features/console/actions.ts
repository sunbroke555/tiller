// Console actions (area console). Order range 200–249 (guest), 200–249 (node).
// Registered in features/guest/registry.ts and features/node/registry.ts.

import { SquareTerminal } from 'lucide-react'

import type { GuestActionDef } from '@/features/guest/types'
import type { NodeActionDef } from '@/features/node/types'
import { consolePath, nodeShellPath } from '@/lib/resources'

export const consoleGuestActions: GuestActionDef[] = [
  {
    id: 'console',
    label: '控制台',
    icon: SquareTerminal,
    order: 200,
    placement: 'primary',
    visible: ({ guest }) => guest.status === 'running' && guest.template !== 1,
    run: ({ guest, navigate }) => navigate(consolePath(guest)),
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
]
