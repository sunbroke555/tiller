import { Suspense, useEffect, useRef } from 'react'
import { NavLink } from 'react-router'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import type { TabDef } from './registry'

interface TabBarProps<P> {
  tabs: readonly TabDef<P>[]
  active: string
  hrefFor: (id: string) => string
  className?: string
}

/**
 * Route-driven tab bar: one link per tab, horizontally scrollable on phones
 * (edge to edge), the active tab scrolled into view.
 */
export function TabBar<P>({ tabs, active, hrefFor, className }: TabBarProps<P>) {
  const activeRef = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [active])
  return (
    <nav
      aria-label="页面标签"
      className={cn(
        '-mx-4 mb-(--section-gap) overflow-x-auto scrollbar-none px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0',
        className,
      )}
    >
      <div className="flex w-max gap-1 border-b border-border/70 lg:w-auto">
        {tabs.map((t) => {
          const isActive = t.id === active
          return (
            <NavLink
              key={t.id}
              ref={isActive ? activeRef : undefined}
              to={hrefFor(t.id)}
              replace
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative -mb-px inline-flex h-10 shrink-0 items-center gap-1.5 rounded-t-lg px-3 text-sm whitespace-nowrap transition-colors pointer-coarse:h-11',
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
    </nav>
  )
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
