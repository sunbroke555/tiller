// Palette commands for guest power (area guest-summary-power), e.g.
//   { scope: 'guest', id: 'guest-start', label: '启动', icon: Play, order: 100, keywords: ['start', 'power on'],
//     visible: (g) => g.status === 'stopped' && g.template !== 1,
//     run: (g) => runTask(post(p`/nodes/${g.node}/${g.type}/${g.vmid}/status/start`), { title: `启动 ${guestName(g)}` }) }

import type { CommandDef } from '@/features/command/types'

export const guestCoreCommands: CommandDef[] = []
