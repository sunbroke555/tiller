import { useParams } from 'react-router'

import { FirewallPanel } from './FirewallPanel'
import { scopeFeatures } from './model'
import { dcFirewallHref, parseDcFirewallPath } from './nav'

const DC = { kind: 'dc' } as const

/** /datacenter/firewall/* — rules, security groups, aliases, IPSets, options. */
export default function DatacenterFirewallPage() {
  const splat = useParams()['*']
  const { view, item } = parseDcFirewallPath(splat, scopeFeatures(DC).views)
  return <FirewallPanel scope={DC} nav={{ view, item, href: dcFirewallHref }} />
}
