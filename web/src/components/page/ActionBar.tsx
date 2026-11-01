import { Fragment, Suspense, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Ellipsis, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { actionLabel, type ActionDef } from './registry'

type Pending<Ctx> = { action: ActionDef<Ctx>; mode: 'confirm' | 'dialog' } | null

const NONE: ReadonlySet<string> = new Set()

/** The `done` promise of a runTask handle, if `result` is one. */
function taskDone(result: unknown): Promise<unknown> | undefined {
  const done = result && typeof result === 'object' ? (result as { done?: unknown }).done : undefined
  return done instanceof Promise ? done : undefined
}

/**
 * Runs actions: direct run, confirm-then-run, or open the action's dialog.
 * Returns `trigger`, the `host` element (confirm/dialog) to render once, and
 * the ids of actions in flight (`busy`).
 *
 * A run action stays busy until its task ends (`run` returned a runTask
 * handle) or its call settled: the page's resource state that hides "启动"
 * only changes after the task, so a second tap would start a duplicate task.
 */
export function useActionRunner<Ctx>(ctx: Ctx): {
  trigger: (action: ActionDef<Ctx>) => void
  host: ReactNode
  busy: ReadonlySet<string>
} {
  const [pending, setPending] = useState<Pending<Ctx>>(null)
  // Keep the last one mounted while the dialog animates out.
  const [last, setLast] = useState<Pending<Ctx>>(null)
  if (pending && pending !== last) setLast(pending)
  const [busy, setBusy] = useState<ReadonlySet<string>>(NONE)
  // Synchronous copy: two taps can land before the re-render disables the button.
  const running = useRef(new Set<string>())

  const execute = (action: ActionDef<Ctx>): Promise<unknown> | undefined => {
    if (!action.run || running.current.has(action.id)) return undefined
    running.current.add(action.id)
    setBusy(new Set(running.current))
    const release = () => {
      running.current.delete(action.id)
      setBusy(new Set(running.current))
    }
    const started = Promise.resolve().then(() => action.run!(ctx))
    started.then(taskDone).then(release, release)
    return started
  }

  const trigger = (action: ActionDef<Ctx>) => {
    if (running.current.has(action.id)) return
    if (action.dialog) return setPending({ action, mode: 'dialog' })
    if (action.confirm) return setPending({ action, mode: 'confirm' })
    execute(action)?.catch((e: unknown) => toast.error(`${actionLabel(action, ctx)}失败`, { description: errorMessage(e) }))
  }

  const close = (open: boolean) => {
    if (!open) setPending(null)
  }

  let host: ReactNode = null
  if (last?.mode === 'confirm' && last.action.confirm) {
    const spec = last.action.confirm(ctx)
    host = (
      <ConfirmDialog
        open={pending === last}
        onOpenChange={close}
        title={spec.title}
        description={spec.description}
        confirmLabel={spec.confirmLabel ?? actionLabel(last.action, ctx)}
        destructive={spec.destructive ?? last.action.destructive}
        typeToConfirm={spec.typeToConfirm}
        onConfirm={() => execute(last.action)}
      />
    )
  } else if (last?.mode === 'dialog' && last.action.dialog) {
    const Dialog = last.action.dialog
    host = (
      <Suspense fallback={null}>
        <Dialog ctx={ctx} open={pending === last} onOpenChange={close} />
      </Suspense>
    )
  }
  return { trigger, host, busy }
}

interface ActionBarProps<Ctx> {
  actions: readonly ActionDef<Ctx>[]
  ctx: Ctx
  trigger: (action: ActionDef<Ctx>) => void
  /** Ids of actions in flight (from useActionRunner): shown busy and not triggered again. */
  busy?: ReadonlySet<string>
  /** 'toolbar': desktop header buttons. 'dock': mobile floating bottom bar. */
  variant: 'toolbar' | 'dock'
  /** Max primary buttons before the rest moves into "更多" (dock: 3). */
  maxPrimary?: number
  className?: string
}

function disabledReason<Ctx>(a: ActionDef<Ctx>, ctx: Ctx): string | null {
  const r = a.disabled?.(ctx)
  return r ? r : null
}

/** Primary actions as buttons plus a "更多" menu, from an action registry. */
export function ActionBar<Ctx>({ actions, ctx, trigger, busy = NONE, variant, maxPrimary, className }: ActionBarProps<Ctx>) {
  const limit = maxPrimary ?? (variant === 'dock' ? 3 : 4)
  const primaries = actions.filter((a) => a.placement === 'primary')
  const shown = primaries.slice(0, limit)
  const overflow = [...primaries.slice(limit), ...actions.filter((a) => a.placement !== 'primary')]
  if (shown.length === 0 && overflow.length === 0) return null

  // Non-modal: opening an action's dialog from the menu must not fight the
  // menu's focus trap / pointer-events lock.
  const menu = overflow.length > 0 && (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {variant === 'dock' ? (
          <DockButton label="更多" icon={<Ellipsis />} />
        ) : (
          <Button variant="outline" size="icon" aria-label="更多操作">
            <Ellipsis />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={variant === 'dock' ? 'top' : 'bottom'} className="min-w-48">
        <ActionMenuItems actions={overflow} ctx={ctx} trigger={trigger} busy={busy} />
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (variant === 'toolbar') {
    return (
      <div className={cn('flex flex-wrap items-center justify-end gap-2', className)}>
        {shown.map((a) => {
          const reason = disabledReason(a, ctx)
          const inFlight = busy.has(a.id)
          return (
            <Button
              key={a.id}
              variant="outline"
              disabled={!!reason || inFlight}
              aria-busy={inFlight || undefined}
              title={reason ?? undefined}
              onClick={() => trigger(a)}
              className={cn(a.destructive && 'text-destructive hover:text-destructive')}
            >
              {inFlight ? <Loader2 className="animate-spin" /> : a.icon && <a.icon />}
              {actionLabel(a, ctx)}
            </Button>
          )
        })}
        {menu}
      </div>
    )
  }

  // One or two buttons would stretch across the whole dock: keep them compact
  // at the right edge (above the search button) instead.
  const compact = shown.length + (menu ? 1 : 0) <= 2
  return (
    <div
      role="toolbar"
      aria-label="操作"
      className={cn(
        'surface-strong flex items-center rounded-full p-1.5',
        compact ? 'ml-auto w-fit [&>button]:w-20 [&>button]:flex-none' : 'w-full',
        className,
      )}
    >
      {shown.map((a) => {
        const reason = disabledReason(a, ctx)
        const inFlight = busy.has(a.id)
        const Icon = a.icon
        return (
          <DockButton
            key={a.id}
            label={actionLabel(a, ctx)}
            icon={inFlight ? <Loader2 className="animate-spin" /> : Icon ? <Icon /> : null}
            // Still tappable when unavailable: touch has no tooltip, so a tap says why.
            aria-disabled={reason || inFlight ? true : undefined}
            aria-busy={inFlight || undefined}
            destructive={a.destructive}
            onClick={() => {
              if (inFlight) return
              if (reason) toast.info(`暂时不能${actionLabel(a, ctx)}`, { description: reason })
              else trigger(a)
            }}
          />
        )
      })}
      {menu}
    </div>
  )
}

function DockButton({
  label,
  icon,
  destructive,
  className,
  ...props
}: { label: string; icon: ReactNode; destructive?: boolean } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-2 text-[11px] font-medium transition-colors active:bg-foreground/[0.06] disabled:opacity-40 aria-disabled:opacity-40 [&_svg]:size-5',
        destructive ? 'text-destructive' : 'text-foreground/85',
        className,
      )}
      {...props}
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </button>
  )
}

/** Menu items grouped by section (for "更多" menus and context menus). */
export function ActionMenuItems<Ctx>({
  actions,
  ctx,
  trigger,
  busy = NONE,
}: {
  actions: readonly ActionDef<Ctx>[]
  ctx: Ctx
  trigger: (action: ActionDef<Ctx>) => void
  busy?: ReadonlySet<string>
}) {
  const sections: { name: string | undefined; items: ActionDef<Ctx>[] }[] = []
  for (const a of actions) {
    const s = sections.find((x) => x.name === a.section)
    if (s) s.items.push(a)
    else sections.push({ name: a.section, items: [a] })
  }
  return (
    <>
      {sections.map((s, i) => (
        <Fragment key={s.name ?? `_${i}`}>
          {i > 0 && <DropdownMenuSeparator />}
          {s.name && sections.length > 1 && <DropdownMenuLabel className="text-xs text-muted-foreground">{s.name}</DropdownMenuLabel>}
          {s.items.map((a) => {
            const reason = disabledReason(a, ctx)
            const inFlight = busy.has(a.id)
            return (
              <DropdownMenuItem
                key={a.id}
                variant={a.destructive ? 'destructive' : 'default'}
                disabled={!!reason || inFlight}
                title={reason ?? undefined}
                onSelect={() => trigger(a)}
                className="min-h-9 pointer-coarse:min-h-11"
              >
                {inFlight ? <Loader2 className="animate-spin" /> : a.icon && <a.icon />}
                {reason ? (
                  // The reason as a second line: `title` never shows on touch.
                  <span className="grid">
                    <span>{actionLabel(a, ctx)}</span>
                    <span className="text-[11px] text-muted-foreground">{reason}</span>
                  </span>
                ) : (
                  actionLabel(a, ctx)
                )}
              </DropdownMenuItem>
            )
          })}
        </Fragment>
      ))}
    </>
  )
}
