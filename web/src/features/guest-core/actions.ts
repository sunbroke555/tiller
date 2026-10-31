// Guest power actions (area guest-summary-power). Order range 100–199.
// Registered in features/guest/registry.ts.
//
// Example:
//   {
//     id: 'start', label: '启动', icon: Play, order: 100, placement: 'primary', section: '电源',
//     visible: ({ guest }) => guest.status === 'stopped' && guest.template !== 1,
//     run: ({ node, type, vmid, name }) =>
//       runTask(post(p`/nodes/${node}/${type}/${vmid}/status/start`), { title: `启动 ${name}` }),
//   },
//   {
//     id: 'stop', label: '强制停止', icon: Square, order: 130, section: '电源', destructive: true,
//     visible: ({ guest }) => guest.status === 'running',
//     confirm: ({ name }) => ({ title: `强制停止 ${name}？`, description: '相当于拔掉电源，未保存的数据会丢失。' }),
//     run: (ctx) => runTask(post(...), { title: `强制停止 ${ctx.name}` }),
//   },

import type { GuestActionDef } from '@/features/guest/types'

export const guestCoreActions: GuestActionDef[] = []
