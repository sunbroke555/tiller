import { Monitor, Moon, ScrollText, Sun, type LucideIcon } from 'lucide-react'

import type { Density, ThemeMode } from './prefs'

export const THEME_MODE_META: Record<ThemeMode, { label: string; description: string; icon: LucideIcon }> = {
  system: { label: '跟随系统', description: '在暗色与浅色玻璃之间自动切换', icon: Monitor },
  dark: { label: '暗色玻璃', description: '近黑底色与柔和光晕', icon: Moon },
  light: { label: '浅色玻璃', description: '浅灰底色与白色玻璃卡片', icon: Sun },
  paper: { label: '纸质', description: '象牙白纸张、衬线标题、实色卡片', icon: ScrollText },
}

export const DENSITY_LABEL: Record<Density, string> = {
  comfortable: '舒适',
  compact: '紧凑',
}
