import type { ReactNode } from 'react'

import { ComingSoon } from '@/components/ComingSoon'

/**
 * A registry tab for a feature scheduled for a later phase:
 *   { id: 'firewall', title: '防火墙', component: comingSoonTab('防火墙规则、选项和日志', 2) }
 */
export function comingSoonTab(description: string, phase?: 2 | 3): () => ReactNode {
  function ComingSoonTab() {
    return <ComingSoon title={phase ? `第 ${phase} 阶段提供` : '即将推出'}>{description}</ComingSoon>
  }
  return ComingSoonTab
}
