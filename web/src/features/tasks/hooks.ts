import { useEffect, useMemo, useState } from 'react'

import { useClusterResources, useTasks } from '@/api/queries'
import { mergeRunningTasks, recentFailures, type RunningTask } from '@/api/tasks-logs'
import { parseUpid } from '@/api/tasks'
import { isGuest, type ClusterResource, type ClusterTask } from '@/api/types'
import { useTrackedTasks } from '@/components/tasks/tracker'

import { guestNameMap, type GuestNames } from './format'

/** Current time in ms, ticking every `intervalMs` while `active`. */
export function useNow(active = true, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [active, intervalMs])
  return now
}

const selectGuestNames = (resources: ClusterResource[]): GuestNames => guestNameMap(resources.filter(isGuest))

/** vmid → name from the polled cluster resources. */
export function useGuestNames(): GuestNames | undefined {
  return useClusterResources({ select: selectGuestNames }).data
}

export interface RunningTasksSummary {
  running: RunningTask[]
  /** Failed tasks of the last 24 h (from /cluster/tasks). */
  failures: ClusterTask[]
  /** Most recent finished task, for the idle footer. */
  lastFinished: ClusterTask | undefined
  isPending: boolean
}

/**
 * Running tasks of the cluster (polled /cluster/tasks merged with the tasks
 * this UI tracks), used by the nav badge, the desktop footer and /tasks.
 */
export function useRunningTasks(): RunningTasksSummary {
  const cluster = useTasks()
  const tracked = useTrackedTasks()
  // 24 h window moves slowly; recompute it once a minute.
  const minute = Math.floor(useNow(true, 60_000) / 60_000)
  return useMemo(() => {
    const data = cluster.data
    return {
      running: mergeRunningTasks(data, tracked, parseUpid),
      failures: recentFailures(data, minute * 60 - 86400),
      lastFinished: data?.find((t) => !!t.endtime),
      isPending: cluster.isPending,
    }
  }, [cluster.data, cluster.isPending, tracked, minute])
}
