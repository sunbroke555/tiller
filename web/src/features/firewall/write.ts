import type { QueryKey } from '@tanstack/react-query'

import { firewallKey, type FirewallScope } from '@/api/firewall'
import { runTask } from '@/components/tasks/tracker'

/**
 * Run a (synchronous) firewall write: refresh the scope's firewall queries
 * and show "<title>：已保存" unless quiet. Rejects with the API error.
 */
export async function fwWrite(
  start: Promise<unknown>,
  title: string,
  scope: FirewallScope,
  opts: { quiet?: boolean; also?: QueryKey[] } = {},
): Promise<void> {
  await runTask(start, {
    title,
    invalidate: [firewallKey(scope), ...(opts.also ?? [])],
    syncSuccessMessage: opts.quiet ? false : `${title}：已保存`,
  })
}
