import { useCallback, useState } from 'react'

import type { SubmitError } from './useCreateFlow'
import type { FieldErrors } from './validate'
import { useWizardStep } from './Wizard'

const hasErrors = (e: FieldErrors) => Object.keys(e).length > 0

/** Scroll to and focus the first invalid control of the step. */
function focusFirstError() {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>('main [aria-invalid="true"], main [role="alert"]')
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (el.matches('input, textarea, button, [tabindex]')) el.focus({ preventScroll: true })
  })
}

/**
 * Step navigation with validation for a creation wizard. Errors of a step
 * show once the user tried to leave it; later steps are reachable only when
 * every step before them is valid; the last step's "next" validates all
 * steps and calls onFinish.
 */
export function useWizardController<Id extends string>({
  steps,
  validate,
  serverErrors,
  stepOfParam,
  onFinish,
}: {
  steps: readonly { id: Id; label: string }[]
  validate: (id: Id) => FieldErrors
  serverErrors?: Record<string, string> | undefined
  stepOfParam: (param: string) => Id
  onFinish: () => void
}) {
  const [shown, setShown] = useState<ReadonlySet<Id>>(new Set())
  const show = useCallback((id: Id) => setShown((s) => (s.has(id) ? s : new Set([...s, id]))), [])

  const firstInvalid = (before: number) => {
    for (let i = 0; i < before; i++) if (hasErrors(validate(steps[i]!.id))) return i
    return -1
  }
  const { index, goTo, goBack } = useWizardStep(steps, firstInvalid)
  const current = steps[index]!.id

  const invalid = new Set<string>()
  for (const s of steps) if (shown.has(s.id) && hasErrors(validate(s.id))) invalid.add(s.id)
  for (const param of Object.keys(serverErrors ?? {})) invalid.add(stepOfParam(param))

  const fieldErrors: Record<string, string> = { ...(shown.has(current) ? validate(current) : {}), ...(serverErrors ?? {}) }

  const next = () => {
    if (hasErrors(validate(current))) {
      show(current)
      focusFirstError()
      return
    }
    if (index < steps.length - 1) {
      goTo(index + 1)
      return
    }
    const bad = firstInvalid(steps.length - 1)
    if (bad >= 0) {
      show(steps[bad]!.id)
      goTo(bad)
      focusFirstError()
      return
    }
    onFinish()
  }

  const canJumpTo = (i: number) => firstInvalid(i) === -1

  const jump = (i: number) => {
    const bad = firstInvalid(i)
    if (bad >= 0 && bad !== index) {
      show(steps[bad]!.id)
      goTo(bad)
    } else if (bad === index) {
      show(current)
      focusFirstError()
    } else {
      goTo(i)
    }
  }

  return { index, next, back: () => goBack(), jump, canJumpTo, invalid, fieldErrors }
}

/** The PVE error of a failed create call, with each field error and its step. */
export function ServerErrorList({ error, stepLabel }: { error: SubmitError; stepLabel: (param: string) => string | undefined }) {
  const fields = Object.entries(error.fields)
  return (
    <div className="grid gap-1">
      <p className="font-medium">{error.message}</p>
      {fields.length > 0 && (
        <ul className="grid gap-0.5 text-xs">
          {fields.map(([k, v]) => (
            <li key={k}>
              <span className="font-mono">{k}</span>
              {stepLabel(k) && <span className="opacity-80">（{stepLabel(k)}）</span>}：{v}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
