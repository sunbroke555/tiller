// Small building blocks shared by the snapshot and backup screens.

import type { ReactNode } from 'react'
import { CircleAlert, Info, TriangleAlert } from 'lucide-react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'

import { usePermissions } from '@/api/permissions'
import { cn } from '@/lib/utils'

/**
 * Whether the user has `priv` on this guest (its /vms path or its pool), from
 * the permission map; the login ticket's coarse caps until that has loaded.
 * Unknown counts as allowed: the server decides anyway.
 */
export function useVmCap(priv: string, vmid: number, pool?: string): boolean {
  return usePermissions().can({ privs: priv }, { kind: 'guest', vmid, pool })
}

/** Tinted inline notice (info / warning / error) inside cards and dialogs. */
export function Notice({
  tone = 'info',
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'error'
  children: ReactNode
  className?: string
}) {
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
        className={cn(
          'mt-0.5 size-4 shrink-0',
          tone === 'info' && 'text-info paper:text-foreground/60',
          tone === 'warning' && 'text-warning-strong',
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  )
}

/** Small rounded label used for "含内存", "受保护", "PBS"… */
export function Chip({
  children,
  tone = 'neutral',
  icon,
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger'
  icon?: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] leading-none font-medium whitespace-nowrap [&_svg]:size-3',
        tone === 'neutral' && 'bg-secondary text-secondary-foreground',
        tone === 'brand' && 'bg-brand/12 text-brand-strong paper:bg-secondary paper:text-foreground/75',
        tone === 'success' && 'bg-success/12 text-success-strong',
        tone === 'warning' && 'bg-warning/14 text-warning-strong',
        tone === 'danger' && 'bg-destructive/12 text-destructive',
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

/** Label/value pairs: two columns on phones too (labels are short). */
export function InfoList({ items, className }: { items: { label: ReactNode; value: ReactNode; mono?: boolean }[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm', className)}>
      {items.map((it, i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{it.label}</dt>
          <dd className={cn('min-w-0 text-right break-words text-foreground sm:text-left', it.mono && 'font-mono text-xs leading-5 break-all')}>
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export interface ChoiceOption<V extends string> {
  value: V
  label: ReactNode
  description?: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

/**
 * Radio choices as tappable cards (mode, restore target…): a full-width
 * stack on phones, side by side from `sm` up when `columns` is set.
 */
export function ChoiceCards<V extends string>({
  value,
  onValueChange,
  options,
  columns,
  dense,
  'aria-label': ariaLabel,
  className,
}: {
  value: V
  onValueChange: (value: V) => void
  options: readonly ChoiceOption<V>[]
  columns?: 2 | 3
  /**
   * Phones: one row of compact segments (icon + label) and the selected
   * option's description underneath, instead of a tall stack of cards.
   */
  dense?: boolean
  'aria-label'?: string
  className?: string
}) {
  const selected = options.find((o) => o.value === value)
  return (
    <div className={cn('grid gap-2', className)}>
      <RadioGroupPrimitive.Root
        value={value}
        onValueChange={(v) => onValueChange(v as V)}
        aria-label={ariaLabel}
        className={cn(
          'grid gap-2',
          dense && (options.length === 3 ? 'grid-cols-3' : 'grid-cols-2'),
          columns === 2 && 'sm:grid-cols-2',
          columns === 3 && 'sm:grid-cols-3',
        )}
      >
        {options.map((o) => (
          <RadioGroupPrimitive.Item
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            className={cn(
              'group/choice flex min-h-11 items-start gap-3 rounded-xl border border-input bg-(--field) px-3 py-2.5 text-left transition-colors outline-none',
              'hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
              'data-[state=checked]:border-brand/60 data-[state=checked]:bg-brand/8 paper:data-[state=checked]:border-foreground/50 paper:data-[state=checked]:bg-secondary',
              dense && 'max-sm:items-center max-sm:justify-center max-sm:px-2',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-control group-data-[state=checked]/choice:border-brand paper:group-data-[state=checked]/choice:border-foreground',
                dense && 'max-sm:hidden',
              )}
            >
              <span className="size-2 rounded-full bg-brand opacity-0 transition-opacity group-data-[state=checked]/choice:opacity-100 paper:bg-foreground" />
            </span>
            <span className={cn('grid min-w-0 flex-1 gap-0.5', dense && 'max-sm:flex-none')}>
              <span
                className={cn(
                  'flex items-center gap-1.5 text-sm font-medium text-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground',
                  'group-data-[state=checked]/choice:[&_svg]:text-brand-strong paper:group-data-[state=checked]/choice:[&_svg]:text-foreground',
                )}
              >
                {o.icon}
                {o.label}
              </span>
              {o.description && (
                <span className={cn('text-xs leading-relaxed text-muted-foreground', dense && 'max-sm:hidden')}>{o.description}</span>
              )}
            </span>
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
      {dense && selected?.description && <p className="text-xs leading-relaxed text-muted-foreground sm:hidden">{selected.description}</p>}
    </div>
  )
}

/** Key/value rows of a guest config (snapshot config, backup config). */
export function ConfigLines({ lines, className }: { lines: { key: string; value: string }[]; className?: string }) {
  return (
    <div
      className={cn(
        'overflow-x-auto rounded-xl border border-border/60 bg-foreground/[0.03] px-3 py-2 font-mono text-xs leading-relaxed paper:bg-secondary/50',
        className,
      )}
    >
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((l, i) =>
            l.value === '' && /^\[.*\]$/.test(l.key) ? (
              <tr key={i}>
                <td colSpan={2} className="pt-3 pb-1 font-semibold text-foreground">
                  {l.key}
                </td>
              </tr>
            ) : (
              <tr key={i} className="align-top">
                <td className={cn('py-0.5 pr-3 whitespace-nowrap text-muted-foreground', l.key.startsWith('#') && 'text-faint')}>{l.key}</td>
                <td className={cn('py-0.5 break-all text-foreground', l.key.startsWith('#') && 'text-faint')}>{l.value}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}
