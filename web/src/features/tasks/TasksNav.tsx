import { NavLink } from 'react-router'
import { ListChecks, ScrollText } from 'lucide-react'

import { cn } from '@/lib/utils'

const LINKS = [
  { to: '/tasks', label: '任务', icon: ListChecks },
  { to: '/cluster/log', label: '集群日志', icon: ScrollText },
] as const

/** Segmented switch between /tasks and /cluster/log. */
export function TasksNav({ className }: { className?: string }) {
  return (
    <nav aria-label="任务与日志" className={cn('surface inline-flex rounded-full p-1', className)}>
      {LINKS.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end
          className={({ isActive }) =>
            cn(
              'inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors pointer-coarse:h-11',
              isActive
                ? 'bg-foreground/[0.08] text-foreground shadow-[inset_0_1px_0_var(--glass-edge)] paper:bg-secondary'
                : 'text-muted-foreground hover:text-foreground',
            )
          }
        >
          {({ isActive }) => (
            <>
              <l.icon className={cn('size-4', isActive && 'text-brand')} aria-hidden />
              {l.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
