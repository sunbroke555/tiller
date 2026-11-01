import type { NodeTabProps } from '@/features/node/types'

import { TaskHistoryView } from './TaskHistoryView'

/** Node → 任务历史: the node's full task history with filters. */
export default function NodeTasksTab({ node }: NodeTabProps) {
  return <TaskHistoryView fixed={{ node }} />
}
