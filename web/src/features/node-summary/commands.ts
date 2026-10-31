// Palette commands for nodes (area node-summary): reboot, shutdown, Wake-on-LAN,
// jump to services / system log.

import { Activity, FileText, Power, RotateCcw, Zap } from 'lucide-react'
import { toast } from 'sonner'

import { nodePowerCommand, wakeOnLan } from '@/api/node-summary'
import { runTask } from '@/components/tasks/tracker'
import type { CommandDef } from '@/features/command/types'
import { nodePath } from '@/lib/resources'

import { rebootDescription, shutdownDescription } from './actions'

export const nodeSummaryCommands: CommandDef[] = [
  {
    id: 'node-syslog',
    scope: 'node',
    label: '系统日志',
    icon: FileText,
    order: 120,
    keywords: ['syslog', 'journal', 'log', '日志'],
    visible: (n) => n.status === 'online',
    run: (n, { navigate }) => navigate(nodePath(n.node, 'syslog')),
  },
  {
    id: 'node-services',
    scope: 'node',
    label: '服务',
    icon: Activity,
    order: 125,
    keywords: ['services', 'systemd', 'restart', '服务'],
    visible: (n) => n.status === 'online',
    run: (n, { navigate }) => navigate(nodePath(n.node, 'services')),
  },
  {
    id: 'node-wakeonlan',
    scope: 'node',
    label: '网络唤醒',
    icon: Zap,
    order: 100,
    keywords: ['wake', 'wol', 'wakeonlan', '唤醒'],
    visible: (n) => n.status !== 'online',
    run: async (n) => {
      const mac = await wakeOnLan(n.node)
      toast.success(`已向 ${n.node} 发送唤醒包`, { description: mac ? `MAC ${mac}` : undefined })
    },
  },
  {
    id: 'node-reboot',
    scope: 'node',
    label: '重启节点',
    icon: RotateCcw,
    order: 180,
    destructive: true,
    keywords: ['reboot', 'restart', '重启'],
    visible: (n) => n.status === 'online',
    confirm: (n) => ({
      title: `重启节点 ${n.node}？`,
      description: rebootDescription(n.node),
      confirmLabel: '重启',
      destructive: true,
      typeToConfirm: n.node,
    }),
    run: (n) =>
      runTask(nodePowerCommand(n.node, 'reboot'), {
        title: `重启节点 ${n.node}`,
        invalidate: [],
        syncSuccessMessage: `已向 ${n.node} 发送重启命令`,
      }),
  },
  {
    id: 'node-shutdown',
    scope: 'node',
    label: '关闭节点',
    icon: Power,
    order: 190,
    destructive: true,
    keywords: ['shutdown', 'poweroff', '关机'],
    visible: (n) => n.status === 'online',
    confirm: (n) => ({
      title: `关闭节点 ${n.node}？`,
      description: shutdownDescription(n.node),
      confirmLabel: '关机',
      destructive: true,
      typeToConfirm: n.node,
    }),
    run: (n) =>
      runTask(nodePowerCommand(n.node, 'shutdown'), {
        title: `关闭节点 ${n.node}`,
        invalidate: [],
        syncSuccessMessage: `已向 ${n.node} 发送关机命令`,
      }),
  },
]
