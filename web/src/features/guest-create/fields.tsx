// Form pieces used by both creation wizards.

import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Check, ChevronsUpDown, Copy, Layers, Package, Plus, X } from 'lucide-react'

import { useClusterResources } from '@/api/queries'
import { isGuest, type GuestType, type StorageContent } from '@/api/types'
import { isOciImage, usePools, useStorageContent, volumeLabel } from '@/api/guest-create'
import { SelectField, useFieldControl, type SelectOption } from '@/components/form'
import { Badge } from '@/components/ui/badge'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatBytes } from '@/lib/format'
import { guestName, guestPath, parseTags } from '@/lib/resources'
import { cn } from '@/lib/utils'

// ------------------------------------------------------------ choice cards

export interface Choice<V extends string> {
  value: V
  label: ReactNode
  description?: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

/**
 * Radio group drawn as tappable cards (≥44px). Arrow keys move between
 * options like a native radio group.
 */
export function ChoiceCards<V extends string>({
  value,
  onChange,
  options,
  columns = 3,
  'aria-label': ariaLabel,
  size = 'default',
  className,
}: {
  value: V
  onChange: (v: V) => void
  options: readonly Choice<V>[]
  columns?: 2 | 3 | 4
  'aria-label'?: string
  size?: 'default' | 'sm'
  className?: string
}) {
  const control = useFieldControl()
  const enabled = options.filter((o) => !o.disabled)
  const move = (dir: 1 | -1) => {
    const i = enabled.findIndex((o) => o.value === value)
    const next = enabled[(i + dir + enabled.length) % enabled.length]
    if (next) onChange(next.value)
  }
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-describedby={control['aria-describedby']}
      className={cn(
        'grid gap-2',
        columns === 2 && 'grid-cols-2',
        columns === 3 && (size === 'sm' ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'),
        columns === 4 && 'grid-cols-2 sm:grid-cols-4',
        className,
      )}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault()
          move(1)
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          move(-1)
        }
      }}
    >
      {options.map((o) => {
        const checked = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'group relative flex min-h-11 items-start gap-3 rounded-xl border px-3 text-left transition-[background-color,border-color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
              size === 'sm' ? 'items-center gap-2 py-2 max-sm:px-2.5 sm:gap-3' : 'py-3',
              checked
                ? 'border-brand/60 bg-brand/10 shadow-[inset_0_0_0_1px_var(--brand)] paper:border-primary paper:bg-primary/8 paper:shadow-[inset_0_0_0_1px_var(--primary)]'
                : 'border-input bg-(--field) hover:bg-accent/60',
            )}
          >
            {o.icon && (
              <span
                className={cn(
                  'mt-0.5 inline-flex shrink-0 [&_svg]:size-5',
                  size === 'sm' && 'mt-0',
                  checked ? 'text-brand paper:text-primary' : 'text-muted-foreground',
                )}
                aria-hidden
              >
                {o.icon}
              </span>
            )}
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-sm font-medium text-foreground">{o.label}</span>
              {o.description && <span className="text-xs leading-relaxed text-muted-foreground">{o.description}</span>}
            </span>
            <span
              aria-hidden
              className={cn(
                'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                size === 'sm' && 'mt-0 max-sm:hidden',
                checked ? 'border-brand bg-brand text-(--brand-contrast) paper:border-primary paper:bg-primary paper:text-primary-foreground' : 'border-input',
              )}
            >
              {checked && <Check className="size-3" strokeWidth={3} />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// --------------------------------------------------------------- chips

/** Multi-select as toggle chips (mount options, …). */
export function ChipToggles({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  options: readonly string[]
  value: readonly string[]
  onChange: (v: string[]) => void
  'aria-label'?: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o)
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 font-mono text-xs transition-colors pointer-coarse:h-11 pointer-coarse:px-4',
              on
                ? 'border-brand/60 bg-brand/12 text-foreground paper:border-primary paper:bg-primary/10'
                : 'border-input bg-(--field) text-muted-foreground hover:text-foreground',
            )}
          >
            {on && <Check className="size-3.5 text-brand paper:text-primary" aria-hidden />}
            {o}
          </button>
        )
      })}
    </div>
  )
}

// --------------------------------------------------------------- tags

