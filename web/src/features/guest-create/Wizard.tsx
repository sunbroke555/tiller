// Multi-step wizard frame shared by the VM and CT creation pages.
//
// Phone: header, a scrollable row of step chips, the step's card and a
// floating back/next bar in the bottom dock (above the nav).
// Desktop (≥1024px): a sticky step rail on the left with a one-line summary
// per step, the card on the right with a sticky footer.
//
// The current step lives in the URL (?step=…) so the browser/phone back
// gesture goes to the previous step instead of leaving the wizard.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, ArrowRight, Check, CircleAlert, Loader2 } from 'lucide-react'

import { DockPortal } from '@/components/layout/BottomDock'
import { GlassCard } from '@/components/GlassCard'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface WizardStepInfo<Id extends string = string> {
  id: Id
  label: string
  /** One line shown under the label in the desktop rail. */
  summary?: ReactNode
  /** The step has errors (shown as a red mark once the user tried to leave it). */
  invalid?: boolean
}

/**
 * Step state synced with ?step=. Steps can only be reached when all steps
 * before them are valid; deep links to a later step fall back.
 */
export function useWizardStep<Id extends string>(steps: readonly { id: Id }[], firstInvalid: (before: number) => number) {
  const [params, setParams] = useSearchParams()
  const requested = params.get('step')
  const requestedIndex = Math.max(
    0,
    steps.findIndex((s) => s.id === requested),
  )
  const blockedAt = firstInvalid(requestedIndex)
  const index = blockedAt >= 0 && blockedAt < requestedIndex ? blockedAt : requestedIndex

  const location = useLocation()
  const navigate = useNavigate()

  const goTo = useCallback(
    (target: number, opts: { replace?: boolean } = {}) => {
      const next = new URLSearchParams(params)
      const id = steps[target]?.id
      if (!id || target === 0) next.delete('step')
      else next.set('step', id)
      // Remember where we came from so "上一步" can pop the history entry.
      setParams(next, { replace: opts.replace, state: { wizardFrom: opts.replace ? undefined : index } })
    },
    [params, setParams, steps, index],
  )

  /** Previous step: pop history when we got here by "next", otherwise replace. */
  const goBack = useCallback(() => {
    if (index === 0) return
    const from = (location.state as { wizardFrom?: number } | null)?.wizardFrom
    if (from === index - 1) navigate(-1)
    else goTo(index - 1, { replace: true })
  }, [index, location.state, navigate, goTo])

  // Keep the URL honest when a deep link was clamped.
  useEffect(() => {
    if (index !== requestedIndex) goTo(index, { replace: true })
  }, [index, requestedIndex, goTo])

  return { index, goTo, goBack }
}

interface WizardProps {
  title: string
  eyebrow?: ReactNode
  steps: readonly WizardStepInfo[]
  index: number
  /** Which steps the user may jump to from the step list. */
  canJumpTo: (index: number) => boolean
  onJump: (index: number) => void
  onBack: () => void
  onNext: () => void
  /** Label of the primary button on the last step ("创建虚拟机"). */
  finishLabel: string
  busy?: boolean
  /** Disable the footer buttons (e.g. while creating). */
  locked?: boolean
  children: ReactNode
}

export function Wizard({ title, eyebrow, steps, index, canJumpTo, onJump, onBack, onNext, finishLabel, busy, locked, children }: WizardProps) {
  const step = steps[index]!
  const last = index === steps.length - 1
  const headingRef = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)

  // Move focus and scroll to the top of the new step (not on first render).
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    headingRef.current?.focus({ preventScroll: true })
  }, [index])

  const nextLabel = last ? finishLabel : `下一步：${steps[index + 1]?.label ?? ''}`

  const backButton = (
    <Button type="button" variant="outline" onClick={onBack} disabled={index === 0 || locked} className="shrink-0 pointer-coarse:h-11">
      <ArrowLeft />
      <span className="max-sm:sr-only">上一步</span>
    </Button>
  )
  const nextButton = (
    <Button type="button" onClick={onNext} disabled={busy || locked} className="min-w-0 flex-1 lg:flex-none pointer-coarse:h-11">
      {busy && <Loader2 className="animate-spin" />}
      <span className="truncate">{nextLabel}</span>
      {!last && !busy && <ArrowRight />}
    </Button>
  )

  return (
    <div className="pb-2">
      <PageHeader
        backTo="/"
        title={title}
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            {eyebrow}
            <span className="tabular lg:hidden">
              第 {index + 1} / {steps.length} 步
            </span>
          </span>
        }
      />

      <StepChips steps={steps} index={index} canJumpTo={canJumpTo} onJump={onJump} className="lg:hidden" />

      <div className="grid gap-(--section-gap) lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:items-start">
        <StepRail steps={steps} index={index} canJumpTo={canJumpTo} onJump={onJump} className="hidden lg:flex" />

        <div className="min-w-0">
          <GlassCard flush>
            <div className="border-b border-border/70 px-(--card-p) py-4">
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="heading flex items-center gap-2.5 text-lg font-semibold text-foreground outline-none"
              >
                <span aria-hidden className="inline-flex size-7 items-center justify-center rounded-full bg-brand/12 text-sm text-brand tabular paper:bg-primary/10 paper:text-primary">
                  {index + 1}
                </span>
                {step.label}
              </h2>
            </div>
            <div className="px-(--card-p) py-5">{children}</div>
            <div className="sticky bottom-0 z-10 hidden items-center justify-between gap-3 rounded-b-2xl border-t border-border/70 bg-(--glass-solid-strong) px-(--card-p) py-3 lg:flex">
              {backButton}
              <span className="text-xs text-muted-foreground tabular">
                第 {index + 1} / {steps.length} 步
              </span>
              {nextButton}
            </div>
          </GlassCard>
        </div>
      </div>

      <DockPortal>
        <div role="toolbar" aria-label="向导" className="surface-strong flex items-center gap-2 rounded-2xl p-2 shadow-float">
          {backButton}
          {nextButton}
        </div>
      </DockPortal>
    </div>
  )
}

