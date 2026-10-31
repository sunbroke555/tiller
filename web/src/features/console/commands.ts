// Palette commands of area console.

import { Keyboard, SquareTerminal } from 'lucide-react'
import { toast } from 'sonner'

import { sendQemuKey } from '@/api/console'
import type { CommandDef } from '@/features/command/types'
import { consolePath, guestName, nodeShellPath } from '@/lib/resources'

export const consoleCommands: CommandDef[] = [
  {
    scope: 'guest',
    id: 'guest-console',
    label: '打开控制台',
    icon: SquareTerminal,
    order: 200,
    keywords: ['console', 'vnc', 'novnc', 'terminal', 'xterm', '终端'],
    visible: (g) => g.status === 'running' && g.template !== 1,
    run: (g, { navigate }) => navigate(consolePath(g)),
  },
  {
    scope: 'guest',
    id: 'guest-sendkey-cad',
    label: '发送 Ctrl+Alt+Del',
    icon: Keyboard,
    order: 210,
    types: ['qemu'],
    keywords: ['sendkey', 'ctrl-alt-delete', 'cad', '按键'],
    visible: (g) => g.status === 'running' && g.template !== 1,
    confirm: (g) => ({
      title: `向 ${guestName(g)} 发送 Ctrl+Alt+Del？`,
      description: '多数系统会因此重启或显示安全选项。',
      confirmLabel: '发送',
    }),
    run: async (g) => {
      await sendQemuKey(g.node, g.vmid, 'ctrl-alt-delete')
      toast.success(`已向 ${guestName(g)} 发送 Ctrl+Alt+Del`)
    },
  },
  {
    scope: 'node',
    id: 'node-shell',
    label: '打开 Shell',
    icon: SquareTerminal,
    order: 200,
    keywords: ['shell', 'terminal', 'ssh', 'console', '终端'],
    visible: (n) => n.status === 'online',
    run: (n, { navigate }) => navigate(nodeShellPath(n.node)),
  },
]
