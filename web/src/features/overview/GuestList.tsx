import { memo } from 'react'
import { Link } from 'react-router'
import { ChevronRight, Lock } from 'lucide-react'

import type { GuestResource } from '@/api/types'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { TagList } from '@/components/TagChip'
import { Checkbox } from '@/components/ui/checkbox'
import { formatBytes, formatPercent } from '@/lib/format'
import { GUEST_TYPE_LABEL, guestName, guestPath, statusLabel } from '@/lib/resources'
import { cn } from '@/lib/utils'

interface GuestListProps {
  guests: GuestResource[]
  showNode: boolean
  showPool?: boolean
  /** Selection mode (bulk actions): rows toggle a checkbox instead of opening the guest. */
  selected?: ReadonlySet<string>
  onToggle?: (guest: GuestResource) => void
}

export function GuestList({ guests, showNode, showPool, selected, onToggle }: GuestListProps) {
  return (
    <ul className="divide-y divide-border/70">
      {guests.map((g) => (
        <li key={g.id}>
          <GuestRow
            guest={g}
            showNode={showNode}
            showPool={showPool ?? false}
            selected={onToggle ? !!selected?.has(g.id) : undefined}
            onToggle={onToggle}
          />
        </li>
      ))}
    </ul>
  )
}

interface GuestRowProps {
  guest: GuestResource
  showNode: boolean
  showPool: boolean
  selected?: boolean | undefined
  onToggle?: ((guest: GuestResource) => void) | undefined
}

/**
 * Whether a row would render the same: /cluster/resources is polled every
 * 5 s and hands out a new object for every running guest (cpu, mem, netin…
 * change), but a row only shows these fields, CPU and memory as formatted.
 */
export function sameGuestRow(a: GuestRowProps, b: GuestRowProps): boolean {
  const x = a.guest
  const y = b.guest
  return (
    a.showNode === b.showNode &&
    a.showPool === b.showPool &&
    a.selected === b.selected &&
    a.onToggle === b.onToggle &&
    (x === y ||
      (x.id === y.id &&
        x.vmid === y.vmid &&
        x.type === y.type &&
        x.node === y.node &&
        x.name === y.name &&
        x.status === y.status &&
        x.template === y.template &&
        x.lock === y.lock &&
        x.tags === y.tags &&
        x.pool === y.pool &&
        formatPercent(x.cpu) === formatPercent(y.cpu) &&
        formatBytes(x.mem) === formatBytes(y.mem)))
  )
}

const GuestRow = memo(function GuestRow({ guest: g, showNode, showPool, selected, onToggle }: GuestRowProps) {
  const running = g.status === 'running'
  const template = g.template === 1
  const rowClass = cn(
    'group flex min-h-14 compact:min-h-12 items-center gap-3 px-(--card-p) py-(--row-py) transition-colors outline-none',
    'hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] active:bg-foreground/[0.05] paper:hover:bg-secondary/50',
  )
  const body = (
    <>
      {onToggle && <Checkbox checked={selected} tabIndex={-1} aria-hidden className="pointer-events-none" />}
      <StatusDot status={template ? 'template' : g.status} pulse={running} className="w-2" />
      <ResourceIcon type={g.type} template={template} className="hidden sm:block" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('truncate font-medium', !running && 'text-foreground/75')}>{guestName(g)}</span>
          {g.lock && <Lock className="size-3.5 shrink-0 text-warning-strong" aria-label={`已锁定：${g.lock}`} />}
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
}, sameGuestRow)
