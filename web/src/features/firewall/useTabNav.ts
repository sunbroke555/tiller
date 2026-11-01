import { useSearchParams } from 'react-router'

import type { FirewallView } from './model'
import { tabFirewallHref, type FirewallNav } from './nav'

/** Firewall navigation inside a node/guest tab: ?fw=<view>&item=<name>. */
export function useTabNav(): FirewallNav {
  const [params] = useSearchParams()
  return {
    view: (params.get('fw') as FirewallView | null) ?? 'rules',
    item: params.get('item') ?? undefined,
    href: tabFirewallHref,
  }
}
