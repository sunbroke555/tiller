import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

import type { GuestResource } from '@/api/types'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import type { SelectionMode } from './logic'

export interface GuestPickerProps {
  /** All guests of the cluster. */
  guests: readonly GuestResource[]
  /** Job node ('' = all nodes): only its guests are listed. */
  node: string
  mode: SelectionMode
  pool: string
  value: readonly number[]
  onChange: (vmids: number[]) => void
  invalid?: boolean
}

/** Filter guests by "name, VMID, type" (like the official search field). */
export function matchGuest(g: Pick<GuestResource, 'vmid' | 'name' | 'type' | 'node'>, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    String(g.vmid).includes(q) ||
    (g.name ?? '').toLowerCase().includes(q) ||
    g.type.includes(q) ||
    (g.type === 'qemu' ? '虚拟机' : '容器').includes(q) ||
    g.node.toLowerCase().includes(q)
  )
}

/**
 * Guest checklist of the job form (the official "vmselector"): include /
 * exclude pick guests; "all" and "pool" show which guests the job covers.
 */
export function GuestPicker({ guests, node, mode, pool, value, onChange, invalid }: GuestPickerProps) {
  const [query, setQuery] = useState('')
  const [review, setReview] = useState(false)
  const selected = useMemo(() => new Set(value), [value])
  const editable = mode === 'include' || mode === 'exclude'

  const visible = useMemo(() => {
    let list = guests.filter((g) => !node || g.node === node)
    if (mode === 'pool') list = list.filter((g) => !!pool && g.pool === pool)
    return [...list].sort((a, b) => a.vmid - b.vmid)
  }, [guests, node, mode, pool])

  const isChecked = (vmid: number) => (mode === 'all' || mode === 'pool' ? true : selected.has(vmid))
  const shown = visible.filter((g) => matchGuest(g, query) && (!review || isChecked(g.vmid)))
  const count = editable ? value.length : visible.length

  const toggle = (vmid: number, on: boolean) => {
    const next = new Set(value)
    if (on) next.add(vmid)
    else next.delete(vmid)
    onChange([...next].sort((a, b) => a - b))
  }
  const allShownChecked = shown.length > 0 && shown.every((g) => selected.has(g.vmid))

  const heading =
    mode === 'include' ? '要备份的客户机' : mode === 'exclude' ? '要排除的客户机' : mode === 'all' ? '会备份全部客户机' : pool ? `资源池 ${pool} 的客户机` : '先选择资源池'

  return (
    <div
      className={cn('overflow-hidden rounded-xl border border-input bg-(--field)', invalid && 'border-destructive/60')}
      data-testid="guest-picker"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{heading}</span>
        <div className="relative w-full sm:w-48">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名称、VMID、类型"
            aria-label="搜索客户机"
            className="h-9 pl-8 text-base md:text-sm"
            autoComplete="off"
          />
        </div>
      </div>

      <ul aria-label="客户机" className="max-h-72 divide-y divide-border/50 overflow-y-auto overscroll-contain">
        {shown.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">
            {visible.length === 0 ? (node ? `节点 ${node} 上没有客户机` : '没有客户机') : '没有匹配的客户机'}
          </li>
        ) : (
          shown.map((g) => {
            const checked = isChecked(g.vmid)
            return (
              <li key={g.vmid}>
                <label
                  className={cn(
                    'flex min-h-11 items-center gap-3 px-3 py-2 text-sm transition-colors',
                    editable ? 'cursor-pointer hover:bg-accent/50' : 'cursor-default',
                  )}
                  data-vmid={g.vmid}
                >
                  <Checkbox
                    checked={checked}
                    disabled={!editable}
                    onCheckedChange={(c) => toggle(g.vmid, c === true)}
                    aria-label={`${g.vmid} ${g.name ?? ''}`.trim()}
                  />
                  <ResourceIcon type={g.type} template={g.template === 1} />
                  <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground tabular">{g.vmid}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground">{g.name ?? '—'}</span>
                  {!node && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{g.node}</span>}
                  <StatusDot status={g.template === 1 ? 'template' : g.status} pulse={false} size="sm" />
                </label>
              </li>
            )
          })
        )}
      </ul>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="tabular" data-testid="guest-picker-count">
          {mode === 'exclude' ? '排除' : '已选'} {count}
        </span>
        {editable && shown.length > 0 && (
          <button
            type="button"
            className="inline-flex min-h-9 items-center rounded-md px-1.5 hover:text-foreground"
            onClick={() => {
              const next = new Set(value)
              for (const g of shown) {
                if (allShownChecked) next.delete(g.vmid)
                else next.add(g.vmid)
              }
              onChange([...next].sort((a, b) => a - b))
            }}
          >
            {allShownChecked ? '取消全选' : query ? '全选匹配项' : '全选'}
          </button>
        )}
        <label className="ml-auto inline-flex min-h-9 cursor-pointer items-center gap-2">
          <Checkbox checked={review} onCheckedChange={(c) => setReview(c === true)} />
          只看已选
        </label>
      </div>
    </div>
  )
}
