// /datacenter/sdn/* — SDN: status and apply, zones, VNets (subnets, firewall),
// options (controllers, IPAM, DNS), the PVE IPAM view, fabrics, route maps
// and prefix lists. Sub-pages are real paths; detail pages hang below their
// list (zones/<id>, vnets/<id>, fabrics/<id>).

import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router'

import { cn } from '@/lib/utils'

import { PendingBar } from './apply'
import { SECTIONS, sdnHref, type SdnSection } from './nav'
import { FabricDetail } from './FabricDetail'
import { FabricsView } from './FabricsView'
import { IpamView } from './IpamView'
import { OptionsView } from './OptionsView'
import { PrefixListsView } from './PrefixListsView'
import { RouteMapsView } from './RouteMapsView'
import { StatusView } from './StatusView'
import { VnetDetail } from './VnetDetail'
import { VnetsView } from './VnetsView'
import { ZoneDetail } from './ZoneDetail'
import { ZonesView } from './ZonesView'

export default function SdnPage() {
  const [first, second] = (useParams()['*'] ?? '').split('/').filter(Boolean)
  const section = (SECTIONS.find((s) => s.id === first)?.id ?? '') as SdnSection
  const item = second ? decodeURIComponent(second) : undefined
  const navRef = useRef<HTMLElement>(null)
  // Phones: keep the current section's tab in view.
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [section])

  return (
    <div className="grid min-w-0 gap-(--section-gap)">
      <nav ref={navRef} aria-label="SDN" className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
        <ul className="flex w-max gap-1 rounded-xl bg-secondary/60 p-1 paper:bg-secondary">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <Link
                to={sdnHref(s.id)}
                aria-current={s.id === section ? 'page' : undefined}
                className={cn(
                  'inline-flex h-9 items-center rounded-lg px-3.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-10',
                  s.id === section && 'bg-background font-medium text-foreground shadow-sm paper:bg-card',
                )}
              >
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {section !== '' && <PendingBar />}

      {section === '' && <StatusView />}
      {section === 'zones' && (item ? <ZoneDetail zone={item} /> : <ZonesView />)}
      {section === 'vnets' && (item ? <VnetDetail vnet={item} /> : <VnetsView />)}
      {section === 'options' && <OptionsView />}
      {section === 'ipam' && <IpamView />}
      {section === 'fabrics' && (item ? <FabricDetail id={item} /> : <FabricsView />)}
      {section === 'route-maps' && <RouteMapsView />}
      {section === 'prefix-lists' && <PrefixListsView />}
    </div>
  )
}
