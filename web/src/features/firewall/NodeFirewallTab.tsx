import type { NodeTabProps } from '@/features/node/types'

import { FirewallPanel } from './FirewallPanel'
import { useTabNav } from './useTabNav'

/** Node firewall: rules, options, log. */
export default function NodeFirewallTab({ node }: NodeTabProps) {
  const nav = useTabNav()
  return <FirewallPanel key={node} scope={{ kind: 'node', node }} nav={nav} />
}
