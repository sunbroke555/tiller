import { Link } from 'react-router'
import { ChevronRight, Lock } from 'lucide-react'

import type { GuestResource } from '@/api/types'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { Checkbox } from '@/components/ui/checkbox'
import { formatBytes, formatPercent } from '@/lib/format'
import { GUEST_TYPE_LABEL, guestName, guestPath, parseTags, statusLabel } from '@/lib/resources'
import { cn } from '@/lib/utils'

interface GuestListProps {
  guests: GuestResource[]
  showNode: boolean
  /** Selection mode (bulk actions): rows toggle a checkbox instead of opening the guest. */
  selected?: ReadonlySet<string>
  onToggle?: (guest: GuestResource) => void
}

export function GuestList({ guests, showNode, selected, onToggle }: GuestListProps) {
  return (
    <ul className="divide-y divide-border/70">
      {guests.map((g) => (
        <li key={g.id}>
          <GuestRow guest={g} showNode={showNode} selected={onToggle ? !!selected?.has(g.id) : undefined} onToggle={onToggle} />
        </li>
      ))}
    </ul>
  )
}

function GuestRow({
  guest: g,
  showNode,
  selected,
  onToggle,
}: {
  guest: GuestResource
  showNode: boolean
  selected?: boolean
  onToggle?: (guest: GuestResource) => void
}) {
  const running = g.status === 'running'
  const template = g.template === 1
  const tags = parseTags(g.tags)
  const rowClass = cn(
    'group flex min-h-14 compact:min-h-12 items-center gap-3 px-(--card-p) py-(--row-py) transition-colors outline-none',
    'hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] active:bg-foreground/[0.05] paper:hover:bg-secondary/50',
  )
  const body = (
    <>
      {onToggle && (
        <Checkbox checked={selected} tabIndex={-1} aria-hidden className="pointer-events-none" />
      )}
      <StatusDot status={template ? 'template' : g.status} pulse={running} className="w-2" />
      <ResourceIcon type={g.type} template={template} className="hidden sm:block" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('truncate font-medium', !running && 'text-foreground/75')}>{guestName(g)}</span>
          {g.lock && <Lock className="size-3.5 shrink-0 text-warning" aria-label={`已锁定：${g.lock}`} />}
          {tags.slice(0, 2).map((t) => (
            <span
              key={t}
              className="hidden shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] leading-none text-brand sm:inline paper:bg-secondary paper:text-foreground/70"
            >
              {t}
            </span>
          ))}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          <span className="tabular">{g.vmid}</span>
          {' · '}
          {template ? `${GUEST_TYPE_LABEL[g.type]}模板` : GUEST_TYPE_LABEL[g.type]}
          {showNode && ` · ${g.node}`}
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
      {!onToggle && <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />}
    </>
  )
  if (onToggle) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={!!selected}
        aria-label={`${guestName(g)}（${g.vmid}）`}
        onClick={() => onToggle(g)}
        className={cn(rowClass, 'w-full text-left', selected && 'bg-brand/[0.06] paper:bg-secondary/60')}
      >
        {body}
      </button>
    )
  }
  return (
    <Link to={guestPath(g)} className={rowClass}>
      {body}
    </Link>
  )
}
