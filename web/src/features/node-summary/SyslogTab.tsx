import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { NodeTabProps } from '@/features/node/types'

/** Placeholder owned by area `node-summary`: replace with the real tab. */
export default function SyslogTab(_props: NodeTabProps) {
  return <AreaPlaceholder area="node-summary">系统日志（journal）浏览与筛选。</AreaPlaceholder>
}
