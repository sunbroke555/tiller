import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { GuestTabProps } from '@/features/guest/types'

/** Placeholder owned by area `tasks-logs`: replace with the real tab. */
export default function GuestTasksTab(_props: GuestTabProps) {
  return <AreaPlaceholder area="tasks-logs">这台客户机的任务历史与日志。</AreaPlaceholder>
}
