import { Link } from 'react-router'
import { ChevronRight, Lock } from 'lucide-react'

import type { GuestResource } from '@/api/types'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { TagList } from '@/components/TagChip'
import { formatBytes, formatPercent } from '@/lib/format'
import { GUEST_TYPE_LABEL, guestName, guestPath, statusLabel } from '@/lib/resources'
import { cn } from '@/lib/utils'

export function GuestList({ guests, showNode, showPool }: { guests: GuestResource[]; showNode: boolean; showPool?: boolean }) {
  return (
    <ul className="divide-y divide-border/70">
      {guests.map((g) => (
        <li key={g.id}>
          <GuestRow guest={g} showNode={showNode} showPool={showPool ?? false} />
        </li>
      ))}
    </ul>
  )
}

function GuestRow({ guest: g, showNode, showPool }: { guest: GuestResource; showNode: boolean; showPool: boolean }) {
  const running = g.status === 'running'
  const template = g.template === 1
  return (
    <Link
      to={guestPath(g)}
      className={cn(
        'group flex min-h-14 compact:min-h-12 items-center gap-3 px-(--card-p) py-(--row-py) transition-colors outline-none',
        'hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] active:bg-foreground/[0.05] paper:hover:bg-secondary/50',
      )}
    >
      <StatusDot status={template ? 'template' : g.status} pulse={running} className="w-2" />
      <ResourceIcon type={g.type} template={template} className="hidden sm:block" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('truncate font-medium', !running && 'text-foreground/75')}>{guestName(g)}</span>
          {g.lock && <Lock className="size-3.5 shrink-0 text-warning" aria-label={`已锁定：${g.lock}`} />}
          <TagList tags={g.tags} max={3} className="hidden flex-nowrap sm:inline-flex" />
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">
            <span className="tabular">{g.vmid}</span>
            {' · '}
            {template ? `${GUEST_TYPE_LABEL[g.type]}模板` : GUEST_TYPE_LABEL[g.type]}
            {showNode && ` · ${g.node}`}
            {showPool && g.pool && ` · 池 ${g.pool}`}
          </span>
          <TagList tags={g.tags} max={2} className="flex-nowrap sm:hidden" />
        </div>
      </div>
      {running ? (
        <div className="grid shrink-0 grid-cols-[auto_auto] gap-x-2 text-right text-xs leading-5">
          <span className="text-muted-foreground">CPU</span>
          <span className="min-w-12 tabular">{formatPercent(g.cpu)}</span>
          <span className="text-muted-foreground">内存</span>
          <span className="min-w-12 tabular">{formatBytes(g.mem)}</span>
        </div>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">{template ? '模板' : statusLabel(g.status)}</span>
      )}
      <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}
