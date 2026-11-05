import { memo } from 'react'
import { Link } from 'react-router'
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronRight, Lock } from 'lucide-react'

import type { GuestResource } from '@/api/types'
import { ResourceIcon } from '@/components/ResourceIcon'
import { statusTone } from '@/components/StatusDot'
import { TagList } from '@/components/TagChip'
import { UsageBar } from '@/components/UsageBar'
import { formatBytes, formatPercent, ratio } from '@/lib/format'
import { METRIC_TEXT, USAGE_HINT, usageTone } from '@/lib/metric-status'
import { GUEST_TYPE_LABEL, guestName, guestPath, statusLabel } from '@/lib/resources'
import { cn } from '@/lib/utils'
import { defaultGuestSortDirection, type GuestSort, type GuestSortDirection } from './filter'

import './GuestList.css'

interface GuestListProps {
  guests: GuestResource[]
  showNode: boolean
  showPool?: boolean
  sort?: GuestSort
  direction?: GuestSortDirection
  onSort?: (sort: GuestSort, direction: GuestSortDirection) => void
  /** Selection mode (bulk actions): rows toggle a checkbox instead of opening the guest. */
  selected?: ReadonlySet<string>
  onToggle?: (guest: GuestResource) => void
}

export function GuestList({ guests, showNode, showPool, sort, direction, onSort, selected, onToggle }: GuestListProps) {
  const heading = (field: GuestSort, label: string, right = false) => {
    if (!onSort) return <span>{label}</span>
    const active = sort === field
    const current = direction ?? defaultGuestSortDirection(field)
    const next = active ? current === 'asc' ? 'desc' : 'asc' : defaultGuestSortDirection(field)
    const Icon = active ? current === 'asc' ? ArrowUp : ArrowDown : ArrowUpDown
    const action = `按${label}${next === 'asc' ? '升序' : '降序'}排列`
    return <button type="button" className={cn('guest-sort-button', right && 'flex-row-reverse')} aria-pressed={active}
      aria-label={`${action}${active ? `，当前${current === 'asc' ? '升序' : '降序'}` : ''}`} title={action} onClick={() => onSort(field, next)}>
      {label}<Icon aria-hidden className={cn('size-3 shrink-0', active ? 'text-brand-strong' : 'opacity-45')} />
    </button>
  }
  return (
    <div className={cn('guest-list', showNode && 'guest-list-with-node')}>
      <div className="guest-list-heading" role={onSort ? 'group' : undefined} aria-label={onSort ? '列表排序' : undefined} aria-hidden={onSort ? undefined : true}>
        <div>{heading('status', '状态')}</div>
        <div className="flex items-center gap-1"><span>{heading('name', '名称')}</span><span aria-hidden>/</span><span>{heading('vmid', 'VMID')}</span></div>
        {showNode && <div>{heading('node', '节点')}</div>}
        <div>{heading('tags', '标签')}</div>
        <div className="flex justify-end">{heading('cpu', 'CPU', true)}</div>
        <div className="flex justify-end">{heading('mem', '内存', true)}</div>
        <span />
      </div>
      <ul className="divide-y divide-border/60">
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
    </div>
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
        usageTone(x.cpu) === usageTone(y.cpu) &&
        usageTone(ratio(x.mem, x.maxmem)) === usageTone(ratio(y.mem, y.maxmem)) &&
        formatPercent(ratio(x.mem, x.maxmem)) === formatPercent(ratio(y.mem, y.maxmem)) &&
        formatBytes(x.maxmem) === formatBytes(y.maxmem) &&
        formatBytes(x.mem) === formatBytes(y.mem)))
  )
}

function GuestStatus({ status }: { status: string }) {
  const tone = statusTone(status)
  return (
    <span
      data-slot="guest-status"
      title={statusLabel(status)}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap',
        tone === 'ok' ? 'text-success-strong' : tone === 'warn' ? 'text-warning-strong' : tone === 'bad' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      <span
        aria-hidden
        className={cn('size-1.5 shrink-0 bg-current', tone === 'off' ? 'rounded-[2px]' : 'rounded-full')}
      />
      <span className="truncate">{statusLabel(status)}</span>
    </span>
  )
}

