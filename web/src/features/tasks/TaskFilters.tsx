import { useState, type ReactNode } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'

import {
  TASK_STATUS_FILTERS,
  TASK_TIME_RANGES,
  countExtraFilters,
  toDateInput,
  type TaskFilters,
  type TaskStatusFilter,
  type TaskTimeRange,
} from '@/api/tasks-logs'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { FieldInput, FormField, FormRow } from '@/components/form'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TASK_TYPE_GROUPS, taskTypeOptionLabel } from '@/lib/taskTypes'
import { cn } from '@/lib/utils'

export interface TaskFilterBarProps {
  filters: TaskFilters
  onChange: (next: TaskFilters) => void
  /** Nodes for the scope select; omitted (or one node) hides it. */
  nodes?: readonly string[]
  /** Offer the VMID filter (not inside a guest's tab). */
  showVmid?: boolean
  /** Running task count shown on the "运行中" choice. */
  runningCount?: number
  /** Filters set by the page (a tab's node / VMID): no chip, not counted. */
  fixedKeys?: readonly (keyof TaskFilters)[]
  className?: string
}

const ALL = 'all'

/**
 * Status segments + "筛选" sheet (scope, type, user, VMID, time) + removable
 * chips for the active filters.
 */
export function TaskFilterBar({ filters, onChange, nodes = [], showVmid = true, runningCount, fixedKeys = [], className }: TaskFilterBarProps) {
  const [open, setOpen] = useState(false)
  const editable = without(filters, ...fixedKeys)
  const extra = countExtraFilters(editable)
  const showNode = nodes.length > 1
  const chips = activeChips(editable, { showNode })

  return (
    <div className={cn('grid grid-cols-1 gap-2.5', className)}>
      <div className="flex items-center gap-2">
        <div className="-ml-4 min-w-0 flex-1 overflow-x-auto pl-4 scrollbar-none sm:ml-0 sm:pl-0">
          <ToggleGroup
            type="single"
            value={filters.status ?? ALL}
            onValueChange={(v) => {
              if (!v) return
              onChange({ ...filters, status: v === ALL ? undefined : (v as TaskStatusFilter) })
            }}
            variant="outline"
            size="sm"
            aria-label="任务状态"
          >
            <ToggleGroupItem value={ALL} className="px-3 text-xs">
              全部
            </ToggleGroupItem>
            {TASK_STATUS_FILTERS.map((s) => (
              <ToggleGroupItem key={s.value} value={s.value} className="gap-1.5 px-3 text-xs">
                {s.label}
                {s.value === 'running' && !!runningCount && (
                  <span className="rounded-full bg-brand/15 px-1.5 text-[10px] leading-4 font-semibold text-brand tabular">
                    {runningCount}
                  </span>
                )}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="h-8 shrink-0 gap-1.5 rounded-md bg-(--field) pointer-coarse:h-10"
          aria-label={extra ? `筛选（已设置 ${extra} 项）` : '筛选'}
        >
          <SlidersHorizontal />
          <span>筛选</span>
          {extra > 0 && (
            <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground tabular">
              {extra}
            </span>
          )}
        </Button>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="已选筛选条件">
          {chips.map((c) => (
            <FilterChip key={c.key} label={c.label} onRemove={() => onChange(c.remove(filters))} />
          ))}
          {chips.length > 1 && (
            <button
              type="button"
              onClick={() => onChange({ status: filters.status, ...(!showNode && filters.node ? { node: filters.node } : {}) })}
              className="h-8 rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground pointer-coarse:h-9"
            >
              清除全部
            </button>
          )}
        </div>
      )}

      <TaskFilterSheet
        open={open}
        onOpenChange={setOpen}
        filters={filters}
        onApply={(f) => {
          onChange(f)
          setOpen(false)
        }}
        nodes={showNode ? nodes : []}
        showVmid={showVmid}
      />
    </div>
  )
}

function FilterChip({ label, onRemove }: { label: ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex h-8 items-center gap-0.5 rounded-full bg-brand/10 pr-0.5 pl-3 text-xs text-brand ring-1 ring-brand/15 ring-inset pointer-coarse:h-9 paper:bg-secondary paper:text-foreground paper:ring-border">
      <span className="max-w-48 truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`移除筛选：${typeof label === 'string' ? label : ''}`}
        className="inline-flex size-7 items-center justify-center rounded-full transition-colors hover:bg-brand/15 pointer-coarse:size-8 paper:hover:bg-foreground/10"
      >
        <X className="size-3.5" />
      </button>
    </span>
  )
}

interface Chip {
  key: string
  label: string
  remove: (f: TaskFilters) => TaskFilters
}

function without(f: TaskFilters, ...keys: (keyof TaskFilters)[]): TaskFilters {
  const out = { ...f }
  for (const k of keys) delete out[k]
  return out
}

/** Chips for the active filters (status has its own segments). */
export function activeChips(f: TaskFilters, { showNode }: { showNode: boolean }): Chip[] {
  const out: Chip[] = []
  if (showNode && f.node) out.push({ key: 'node', label: `节点 ${f.node}`, remove: (x) => without(x, 'node') })
  if (f.type) out.push({ key: 'type', label: `类型：${taskTypeOptionLabel(f.type)}`, remove: (x) => without(x, 'type') })
  if (f.user) out.push({ key: 'user', label: `用户：${f.user}`, remove: (x) => without(x, 'user') })
  if (f.vmid) out.push({ key: 'vmid', label: `VMID ${f.vmid}`, remove: (x) => without(x, 'vmid') })
  if (f.range) {
    const r = TASK_TIME_RANGES.find((x) => x.value === f.range)
    out.push({ key: 'time', label: `最近 ${r?.label ?? f.range}`, remove: (x) => without(x, 'range', 'from', 'to') })
  } else if (f.from || f.to) {
    const label = f.from && f.to ? `${f.from} 至 ${f.to}` : f.from ? `${f.from} 之后` : `${f.to} 之前`
    out.push({ key: 'time', label, remove: (x) => without(x, 'range', 'from', 'to') })
  }
  return out
}

// ------------------------------------------------------------------ sheet

type TimeChoice = 'any' | TaskTimeRange | 'custom'

const TIME_CHIP = 'w-full rounded-full px-3 text-xs sm:w-auto'

const EMPTY_TYPE = '__any__'
const CLUSTER_SCOPE = '__cluster__'

function TaskFilterSheet({
  open,
  onOpenChange,
  filters,
  onApply,
  nodes,
  showVmid,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: TaskFilters
  onApply: (f: TaskFilters) => void
  nodes: readonly string[]
  showVmid: boolean
}) {
  const [draft, setDraft] = useState(filters)
  const [time, setTime] = useState<TimeChoice>('any')
  const [vmidText, setVmidText] = useState('')
  // Load the current filters each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDraft(filters)
      setTime(filters.range ?? (filters.from || filters.to ? 'custom' : 'any'))
      setVmidText(filters.vmid ? String(filters.vmid) : '')
    }
  }

  const vmid = vmidText.trim() ? Number(vmidText.trim()) : undefined
  const vmidError = vmid !== undefined && (!Number.isInteger(vmid) || vmid < 100) ? 'VMID 是不小于 100 的整数' : undefined
  const rangeError = time === 'custom' && draft.from && draft.to && draft.from > draft.to ? '开始日期晚于结束日期' : undefined

  const apply = () => {
    if (vmidError || rangeError) return
    const next: TaskFilters = { ...draft }
    delete next.vmid
    delete next.range
    delete next.from
    delete next.to
    if (vmid !== undefined) next.vmid = vmid
    if (time === 'custom') {
      if (draft.from) next.from = draft.from
      if (draft.to) next.to = draft.to
    } else if (time !== 'any') {
      next.range = time
    }
    if (!next.user?.trim()) delete next.user
    else next.user = next.user.trim()
    onApply(next)
  }

  const reset = () => {
    setDraft({ status: filters.status, ...(nodes.length === 0 && filters.node ? { node: filters.node } : {}) })
    setTime('any')
    setVmidText('')
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="筛选任务"
      size="md"
      wrap={(sections) => (
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault()
            apply()
          }}
        >
          {sections}
        </form>
      )}
      footer={
        <>
          <Button type="button" variant="outline" onClick={reset}>
            重置
          </Button>
          <Button type="submit" disabled={!!vmidError || !!rangeError}>
            应用
          </Button>
        </>
      }
    >
      <div className="grid gap-5 pt-1 pb-2">
        {nodes.length > 1 && (
          <FormField
            label="范围"
            id="task-filter-node"
            hint={draft.node ? '节点的完整任务历史。' : '各节点最近的任务；选择节点可以查看完整历史。'}
          >
            <Select value={draft.node ?? CLUSTER_SCOPE} onValueChange={(v) => setDraft({ ...draft, node: v === CLUSTER_SCOPE ? undefined : v })}>
              <SelectTrigger id="task-filter-node" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value={CLUSTER_SCOPE}>全集群（最近任务）</SelectItem>
                <SelectSeparator />
                {nodes.map((n) => (
                  <SelectItem key={n} value={n}>
                    节点 {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        )}

        <FormField label="任务类型" id="task-filter-type">
          <Select value={draft.type ?? EMPTY_TYPE} onValueChange={(v) => setDraft({ ...draft, type: v === EMPTY_TYPE ? undefined : v })}>
            <SelectTrigger id="task-filter-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-[min(24rem,var(--radix-select-content-available-height))]">
              <SelectItem value={EMPTY_TYPE}>
                <span className="text-muted-foreground">全部类型</span>
              </SelectItem>
              {TASK_TYPE_GROUPS.map((g) => (
                <SelectGroup key={g.label}>
                  <SelectSeparator />
                  <SelectLabel>{g.label}</SelectLabel>
                  {g.types.map((t) => (
                    <SelectItem key={t} value={t} className="pointer-coarse:py-2.5">
                      {taskTypeOptionLabel(t)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormRow>
          <FormField label="用户" hint="包含这段文字的用户，例如 root。">
            <FieldInput
              value={draft.user ?? ''}
              onChange={(e) => setDraft({ ...draft, user: e.target.value })}
              placeholder="全部用户"
              autoCapitalize="off"
              spellCheck={false}
            />
          </FormField>
          {showVmid && (
            <FormField label="VMID" error={vmidError}>
              <FieldInput
                value={vmidText}
                onChange={(e) => setVmidText(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                placeholder="全部客户机"
              />
            </FormField>
          )}
        </FormRow>

        <FormField label="时间" error={rangeError}>
          <ToggleGroup
            type="single"
            value={time}
            onValueChange={(v) => v && setTime(v as TimeChoice)}
            variant="outline"
            size="sm"
            spacing={1}
            className="grid w-full grid-cols-3 gap-1.5 sm:flex sm:flex-wrap"
            aria-label="时间范围"
          >
            <ToggleGroupItem value="any" className={TIME_CHIP}>
              不限
            </ToggleGroupItem>
            {TASK_TIME_RANGES.map((r) => (
              <ToggleGroupItem key={r.value} value={r.value} className={TIME_CHIP}>
                {r.label}
              </ToggleGroupItem>
            ))}
            <ToggleGroupItem value="custom" className={TIME_CHIP}>
              自定义
            </ToggleGroupItem>
          </ToggleGroup>
        </FormField>

        {time === 'custom' && (
          <FormRow>
            <FormField label="从">
              <FieldInput
                type="date"
                value={draft.from ?? ''}
                max={draft.to || toDateInput(new Date())}
                onChange={(e) => setDraft({ ...draft, from: e.target.value || undefined })}
              />
            </FormField>
            <FormField label="到">
              <FieldInput
                type="date"
                value={draft.to ?? ''}
                min={draft.from}
                max={toDateInput(new Date())}
                onChange={(e) => setDraft({ ...draft, to: e.target.value || undefined })}
              />
            </FormField>
          </FormRow>
        )}
      </div>
    </ResponsiveDialog>
  )
}
