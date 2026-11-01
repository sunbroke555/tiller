// Small shared pieces of the notifications / metrics section.

import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Activity, BarChart3, Bell, CircleSlash, Lock, Mail, Plus, RefreshCw, Send, Trash2, Webhook } from 'lucide-react'

import { useFieldControl } from '@/components/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import type { KeyValue } from './model'

// ------------------------------------------------------------------ nav

export type NmView = 'targets' | 'matchers' | 'metrics'
export const NM_VIEWS: readonly NmView[] = ['targets', 'matchers', 'metrics']
export const NM_VIEW_LABEL: Record<NmView, string> = { targets: '通知目标', matchers: '匹配规则', metrics: '指标服务器' }
export const nmHref = (v: NmView) => `/datacenter/notifications/${v}`

export function SubNav({ view }: { view: NmView }) {
  return (
    <nav aria-label="通知与指标" className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
      <ul className="flex w-max gap-1 rounded-xl bg-secondary/60 p-1 paper:bg-secondary">
        {NM_VIEWS.map((v) => (
          <li key={v}>
            <Link
              to={nmHref(v)}
              aria-current={v === view ? 'page' : undefined}
              className={cn(
                'inline-flex h-9 items-center rounded-lg px-3.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-10',
                v === view && 'bg-background font-medium text-foreground shadow-sm paper:bg-card',
              )}
            >
              {NM_VIEW_LABEL[v]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// ------------------------------------------------------------------ card header

export function ListHeader({
  title,
  subtitle,
  fetching,
  onRefresh,
  addLabel,
  onAdd,
}: {
  title: string
  subtitle: ReactNode
  fetching: boolean
  onRefresh: () => void
  addLabel?: string
  onAdd?: (() => void) | undefined
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-(--card-p) py-3">
      <div className="min-w-0 flex-1">
        <h2 className="heading text-base font-medium text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <Button variant="ghost" size="icon" aria-label="刷新" title="刷新" onClick={onRefresh} disabled={fetching} className="text-muted-foreground">
        <RefreshCw className={cn(fetching && 'animate-spin')} />
      </Button>
      {onAdd && (
        <Button onClick={onAdd}>
          <Plus />
          {addLabel}
        </Button>
      )}
    </div>
  )
}

export function ReadOnlyNote({ children }: { children: ReactNode }) {
  return (
    <p role="note" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Lock className="size-4 shrink-0" aria-hidden />
      {children}
    </p>
  )
}

// ------------------------------------------------------------------ badges

export function Pill({ tone = 'neutral', icon, children }: { tone?: 'neutral' | 'info' | 'danger'; icon?: ReactNode; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap [&_svg]:size-3',
        tone === 'neutral' && 'bg-secondary text-secondary-foreground',
        tone === 'info' && 'bg-info/12 text-info paper:bg-secondary paper:text-foreground/70',
        tone === 'danger' && 'bg-destructive/12 text-destructive paper:bg-secondary',
      )}
    >
      {icon}
      {children}
    </span>
  )
}

export const DisabledPill = () => (
  <Pill tone="danger" icon={<CircleSlash aria-hidden />}>
    已禁用
  </Pill>
)

// ------------------------------------------------------------------ icons

const TARGET_ICON = { sendmail: Mail, smtp: Send, gotify: Bell, webhook: Webhook } as const
const METRIC_ICON = { graphite: BarChart3, influxdb: Activity, opentelemetry: Activity } as const

export function TypeBadgeIcon({ kind, type, dim }: { kind: 'target' | 'metric'; type: string; dim?: boolean }) {
  const Icon = (kind === 'target' ? TARGET_ICON[type as keyof typeof TARGET_ICON] : METRIC_ICON[type as keyof typeof METRIC_ICON]) ?? Bell
  return (
    <span
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand-strong ring-1 ring-brand/15 ring-inset paper:bg-secondary paper:text-foreground/70 paper:ring-border',
        dim && 'opacity-50',
      )}
      aria-hidden
    >
      <Icon className="size-4.5" />
    </span>
  )
}

// ------------------------------------------------------------------ key/value rows

/** Webhook headers / secrets: name + value rows, add and remove. */
export function KeyValueEditor({
  value,
  onChange,
  label,
  addLabel,
  secret,
  disabled,
}: {
  value: KeyValue[]
  onChange: (v: KeyValue[]) => void
  label: string
  addLabel: string
  secret?: boolean
  disabled?: boolean
}) {
  const control = useFieldControl()
  const update = (i: number, patch: Partial<KeyValue>) => onChange(value.map((kv, j) => (j === i ? { ...kv, ...patch } : kv)))
  return (
    <div role="group" aria-label={label} aria-describedby={control['aria-describedby']} className="grid gap-2">
      {value.map((kv, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            aria-label={`${label} ${i + 1} 名称`}
            value={kv.name}
            onChange={(e) => update(i, { name: e.target.value })}
            placeholder="名称"
            disabled={disabled}
            autoComplete="off"
            className="w-2/5 font-mono text-sm"
          />
          <Input
            aria-label={`${label} ${i + 1} 值`}
            value={kv.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder={kv.stored ? '不变' : '值'}
            type={secret ? 'password' : 'text'}
            disabled={disabled}
            autoComplete={secret ? 'new-password' : 'off'}
            className="min-w-0 flex-1 font-mono text-sm"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`删除${label} ${kv.name || i + 1}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            disabled={disabled}
            className="shrink-0 text-muted-foreground pointer-coarse:size-11"
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { name: '', value: '' }])} disabled={disabled}>
          <Plus />
          {addLabel}
        </Button>
      </div>
    </div>
  )
}
