import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { NodeTabProps } from '@/features/node/types'

/** Placeholder owned by area `tasks-logs`: replace with the real tab. */
export default function NodeTasksTab(_props: NodeTabProps) {
  return <AreaPlaceholder area="tasks-logs">这个节点的任务历史与日志。</AreaPlaceholder>
}
