import { createContext, use, useId, useState, type ComponentProps, type ReactNode } from 'react'
import { ChevronDown, CircleAlert } from 'lucide-react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

// ------------------------------------------------------------- contexts

/**
 * Per-field API errors keyed by parameter name ({ vmid: "VM 100 already
 * exists" }). FormDialog fills it from PveApiError.errors; FormField picks
 * its own by `name`.
 */
export const FormErrorsContext = createContext<Record<string, string>>({})

interface FieldContextValue {
  id: string
  descriptionId: string | undefined
  errorId: string | undefined
  invalid: boolean
  disabled: boolean
}

const FieldContext = createContext<FieldContextValue | null>(null)

/**
 * Props that wire a control to its FormField: id (for the label),
 * aria-describedby (hint and error) and aria-invalid. Primitives spread these;
 * outside a FormField it returns {}.
 */
export function useFieldControl(): {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: true
  disabled?: boolean
} {
  const ctx = use(FieldContext)
  if (!ctx) return {}
  const describedBy = [ctx.descriptionId, ctx.errorId].filter(Boolean).join(' ') || undefined
  return {
    id: ctx.id,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(ctx.invalid ? { 'aria-invalid': true as const } : {}),
    ...(ctx.disabled ? { disabled: true } : {}),
  }
}

// ---------------------------------------------------------------- field

export interface FormFieldProps {
  label?: ReactNode
  /** Short help under the control. */
  hint?: ReactNode
  /** Error text; overrides the API error for `name`. */
  error?: ReactNode
  /** API parameter name: shows FormErrorsContext[name] as the error. */
  name?: string
  required?: boolean
  disabled?: boolean
  /** Content at the right of the label (a unit, a "default" link). */
  labelExtra?: ReactNode
  /** Use an existing id for the control instead of a generated one. */
  id?: string
  className?: string
  children: ReactNode
}

/**
 * Label + control + hint + error, stacked. Controls inside (FieldInput,
 * SelectField, NumberInput, …) pick up the id and aria attributes; for other
 * controls call useFieldControl() or pass `id`.
 */
export function FormField({ label, hint, error, name, required, disabled = false, labelExtra, id, className, children }: FormFieldProps) {
  const generated = useId()
  const errors = use(FormErrorsContext)
  const fieldId = id ?? generated
  const shownError = error ?? (name ? errors[name] : undefined)
  const descriptionId = hint ? `${fieldId}-hint` : undefined
  const errorId = shownError ? `${fieldId}-error` : undefined
  return (
    <FieldContext value={{ id: fieldId, descriptionId, errorId, invalid: !!shownError, disabled }}>
      <div data-slot="form-field" className={cn('grid min-w-0 content-start gap-2', className)}>
        {(label || labelExtra) && (
          <div className="flex min-h-5 items-center justify-between gap-2">
            {label && (
              <Label htmlFor={fieldId} className={cn('text-sm font-medium', disabled && 'opacity-60')}>
                {label}
                {required && (
                  <span aria-hidden className="text-destructive">
                    *
                  </span>
                )}
              </Label>
            )}
            {labelExtra && <div className="text-xs text-muted-foreground">{labelExtra}</div>}
          </div>
        )}
        {children}
        {hint && (
          <p id={descriptionId} className="text-xs leading-relaxed text-muted-foreground">
            {hint}
          </p>
        )}
        {shownError ? (
          <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            <span className="whitespace-pre-line">{shownError}</span>
          </p>
        ) : null}
      </div>
    </FieldContext>
  )
}

/** Input wired to the surrounding FormField. */
export function FieldInput(props: ComponentProps<typeof Input>) {
  const control = useFieldControl()
  return <Input autoComplete="off" {...control} {...props} />
}

/** Textarea wired to the surrounding FormField. */
export function FieldTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  const control = useFieldControl()
  return <Textarea className={cn('min-h-24', className)} {...control} {...props} />
}

// ----------------------------------------------------------------- layout

/** Fields side by side from `sm` up; stacked on phones. */
export function FormRow({ cols = 2, className, children }: { cols?: 2 | 3 | 4; className?: string; children: ReactNode }) {
  return (
    <div
      data-slot="form-row"
      className={cn(
        'grid gap-4',
        cols === 2 && 'sm:grid-cols-2',
        cols === 3 && 'sm:grid-cols-3',
        cols === 4 && 'grid-cols-2 sm:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  )
}

export interface FormSectionProps {
  title?: ReactNode
  description?: ReactNode
  /** Collapsed behind its title (e.g. "高级选项"). */
  collapsible?: boolean
  defaultOpen?: boolean
  className?: string
  children: ReactNode
}

/** A group of fields with an optional heading; collapsible for advanced options. */
export function FormSection({ title, description, collapsible, defaultOpen = false, className, children }: FormSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  if (collapsible) {
    return (
      <Collapsible open={open} onOpenChange={setOpen} className={cn('grid gap-4', className)}>
        <CollapsibleTrigger className="-mx-2 flex min-h-11 items-center gap-2 rounded-lg px-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
          <ChevronDown className={cn('size-4 transition-transform', !open && '-rotate-90')} aria-hidden />
          <span className="flex-1">{title ?? '高级选项'}</span>
          {description && <span className="text-xs font-normal">{description}</span>}
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-4">{children}</CollapsibleContent>
      </Collapsible>
    )
  }
  return (
    <section className={cn('grid gap-4', className)}>
      {(title || description) && (
        <header className="grid gap-1">
          {title && <h3 className="text-sm font-medium text-foreground">{title}</h3>}
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </header>
      )}
      {children}
    </section>
  )
}

/** Error banner at the top of a form (request failures without a field). */
export function FormError({ children, className }: { children: ReactNode; className?: string }) {
  if (!children) return null
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive',
        className,
      )}
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 break-words whitespace-pre-line">{children}</div>
    </div>
  )
}
