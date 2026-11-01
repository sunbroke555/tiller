// Pickers of the rule editor: free text with suggestions (source/dest refs,
// protocol, ICMP type, IPSet members) and a searchable select (macros,
// security groups).

import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronsUpDown, ListPlus } from 'lucide-react'

import { useFieldControl } from '@/components/form'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface PickOption {
  value: string
  label: string
  description?: string
  group?: string
  keywords?: string[]
}

function groupOptions(options: readonly PickOption[]): [string, PickOption[]][] {
  const map = new Map<string, PickOption[]>()
  for (const o of options) {
    const g = o.group ?? ''
    map.set(g, [...(map.get(g) ?? []), o])
  }
  return [...map.entries()]
}

const filter = (itemValue: string, query: string, keywords?: string[]) => {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  return [itemValue, ...(keywords ?? [])].join(' ').toLowerCase().includes(q) ? 1 : 0
}

function OptionList({
  options,
  value,
  onPick,
  searchPlaceholder,
  empty = '没有匹配项',
  top,
}: {
  options: readonly PickOption[]
  value: string | undefined
  onPick: (value: string) => void
  searchPlaceholder: string
  empty?: string
  top?: ReactNode
}) {
  const groups = useMemo(() => groupOptions(options), [options])
  return (
    <Command filter={filter}>
      <CommandInput placeholder={searchPlaceholder} className="pointer-coarse:h-11" />
      <CommandList className="max-h-[min(20rem,45dvh)]">
        <CommandEmpty>{empty}</CommandEmpty>
        {top}
        {groups.map(([group, items]) => (
          <CommandGroup key={group || '_'} heading={group || undefined}>
            {items.map((o) => (
              <CommandItem
                key={o.value}
                value={o.value}
                keywords={[o.label, o.description ?? '', ...(o.keywords ?? [])]}
                onSelect={() => onPick(o.value)}
                className="pointer-coarse:py-2.5"
              >
                <Check className={cn(o.value === value ? 'opacity-100' : 'opacity-0')} />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.description && <span className="ml-2 max-w-[55%] shrink-0 truncate text-xs text-muted-foreground">{o.description}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  )
}

export interface SuggestInputProps {
  value: string
  onChange: (value: string) => void
  options: readonly PickOption[]
  placeholder?: string
  /** aria-label of the suggestions button. */
  pickLabel: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  inputMode?: 'text' | 'numeric'
  className?: string
}

/** Text input that also offers a list to pick from (picking replaces the text). */
export function SuggestInput({
  value,
  onChange,
  options,
  placeholder,
  pickLabel,
  searchPlaceholder = '搜索…',
  emptyText,
  disabled,
  inputMode,
  className,
}: SuggestInputProps) {
  const control = useFieldControl()
  const [open, setOpen] = useState(false)
  const off = disabled || control.disabled
  return (
    <div className={cn('flex min-w-0 gap-2', className)}>
      <Input
        {...control}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        disabled={off}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1"
      />
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label={pickLabel} title={pickLabel} disabled={off} className="shrink-0 pointer-coarse:size-11">
            <ListPlus />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
          <OptionList
            options={options}
            value={value}
            searchPlaceholder={searchPlaceholder}
            empty={emptyText}
            onPick={(v) => {
              onChange(v)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

export interface SearchSelectProps {
  value: string | undefined
  onValueChange: (value: string | undefined) => void
  options: readonly PickOption[]
  placeholder?: string
  searchPlaceholder?: string
  /** Label of a "not set" choice at the top. */
  emptyOption?: string
  loading?: boolean
  disabled?: boolean
  className?: string
}

/** Select with a search box (macros: ~100 entries). */
export function SearchSelect({
  value,
  onValueChange,
  options,
  placeholder = '请选择',
  searchPlaceholder = '搜索…',
  emptyOption,
  loading,
  disabled,
  className,
}: SearchSelectProps) {
  const control = useFieldControl()
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)
  const label = selected?.label ?? (value || (loading ? '加载中…' : (emptyOption ?? placeholder)))
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || control.disabled || loading}
          id={control.id}
          aria-describedby={control['aria-describedby']}
          aria-invalid={control['aria-invalid']}
          className={cn('w-full min-w-0 justify-between bg-(--field) px-3 font-normal', !value && 'text-muted-foreground', className)}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] min-w-(--radix-popover-trigger-width) p-0">
        <OptionList
          options={options}
          value={value}
          searchPlaceholder={searchPlaceholder}
          onPick={(v) => {
            onValueChange(v)
            setOpen(false)
          }}
          top={
            emptyOption ? (
              <CommandGroup>
                <CommandItem
                  value="__empty__"
                  keywords={[emptyOption]}
                  onSelect={() => {
                    onValueChange(undefined)
                    setOpen(false)
                  }}
                  className="pointer-coarse:py-2.5"
                >
                  <Check className={cn(value ? 'opacity-0' : 'opacity-100')} />
                  <span className="text-muted-foreground">{emptyOption}</span>
                </CommandItem>
              </CommandGroup>
            ) : undefined
          }
        />
      </PopoverContent>
    </Popover>
  )
}
