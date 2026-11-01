import {
  Building2,
  Database,
  LayoutGrid,
  Layers,
  ListChecks,
  Palette,
  SquareTerminal,
  UserRound,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Extra words the command palette matches on. */
  keywords?: string[]
  /** Exact match for "/" so it is not active everywhere. */
  end?: boolean
}

/** Mobile bottom bar: 资源 / 存储 / 任务 / Shell. */
export const MOBILE_NAV: NavItem[] = [
  { to: '/', label: '资源', icon: LayoutGrid, end: true },
  { to: '/storage', label: '存储', icon: Database },
  { to: '/tasks', label: '任务', icon: ListChecks },
  { to: '/shell', label: 'Shell', icon: SquareTerminal },
]

/** Desktop sidebar and command palette pages. */
export const MAIN_NAV: NavItem[] = [
  { to: '/', label: '概览', icon: LayoutGrid, end: true, keywords: ['overview', 'home', 'resources', '资源', '首页'] },
  {
    to: '/datacenter',
    label: '数据中心',
    icon: Building2,
    keywords: ['datacenter', 'cluster', 'summary', 'health', 'subscription', 'notes', '集群', '健康', '订阅', '备注'],
  },
  { to: '/pool', label: '资源池', icon: Layers, keywords: ['pool', 'pools', '池'] },
  { to: '/storage', label: '存储', icon: Database, keywords: ['storage', 'disk', 'iso', 'backup', '备份'] },
  { to: '/tasks', label: '任务', icon: ListChecks, keywords: ['tasks', 'log', '日志'] },
  { to: '/shell', label: 'Shell', icon: SquareTerminal, keywords: ['shell', 'terminal', 'console', '终端'] },
]

export const SETTINGS_NAV: NavItem = {
  to: '/settings/appearance',
  label: '外观',
  icon: Palette,
  keywords: ['appearance', 'theme', 'dark', 'light', 'paper', 'install', 'language', '主题', '暗色', '浅色', '纸质', '设置', '语言', '安装'],
}

export const ACCOUNT_NAV: NavItem = {
  to: '/account',
  label: '我的账户',
  icon: UserRound,
  keywords: ['account', 'password', 'tfa', '2fa', 'totp', 'webauthn', 'permissions', '密码', '两步验证', '权限', '账户'],
}
