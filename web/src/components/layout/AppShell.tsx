import { Outlet } from 'react-router'

import { AmbientBackground } from '@/components/AmbientBackground'
import { TaskLogHost } from '@/components/tasks/TaskLogSheet'

import { BottomDock } from './BottomDock'
import { CommandPaletteProvider } from './CommandPalette'
import { KeyboardShortcuts } from './KeyboardShortcuts'
import { OfflineBanner } from './OfflineBanner'
import { Sidebar } from './Sidebar'

/**
 * Responsive frame. Mobile: content + bottom dock (task toasts, page action
 * bar, floating nav and search button). Desktop (lg, ≥1024px): sidebar with
 * navigation and resource tree; task toasts bottom right.
 */
export function AppShell() {
  return (
    <CommandPaletteProvider>
      <BottomDock>
        <AmbientBackground />
        <div className="relative z-10 min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
          <Sidebar className="hidden lg:flex" />
          <main className="min-w-0 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[calc(var(--dock-h,4.5rem)+max(0.75rem,env(safe-area-inset-bottom))+1.75rem)] sm:px-6 lg:px-10 lg:pt-8 lg:pb-12">
            <div className="mx-auto w-full max-w-6xl">
              <Outlet />
            </div>
          </main>
        </div>
      </BottomDock>
      <TaskLogHost />
      <KeyboardShortcuts />
      <OfflineBanner />
    </CommandPaletteProvider>
  )
}
