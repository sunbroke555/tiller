import { useClusterResources } from '@/api/queries'
import { isNode, type ClusterResource } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'

import { TaskHistoryView } from './TaskHistoryView'
import { TaskListSkeleton } from './TaskList'
import { TasksNav } from './TasksNav'

const selectNodeNames = (all: ClusterResource[]) =>
  all
    .filter(isNode)
    .map((n) => n.node)
    .sort((a, b) => a.localeCompare(b))

/**
 * /tasks — task history of the cluster with live running tasks, filters
 * (status, scope/node, type, user, VMID, time) and the log sheet.
 */
export default function TasksPage() {
  const nodes = useClusterResources({ select: selectNodeNames })
  return (
    <>
      <PageHeader title="任务" description="集群的任务历史与实时日志" />
      <TasksNav className="mb-(--section-gap)" />
      {nodes.isPending ? (
        <div className="grid grid-cols-1 gap-3" aria-busy="true" aria-label="加载中">
          <Skeleton className="h-8 w-80 max-w-full" />
          <div className="surface overflow-hidden rounded-2xl">
            <TaskListSkeleton />
          </div>
        </div>
      ) : (
        <TaskHistoryView nodes={nodes.data ?? []} showNode={(nodes.data?.length ?? 0) > 1} />
      )}
    </>
  )
}
