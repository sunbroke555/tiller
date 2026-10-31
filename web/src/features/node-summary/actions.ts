// Node actions (area node-summary): reboot, shutdown, Wake-on-LAN, package
// versions and system report. Order range 100–199. Registered in
// features/node/registry.ts.
//
// Reboot / shutdown live in the "更多" menu (section 电源) rather than as
// primary buttons: on phones the dock is for everyday actions, and both need
// the node name typed to confirm.

import { lazy } from 'react'
import { FileText, Package, Power, RotateCcw, Zap } from 'lucide-react'
import { toast } from 'sonner'

import { hasNodePriv, nodePowerCommand, wakeOnLan } from '@/api/node-summary'
import { runTask } from '@/components/tasks/tracker'
import type { NodeActionDef } from '@/features/node/types'

const PackageVersionsAction = lazy(() => import('./ActionDialogs').then((m) => ({ default: m.PackageVersionsAction })))
const SystemReportAction = lazy(() => import('./ActionDialogs').then((m) => ({ default: m.SystemReportAction })))

const noPowerPriv = () => (!hasNodePriv('Sys.PowerMgmt') ? '没有 Sys.PowerMgmt 权限' : false)

export function rebootDescription(node: string) {
  return `节点 ${node} 上运行的虚拟机和容器会按启动/关机顺序先被关闭，重启期间它们都不可用，本页面也会暂时断开。`
}

export function shutdownDescription(node: string) {
  return `节点 ${node} 上运行的虚拟机和容器会先被关闭。关机后只能通过网络唤醒、IPMI 或到现场开机。`
}

export const nodeSummaryActions: NodeActionDef[] = [
  {
    id: 'wakeonlan',
    label: '网络唤醒',
    icon: Zap,
    order: 100,
    placement: 'primary',
    section: '电源',
    visible: ({ resource }) => resource.status !== 'online',
    disabled: noPowerPriv,
    run: async ({ node }) => {
      const mac = await wakeOnLan(node)
      toast.success(`已向 ${node} 发送唤醒包`, { description: mac ? `MAC ${mac}` : undefined })
    },
  },
  {
    id: 'packages',
    label: '软件包版本',
    icon: Package,
    order: 150,
    section: '信息',
    visible: ({ resource }) => resource.status === 'online',
    dialog: PackageVersionsAction,
  },
  {
    id: 'report',
    label: '系统报告',
    icon: FileText,
    order: 160,
    section: '信息',
    visible: ({ resource }) => resource.status === 'online',
    dialog: SystemReportAction,
  },
  {
    id: 'reboot',
    label: '重启节点',
    icon: RotateCcw,
    order: 180,
    section: '电源',
    destructive: true,
    visible: ({ resource }) => resource.status === 'online',
    disabled: noPowerPriv,
    confirm: ({ node }) => ({
      title: `重启节点 ${node}？`,
      description: rebootDescription(node),
      confirmLabel: '重启',
      destructive: true,
      typeToConfirm: node,
    }),
    run: ({ node }) =>
      runTask(nodePowerCommand(node, 'reboot'), {
        title: `重启节点 ${node}`,
        invalidate: [],
        syncSuccessMessage: `已向 ${node} 发送重启命令`,
      }),
  },
  {
    id: 'shutdown',
    label: '关闭节点',
    icon: Power,
    order: 190,
    section: '电源',
    destructive: true,
    visible: ({ resource }) => resource.status === 'online',
    disabled: noPowerPriv,
    confirm: ({ node }) => ({
      title: `关闭节点 ${node}？`,
      description: shutdownDescription(node),
      confirmLabel: '关机',
      destructive: true,
      typeToConfirm: node,
    }),
    run: ({ node }) =>
      runTask(nodePowerCommand(node, 'shutdown'), {
        title: `关闭节点 ${node}`,
        invalidate: [],
        syncSuccessMessage: `已向 ${node} 发送关机命令`,
      }),
  },
]
