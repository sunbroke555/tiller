import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SIZE_FACTOR, bestSizeUnit, convertSize, type SizeUnit } from '@/lib/size'
import { cn } from '@/lib/utils'

import { useFieldControl } from './Field'

type InputProps = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'step'>

export interface NumberInputProps extends InputProps {
  value: number | null | undefined
  /** undefined when the field is cleared. */
  onChange: (value: number | undefined) => void
  min?: number
  max?: number
  /** Step of the +/- buttons (default 1). */
  step?: number
  /** Allow decimals (default: integers only). */
  decimal?: boolean
  /** Unit shown inside the field on the right ("MiB", "核", "%"). */
  unit?: ReactNode
  /** Show −/+ buttons (44px on touch). */
  stepper?: boolean
  /** Replace the unit label with a control (SizeInput's unit picker). */
  unitSlot?: ReactNode
}

function toText(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '' : String(v)
}

function clamp(v: number, min?: number, max?: number) {
  if (min !== undefined && v < min) return min
  if (max !== undefined && v > max) return max
  return v
}

/**
 * Text input for numbers (numeric keyboard on phones, no browser spinner
 * quirks). Typing keeps the raw text; the value is clamped on blur.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  decimal = false,
  unit,
  unitSlot,
  stepper,
  className,
  onBlur,
  disabled,
  ...props
}: NumberInputProps) {
  const control = useFieldControl()
  const [text, setText] = useState(toText(value))

  // Follow outside changes (reset, auto-fill) unless they match what is typed.
  useEffect(() => {
    setText((t) => (t !== '' && Number(t) === value ? t : toText(value)))
  }, [value])

  const pattern = decimal ? /^-?\d*(?:[.,]\d*)?$/ : /^-?\d*$/
  const isDisabled = disabled ?? control.disabled

  const commit = (raw: string) => {
    setText(raw)
    const normalized = raw.replace(',', '.')
    if (normalized === '' || normalized === '-') return onChange(undefined)
    const n = Number(normalized)
    if (Number.isFinite(n)) onChange(n)
  }

  const bump = (dir: 1 | -1) => {
    const base = value ?? min ?? 0
    const next = clamp(decimal ? Math.round((base + dir * step) * 1e6) / 1e6 : base + dir * step, min, max)
    setText(String(next))
    onChange(next)
  }

  const field = (
    <div className={cn('relative min-w-0 flex-1', !stepper && className)}>
      <Input
        type="text"
        inputMode={decimal ? 'decimal' : 'numeric'}
        autoComplete="off"
        {...control}
        {...props}
        disabled={isDisabled}
        value={text}
        onChange={(e) => {
          if (pattern.test(e.target.value)) commit(e.target.value)
        }}
        onBlur={(e) => {
          if (value !== undefined && value !== null) {
            const c = clamp(value, min, max)
            if (c !== value) onChange(c)
            setText(toText(c))
          }
          onBlur?.(e)
        }}
        className={cn('tabular', (unit || unitSlot) && 'pr-16')}
      />
      {unitSlot ? (
        <div className="absolute inset-y-0 right-0 flex items-center pr-1">{unitSlot}</div>
      ) : unit ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">{unit}</span>
      ) : null}
    </div>
  )

  if (!stepper) return field
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <StepButton label="减少" disabled={isDisabled || (min !== undefined && (value ?? min) <= min)} onClick={() => bump(-1)}>
        <Minus />
      </StepButton>
      {field}
      <StepButton label="增加" disabled={isDisabled || (max !== undefined && (value ?? 0) >= max)} onClick={() => bump(1)}>
        <Plus />
      </StepButton>
    </div>
  )
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-input bg-(--field) text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 pointer-coarse:size-11 [&_svg]:size-4"
    >
      {children}
    </button>
  )
}

// -------------------------------------------------------------- SizeInput

export interface SizeInputProps extends Omit<NumberInputProps, 'value' | 'onChange' | 'unit' | 'unitSlot' | 'decimal' | 'min' | 'max' | 'step'> {
  /** Value in `baseUnit` (memory: MiB, disk: GiB). */
  value: number | null | undefined
  onChange: (value: number | undefined) => void
  /** Unit of `value` and of min/max. Default MiB. */
  baseUnit?: SizeUnit
  /** Units the user can type in. Default ['MiB', 'GiB']. */
  units?: readonly SizeUnit[]
  /** In baseUnit. */
  min?: number
  max?: number
  /** Stepper step in the displayed unit (default 1). */
  step?: number
}

/**
 * Size with a unit picker: shows 4096 MiB as "4 GiB", converts back to the
 * base unit (rounded to whole base units) on change.
 */
export function SizeInput({
  value,
  onChange,
  baseUnit = 'MiB',
  units = ['MiB', 'GiB'],
  min,
  max,
  step = 1,
  ...props
}: SizeInputProps) {
  const [unit, setUnit] = useState<SizeUnit>(() => bestSizeUnit(value, baseUnit, units))
  const display = value === null || value === undefined ? undefined : Math.round(convertSize(value, baseUnit, unit) * 1000) / 1000
  const toBase = (v: number) => Math.round(convertSize(v, unit, baseUnit))
  const fromBase = (v: number | undefined) => (v === undefined ? undefined : convertSize(v, baseUnit, unit))
  const unitSlot =
    units.length > 1 ? (
      <Select value={unit} onValueChange={(u) => setUnit(u as SizeUnit)} disabled={props.disabled}>
        <SelectTrigger
          size="sm"
          aria-label="单位"
          className="h-7 gap-1 border-0 bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:bg-accent pointer-coarse:h-9"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {[...units]
            .sort((a, b) => SIZE_FACTOR[a] - SIZE_FACTOR[b])
            .map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    ) : undefined
  return (
    <NumberInput
      {...props}
      decimal
      value={display}
      min={fromBase(min)}
      max={fromBase(max)}
      step={step}
      onChange={(v) => onChange(v === undefined ? undefined : toBase(v))}
      unit={units.length > 1 ? undefined : unit}
      unitSlot={unitSlot}
    />
  )
}
