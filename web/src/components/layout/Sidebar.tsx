import { NavLink } from 'react-router'
import { Search } from 'lucide-react'

import { useClusterStatus, useVersion } from '@/api/queries'
import { useSession } from '@/api/useSession'
import { getInstanceScope } from '@/api/instance-scope'
import { useInstances } from '@/api/instances'
import { Logo } from '@/components/Logo'
import { cn } from '@/lib/utils'

import { useCommandPalette } from './CommandPalette'
import { MAIN_NAV, SETTINGS_NAV, type NavItem } from './nav'
import { ResourceTree } from './ResourceTree'
import { UserMenu } from './UserMenu'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

function SideLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex h-9 min-w-0 items-center gap-2 rounded-lg px-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(max-height:720px)]:h-8',
          isActive
            ? 'bg-sidebar-accent font-medium text-foreground shadow-[inset_0_1px_0_var(--glass-edge)]'
            : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          <item.icon className={cn('size-4 shrink-0', isActive && 'text-brand-strong')} />
          <span className="truncate">{item.label}</span>
          {item.badge && <item.badge className="ml-auto shrink-0" />}
        </>
      )}
    </NavLink>
  )
}

/** Desktop (≥1024px) navigation column with the resource tree. */
export function Sidebar({ className }: { className?: string }) {
  const { setOpen } = useCommandPalette()
  const session = useSession()
  const { data: version } = useVersion()
  const { data: status } = useClusterStatus()
  const { data: catalog } = useInstances()
  const instance = catalog?.instances.find((i) => i.id === getInstanceScope()?.id)
  const cluster = status?.find((e) => e.type === 'cluster')
  const subtitle = [instance?.name ?? cluster?.name ?? session?.clustername, version && `PVE ${version.version}`].filter(Boolean).join(' · ')

  return (
    <aside
      className={cn(
        'sticky top-0 h-dvh flex-col gap-2 border-r border-sidebar-border/70 bg-sidebar p-3 [@media(max-height:720px)]:gap-1 [@media(max-height:720px)]:py-2',
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2.5 pl-2">
        <Logo className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="heading text-[15px] font-semibold">Tiller</div>
          <div className="truncate text-xs text-muted-foreground">{subtitle || 'Proxmox VE'}</div>
        </div>
        <button
          type="button"
          aria-label="搜索"
          title={`搜索（${isMac ? '⌘' : 'Ctrl'} K）`}
          onClick={() => setOpen(true)}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="size-4" aria-hidden />
        </button>
      </div>

      <nav aria-label="主导航" className="grid shrink-0 grid-cols-2 gap-1">
        {MAIN_NAV.map((item) => (
          <SideLink key={item.to} item={item} />
        ))}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col">
        <ResourceTree />
      </div>

      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-sidebar-border/70 pt-2">
        <SideLink item={SETTINGS_NAV} />
        <UserMenu className="size-9 rounded-lg" />
      </div>
    </aside>
  )
}
