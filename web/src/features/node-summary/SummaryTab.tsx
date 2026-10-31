import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { NodeTabProps } from '@/features/node/types'

/** Placeholder owned by area `node-summary`: replace with the real tab. */
export default function SummaryTab(_props: NodeTabProps) {
  return <AreaPlaceholder area="node-summary">节点状态、资源图表、版本、重启与关机。</AreaPlaceholder>
}
