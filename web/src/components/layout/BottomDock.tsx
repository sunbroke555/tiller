import { createContext, use, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { TaskToast } from '@/components/tasks/TaskToast'
import { useIsDesktop } from '@/hooks/useMediaQuery'

import { BottomNav } from './BottomNav'

const DockSlotContext = createContext<HTMLElement | null>(null)

/**
 * Render children in the mobile bottom dock, right above the bottom nav
 * (e.g. a detail page's floating action bar). Nothing on desktop.
 */
export function DockPortal({ children }: { children: ReactNode }) {
  const slot = use(DockSlotContext)
  const desktop = useIsDesktop()
  if (!slot || desktop) return null
  return createPortal(children, slot)
}

/**
 * The fixed bottom area: task toasts on top, then page bars (DockPortal),
 * then the mobile nav. On desktop only the toasts remain, bottom right.
 * Its height is published as --dock-h so <main> can pad for it.
 */
export function BottomDock({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  const measured = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = measured.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    const ro = new ResizeObserver(() => root.style.setProperty('--dock-h', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--dock-h')
    }
  }, [])

  return (
    <DockSlotContext value={slot}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2.5 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:inset-x-auto lg:right-6 lg:bottom-[calc(var(--task-footer-h,0px)+1rem)] lg:w-[23rem] lg:px-0 lg:pb-0"
      >
        <TaskToast className="pointer-events-auto w-full max-w-md lg:max-w-none" />
        <div ref={measured} className="flex w-full flex-col items-center gap-2.5 lg:hidden">
          <div ref={setSlot} className="w-full max-w-md empty:hidden *:pointer-events-auto" />
          <BottomNav />
        </div>
      </div>
    </DockSlotContext>
  )
}
