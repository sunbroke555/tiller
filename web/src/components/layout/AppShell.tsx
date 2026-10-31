import { Outlet } from 'react-router'

import { AmbientBackground } from '@/components/AmbientBackground'

import { BottomNav } from './BottomNav'
import { CommandPaletteProvider } from './CommandPalette'
import { Sidebar } from './Sidebar'

/**
 * Responsive frame. Mobile: content + floating bottom nav and search button.
 * Desktop (lg, ≥1024px): sidebar with navigation and resource tree.
 */
export function AppShell() {
  return (
    <CommandPaletteProvider>
      <AmbientBackground />
      <div className="relative z-10 min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Sidebar className="hidden lg:flex" />
        <main className="min-w-0 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-36 sm:px-6 lg:px-10 lg:pt-8 lg:pb-12">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
      <BottomNav className="lg:hidden" />
    </CommandPaletteProvider>
  )
}
