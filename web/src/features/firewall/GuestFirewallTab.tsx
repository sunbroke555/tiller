import type { GuestTabProps } from '@/features/guest/types'

import { FirewallPanel } from './FirewallPanel'
import { useTabNav } from './useTabNav'

/** VM / CT firewall: rules, aliases, IPSets, options, log. */
export default function GuestFirewallTab({ node, type, vmid, guest }: GuestTabProps) {
  const nav = useTabNav()
  return <FirewallPanel key={`${node}/${vmid}`} scope={{ kind: 'guest', node, type, vmid }} nav={nav} pool={guest.pool} />
}