/** Tags as removable chips plus an input; Enter, space, comma or ";" adds. */
export function TagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const control = useFieldControl()
  const [text, setText] = useState('')
  const { data: known } = useClusterResources({
    select: (all) => [...new Set(all.flatMap((r) => parseTags(r.tags)))].sort(),
  })
  const suggestions = (known ?? []).filter((t) => !value.includes(t) && (!text || t.startsWith(text.toLowerCase()))).slice(0, 8)

  const add = (raw: string) => {
    const parts = raw
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (!parts.length) return
    onChange([...new Set([...value, ...parts])])
    setText('')
  }

  return (
    <div className="grid gap-2">
      <div
        className={cn(
          'flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-(--field) px-2 py-1.5 shadow-xs pointer-coarse:min-h-11',
          'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
          control['aria-invalid'] && 'border-destructive',
        )}
      >
        {value.map((t) => (
          <Badge key={t} variant="secondary" className="h-7 gap-1 pr-1 font-normal">
            {t}
            <button
              type="button"
              aria-label={`移除标签 ${t}`}
              onClick={() => onChange(value.filter((x) => x !== t))}
              className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          {...control}
          value={text}
          onChange={(e) => {
            const v = e.target.value
            if (/[\s,;]$/.test(v)) add(v)
            else setText(v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(text)
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1))
            }
          }}
          onBlur={() => add(text)}
          placeholder={value.length ? '' : '输入后回车添加'}
          autoComplete="off"
          autoCapitalize="none"
          className="h-7 min-w-24 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="已有标签">
          {suggestions.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => add(t)}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-input px-2.5 text-xs text-muted-foreground transition-colors hover:border-solid hover:text-foreground pointer-coarse:h-9"
            >
              <Plus className="size-3" aria-hidden />
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------------- pools

export function PoolSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data, isPending, isError } = usePools()
  const options: SelectOption[] = (data ?? []).map((p) => ({ value: p.poolid, label: p.poolid, description: p.comment }))
  return (
    <SelectField
      value={value}
      onValueChange={(v) => onChange(v ?? '')}
      options={options}
      emptyOption="无"
      loading={isPending}
      placeholder={isError ? '无法加载资源池' : '无'}
    />
  )
}

// ------------------------------------------------------------- volumes

/** ISO images / CT templates of one storage. */
export function VolumeSelect({
  node,
  storage,
  content,
  value,
  onChange,
  placeholder,
}: {
  node: string | undefined
  storage: string | undefined
  content: StorageContent
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const { data, isPending, isError } = useStorageContent(node, storage, content)
  const options: SelectOption[] = (data ?? []).map((v) => ({
    value: v.volid,
    label: volumeLabel(v.volid),
    icon:
      content === 'vztmpl' ? (
        isOciImage(v) ? (
          <Layers className="size-4 text-info" aria-hidden />
        ) : (
          <Package className="size-4 text-muted-foreground" aria-hidden />
        )
      ) : undefined,
    description: [content === 'vztmpl' && isOciImage(v) ? 'OCI' : null, formatBytes(v.size)].filter(Boolean).join(' · '),
  }))
  const empty = !!storage && !isPending && !isError && options.length === 0
  return (
    <SelectField
      value={value}
      onValueChange={(v) => onChange(v ?? '')}
      options={options}
      loading={!!storage && isPending}
      disabled={!storage || empty}
      placeholder={
        !storage ? '先选择存储' : isError ? '无法加载' : empty ? (content === 'iso' ? '这个存储上没有 ISO 镜像' : '这个存储上没有模板') : (placeholder ?? '请选择')
      }
    />
  )
}

// ------------------------------------------------------------ combobox

export interface ComboOption {
  value: string
  label: string
  group?: string
  description?: string
  keywords?: string[]
}

/** Searchable select for long lists (CPU models). */
export function ComboboxField({
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
  const current = options.find((o) => o.value === value)
  const groups = useMemo(() => {
    const map = new Map<string, ComboOption[]>()
    for (const o of options) {
      const g = o.group ?? ''
      map.set(g, [...(map.get(g) ?? []), o])
    }
    return [...map.entries()]
  }, [options])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          {...control}
          className="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-(--field) px-3 text-left text-sm shadow-xs outline-none hover:bg-accent/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive pointer-coarse:h-11"
        >
          <span className={cn('truncate', !current && !value && 'text-muted-foreground')}>
            {loading && !current ? '加载中…' : (current?.label ?? (value || placeholder))}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="text-base md:text-sm" />
          <CommandList className="max-h-[min(20rem,50dvh)]">
            <CommandEmpty>没有匹配项</CommandEmpty>
            {groups.map(([group, items]) => (
              <CommandGroup key={group} heading={group || undefined}>
                {items.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={o.value}
                    keywords={[o.label, ...(o.keywords ?? [])]}
                    onSelect={() => {
                      onChange(o.value)
                      setOpen(false)
                    }}
                    className="py-2 pointer-coarse:py-2.5"
                  >
                    <Check className={cn('size-4', o.value === value ? 'opacity-100' : 'opacity-0')} aria-hidden />
                    <span className="truncate">{o.label}</span>
                    {o.description && <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">{o.description}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------- template shortcut

/** "Clone from a template is faster" hint with links to the guest templates. */
export function TemplateShortcut({ type }: { type: GuestType }) {
  const { data: templates } = useClusterResources({
    select: (all) => all.filter(isGuest).filter((g) => g.type === type && g.template === 1).sort((a, b) => a.vmid - b.vmid),
  })
  if (!templates?.length) return null
  const shown = templates.slice(0, 4)
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-dashed border-input px-3.5 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <Copy className="mt-0.5 size-4 shrink-0 text-brand paper:text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground">
          <span className="text-foreground">从模板克隆更快：</span>打开模板后点“克隆”即可。
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((t) => (
          <Link
            key={t.vmid}
            to={guestPath(t)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-input bg-(--field) px-3 text-xs text-foreground transition-colors hover:bg-accent pointer-coarse:h-10"
          >
            {guestName(t)}
            <span className="text-muted-foreground tabular">{t.vmid}</span>
          </Link>
        ))}
        {templates.length > shown.length && (
          <span className="inline-flex h-8 items-center px-1 text-xs text-muted-foreground">等 {templates.length} 个</span>
        )}
      </div>
    </div>
  )
}
