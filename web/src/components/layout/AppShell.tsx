import { Outlet } from 'react-router'

import { AmbientBackground } from '@/components/AmbientBackground'
import { TaskLogHost } from '@/components/tasks/TaskLogSheet'
import { TaskFooterBar } from '@/features/tasks/TaskShell'

import { BottomDock } from './BottomDock'
import { CommandPaletteProvider } from './CommandPalette'
import { KeyboardShortcuts } from './KeyboardShortcuts'
import { OfflineBanner } from './OfflineBanner'
import { Sidebar } from './Sidebar'

/**
 * Responsive frame. Mobile: content + bottom dock (task toasts, page action
 * bar, floating nav and search button). Desktop (lg, ≥1024px): sidebar with
 * navigation and resource tree; task toasts bottom right, above the task
 * footer bar.
 */
export function AppShell() {
  return (
    <CommandPaletteProvider>
      <BottomDock>
        <AmbientBackground />
        <div className="relative z-10 min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
          <Sidebar className="hidden lg:flex" />
          <main className="min-w-0 pt-[max(1.25rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(var(--dock-h,4.5rem)+max(0.75rem,env(safe-area-inset-bottom))+1.75rem)] pl-[max(1rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] lg:px-10 lg:pt-8 lg:pb-[calc(var(--task-footer-h,0px)+3rem)]">
            <div className="mx-auto w-full max-w-6xl">
              <Outlet />
            </div>
          </main>
        </div>
        <TaskFooterBar />
        {/* Installed PWA on a notched phone: content scrolling under the
            status bar gets a frosted band behind the clock and battery. */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[env(safe-area-inset-top)] bg-background/85 backdrop-blur-md lg:hidden"
        />
      </BottomDock>
      <TaskLogHost />
      <KeyboardShortcuts />
      <OfflineBanner />
    </CommandPaletteProvider>
  )
}