const GuestRow = memo(function GuestRow({ guest: g, showNode, showPool, selected, onToggle }: GuestRowProps) {
  const running = g.status === 'running'
  const template = g.template === 1
  const name = guestName(g)
  // Capital identifiers fill more of the line than lowercase names.
  const allCaps = /[A-Z]/.test(name) && /^[A-Z\d_. -]+$/.test(name)
  const live = running && !template
  const memoryRatio = ratio(g.mem, g.maxmem)
  const hasTags = !!g.tags?.trim()
  const rowClass = cn(
    'guest-row group transition-colors outline-none',
    'hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset active:bg-foreground/[0.05] paper:hover:bg-secondary/50',
  )
  const body = (
    <>
      <div className="guest-row-status">
        <GuestStatus status={template ? 'template' : g.status} />
      </div>
      <div className="guest-row-identity flex min-w-0 items-center gap-3">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.04] text-muted-foreground ring-1 ring-border/60 ring-inset">
          <ResourceIcon type={g.type} template={template} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span title={name} className={cn('truncate text-sm font-medium text-foreground', allCaps && 'text-[13px] leading-5')}>{name}</span>
            {g.lock && <Lock className="size-3.5 shrink-0 text-warning-strong" aria-label={`已锁定：${g.lock}`} />}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            <span className="tabular">{g.vmid}</span>
            {' · '}
            {template ? `${GUEST_TYPE_LABEL[g.type]}模板` : GUEST_TYPE_LABEL[g.type]}
            {showNode && <span className="guest-row-node-inline"> · {g.node}</span>}
            {showPool && g.pool && ` · 池 ${g.pool}`}
          </div>
        </div>
      </div>
      {showNode && <span className="guest-row-node truncate text-xs text-muted-foreground" title={g.node}>{g.node}</span>}
      <div className={cn('guest-row-tags', !hasTags && 'guest-row-tags-empty')}>
        {hasTags ? <TagList tags={g.tags} max={2} className="max-w-full flex-nowrap [&>span]:min-w-0 [&>span]:shrink [&>span[title]]:shrink-0" /> : <span className="text-faint">—</span>}
      </div>
      <div className={cn('guest-row-metrics', !live && 'guest-row-metrics-idle')}>
        <GuestMetric label="CPU" value={live ? formatPercent(g.cpu) : '—'} ratio={live ? g.cpu : null} live={live} ariaLabel="CPU 使用率" />
        <GuestMetric label="内存" value={live ? formatBytes(g.mem) : '—'} ratio={live ? memoryRatio : null} live={live} ariaLabel="内存使用量" detail={live ? `已用 ${formatBytes(g.mem)} / 总计 ${formatBytes(g.maxmem)}` : undefined} />
      </div>
      <div className={cn('guest-row-action', onToggle && 'guest-row-selection')}>
        {onToggle ? <span aria-hidden className={cn('inline-flex size-4 items-center justify-center rounded-[4px] border border-input', selected && 'border-primary bg-primary text-primary-foreground')}>
          {selected && <Check className="size-3" />}
        </span> : <ChevronRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5" />}
      </div>
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

function GuestMetric({ label, value, ratio: valueRatio, live, ariaLabel, detail }: {
  label: string; value: string; ratio: number | null | undefined; live: boolean; ariaLabel: string; detail?: string | undefined
}) {
  return <div className="guest-row-metric min-w-0" title={detail ? `${detail}。${USAGE_HINT}` : USAGE_HINT}>
    <div className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
      <span className="guest-row-metric-label text-muted-foreground">{label}</span>
      <span aria-label={ariaLabel} className={cn('ml-auto whitespace-nowrap tabular', live ? METRIC_TEXT[usageTone(valueRatio)] : 'text-faint')}>{value}</span>
    </div>
    {live && <div aria-hidden className="mt-2"><UsageBar value={valueRatio} showPercent={false} size="sm" /></div>}
  </div>
}
