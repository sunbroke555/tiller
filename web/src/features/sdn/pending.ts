// Pending vs. running SDN configuration. Lists read with ?pending=1 return
// the running values at the top level plus `state` and `pending`:
//
//   new      – everything lives in `pending` (fabrics: not even the id is at the top)
//   changed  – `pending` holds the values apply will write; "deleted" marks a removed key
//   deleted  – the running values; apply removes the object
//
// The UI shows the effective (pending) values everywhere and marks what apply
// would change, like the official render_sdn_pending / _state helpers.

import type { SdnPendingFields, SdnState } from '@/api/sdn'

/** The values the next apply will write (running values for a deleted object). */
export function effective<T extends SdnPendingFields>(obj: T): T {
  if (!obj.pending || obj.state === 'deleted') return obj
  const out = { ...obj } as Record<string, unknown>
  for (const [k, v] of Object.entries(obj.pending)) {
    if (v === 'deleted') delete out[k]
    else out[k] = v
  }
  return out as T
}

export interface PendingChange {
  key: string
  before: unknown
  after: unknown
}

const IGNORED = new Set(['digest', 'state', 'pending', 'type'])

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** What apply would change on this object (keys in pending that differ from running). */
export function pendingChanges(obj: SdnPendingFields): PendingChange[] {
  if (!obj.state || obj.state === 'deleted' || !obj.pending) return []
  const running = obj as unknown as Record<string, unknown>
  const out: PendingChange[] = []
  for (const [key, raw] of Object.entries(obj.pending)) {
    if (IGNORED.has(key)) continue
    const after = raw === 'deleted' ? undefined : raw
    const before = obj.state === 'new' ? undefined : running[key]
    if (obj.state === 'changed' && same(before, after)) continue
    out.push({ key, before, after })
  }
  return out
}

export const STATE_LABEL: Record<SdnState, string> = {
  new: '待新增',
  changed: '待修改',
  deleted: '待删除',
}

/** Number of objects with unapplied changes. */
export function countPending(...lists: readonly (readonly SdnPendingFields[] | undefined)[]): number {
  let n = 0
  for (const list of lists) for (const o of list ?? []) if (o.state) n++
  return n
}

/** Short text of a pending value for tooltips and diff lists. */
export function formatValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '（无）'
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('; ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Sort: alive objects by id, deleted ones last. */
export function byState<T extends SdnPendingFields>(id: (o: T) => string) {
  return (a: T, b: T) => Number(a.state === 'deleted') - Number(b.state === 'deleted') || id(a).localeCompare(id(b), undefined, { numeric: true })
}
