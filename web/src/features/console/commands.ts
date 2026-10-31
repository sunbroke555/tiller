// Palette commands of area console.

import { SquareTerminal } from 'lucide-react'

import type { CommandDef } from '@/features/command/types'
import { consolePath, nodeShellPath } from '@/lib/resources'

export const consoleCommands: CommandDef[] = [
  {
    scope: 'guest',
    id: 'guest-console',
    label: '打开控制台',
    icon: SquareTerminal,
    order: 200,
    keywords: ['console', 'vnc', 'terminal', '终端'],
    visible: (g) => g.status === 'running' && g.template !== 1,
    run: (g, { navigate }) => navigate(consolePath(g)),
  },
  {
    scope: 'node',
    id: 'node-shell',
    label: '打开 Shell',
    icon: SquareTerminal,
    order: 200,
    keywords: ['shell', 'terminal', 'ssh', '终端'],
    visible: (n) => n.status === 'online',
    run: (n, { navigate }) => navigate(nodeShellPath(n.node)),
  },
]
