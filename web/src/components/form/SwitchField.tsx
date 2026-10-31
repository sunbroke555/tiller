import { useId, type ReactNode } from 'react'

import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export interface SwitchFieldProps {
  label: ReactNode
  description?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  /** Checkbox instead of a switch (lists of flags). */
  variant?: 'switch' | 'checkbox'
}

/**
 * A whole-row toggle: label and description on the left, switch on the right;
 * the full row (≥44px) is the tap target.
 */
export function SwitchField({ label, description, checked, onCheckedChange, disabled, className, variant = 'switch' }: SwitchFieldProps) {
  const id = useId()
  const labelId = `${id}-label`
  const descId = description ? `${id}-desc` : undefined
  const control =
    variant === 'checkbox' ? (
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(c) => onCheckedChange(c === true)}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={descId}
      />
    ) : (
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={descId}
      />
    )
  return (
    <label
      htmlFor={id}
      data-slot="switch-field"
      data-disabled={disabled || undefined}
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl py-1.5 select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60',
        variant === 'checkbox' && 'flex-row-reverse justify-end',
        className,
      )}
    >
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span id={labelId} className="text-sm font-medium text-foreground">
          {label}
        </span>
        {description && (
          <span id={descId} className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      {control}
    </label>
  )
}

/** SwitchField rendered as a checkbox row. */
export function CheckboxField(props: Omit<SwitchFieldProps, 'variant'>) {
  return <SwitchField {...props} variant="checkbox" />
}

/** PVE 0/1 (or "1"/"0") flag → boolean, with the schema default for "unset". */
export function pveFlag(value: string | number | boolean | null | undefined, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback
  return value === true || value === 1 || value === '1'
}
