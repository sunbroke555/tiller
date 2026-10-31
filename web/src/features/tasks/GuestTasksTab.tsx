import type { GuestTabProps } from '@/features/guest/types'

import { TaskHistoryView } from './TaskHistoryView'

/** Guest → 任务历史: tasks of this VM / CT on its node (GET /nodes/{node}/tasks?vmid=). */
export default function GuestTasksTab({ node, vmid }: GuestTabProps) {
  return <TaskHistoryView fixed={{ node, vmid }} omitSubject />
}
