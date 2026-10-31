import { NavLink } from 'react-router'
import { Search } from 'lucide-react'

import { useClusterStatus, useVersion } from '@/api/queries'
import { useSession } from '@/api/useSession'
import { Logo } from '@/components/Logo'
import { ScrollArea } from '@/components/ui/scroll-area'
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
          'flex h-9 items-center gap-3 rounded-xl px-3 text-sm transition-colors',
          isActive
            ? 'bg-sidebar-accent font-medium text-foreground shadow-[inset_0_1px_0_var(--glass-edge)]'
            : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          <item.icon className={cn('size-[18px]', isActive && 'text-brand')} />
          {item.label}
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
  const cluster = status?.find((e) => e.type === 'cluster')
  const subtitle = [cluster?.name ?? session?.clustername, version && `PVE ${version.version}`].filter(Boolean).join(' · ')

  return (
    <aside
      className={cn(
        'sticky top-0 h-dvh flex-col gap-4 border-r border-sidebar-border/70 bg-sidebar px-3 pt-5 pb-3',
        className,
      )}
    >
      <div className="flex items-center gap-3 px-2">
        <Logo />
        <div className="min-w-0">
          <div className="heading text-[15px] font-semibold">PVE Web</div>
          <div className="truncate text-xs text-muted-foreground">{subtitle || 'Proxmox VE'}</div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-xl border border-input bg-(--field) px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <Search className="size-4" />
        <span>搜索…</span>
        <kbd className="ml-auto rounded-md border border-border px-1.5 font-mono text-[10px] text-muted-foreground">
          {isMac ? '⌘' : 'Ctrl'} K
        </kbd>
      </button>

      <nav aria-label="主导航" className="space-y-0.5">
        {MAIN_NAV.map((item) => (
          <SideLink key={item.to} item={item} />
        ))}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1.5 px-3 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">资源</div>
        <ScrollArea className="min-h-0 flex-1 pr-1">
          <ResourceTree />
        </ScrollArea>
      </div>

      <div className="space-y-1 border-t border-sidebar-border/70 pt-3">
        <SideLink item={SETTINGS_NAV} />
        <UserMenu variant="row" />
      </div>
    </aside>
  )
}
