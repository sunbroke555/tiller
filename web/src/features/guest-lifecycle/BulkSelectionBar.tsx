import { lazy, Suspense, useState, type ReactNode } from 'react'
import { MoveRight, Pause, Play, Power, X } from 'lucide-react'

import type { GuestResource } from '@/api/types'
import { DockPortal } from '@/components/layout/BottomDock'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { bulkCandidate, type BulkAction } from './params'

// Lazy: the overview (main chunk) only needs the bar until a dialog opens.
const BulkDialog = lazy(() => import('./BulkDialog').then((m) => ({ default: m.BulkDialog })))

const ACTIONS: { action: BulkAction; label: string; icon: typeof Play }[] = [
  { action: 'start', label: '启动', icon: Play },
  { action: 'shutdown', label: '关机', icon: Power },
  { action: 'suspend', label: '挂起', icon: Pause },
  { action: 'migrate', label: '迁移', icon: MoveRight },
]

interface BulkSelectionBarProps {
  /** Selected guests (from the overview list in selection mode). */
  selected: readonly GuestResource[]
  /** Leave selection mode. */
  onExit: () => void
  /** Hide 迁移 on a single-node cluster. */
  canMigrate: boolean
}

/**
 * Bulk actions for guests picked in the overview list (cluster bulk-action
 * API, guests on any node): a floating toolbar above the bottom nav on
 * phones, an inline bar above the list on desktop.
 */
export function BulkSelectionBar({ selected, onExit, canMigrate }: BulkSelectionBarProps) {
  const [action, setAction] = useState<BulkAction | null>(null)
  const [last, setLast] = useState<BulkAction | null>(null)
  if (action && action !== last) setLast(action)
  const actions = ACTIONS.filter((a) => a.action !== 'migrate' || canMigrate)
  const count = selected.length
  const applies = (a: BulkAction) => selected.some((g) => bulkCandidate(a, g))

  const buttons = (variant: 'dock' | 'inline'): ReactNode =>
    actions.map(({ action: a, label, icon: Icon }) => {
      const disabled = count === 0 || !applies(a)
      return variant === 'dock' ? (
        <button
          key={a}
          type="button"
          disabled={disabled}
          onClick={() => setAction(a)}
          className="flex h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-1 text-[11px] font-medium text-foreground/85 transition-colors active:bg-foreground/[0.06] disabled:opacity-40 [&_svg]:size-5"
        >
          <Icon aria-hidden />
          <span className="truncate">{label}</span>
        </button>
      ) : (
        <Button key={a} type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setAction(a)}>
          <Icon /> {label}
        </Button>
      )
    })

  return (
    <>
      <div
        role="toolbar"
        aria-label="批量操作"
        className="surface-strong mb-(--row-gap) hidden items-center gap-2 rounded-2xl px-4 py-2.5 lg:flex"
      >
        <span className="mr-auto text-sm">
          已选 <span className="font-medium tabular">{count}</span> 台
          {count === 0 && <span className="text-muted-foreground"> · 点击列表中的客户机进行选择</span>}
        </span>
        {buttons('inline')}
        <Button type="button" variant="ghost" size="sm" onClick={onExit}>
          <X /> 取消
        </Button>
      </div>

      <DockPortal>
        <div role="toolbar" aria-label="批量操作" className={cn('surface-strong flex w-full items-center rounded-full p-1.5')}>
          <div
            aria-live="polite"
            className="flex h-12 min-w-14 shrink-0 flex-col items-center justify-center rounded-full bg-brand/12 px-2 text-[11px] leading-tight text-muted-foreground paper:bg-secondary"
          >
            <span className="text-base font-semibold text-foreground tabular">{count}</span>
            已选
          </div>
          {buttons('dock')}
          <button
            type="button"
            onClick={onExit}
            className="flex h-12 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-medium text-muted-foreground transition-colors active:bg-foreground/[0.06] [&_svg]:size-5"
          >
            <X aria-hidden />
            取消
          </button>
        </div>
      </DockPortal>

      {last && (
        <Suspense fallback={null}>
          <BulkDialog
            open={action !== null}
            onOpenChange={(o) => !o && setAction(null)}
            action={action ?? last}
            guests={selected}
            initialSelection={selected.filter((g) => bulkCandidate(action ?? last, g)).map((g) => g.vmid)}
            scope={{ kind: 'cluster' }}
            onStarted={onExit}
          />
        </Suspense>
      )}
    </>
  )
}
