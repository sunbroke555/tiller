// Display helpers for task and log lists.

import { DASH, formatDuration } from '@/lib/format'
import type { ClusterTask, GuestResource } from '@/api/types'
import { describeTask, taskTypeLabel } from '@/lib/taskTypes'

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Compact absolute time for lists: "10-31 08:30:12" this year,
 * "2025-10-31 08:30" for older entries.
 */
export function formatTaskTime(epochSeconds: number | null | undefined, nowMs = Date.now()): string {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds)) return DASH
  const d = new Date(epochSeconds * 1000)
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear()
  const date = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (sameYear) return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return `${d.getFullYear()}-${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Task duration: end − start, or elapsed so far while running. */
export function taskDuration(task: Pick<ClusterTask, 'starttime' | 'endtime'>, nowMs = Date.now()): string {
  const end = task.endtime ?? nowMs / 1000
  return formatDuration(Math.max(0, end - task.starttime))
}

/** vmid → guest name, for "启动 VM 100（web-01）". */
export type GuestNames = ReadonlyMap<string, string>

export function guestNameMap(guests: readonly Pick<GuestResource, 'vmid' | 'name'>[]): GuestNames {
  const out = new Map<string, string>()
  for (const g of guests) if (g.name) out.set(String(g.vmid), g.name)
  return out
}

/**
 * Row title: "启动 VM 100（web-01）"; inside a guest's own tab only the
 * action ("启动"), the subject is obvious there.
 */
export function taskTitle(task: Pick<ClusterTask, 'type' | 'id'>, names?: GuestNames, { omitSubject = false } = {}): string {
  if (omitSubject) return taskTypeLabel(task.type)
  const base = describeTask(task)
  const name = task.id ? names?.get(task.id) : undefined
  return name ? `${base}（${name}）` : base
}
