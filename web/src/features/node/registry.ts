// Tabs and actions of the node page (/node/:node/:tab?). Same rules as
// features/guest/registry.ts: tabs are pre-registered and point at files
// owned by their areas; actions come from each area's actions.ts.
//
// Action order ranges: node-summary 100–199, console 200–249,
// guest-lifecycle (bulk actions) 300–399.

import { lazyComponent as lazy } from '@/lib/lazyComponent'
import {
  Activity,
  Database,
  BadgeCheck,
  Download,
  FileText,
  HardDrive,
  LayoutDashboard,
  ListChecks,
  Monitor,
  Network,
  Repeat,
  Settings2,
  Shield,
  ShieldCheck,
  SquareTerminal,
} from 'lucide-react'

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
    id: 'guests',
    title: '客户机',
    icon: Monitor,
    order: 15,
    component: lazy(() => import('@/features/node-summary/GuestsTab')),
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
  {
    id: 'network',
    title: '网络',
    icon: Network,
    order: 60,
    visible: online,
    component: lazy(() => import('@/features/node-network/NetworkTab')),
  },
  {
    id: 'system',
    title: '系统',
    icon: Settings2,
    order: 70,
    visible: online,
    permission: { privs: 'Sys.Audit' },
    component: lazy(() => import('@/features/node-system/SystemTab')),
  },
  {
    id: 'certificates',
    title: '证书',
    icon: ShieldCheck,
    order: 80,
    visible: online,
    permission: { privs: 'Sys.Audit' },
    component: lazy(() => import('@/features/certificates-acme/CertificatesTab')),
  },
  {
    id: 'disks',
    title: '磁盘',
    icon: HardDrive,
    order: 90,
    visible: online,
    permission: { privs: 'Sys.Audit' },
    component: lazy(() => import('@/features/node-disks/DisksTab')),
  },
  {
    id: 'updates',
    title: '更新',
    icon: Download,
    order: 100,
    visible: online,
    // Repositories and versions need Sys.Audit; the package list itself Sys.Modify (checked inside).
    permission: { privs: 'Sys.Audit' },
    component: lazy(() => import('@/features/node-updates/UpdatesTab')),
  },
  {
    id: 'firewall',
    title: '防火墙',
    icon: Shield,
    order: 110,
    permission: { privs: 'Sys.Audit' },
    component: lazy(() => import('@/features/firewall/NodeFirewallTab')),
  },
  { id: 'replication', title: '复制', icon: Repeat, order: 120, component: lazy(() => import('@/features/replication/NodeReplicationTab')) },
  // Phase 3
  { id: 'subscription', title: '订阅', icon: BadgeCheck, order: 130, component: lazy(() => import('@/features/dc-options/NodeSubscriptionTab')) },
  {
    id: 'ceph',
    title: 'Ceph',
    icon: Database,
    order: 140,
    visible: online,
    permission: { privs: 'Sys.Audit' },
    component: lazy(() => import('@/features/ceph/NodeCephTab')),
  },
]

export const nodeActions: NodeActionDef[] = [...nodeSummaryActions, ...consoleNodeActions, ...nodeBulkActions]
