export type GuestFilter = 'all' | 'running' | 'stopped'

export const FILTERS: { value: GuestFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '运行中' },
  { value: 'stopped', label: '已停止' },
]

/** "stopped" means everything not running (paused, templates …). */
export function filterGuests<T extends { status: string }>(guests: T[], filter: GuestFilter): T[] {
  if (filter === 'running') return guests.filter((g) => g.status === 'running')
  if (filter === 'stopped') return guests.filter((g) => g.status !== 'running')
  return guests
}
