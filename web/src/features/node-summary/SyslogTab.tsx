import type { NodeTabProps } from '@/features/node/types'
import { GlassCard } from '@/components/GlassCard'

import { JournalView } from './JournalView'

/** Node system log (journal): live follow, time range, filters, load older. */
export default function SyslogTab({ node }: NodeTabProps) {
  return (
    <GlassCard className="flex flex-col">
      <JournalView
        node={node}
        className="h-[calc(100dvh-36rem)] min-h-[17rem] lg:h-[calc(100dvh-15rem)] lg:min-h-[26rem]"
      />
    </GlassCard>
  )
}
