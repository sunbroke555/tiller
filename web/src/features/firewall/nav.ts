import type { To } from 'react-router'

import type { FirewallView } from './model'

/**
 * Where the firewall panel is mounted: the datacenter section uses real
 * sub-paths (/datacenter/firewall/ipset/<name>), node and guest tabs keep
 * the view in the query string (?fw=ipset&item=<name>).
 */
export interface FirewallNav {
  view: FirewallView
  /** Selected IPSet / security group. */
  item?: string | undefined
  href: (view: FirewallView, item?: string) => To
}

export const DC_FIREWALL_BASE = '/datacenter/firewall'

export function dcFirewallHref(view: FirewallView, item?: string): string {
  return `${DC_FIREWALL_BASE}/${view}${item ? `/${encodeURIComponent(item)}` : ''}`
}

/** "ipset/web" → { view: 'ipset', item: 'web' } (unknown views fall back to rules). */
export function parseDcFirewallPath(splat: string | undefined, views: readonly FirewallView[]): { view: FirewallView; item?: string } {
  const [first, second] = (splat ?? '').split('/').filter(Boolean)
  const view = views.includes(first as FirewallView) ? (first as FirewallView) : 'rules'
  return { view, item: second ? decodeURIComponent(second) : undefined }
}

export function tabFirewallHref(view: FirewallView, item?: string): To {
  const q = new URLSearchParams()
  if (view !== 'rules') q.set('fw', view)
  if (item) q.set('item', item)
  const s = q.toString()
  return { search: s ? `?${s}` : '' }
}
