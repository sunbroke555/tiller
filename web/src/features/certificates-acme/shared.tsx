// Building blocks of the certificates tab: section cards, list rows with a
// "more" menu, fact tiles, validity badges, a searchable combobox and the
// "who am I talking through" check.

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight, ChevronsUpDown, Ellipsis, FileUp, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'

import { useClusterStatus } from '@/api/queries'
import { useFieldControl } from '@/components/form'
import { GlassCard } from '@/components/GlassCard'
import { SectionHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import type { ValidityState } from './model'

// --------------------------------------------------------------- sections

export function Section({
  title,
  description,
  action,
  children,
  footer,
  className,
  label,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  /** Inside the card, below the rows (buttons). */
  footer?: ReactNode
  className?: string
  /** Accessible name when the title is not plain text. */
  label?: string
}) {
  return (
    <section aria-label={label ?? (typeof title === 'string' ? title : undefined)} className={cn('min-w-0', className)}>
      <SectionHeader title={title} className="mb-2.5 min-h-9">
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </SectionHeader>
      {description && <p className="-mt-1 mb-2.5 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      <GlassCard flush className="overflow-hidden">
        <div className="divide-y divide-border/70">{children}</div>
        {footer && <div className="flex flex-wrap gap-2 border-t border-border/70 px-(--card-p) py-3">{footer}</div>}
      </GlassCard>
    </section>
  )
}

/** Small header button (44px on touch). */
export function HeaderButton({
  icon: Icon,
  children,
  onClick,
  disabled,
  title,
}: {
  icon: LucideIcon
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled} title={title} className="pointer-coarse:h-10">
      <Icon /> {children}
    </Button>
  )
}

// ------------------------------------------------------------------- rows

export interface RowAction {
  id: string
  label: string
  icon: LucideIcon
  onSelect: () => void
  destructive?: boolean
  disabled?: string | false
  separated?: boolean
}

export function IconTile({ icon: Icon, tone = 'brand' }: { icon: LucideIcon; tone?: 'brand' | 'muted' | 'warning' | 'danger' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset sm:mt-0',
        tone === 'brand' && 'bg-brand/10 text-brand-strong ring-brand/15 paper:bg-secondary paper:text-foreground/70 paper:ring-border',
        tone === 'muted' && 'bg-foreground/[0.04] text-muted-foreground ring-border/60',
        tone === 'warning' && 'bg-warning/10 text-warning-strong ring-warning/20',
        tone === 'danger' && 'bg-destructive/10 text-destructive ring-destructive/20',
      )}
    >
      <Icon className="size-[18px]" />
    </span>
  )
}

/**
 * A list row: icon, title, detail lines. The row opens `onOpen`; extra
 * actions sit in a "more" menu on the right.
 */
export function ListRow({
  icon,
  tone,
  title,
  meta,
  detail,
  badges,
  onOpen,
  openLabel,
  actions = [],
  menuLabel,
  className,
}: {
  icon: LucideIcon
  tone?: 'brand' | 'muted' | 'warning' | 'danger'
  title: ReactNode
  /** Right of the title on wide screens, below it on phones. */
  meta?: ReactNode
  detail?: ReactNode
  badges?: ReactNode
  onOpen?: () => void
  /** Accessible name of the row button. */
  openLabel?: string
  actions?: RowAction[]
  /** Name of the "more" menu (default: the title when it is text). */
  menuLabel?: string
  className?: string
}) {
  const body = (
    <>
      <IconTile icon={icon} tone={tone} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate font-medium">{title}</span>
          {badges}
        </span>
        {meta && <span className="min-w-0 truncate text-[13px] text-muted-foreground">{meta}</span>}
        {detail && <span className="min-w-0 text-xs leading-relaxed break-words text-muted-foreground">{detail}</span>}
      </span>
    </>
  )
  const rowCls = 'flex min-h-16 flex-1 items-start gap-3 px-(--card-p) py-(--row-py) text-left sm:items-center compact:min-h-12'
  return (
    <div data-slot="list-row" className={cn('flex min-w-0 items-stretch', className)}>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={openLabel}
          className={cn(
            rowCls,
            'min-w-0 transition-colors outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] active:bg-foreground/[0.05] paper:hover:bg-secondary/50',
          )}
        >
          {body}
          {actions.length === 0 && <ChevronRight className="mt-2.5 size-4 shrink-0 self-start text-faint sm:mt-0 sm:self-center" aria-hidden />}
        </button>
      ) : (
        <div className={cn(rowCls, 'min-w-0')}>{body}</div>
      )}
      {actions.length > 0 && <RowMenu label={menuLabel ?? (typeof title === 'string' ? title : (openLabel ?? '操作'))} actions={actions} />}
    </div>
  )
}

