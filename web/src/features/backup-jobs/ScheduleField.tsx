import { useEffect, useState } from 'react'
import { CalendarClock, ChevronDown, Loader2 } from 'lucide-react'

import { useScheduleRuns } from '@/api/backup-jobs'
import { FieldInput } from '@/components/form'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { SCHEDULE_PRESETS, describeSchedule, formatRunTime } from './logic'

/** Value after the user stopped typing for `ms`. */
export function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

/** Preset menu for a calendar event (PVE.form.CalendarEvent's examples). */
export function SchedulePresetMenu({ onPick, className }: { onPick: (value: string) => void; className?: string }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className={cn('shrink-0', className)}>
          常用
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 min-w-64 overflow-y-auto">
        {SCHEDULE_PRESETS.map((p) => (
          <DropdownMenuItem key={p.value} onSelect={() => onPick(p.value)} className="flex items-center justify-between gap-4">
            <span>{p.label}</span>
            <span className="font-mono text-xs text-muted-foreground">{p.value}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Next runs of a calendar event, from the server's own parser
 * (/cluster/jobs/schedule-analyze): also tells whether the event is valid.
 */
export function ScheduleRuns({ schedule, count = 3, className }: { schedule: string; count?: number; className?: string }) {
  const debounced = useDebounced(schedule.trim())
  const runs = useScheduleRuns(debounced, count)
  const typing = debounced !== schedule.trim()
  if (!schedule.trim()) return null
  if (runs.isError && !typing) {
    return (
      <p role="alert" className={cn('text-xs text-destructive', className)} data-testid="schedule-error">
        计划格式无效：{errorMessage(runs.error)}
      </p>
    )
  }
  return (
    <div className={cn('flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground', className)} data-testid="schedule-runs">
      <CalendarClock className="size-3.5 shrink-0" aria-hidden />
      <span>接下来：</span>
      {runs.isPending || (typing && !runs.data) ? (
        <Loader2 className="size-3.5 animate-spin" aria-label="计算中" />
      ) : runs.data?.length ? (
        runs.data.map((r) => (
          <span key={r.timestamp} className={cn('rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-secondary-foreground tabular', typing && 'opacity-60')}>
            {formatRunTime(r.timestamp)}
          </span>
        ))
      ) : (
        <span>不会再运行</span>
      )}
    </div>
  )
}

/** Calendar event input with presets and the next runs underneath. */
export function ScheduleInput({ value, onChange, autoFocus }: { value: string; onChange: (value: string) => void; autoFocus?: boolean }) {
  const label = describeSchedule(value)
  return (
    <div className="grid gap-1.5">
      <div className="flex gap-2">
        <FieldInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="如 sun 01:00、mon..fri 21:00"
          className="font-mono"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
        />
        <SchedulePresetMenu onPick={onChange} />
      </div>
      {label && <p className="text-xs text-foreground/80">{label}</p>}
      <ScheduleRuns schedule={value} />
    </div>
  )
}
