// Tabs and actions of the guest page. The shell (GuestPage) renders whatever
// is listed here.
//
// Tabs are pre-registered and point at files owned by their areas: an area
// replaces its own component file and normally never edits this list.
// Actions come from each area's actions.ts, concatenated below.
//
// Order ranges: tabs follow the official UI order (10, 20, …).
// Actions: guest-core 100–199 (power), console 200–249, guest-backup 300–349,
// guest-lifecycle 400–499.

import { lazy } from 'react'
import {
  Archive,
  Camera,
  CloudCog,
  Cpu,
  Gauge,
  HardDrive,
  LayoutDashboard,
  ListChecks,
  Network,
  Repeat,
  Settings2,
  Shield,
  SquareTerminal,
  Users,
  Waypoints,
} from 'lucide-react'

import { comingSoonTab } from '@/components/page/ComingSoonTab'
import { consoleGuestActions } from '@/features/console/actions'
import { guestBackupActions } from '@/features/guest-backup/actions'
import { guestCoreActions } from '@/features/guest-core/actions'
import { guestLifecycleActions } from '@/features/guest-lifecycle/actions'

import { BOTH, LXC, QEMU, type GuestActionDef, type GuestTabDef } from './types'

const notTemplate = ({ guest }: { guest: { template?: 0 | 1 } }) => guest.template !== 1

export const guestTabs: GuestTabDef[] = [
  {
    id: 'summary',
    title: '概要',
    icon: LayoutDashboard,
    order: 10,
    types: BOTH,
    component: lazy(() => import('@/features/guest-core/SummaryTab')),
  },
  {
    id: 'console',
    title: '控制台',
    icon: SquareTerminal,
    order: 20,
    types: BOTH,
    visible: notTemplate,
    permission: { privs: 'VM.Console' },
    component: lazy(() => import('@/features/console/GuestConsoleTab')),
  },
  // QEMU configuration
  {
    id: 'hardware',
    title: '硬件',
    icon: Cpu,
    order: 30,
    types: QEMU,
    component: lazy(() => import('@/features/qemu-config/HardwareTab')),
  },
  {
    id: 'cloudinit',
    title: 'Cloud-Init',
    icon: CloudCog,
    order: 40,
    types: QEMU,
    component: lazy(() => import('@/features/qemu-config/CloudInitTab')),
  },
  // LXC configuration
  {
    id: 'resources',
    title: '资源',
    icon: HardDrive,
    order: 30,
    types: LXC,
    component: lazy(() => import('@/features/lxc-config/ResourcesTab')),
  },
  {
    id: 'network',
    title: '网络',
    icon: Network,
    order: 34,
    types: LXC,
    component: lazy(() => import('@/features/lxc-config/NetworkTab')),
  },
  {
    id: 'dns',
    title: 'DNS',
    icon: Waypoints,
    order: 36,
    types: LXC,
    component: lazy(() => import('@/features/lxc-config/DnsTab')),
  },
  // Options (one id, one component per type)
  {
    id: 'options',
    title: '选项',
    icon: Settings2,
    order: 50,
    types: QEMU,
    component: lazy(() => import('@/features/qemu-config/OptionsTab')),
  },
  {
    id: 'options',
    title: '选项',
    icon: Settings2,
    order: 50,
    types: LXC,
    component: lazy(() => import('@/features/lxc-config/OptionsTab')),
  },
  {
    id: 'tasks',
    title: '任务历史',
    icon: ListChecks,
    order: 60,
    types: BOTH,
    component: lazy(() => import('@/features/tasks/GuestTasksTab')),
  },
  {
    id: 'monitor',
    title: '监视器',
    icon: Gauge,
    order: 70,
    types: QEMU,
    visible: notTemplate,
    // PVE 9: info commands need Sys.Audit on /, the rest is root-only.
    permission: { privs: 'Sys.Audit', path: '/' },
    component: lazy(() => import('@/features/qemu-config/MonitorTab')),
  },
  {
    id: 'backup',
    title: '备份',
    icon: Archive,
    order: 80,
    types: BOTH,
    component: lazy(() => import('@/features/guest-backup/BackupTab')),
  },
  {
    id: 'replication',
    title: '复制',
    icon: Repeat,
    order: 90,
    types: BOTH,
    component: comingSoonTab('存储复制任务的创建、立即同步和日志。', 2),
  },
  {
    id: 'snapshots',
    title: '快照',
    icon: Camera,
    order: 100,
    types: BOTH,
    visible: notTemplate,
    component: lazy(() => import('@/features/guest-backup/SnapshotsTab')),
  },
  {
    id: 'firewall',
    title: '防火墙',
    icon: Shield,
    order: 110,
    types: BOTH,
    permission: { privs: 'VM.Audit' },
    component: lazy(() => import('@/features/firewall/GuestFirewallTab')),
  },
  {
    id: 'permissions',
    title: '权限',
    icon: Users,
    order: 120,
    types: BOTH,
    component: comingSoonTab('这台客户机的访问权限（ACL）。', 3),
  },
]

export const guestActions: GuestActionDef[] = [
  ...guestCoreActions,
  ...consoleGuestActions,
  ...guestBackupActions,
  ...guestLifecycleActions,
]