export function RowMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  return (
    <div className="flex shrink-0 items-start py-2 pr-2 sm:items-center sm:py-0">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`更多操作：${label}`} className="size-11 text-muted-foreground">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuLabel className="truncate text-xs text-muted-foreground">{label}</DropdownMenuLabel>
          {actions.map((a) => (
            <div key={a.id}>
              {a.separated && <DropdownMenuSeparator />}
              <DropdownMenuItem
                variant={a.destructive ? 'destructive' : 'default'}
                disabled={!!a.disabled}
                onSelect={() => a.onSelect()}
                className="pointer-coarse:py-2.5"
              >
                <a.icon />
                <span className="grid">
                  {a.label}
                  {a.disabled && <span className="text-xs text-muted-foreground">{a.disabled}</span>}
                </span>
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function EmptyRow({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-(--card-p) py-4 text-sm text-muted-foreground">
      <span>{children}</span>
      {action}
    </div>
  )
}

// ------------------------------------------------------------------ facts

export function Fact({ label, children, className, wide }: { label: string; children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-xl bg-foreground/[0.03] px-3 py-2 ring-1 ring-border/60 ring-inset paper:bg-secondary/50',
        wide && 'sm:col-span-2',
        className,
      )}
    >
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 min-w-0 text-[13px] break-words">{children}</div>
    </div>
  )
}

const VALIDITY_CLS: Record<ValidityState, string> = {
  valid: 'bg-success/12 text-success-strong ring-success/25',
  expiring: 'bg-warning/12 text-warning-strong ring-warning/30',
  expired: 'bg-destructive/12 text-destructive ring-destructive/30',
  notyet: 'bg-warning/12 text-warning-strong ring-warning/30',
  unknown: 'bg-foreground/[0.05] text-muted-foreground ring-border',
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap ring-1 ring-inset',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function ValidityPill({ state, children }: { state: ValidityState; children: ReactNode }) {
  return <Pill className={VALIDITY_CLS[state]}>{children}</Pill>
}

export function NeutralPill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'brand' | 'warning' }) {
  return (
    <Pill
      className={cn(
        tone === 'muted' && 'bg-foreground/[0.05] text-muted-foreground ring-border',
        tone === 'brand' && 'bg-brand/12 text-brand-strong ring-brand/25 paper:bg-secondary paper:text-foreground paper:ring-border',
        tone === 'warning' && 'bg-warning/12 text-warning-strong ring-warning/30',
      )}
    >
      {children}
    </Pill>
  )
}

export function Notice({ icon: Icon, children, tone = 'muted' }: { icon: LucideIcon; children: ReactNode; tone?: 'muted' | 'warning' }) {
  return (
    <p
      role="note"
      className={cn(
        'flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm',
        tone === 'warning' ? 'border border-warning/40 bg-warning/10 text-foreground' : 'bg-foreground/[0.03] text-muted-foreground ring-1 ring-border/60 ring-inset',
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', tone === 'warning' ? 'text-warning-strong' : '')} aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

// ------------------------------------------------------------- file input

/** "从文件读取" button: reads a small text file and hands over its content. */
export function FileTextButton({ label = '从文件读取', accept, onText }: { label?: string; accept?: string; onText: (text: string, name: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="pointer-coarse:h-10" onClick={() => ref.current?.click()}>
        <FileUp /> {label}
      </Button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        aria-label={label}
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          if (file.size > 64 * 1024) {
            toast.error(`${file.name} 太大（超过 64 KiB），不像是 PEM 文件`)
            return
          }
          onText(await file.text(), file.name)
        }}
      />
    </>
  )
}

// --------------------------------------------------------------- combobox

export interface ComboOption {
  value: string
  label: string
  description?: string
}

/** Searchable select for long lists (the DNS APIs). */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = '请选择',
  searchPlaceholder = '搜索…',
  loading,
}: {
  value: string
  onChange: (v: string) => void
  options: readonly ComboOption[]
  placeholder?: string
  searchPlaceholder?: string
  loading?: boolean
}) {
  const control = useFieldControl()
  const [open, setOpen] = useState(false)
  const current = useMemo(() => options.find((o) => o.value === value), [options, value])
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          {...control}
          className="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-(--field) px-3 text-left text-sm shadow-xs outline-none hover:bg-accent/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive pointer-coarse:h-11"
        >
          <span className={cn('truncate', !current && !value && 'text-muted-foreground')}>
            {loading && !current ? '加载中…' : current ? `${current.label}` : value || placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-[min(20rem,45dvh)]">
            <CommandEmpty>没有匹配项</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  keywords={[o.label]}
                  onSelect={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                  className="py-2 pointer-coarse:py-2.5"
                >
                  <Check className={cn('size-4', o.value === value ? 'opacity-100' : 'opacity-0')} aria-hidden />
                  <span className="truncate">{o.label}</span>
                  {o.description && <span className="ml-auto truncate pl-2 font-mono text-xs text-muted-foreground">{o.description}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ------------------------------------------------------------ local node

/** The node that serves pve-web's API connection (cluster/status local=1). */
export function useLocalNode(): string | undefined {
  const { data } = useClusterStatus()
  return data?.find((e) => e.type === 'node' && Number(e.local) === 1)?.name
}
