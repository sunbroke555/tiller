import type { ComponentType } from 'react'
import { Building2, Database, LayoutGrid, ListChecks, Palette, SquareTerminal, type LucideIcon } from 'lucide-react'

import { RunningTasksBadge } from '@/features/tasks/TaskShell'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Extra words the command palette matches on. */
  keywords?: string[]
  /** Exact match for "/" so it is not active everywhere. */
  end?: boolean
  /** Live count next to the label (renders nothing when idle). */
  badge?: ComponentType<{ className?: string }>
}

/** Mobile bottom bar: 资源 / 存储 / 任务 / Shell. */
export const MOBILE_NAV: NavItem[] = [
  { to: '/', label: '资源', icon: LayoutGrid, end: true },
  { to: '/storage', label: '存储', icon: Database },
  { to: '/tasks', label: '任务', icon: ListChecks, badge: RunningTasksBadge },
  { to: '/shell', label: 'Shell', icon: SquareTerminal },
]

/** Desktop sidebar and command palette pages. */
export const MAIN_NAV: NavItem[] = [
  { to: '/', label: '概览', icon: LayoutGrid, end: true, keywords: ['overview', 'home', 'resources', '资源', '首页'] },
  { to: '/storage', label: '存储', icon: Database, keywords: ['storage', 'disk', 'iso', 'backup', '备份'] },
  { to: '/tasks', label: '任务', icon: ListChecks, keywords: ['tasks', 'log', '日志'], badge: RunningTasksBadge },
  { to: '/shell', label: 'Shell', icon: SquareTerminal, keywords: ['shell', 'terminal', 'console', '终端'] },
  { to: '/datacenter', label: '数据中心', icon: Building2, keywords: ['datacenter', 'cluster', 'users', '集群', '用户', '权限'] },
]

export const SETTINGS_NAV: NavItem = {
  to: '/settings/appearance',
  label: '外观',
  icon: Palette,
  keywords: ['appearance', 'theme', 'dark', 'light', 'paper', '主题', '暗色', '浅色', '纸质', '设置'],
}
