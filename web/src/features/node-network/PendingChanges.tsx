import { useState } from 'react'
import { AlertTriangle, ChevronDown, FileDiff, Loader2, Play, Undo2 } from 'lucide-react'

import { applyNetwork, revertNetwork } from '@/api/node-network'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { CheckboxField, FormError } from '@/components/form'
import { GlassCard } from '@/components/GlassCard'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import type { PendingDiff } from './model'
import { networkInvalidate } from './shared'

/** Unified diff, coloured per line. */
export function DiffView({ diff, className }: { diff: string; className?: string }) {
  const lines = diff.replace(/\n$/, '').split('\n')
  return (
    <pre
      role="region"
      aria-label="配置差异"
      tabIndex={0}
      className={cn(
        'max-h-[50dvh] overflow-auto overscroll-contain rounded-xl border border-border/60 bg-foreground/[0.03] py-2 font-mono text-[11.5px] leading-[1.6] sm:text-xs paper:bg-secondary/50',
        className,
      )}
    >
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            'min-w-max px-3 whitespace-pre',
            l.startsWith('+') && !l.startsWith('+++') && 'bg-success/10 text-success-strong',
            l.startsWith('-') && !l.startsWith('---') && 'bg-destructive/10 text-destructive',
            l.startsWith('@@') && 'text-brand-strong paper:text-primary',
            (l.startsWith('+++') || l.startsWith('---')) && 'text-muted-foreground',
          )}
        >
          {l || ' '}
        </div>
      ))}
    </pre>
  )
}

/**
 * Banner shown while /etc/network/interfaces.new exists: what changes,
 * the diff, and apply (ifreload) / revert.
 */
export function PendingChanges({
  node,
  diff,
  pending,
  canModify,
  riskyIfaces,
}: {
  node: string
  diff: string
  pending: PendingDiff
  canModify: boolean
  /** Touched interfaces that carry a default gateway (applying may cut the node off). */
  riskyIfaces: string[]
}) {
  const [showDiff, setShowDiff] = useState(false)
  const [applyOpen, setApplyOpen] = useState(false)
  const [revertOpen, setRevertOpen] = useState(false)
  const names = [...pending.ifaces.keys()]

  return (
    <GlassCard className="grid gap-3 border-warning/40 ring-1 ring-warning/30 ring-inset" role="region" aria-label="待应用的更改">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
          <span
            aria-hidden
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/12 text-warning-strong ring-1 ring-warning/25 ring-inset"
          >
            <FileDiff className="size-4.5" />
          </span>
          <div className="grid min-w-0 gap-0.5">
            <h2 className="text-sm font-medium">有待应用的网络更改</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {names.length > 0 ? (
                <>
                  涉及 <span className="font-mono text-foreground">{names.join('、')}</span>
                </>
              ) : (
                '配置文件有改动'
              )}
              <span className="tabular">
                {' '}
                · <span className="text-success-strong">+{pending.added}</span> <span className="text-destructive">−{pending.removed}</span> 行
              </span>
              。应用后生效（ifreload），或重启节点。
            </p>
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto *:max-sm:flex-1">
          <Button variant="ghost" onClick={() => setShowDiff((v) => !v)} aria-expanded={showDiff}>
            <ChevronDown className={cn('transition-transform', !showDiff && '-rotate-90')} />
            差异
          </Button>
          {canModify && (
            <>
              <Button variant="outline" onClick={() => setRevertOpen(true)}>
                <Undo2 /> 还原
              </Button>
              <Button onClick={() => setApplyOpen(true)}>
                <Play /> 应用配置
              </Button>
            </>
          )}
        </div>
      </div>
      {showDiff && <DiffView diff={diff} />}

      <ApplyDialog node={node} diff={diff} riskyIfaces={riskyIfaces} open={applyOpen} onOpenChange={setApplyOpen} />
      <ConfirmDialog
        open={revertOpen}
        onOpenChange={setRevertOpen}
        title="还原所有待应用的网络更改？"
        description="删除 /etc/network/interfaces.new，接口列表回到当前生效的配置。已生效的网络不受影响。"
        confirmLabel="还原"
        destructive
        onConfirm={() =>
          runTask(revertNetwork(node), {
            title: `还原 ${node} 的网络更改`,
            invalidate: networkInvalidate(node),
            syncSuccessMessage: '已还原待应用的网络更改',
          })
        }
      />
    </GlassCard>
  )
}

function ApplyDialog({
  node,
  diff,
  riskyIfaces,
  open,
  onOpenChange,
}: {
  node: string
  diff: string
  riskyIfaces: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [frr, setFrr] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setError(null)
      setFrr(false)
    }
  }

  async function apply() {
    setBusy(true)
    setError(null)
    try {
      await runTask(applyNetwork(node, { regenerateFrr: frr }), {
        title: `应用 ${node} 的网络配置`,
        invalidate: networkInvalidate(node),
      })
      onOpenChange(false)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      dismissible={!busy}
      size="lg"
      title="应用网络配置？"
      description={`在 ${node} 上用 interfaces.new 替换当前配置并执行 ifreload -a。`}
      bodyClassName="grid gap-4"
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void apply()}>
            {busy ? <Loader2 className="animate-spin" /> : <Play />}
            应用
          </Button>
        </>
      }
    >
      {error && <FormError>{error}</FormError>}
      <p
        className={cn(
          'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm',
          riskyIfaces.length > 0 ? 'border-destructive/40 bg-destructive/10' : 'border-warning/40 bg-warning/10',
        )}
      >
        <AlertTriangle
          className={cn('mt-0.5 size-4 shrink-0', riskyIfaces.length > 0 ? 'text-destructive' : 'text-warning-strong')}
          aria-hidden
        />
        <span>
          {riskyIfaces.length > 0 ? (
            <>
              这些更改涉及承载默认网关的接口 <span className="font-mono font-medium">{riskyIfaces.join('、')}</span>
              。配置有误会让节点失联，只能从控制台修复。
            </>
          ) : (
            '配置有误可能让节点或客户机断网。请确认下面的差异无误。'
          )}
        </span>
      </p>
      <DiffView diff={diff} />
      <CheckboxField
        label="重新生成 FRR 配置"
        description="默认只在 SDN 使用 FRR 时重新生成"
        checked={frr}
        onCheckedChange={setFrr}
        disabled={busy}
      />
    </ResponsiveDialog>
  )
}
