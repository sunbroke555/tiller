// Tabs and actions of the node page (/node/:node/:tab?). Same rules as
// features/guest/registry.ts: tabs are pre-registered and point at files
// owned by their areas; actions come from each area's actions.ts.
//
// Action order ranges: node-summary 100–199, console 200–249,
// guest-lifecycle (bulk actions) 300–399.

import { lazy } from 'react'
import {
  Activity,
  Download,
  FileText,
  HardDrive,
  LayoutDashboard,
  ListChecks,
  Network,
  Repeat,
  Settings2,
  Shield,
  ShieldCheck,
  SquareTerminal,
} from 'lucide-react'

import { comingSoonTab } from '@/components/page/ComingSoonTab'
import { consoleNodeActions } from '@/features/console/actions'
import { nodeBulkActions } from '@/features/guest-lifecycle/actions'
import { nodeSummaryActions } from '@/features/node-summary/actions'

import type { NodeActionDef, NodeTabDef } from './types'

const online = ({ resource }: { resource: { status?: string } }) => resource.status === 'online'

export const nodeTabs: NodeTabDef[] = [
  {
    id: 'summary',
    title: '概要',
    icon: LayoutDashboard,
    order: 10,
    component: lazy(() => import('@/features/node-summary/SummaryTab')),
  },
  {
    id: 'shell',
    title: 'Shell',
    icon: SquareTerminal,
    order: 20,
    visible: online,
    permission: { privs: 'Sys.Console' },
    component: lazy(() => import('@/features/console/NodeShellTab')),
  },
  {
    id: 'services',
    title: '服务',
    icon: Activity,
    order: 30,
    visible: online,
    component: lazy(() => import('@/features/node-summary/ServicesTab')),
  },
  {
    id: 'syslog',
    title: '系统日志',
    icon: FileText,
    order: 40,
    visible: online,
    permission: { privs: 'Sys.Syslog' },
    component: lazy(() => import('@/features/node-summary/SyslogTab')),
  },
  {
    id: 'tasks',
    title: '任务历史',
    icon: ListChecks,
    order: 50,
    component: lazy(() => import('@/features/tasks/NodeTasksTab')),
  },
  // Phase 2
  { id: 'network', title: '网络', icon: Network, order: 60, component: comingSoonTab('网卡、网桥、Bond、VLAN 的增删改与应用。', 2) },
  { id: 'system', title: '系统', icon: Settings2, order: 70, component: comingSoonTab('DNS、Hosts、时区和节点选项。', 2) },
  { id: 'certificates', title: '证书', icon: ShieldCheck, order: 80, component: comingSoonTab('节点证书、自定义证书上传和 ACME。', 2) },
  { id: 'disks', title: '磁盘', icon: HardDrive, order: 90, component: comingSoonTab('磁盘列表、SMART、LVM / ZFS / 目录存储创建。', 2) },
  { id: 'updates', title: '更新', icon: Download, order: 100, component: comingSoonTab('软件包更新、changelog 和软件源。', 2) },
  { id: 'firewall', title: '防火墙', icon: Shield, order: 110, component: comingSoonTab('节点防火墙规则、选项和日志。', 2) },
  { id: 'replication', title: '复制', icon: Repeat, order: 120, component: lazy(() => import('@/features/replication/NodeReplicationTab')) },
]

export const nodeActions: NodeActionDef[] = [...nodeSummaryActions, ...consoleNodeActions, ...nodeBulkActions]
