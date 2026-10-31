import { ComingSoon } from '@/components/ComingSoon'
import { PageHeader } from '@/components/PageHeader'

/** /tasks — owned by area tasks-logs. */
export default function TasksPage() {
  return (
    <>
      <PageHeader title="任务" description="集群最近的任务与实时日志" />
      <ComingSoon>任务列表、筛选和实时日志会在这里。</ComingSoon>
    </>
  )
}
