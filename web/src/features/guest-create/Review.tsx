// Confirm step pieces: a readable summary per step, the raw API parameters,
// the "start after created" switch and the creation progress.

import { useState, type ReactNode } from 'react'
import { ChevronDown, CircleAlert, CircleCheck, FileText, Loader2, Pencil } from 'lucide-react'

import type { Params } from '@/api/client'
import { SwitchField } from '@/components/form'
import { openTaskLog, useTrackedTasks } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

export interface ReviewRow {
  label: string
  value: ReactNode
  /** Monospace value (volume ids, MACs, property strings). */
  mono?: boolean
}

export interface ReviewSectionData {
  /** Wizard step index the "修改" link jumps to. */
  step: number
  title: string
  rows: ReviewRow[]
  /** Server-side error on one of this step's parameters. */
  invalid?: boolean
}

export function ReviewSections({ sections, onEdit, disabled }: { sections: ReviewSectionData[]; onEdit: (step: number) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {sections.map((s) => (
        <section
          key={s.title}
          aria-label={s.title}
          className={cn(
            'rounded-xl border bg-(--field) px-3.5 pt-2.5 pb-3',
            s.invalid ? 'border-destructive/50' : 'border-border',
          )}
        >
          <header className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              {s.invalid && <CircleAlert className="size-4 text-destructive" aria-hidden />}
              {s.title}
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onEdit(s.step)}
              className="-mr-2 h-8 gap-1 text-xs text-muted-foreground pointer-coarse:h-10"
              aria-label={`修改${s.title}`}
            >
              <Pencil className="size-3.5" /> 修改
            </Button>
          </header>
          <dl className="grid gap-y-1.5 text-sm">
            {s.rows.map((r) => (
              <div key={r.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3">
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className={cn('min-w-0 break-words text-foreground', r.mono && 'font-mono text-xs leading-5')}>{r.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

/** The exact parameters sent to PVE (like the official confirm grid), secrets masked. */
export function ParamsList({ params, secret = [] }: { params: Params; secret?: readonly string[] }) {
  const [open, setOpen] = useState(false)
  const entries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ChevronDown className={cn('size-4 transition-transform', !open && '-rotate-90')} aria-hidden />
        <span className="flex-1">API 参数</span>
        <span className="text-xs tabular">{entries.length} 项</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-1 grid gap-px overflow-hidden rounded-xl border border-border bg-border font-mono text-xs">
          {entries.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)] gap-3 bg-card px-3 py-2 paper:bg-background">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-all whitespace-pre-wrap text-foreground">{secret.includes(k) ? '••••••' : String(v)}</dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function StartAfterCreate({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-(--field) px-3.5">
      <SwitchField label="创建后启动" description={label} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}

export type CreateState =
  | { phase: 'idle' }
  | { phase: 'running'; upid: string | null; node: string }
  | { phase: 'opening'; upid: string | null; node: string }
  | { phase: 'failed'; upid: string | null; node: string; exitstatus?: string }

/** Progress / result of the create task, with a link to its live log. */
export function CreateStatus({ state, what }: { state: CreateState; what: string }) {
  const tasks = useTrackedTasks()
  if (state.phase === 'idle') return null
  const task = state.upid ? tasks.find((t) => t.upid === state.upid) : undefined
  const failed = state.phase === 'failed'
  const showLog = state.upid
    ? () => openTaskLog({ node: state.node, upid: state.upid!, title: `创建${what}` })
    : undefined
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-start gap-3 rounded-xl border px-3.5 py-3',
        failed ? 'border-destructive/40 bg-destructive/10' : 'border-brand/30 bg-brand/8 paper:border-primary/30 paper:bg-primary/6',
      )}
    >
      {failed ? (
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
      ) : state.phase === 'opening' ? (
        <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
      ) : (
        <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-brand paper:text-primary" aria-hidden />
      )}
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className={cn('text-sm font-medium', failed ? 'text-destructive' : 'text-foreground')}>
          {failed ? `创建${what}失败` : state.phase === 'opening' ? `${what}已创建，正在打开…` : `正在创建${what}…`}
        </p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {failed ? (state.exitstatus ?? task?.exitstatus ?? '任务失败') : (task?.lastLine ?? '已提交，等待任务输出…')}
        </p>
        {failed && <p className="text-xs text-muted-foreground">可以修改参数后重新创建。</p>}
      </div>
      {showLog && (
        <Button type="button" variant="outline" size="sm" onClick={showLog} className="shrink-0 pointer-coarse:h-10">
          <FileText /> 日志
        </Button>
      )}
    </div>
  )
}