interface StepNavProps {
  steps: readonly WizardStepInfo[]
  index: number
  canJumpTo: (index: number) => boolean
  onJump: (index: number) => void
  className?: string
}

function StepMarker({ state, n }: { state: 'done' | 'current' | 'todo' | 'invalid'; n: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular transition-colors',
        state === 'current' && 'bg-brand text-(--brand-contrast) paper:bg-primary paper:text-primary-foreground',
        state === 'done' && 'bg-brand/15 text-brand paper:bg-primary/12 paper:text-primary',
        state === 'todo' && 'border border-input text-muted-foreground',
        state === 'invalid' && 'bg-destructive/15 text-destructive',
      )}
    >
      {state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : state === 'invalid' ? <CircleAlert className="size-3.5" /> : n}
    </span>
  )
}

function stateOf(i: number, index: number, step: WizardStepInfo): 'done' | 'current' | 'todo' | 'invalid' {
  if (i === index) return 'current'
  if (step.invalid) return 'invalid'
  return i < index ? 'done' : 'todo'
}

/** Desktop: vertical list with summaries. */
function StepRail({ steps, index, canJumpTo, onJump, className }: StepNavProps) {
  return (
    <nav aria-label="步骤" className={cn('sticky top-8 flex-col', className)}>
      <ol className="surface grid gap-0.5 rounded-2xl p-2">
        {steps.map((s, i) => {
          const state = stateOf(i, index, s)
          const enabled = i !== index && canJumpTo(i)
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onJump(i)}
                disabled={!enabled}
                aria-current={i === index ? 'step' : undefined}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
                  i === index ? 'bg-accent' : enabled ? 'hover:bg-accent/60' : 'cursor-default',
                  !enabled && i !== index && i > index && 'opacity-60',
                )}
              >
                <StepMarker state={state} n={i + 1} />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className={cn('text-sm', i === index ? 'font-medium text-foreground' : 'text-foreground/90')}>{s.label}</span>
                  {s.summary && i !== index && <span className="truncate text-xs text-muted-foreground">{s.summary}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** Phone: horizontally scrolling chips, the current one kept in view. */
function StepChips({ steps, index, canJumpTo, onJump, className }: StepNavProps) {
  const listRef = useRef<HTMLOListElement>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-current="step"]')
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: mounted ? 'smooth' : 'instant' })
    setMounted(true)
  }, [index])
  return (
    <nav aria-label="步骤" className={cn('-mx-4 mb-4 sm:-mx-6', className)}>
      <ol ref={listRef} className="scrollbar-none flex gap-1.5 overflow-x-auto px-4 pb-1 sm:px-6">
        {steps.map((s, i) => {
          const state = stateOf(i, index, s)
          const enabled = i !== index && canJumpTo(i)
          return (
            <li key={s.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onJump(i)}
                disabled={!enabled}
                aria-current={i === index ? 'step' : undefined}
                className={cn(
                  'flex h-11 items-center gap-2 rounded-full border pr-3.5 pl-1.5 text-sm transition-colors',
                  i === index
                    ? 'surface-strong border-brand/50 font-medium text-foreground paper:border-primary/60'
                    : 'border-transparent bg-transparent text-muted-foreground',
                  !enabled && i > index && 'opacity-60',
                )}
              >
                <StepMarker state={state} n={i + 1} />
                {s.label}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
