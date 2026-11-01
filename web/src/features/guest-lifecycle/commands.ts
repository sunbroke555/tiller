// Palette commands for guest lifecycle (area guest-lifecycle). Commands that
// need a dialog (迁移 / 克隆 / 删除) open the guest page with ?action=<id>;
// its summary tab opens the dialog.

import { Copy, LayoutTemplate, Send, Trash2 } from 'lucide-react'

import { convertToTemplate } from '@/api/guest-lifecycle'
import type { GuestResource } from '@/api/types'
import { runTask } from '@/components/tasks/tracker'
import type { CommandContext, CommandDef } from '@/features/command/types'
import { guestName, guestPath } from '@/lib/resources'

const openAction = (id: string) => (g: GuestResource, { navigate }: CommandContext) => navigate(`${guestPath(g)}?action=${id}`)
const unlocked = (g: GuestResource) => !g.lock || g.lock === 'suspended'

export const guestLifecycleCommands: CommandDef[] = [
  {
    scope: 'guest',
    id: 'guest-migrate',
    label: '迁移',
    icon: Send,
    order: 400,
    keywords: ['migrate', 'move'],
    visible: (g, { resources }) => unlocked(g) && resources.filter((r) => r.type === 'node').length > 1,
    run: openAction('migrate'),
  },
  {
    scope: 'guest',
    id: 'guest-clone',
    label: '克隆',
    icon: Copy,
    order: 410,
    keywords: ['clone', 'copy', 'duplicate'],
    visible: unlocked,
    run: openAction('clone'),
  },
  {
    scope: 'guest',
    id: 'guest-template',
    label: '转换为模板',
    icon: LayoutTemplate,
    order: 420,
    keywords: ['template', 'convert'],
    visible: (g) => g.template !== 1 && g.status === 'stopped' && !g.lock,
    confirm: (g) => ({
      title: `把 ${guestName(g)} 转换为模板？`,
      description: '转换后不能再启动，也不能转回普通客户机。',
      confirmLabel: '转换为模板',
    }),
    run: (g) => runTask(convertToTemplate(g.node, g.type, g.vmid), { title: `把 ${guestName(g)} 转换为模板` }),
  },
  {
    scope: 'guest',
    id: 'guest-remove',
    label: '删除',
    icon: Trash2,
    order: 490,
    destructive: true,
    keywords: ['delete', 'remove', 'destroy'],
    visible: unlocked,
    run: openAction('remove'),
  },
]
