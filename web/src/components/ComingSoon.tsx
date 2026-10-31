import type { ReactNode } from 'react'
import { Construction } from 'lucide-react'

import { EmptyState } from './EmptyState'
import { GlassCard } from './GlassCard'

/** Placeholder body for routes whose feature is not built yet. */
export function ComingSoon({ title = '即将推出', children }: { title?: string; children?: ReactNode }) {
  return (
    <GlassCard>
      <EmptyState icon={Construction} title={title} description={children} />
    </GlassCard>
  )
}
