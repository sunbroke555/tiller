import { NavLink } from 'react-router'
import { Search } from 'lucide-react'

import { cn } from '@/lib/utils'

import { useCommandPalette } from './CommandPalette'
import { MOBILE_NAV } from './nav'

/**
 * Floating glass tab bar plus a separate round search button (mobile).
 * Positioned by BottomDock.
 */
export function BottomNav({ className }: { className?: string }) {
  const { setOpen } = useCommandPalette()
  return (
    <div className={cn('pointer-events-none flex w-full items-end justify-center gap-2.5', className)}>
      <nav aria-label="主导航" className="surface-strong pointer-events-auto flex flex-1 items-center rounded-full p-1.5 sm:max-w-md sm:flex-none">
        {MOBILE_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex h-12 min-w-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-3 text-[11px] font-medium transition-colors sm:min-w-18',
                isActive
                  ? 'bg-foreground/[0.08] text-foreground shadow-[inset_0_1px_0_var(--glass-edge)] paper:bg-secondary'
                  : 'text-muted-foreground active:bg-foreground/[0.05]',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  <item.icon className={cn('size-5', isActive && 'text-brand-strong')} strokeWidth={isActive ? 2.2 : 1.8} />
                  {item.badge && <item.badge className="absolute -top-1.5 left-3.5 ring-2 ring-(--glass-solid-strong)" />}
                </span>
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="搜索"
        className="surface-strong pointer-events-auto inline-flex size-[3.75rem] shrink-0 items-center justify-center rounded-full text-foreground transition-transform active:scale-95"
      >
        <Search className="size-[22px]" />
      </button>
    </div>
  )
}
