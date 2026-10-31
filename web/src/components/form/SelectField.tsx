import type { ReactNode } from 'react'
import { CheckIcon } from 'lucide-react'
import { Select as SelectPrimitive } from 'radix-ui'

import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

import { useFieldControl } from './Field'

export interface SelectOption<V extends string = string> {
  value: V
  label: ReactNode
  /** Second line / right-aligned detail in the list (not in the trigger). */
  description?: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

/** Radix Select cannot hold "", so the empty choice uses this value internally. */
const EMPTY = '__pve_web_empty__'

export interface SelectFieldProps<V extends string = string> {
  value: V | undefined | null
  /** undefined when the empty option is picked. */
  onValueChange: (value: V | undefined) => void
  options: readonly SelectOption<V>[]
  placeholder?: string
  /**
   * Label of an extra first option meaning "not set" (PVE default), e.g.
   * "默认 (virtio)". Picking it calls onValueChange(undefined).
   */
  emptyOption?: ReactNode
  loading?: boolean
  disabled?: boolean
  className?: string
  /** Popover alignment; long lists read better with "popper". */
  position?: 'item-aligned' | 'popper'
  'aria-label'?: string
}

/** Full-width select for forms, wired to the surrounding FormField. */
export function SelectField<V extends string = string>({
  value,
  onValueChange,
  options,
  placeholder = '请选择',
  emptyOption,
  loading,
  disabled,
  className,
  position = 'popper',
  'aria-label': ariaLabel,
}: SelectFieldProps<V>) {
  const { disabled: fieldDisabled, ...control } = useFieldControl()
  const current = value === undefined || value === null || value === '' ? (emptyOption ? EMPTY : '') : value
  return (
    <Select
      value={current}
      onValueChange={(v) => onValueChange(v === EMPTY ? undefined : (v as V))}
      disabled={!!(disabled || fieldDisabled || loading)}
    >
      <SelectTrigger {...control} aria-label={ariaLabel} className={cn('w-full min-w-0 *:data-[slot=select-value]:min-w-0', className)}>
        <SelectValue placeholder={loading ? '加载中…' : placeholder} />
      </SelectTrigger>
      <SelectContent position={position} className="max-h-[min(22rem,var(--radix-select-content-available-height))]">
        {emptyOption && (
          <>
            <SelectItem value={EMPTY}>
              <span className="text-muted-foreground">{emptyOption}</span>
            </SelectItem>
            {options.length > 0 && <SelectSeparator />}
          </>
        )}
        {options.map((o) => (
          <SelectPrimitive.Item
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            className="relative flex w-full cursor-default items-center gap-2 rounded-sm py-2 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 pointer-coarse:py-2.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <span className="absolute right-2 flex size-3.5 items-center justify-center">
              <SelectPrimitive.ItemIndicator>
                <CheckIcon className="size-4" />
              </SelectPrimitive.ItemIndicator>
            </span>
            {/* Only icon + label go into the trigger; the description stays in the list. */}
            <SelectPrimitive.ItemText asChild>
              <span className="flex min-w-0 items-center gap-2">
                {o.icon}
                <span className="truncate">{o.label}</span>
              </span>
            </SelectPrimitive.ItemText>
            {o.description && <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">{o.description}</span>}
          </SelectPrimitive.Item>
        ))}
      </SelectContent>
    </Select>
  )
}
