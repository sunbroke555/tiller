// Form pieces of the storage editor: multi-select chips (content, nodes), a
// scan button with its result list, read-only "fixed" settings and notices.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, CircleAlert, Info, Loader2, Search, TriangleAlert } from 'lucide-react'

import { useClusterResources } from '@/api/queries'
import { isNode, type StorageContent } from '@/api/types'
import { useFieldControl } from '@/components/form'
import { Button } from '@/components/ui/button'
import { STORAGE_CONTENT_LABEL } from '@/features/storage/types'
import { CONTENT_ICON } from '@/features/storage-browser/labels'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import type { FixedField } from './model'

// ----------------------------------------------------------------- chips

interface ChipOption {
  value: string
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

/** Wrapping multi-select chips (checkbox semantics, ≥44px on touch). */
export function ChipSelect({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: readonly ChipOption[]
  value: readonly string[]
  onChange: (value: string[]) => void
  label: string
  disabled?: boolean
}) {
  const control = useFieldControl()
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={control['aria-describedby']}
      id={control.id}
      className="flex flex-wrap gap-2"
    >
      {options.map((o) => {
        const on = value.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={disabled || o.disabled}
            onClick={() => toggle(o.value)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors pointer-coarse:h-11 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
              on
                ? 'border-brand/50 bg-brand/15 text-foreground paper:border-primary/50 paper:bg-primary/10'
                : 'border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {on ? <Check className="text-brand-strong paper:text-primary" aria-hidden /> : o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Content types as chips with their icons. */
export function ContentChips({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly StorageContent[]
  value: readonly string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}) {
  return (
    <ChipSelect
      label="内容"
      disabled={disabled}
      value={value}
      onChange={onChange}
      options={options.map((c) => {
        const Icon = CONTENT_ICON[c]
        return { value: c, label: STORAGE_CONTENT_LABEL[c], icon: <Icon aria-hidden /> }
      })}
    />
  )
}

/** Node restriction: chips of the cluster nodes; none selected = all nodes. */
export function NodeChips({ value, onChange, disabled }: { value: readonly string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const { data } = useClusterResources({
    select: (all) => all.filter(isNode).map((n) => n.node).sort(),
  })
  const nodes = [...new Set([...(data ?? []), ...value])].sort()
  return (
    <ChipSelect
      label="节点"
      disabled={disabled}
      value={value}
      onChange={onChange}
      options={nodes.map((n) => ({ value: n, label: n, disabled: !data?.includes(n) && !value.includes(n) }))}
    />
  )
}

// ------------------------------------------------------------------ scan

export interface ScanItem {
  value: string
  label?: ReactNode
  description?: ReactNode
}

/**
 * A "扫描" button for a text field: runs `scan` and lists the results under
 * the field; picking one calls onPick. `blocked` (a reason) disables it.
 */
export function ScanButton({
  scan,
  onPick,
  blocked,
  emptyText = '没有找到',
  label = '扫描',
  resetKey,
}: {
  scan: (signal: AbortSignal) => Promise<ScanItem[]>
  onPick: (value: string) => void
  blocked?: string | null
  emptyText?: string
  label?: string
  /** Clears the results when it changes (e.g. the server). */
  resetKey?: string
}) {
  const [state, setState] = useState<{ status: 'idle' | 'busy' | 'done' | 'error'; items: ScanItem[]; error?: string }>({
    status: 'idle',
    items: [],
  })
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    abort.current?.abort()
    setState({ status: 'idle', items: [] })
  }, [resetKey])
  useEffect(() => () => abort.current?.abort(), [])

  async function run() {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setState({ status: 'busy', items: [] })
    try {
      const items = await scan(ctl.signal)
      if (!ctl.signal.aborted) setState({ status: 'done', items })
    } catch (e) {
      if (!ctl.signal.aborted) setState({ status: 'error', items: [], error: errorMessage(e) })
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="shrink-0"
        onClick={() => void run()}
        disabled={!!blocked || state.status === 'busy'}
        title={blocked ?? undefined}
      >
        {state.status === 'busy' ? <Loader2 className="animate-spin" /> : <Search />}
        {label}
      </Button>
      {state.status !== 'idle' && state.status !== 'busy' && (
        <div className="col-span-full basis-full">
          {state.status === 'error' ? (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
              <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
              <span className="break-words">扫描失败：{state.error}</span>
            </p>
          ) : state.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">{emptyText}</p>
          ) : (
            <ul aria-label="扫描结果" className="max-h-56 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/70">
              {state.items.map((it) => (
                <li key={it.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(it.value)
                      setState({ status: 'idle', items: [] })
                    }}
                    className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground">{it.label ?? it.value}</span>
                    {it.description && <span className="shrink-0 truncate text-xs text-muted-foreground">{it.description}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  )
}

/** Input + trailing button on one row; the scan results wrap below. */
export function InputWithAction({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-2 [&>input]:min-w-0 [&>input]:flex-1">{children}</div>
}

// ----------------------------------------------------------------- fixed

/** Read-only settings of an existing storage (cannot change after creation). */
export function FixedList({ rows }: { rows: readonly FixedField[] }) {
  if (!rows.length) return null
  return (
    <dl className="grid gap-x-4 gap-y-2 rounded-xl border border-border/70 bg-foreground/[0.02] px-3 py-2.5 text-sm sm:grid-cols-[auto_1fr] paper:bg-secondary/40">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-xs text-muted-foreground sm:text-sm">{r.label}</dt>
          <dd className="-mt-1.5 min-w-0 font-mono text-[13px] break-all text-foreground sm:mt-0">{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ---------------------------------------------------------------- notice

export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'warning' | 'error'; children: ReactNode; className?: string }) {
  const Icon = tone === 'error' ? CircleAlert : tone === 'warning' ? TriangleAlert : Info
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm leading-relaxed',
        tone === 'info' && 'border-info/25 bg-info/10 text-foreground/85 paper:border-border paper:bg-secondary/60',
        tone === 'warning' && 'border-warning/30 bg-warning/10 text-foreground/90',
        tone === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
        className,
      )}
    >
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', tone === 'info' && 'text-info paper:text-foreground/60', tone === 'warning' && 'text-warning-strong')}
        aria-hidden
      />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  )
}
