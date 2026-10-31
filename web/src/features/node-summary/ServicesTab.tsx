import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { NodeTabProps } from '@/features/node/types'

/** Placeholder owned by area `node-summary`: replace with the real tab. */
export default function ServicesTab(_props: NodeTabProps) {
  return <AreaPlaceholder area="node-summary">系统服务的状态、启动、停止和重启。</AreaPlaceholder>
}
