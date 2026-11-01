import { FirewallPanel } from './FirewallPanel'
import { useTabNav } from './useTabNav'

/**
 * Firewall of an SDN VNet (forward rules and options; nftables only). For the
 * SDN area to mount on its VNet page; navigation uses ?fw=rules|options.
 */
export function VnetFirewall({ vnet }: { vnet: string }) {
  const nav = useTabNav()
  return <FirewallPanel key={vnet} scope={{ kind: 'vnet', vnet }} nav={nav} />
}
