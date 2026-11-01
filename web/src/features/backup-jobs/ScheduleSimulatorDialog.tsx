import { useEffect, useState } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'

import { useScheduleRuns } from '@/api/backup-jobs'
import { FieldInput, FormField, NumberInput } from '@/components/form'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'

import { describeSchedule, formatTimeUntil } from './logic'
import { SchedulePresetMenu, useDebounced } from './ScheduleField'

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** "计划模拟器" (PVE.window.ScheduleSimulator): next N runs of a calendar event. */
export function ScheduleSimulatorDialog({
  open,
  onOpenChange,
  initialSchedule,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSchedule?: string | undefined
}) {
  const [schedule, setSchedule] = useState(initialSchedule ?? '')
  const [iterations, setIterations] = useState<number | undefined>(10)

  useEffect(() => {
    if (open) {
      setSchedule(initialSchedule ?? '')
      setIterations(10)
    }
  }, [open, initialSchedule])

  const debounced = useDebounced(schedule.trim())
  const n = Math.min(100, Math.max(1, iterations ?? 10))
  const runs = useScheduleRuns(open ? debounced : '', n)
  const label = describeSchedule(schedule)

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="计划模拟器"
      description="输入计划（systemd 日历事件的子集），查看接下来的运行时间。"
      size="md"
      footer={
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          关闭
        </Button>
      }
    >
      <div className="grid gap-4 pt-1 pb-2">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <FormField label="计划" name="schedule" hint={label ?? undefined}>
            <div className="flex gap-2">
              <FieldInput
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="如 mon..fri 21:00"
                className="font-mono"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <SchedulePresetMenu onPick={setSchedule} />
            </div>
          </FormField>
          <FormField label="次数" name="iterations">
            <NumberInput value={iterations} onChange={setIterations} min={1} max={100} />
          </FormField>
        </div>

        {!schedule.trim() ? (
          <EmptyState icon={CalendarClock} title="输入一个计划" description="例如 sun 01:00、*/30、mon..fri 7..18:00/15。也可以从“常用”里选。" className="py-6" />
        ) : runs.isError ? (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            计划格式无效：{errorMessage(runs.error)}
          </p>
        ) : runs.isPending ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="计算中" />
          </div>
        ) : (
          <ol aria-label="运行时间" className="divide-y divide-border/60 rounded-xl border border-border/60" data-testid="simulator-runs">
            {(runs.data ?? []).map((r, i) => {
              const d = new Date(r.timestamp * 1000)
              const pad = (v: number) => String(v).padStart(2, '0')
              return (
                <li key={r.timestamp} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="w-6 text-right text-xs text-faint tabular">{i + 1}</span>
                  <span className="font-mono tabular">
                    {d.getFullYear()}-{pad(d.getMonth() + 1)}-{pad(d.getDate())}
                  </span>
                  <span className="text-muted-foreground">{WEEKDAY[d.getDay()]}</span>
                  <span className="font-mono tabular">
                    {pad(d.getHours())}:{pad(d.getMinutes())}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">{formatTimeUntil(r.timestamp)}</span>
                </li>
              )
            })}
            {runs.data?.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">没有后续运行时间</li>}
          </ol>
        )}
      </div>
    </ResponsiveDialog>
  )
}

export default ScheduleSimulatorDialog
