import { Suspense, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { NavLink } from 'react-router'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { preloadOnIntent } from '@/lib/lazyComponent'

import type { TabDef } from './registry'

interface TabBarProps<P> {
  tabs: readonly TabDef<P>[]
  active: string
  hrefFor: (id: string) => string
  className?: string
}

/**
 * Route-driven tab bar: one link per tab, horizontally scrollable on phones
 * (edge to edge), with scroll buttons on desktop when the row overflows.
 */
export function TabBar<P>({ tabs, active, hrefFor, className }: TabBarProps<P>) {
  const barRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLAnchorElement>(null)
  const [scroll, setScroll] = useState({ overflow: false, back: false, forward: false })

  useEffect(() => {
    const bar = barRef.current
    const viewport = scrollRef.current
    const content = contentRef.current
    if (!bar || !viewport || !content) return

    const update = () => {
      const next = {
        overflow: content.scrollWidth > bar.clientWidth + 1,
        back: viewport.scrollLeft > 1,
        forward: viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1,
      }
      setScroll((previous) =>
        previous.overflow === next.overflow && previous.back === next.back && previous.forward === next.forward
          ? previous
          : next,
      )
    }
    const resize = () => {
      update()
      revealTab(viewport, activeRef.current)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(bar)
    observer.observe(viewport)
    observer.observe(content)
    viewport.addEventListener('scroll', update, { passive: true })
    resize()
    return () => {
      observer.disconnect()
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  useEffect(() => {
    revealTab(scrollRef.current, activeRef.current, scrollBehavior())
  }, [active])

  const move = (direction: number) => {
    const viewport = scrollRef.current
    if (viewport) viewport.scrollBy({ left: direction * viewport.clientWidth * 0.75, behavior: scrollBehavior() })
  }

  return (
    <nav
      aria-label="页面标签"
      className={cn(
        '-mx-4 mb-(--section-gap) px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0',
        className,
      )}
    >
      <div ref={barRef} className="flex min-w-0 items-center gap-1 border-b border-border/70">
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto scrollbar-none">
          <div ref={contentRef} className="flex w-max min-w-full gap-1">
            {tabs.map((t) => {
              const isActive = t.id === active
              return (
                <NavLink
                  key={t.id}
                  ref={isActive ? activeRef : undefined}
                  to={hrefFor(t.id)}
                  onPointerEnter={() => preloadOnIntent(t.component)}
                  onFocus={() => preloadOnIntent(t.component)}
                  onTouchStart={() => preloadOnIntent(t.component)}
                  end
                  replace
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-t-lg px-3 text-sm whitespace-nowrap transition-colors pointer-coarse:h-11',
                    'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors',
                    isActive
                      ? 'font-medium text-foreground after:bg-brand'
                      : 'text-muted-foreground after:bg-transparent hover:text-foreground',
                  )}
                >
                  {t.icon && <t.icon className={cn('size-4', isActive ? 'text-brand-strong' : 'opacity-70')} aria-hidden />}
                  {t.title}
                </NavLink>
              )
            })}
          </div>
        </div>
        {scroll.overflow && (
          <div className="hidden shrink-0 items-center gap-0.5 border-l border-border/70 pl-1 lg:flex">
            <Button type="button" variant="ghost" size="icon" aria-label="向左滚动标签" title="向左滚动标签" disabled={!scroll.back} onClick={() => move(-1)}>
              <ChevronLeft aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="向右滚动标签" title="向右滚动标签" disabled={!scroll.forward} onClick={() => move(1)}>
              <ChevronRight aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </nav>
  )
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/** Move only the tab strip; selecting a tab must not move the whole page. */
function revealTab(viewport: HTMLElement | null, tab: HTMLElement | null, behavior: ScrollBehavior = 'auto') {
  if (!viewport || !tab) return
  const bounds = viewport.getBoundingClientRect()
  const target = tab.getBoundingClientRect()
  const offset = target.left < bounds.left ? target.left - bounds.left : target.right > bounds.right ? target.right - bounds.right : 0
  if (offset) viewport.scrollBy({ left: offset, behavior })
}

/** Loading placeholder for a lazily loaded tab. */
export function TabSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="加载中">
      <Skeleton className="h-28 rounded-2xl" />
      <Skeleton className="h-48 rounded-2xl" />
    </div>
  )
}

/** Renders the active tab's component with Suspense and an error boundary. */
export function TabPanel<P extends object>({ tab, props }: { tab: TabDef<P> | undefined; props: P }) {
  if (!tab) return null
  const Component = tab.component
  return (
    <section role="tabpanel" aria-label={tab.title} className="min-w-0">
      <ErrorBoundary key={tab.id}>
        <Suspense fallback={<TabSkeleton />}>
          <Component {...props} />
        </Suspense>
      </ErrorBoundary>
    </section>
  )
}
