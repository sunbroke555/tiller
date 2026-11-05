// Mute a Ceph health check (pve-manager ≥ 9.2.12, PUT /cluster/ceph/health-mute/{code}).
// A muted check stays visible and keeps being evaluated, but no longer counts
// towards the cluster's overall health.

import { useEffect, useId, useState } from 'react'

import { cephKeys, setCephHealthMute } from '@/api/ceph'
import { FormDialog, SwitchField } from '@/components/form'
import { fireTask, runTask } from '@/components/tasks/tracker'
import { cn } from '@/lib/utils'

import { MUTE_DURATIONS, healthMuteParams, healthUnmuteParams, type MuteForm } from './model'

const INVALIDATE = [cephKeys.status(), cephKeys.healthMutes()]

const DEFAULT_FORM: MuteForm = { duration: '1w', sticky: false }

export function HealthMuteDialog({
  code,
  summary,
  open,
  onOpenChange,
}: {
  code: string | null
  summary?: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [form, setForm] = useState<MuteForm>(DEFAULT_FORM)
  const labelId = useId()
  useEffect(() => {
    if (open) setForm(DEFAULT_FORM)
  }, [open])
  if (!code) return null

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`静默 ${code}`}
      description="静默后这项检查仍会显示并持续评估，但不再影响集群的整体健康状态。"
      submitLabel="静默"
      onSubmit={() =>
        runTask(setCephHealthMute(code, healthMuteParams(form)), {
          title: `静默 ${code}`,
          syncSuccessMessage: `已静默 ${code}`,
          invalidate: INVALIDATE,
        })
      }
    >
      {summary && <p className="text-sm break-words text-muted-foreground">{summary}</p>}
      <div className="grid gap-2">
        <span id={labelId} className="text-sm font-medium">
          时长
        </span>
        <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
          {MUTE_DURATIONS.map((d) => {
            const checked = form.duration === d.value
            return (
              <button
                key={d.value}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => setForm((f) => ({ ...f, duration: d.value }))}
                className={cn(
                  'inline-flex min-h-9 items-center rounded-full px-3.5 text-sm ring-1 ring-border ring-inset outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11',
                  checked && 'bg-brand/12 font-medium text-brand-strong ring-brand/40 paper:bg-secondary paper:text-foreground',
                )}
              >
                {d.label}
              </button>
            )
          })}
        </div>
      </div>
      <SwitchField
        label="变严重时也保持静默"
        description="默认情况下，受影响的对象变多时静默会自动解除，让这项检查重新引起注意。"
        checked={form.sticky}
        onCheckedChange={(sticky) => setForm((f) => ({ ...f, sticky }))}
      />
    </FormDialog>
  )
}

/** Unmute right away (harmless, so no confirmation). */
export function unmuteHealthCheck(code: string): void {
  fireTask(setCephHealthMute(code, healthUnmuteParams()), {
    title: `取消静默 ${code}`,
    syncSuccessMessage: `已取消静默 ${code}`,
    invalidate: INVALIDATE,
  })
}
