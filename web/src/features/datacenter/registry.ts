// Sections of the datacenter (/datacenter/:section/*). Same rules as
// features/node/registry.ts: every section is pre-registered here and points
// at a file owned by its area; an area replaces its comingSoonTab(...) entry
// with `lazy(() => import('@/features/<area>/<Page>'))` when it lands.
//
// A section component owns everything below /datacenter/<id>/ — use nested
// <Routes> or the `*` splat for sub-pages (e.g. firewall/rules, firewall/ipset).

import { lazy } from 'react'
import {
  Archive,
  Bell,
  Boxes,
  Database,
  HardDrive,
  KeyRound,
  Network,
  Repeat,
  Server,
  Settings2,
  Shield,
  ShieldCheck,
  Users,
} from 'lucide-react'

import { comingSoonTab } from '@/components/page/ComingSoonTab'

import type { TabDef } from '@/components/page/registry'

/** Props of a datacenter section component (it reads sub-paths from the router itself). */
export type DatacenterSectionProps = Record<string, never>

export interface DatacenterSectionDef extends TabDef<DatacenterSectionProps> {
  /** One line under the title on the datacenter summary's 管理 grid. */
  hint: string
  /** Phase the section is scheduled for; sections still on comingSoonTab show it. */
  phase: 2 | 3
  /** True once the area replaced the placeholder (the 管理 grid then links to it). */
  ready?: boolean
}

export const datacenterSections: DatacenterSectionDef[] = [
  // Phase 2
  { id: 'storage', title: '存储配置', hint: '添加 NFS、CIFS、PBS 等存储', icon: HardDrive, order: 10, phase: 2, ready: true, component: lazy(() => import('@/features/storage-config/StorageConfigPage')) },
  {
    id: 'backup',
    title: '备份计划',
    hint: '定时备份任务',
    icon: Archive,
    order: 20,
    phase: 2,
    ready: true,
    permission: { privs: 'Sys.Audit' },
    component: lazy(() => import('@/features/backup-jobs/BackupJobsPage')),
  },
  { id: 'replication', title: '存储复制', hint: 'ZFS 复制任务', icon: Repeat, order: 30, phase: 2, ready: true, component: lazy(() => import('@/features/replication/ReplicationPage')) },
  { id: 'firewall', title: '防火墙', hint: '规则、安全组、IPSet', icon: Shield, order: 40, phase: 2, ready: true, permission: { privs: 'Sys.Audit' }, component: lazy(() => import('@/features/firewall/DatacenterFirewallPage')) },
  // Phase 3
  {
    id: 'users',
    title: '用户与令牌',
    hint: '用户、组、API 令牌、两步验证',
    icon: Users,
    order: 50,
    phase: 3,
    ready: true,
    component: lazy(() => import('@/features/access-users/AccessUsersPage')),
  },
  {
    id: 'permissions',
    title: '权限与认证',
    hint: '角色、ACL、认证域、资源池',
    icon: KeyRound,
    order: 60,
    phase: 3,
    ready: true,
    permission: { privs: 'Sys.Audit' },
    component: lazy(() => import('@/features/access-control/PermissionsPage')),
  },
  {
    id: 'ha',
    title: '高可用',
    hint: 'HA 资源与规则',
    icon: ShieldCheck,
    order: 70,
    phase: 3,
    ready: true,
    permission: { privs: 'Sys.Audit' },
    component: lazy(() => import('@/features/ha/HaPage')),
  },
  { id: 'sdn', title: 'SDN', hint: 'Zone、VNet、子网、Fabrics', icon: Network, order: 80, phase: 3, component: comingSoonTab('SDN Zone、VNet、子网、控制器、IPAM、DNS 和 Fabrics。', 3) },
  { id: 'ceph', title: 'Ceph', hint: '集群存储', icon: Database, order: 90, phase: 3, component: comingSoonTab('Ceph 安装、监视器、OSD、存储池和 CephFS。', 3) },
  {
    id: 'cluster',
    title: '集群',
    hint: '创建、加入、节点管理',
    icon: Server,
    order: 100,
    phase: 3,
    ready: true,
    permission: { privs: 'Sys.Audit' },
    component: lazy(() => import('@/features/cluster/ClusterPage')),
  },
  {
    id: 'notifications',
    title: '通知与指标',
    hint: '通知目标、匹配规则、指标服务器',
    icon: Bell,
    order: 110,
    phase: 3,
    ready: true,
    component: lazy(() => import('@/features/notifications-metrics/NotificationsMetricsPage')),
  },
  {
    id: 'mappings',
    title: '资源映射',
    hint: 'PCI、USB、目录映射与自定义 CPU',
    icon: Boxes,
    order: 120,
    phase: 3,
    ready: true,
    component: lazy(() => import('@/features/resource-mappings/ResourceMappingsPage')),
  },
  {
    id: 'options',
    title: '数据中心选项',
    hint: '默认值、标签、订阅',
    icon: Settings2,
    order: 130,
    phase: 3,
    ready: true,
    permission: { privs: 'Sys.Audit' },
    component: lazy(() => import('@/features/dc-options/DcOptionsPage')),
  },
]

export function datacenterSectionPath(id: string, sub?: string): string {
  return sub ? `/datacenter/${id}/${sub}` : `/datacenter/${id}`
}
