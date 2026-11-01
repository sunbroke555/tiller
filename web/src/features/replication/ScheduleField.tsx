// Calendar-event input with presets and a live preview of the next runs
// (GET /cluster/jobs/schedule-analyze also tells whether PVE can parse it).

import { useEffect, useState } from 'react'
import { CalendarClock, ChevronDown, Loader2 } from 'lucide-react'

import { isPveApiError } from '@/api/client'
import { useScheduleAnalyze } from '@/api/replication'
import { FieldInput, FormField } from '@/components/form'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'

import { DEFAULT_SCHEDULE, SCHEDULE_PRESETS, describeSchedule, scheduleErrorText } from './logic'

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return out
}

export interface ScheduleCheck {
  /** PVE rejected the event (message), or null. */
  error: string | null
  /** Waiting for the debounce or the server. */
  checking: boolean
  next: number[]
}

/** Validates `schedule` against the server ("" means the default). */
export function useScheduleCheck(schedule: string, enabled = true): ScheduleCheck {
  const raw = schedule.trim() || DEFAULT_SCHEDULE
  const debounced = useDebounced(raw, 350)
  const q = useScheduleAnalyze(debounced, enabled)
  const checking = enabled && (debounced !== raw || q.isFetching)
  if (q.error) {
    const detail = isPveApiError(q.error) ? (q.error.errors?.schedule ?? q.error.message) : errorMessage(q.error)
    return { error: scheduleErrorText(detail), checking, next: [] }
  }
  return { error: null, checking, next: (q.data ?? []).map((e) => e.timestamp) }
}

export function ScheduleField({
  value,
  onChange,
  check,
}: {
  value: string
  onChange: (value: string) => void
  check: ScheduleCheck
}) {
  const described = describeSchedule(value)
  const hint = check.error ? undefined : (
    <span className="flex flex-wrap items-center gap-x-1.5">
      {check.checking ? (
        <Loader2 className="size-3 animate-spin" aria-hidden />
      ) : (
        <CalendarClock className="size-3" aria-hidden />
      )}
      {described && <span className="text-foreground/80">{described}</span>}
      {check.next.length > 0 && (
        <span className="tabular">
          {described ? '· ' : ''}接下来 {check.next.slice(0, 2).map((t) => formatDateTime(t).slice(5)).join('、')}
        </span>
      )}
    </span>
  )
  return (
    <FormField label="同步计划" name="schedule" hint={hint} error={check.error ?? undefined}>
      <div className="flex gap-2">
        <FieldInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`${DEFAULT_SCHEDULE}（每 15 分钟）`}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 font-mono"
          data-testid="schedule-input"
        />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="shrink-0 px-3" aria-label="常用计划">
              <span className="max-sm:hidden">常用</span>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            collisionPadding={12}
            className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-[min(26rem,calc(100vw-1.5rem))] overflow-y-auto"
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">常用计划</DropdownMenuLabel>
            {SCHEDULE_PRESETS.map((p) => (
              <DropdownMenuItem key={p.value} onSelect={() => onChange(p.value)} className="justify-between gap-3">
                <span className="min-w-0">{p.label}</span>
                <span className="max-w-[45%] shrink-0 truncate font-mono text-xs text-muted-foreground">{p.value}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </FormField>
  )
}
