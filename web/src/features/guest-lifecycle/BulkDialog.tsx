import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'

import { clusterBulkAction, nodeBulkAction } from '@/api/guest-lifecycle'
import type { GuestResource } from '@/api/types'
import {
  FormDialog,
  FormField,
  FormRow,
  FormSection,
  NodeSelect,
  NumberInput,
  StorageSelect,
  SwitchField,
} from '@/components/form'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { byVmid, guestName, statusLabel } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { Notice } from './notes'
import { BULK_LABEL, bulkCandidate, clusterBulkParams, nodeBulkParams, type BulkAction } from './params'

export interface BulkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: BulkAction
  /** Guests offered in the checklist. */
  guests: readonly GuestResource[]
  /**
   * 'node': /nodes/{node}/…all (all guests on that node).
   * 'cluster': /cluster/bulk-action/guest/… (guests on any node).
   */
  scope: { kind: 'node'; node: string } | { kind: 'cluster' }
  /** Pre-checked VMIDs; default: guests the action applies to. */
  initialSelection?: readonly number[]
  /** Called after the task started (e.g. to leave selection mode). */
  onStarted?: () => void
}

const SUBMIT: Record<BulkAction, string> = { start: '启动', shutdown: '关机', suspend: '挂起', migrate: '迁移' }

/**
 * Bulk start / shutdown / suspend / migrate (official PVE.window.BulkAction):
 * a checklist of guests plus the options of the action, as one task.
 */
export function BulkDialog({ open, onOpenChange, action, guests, scope, initialSelection, onStarted }: BulkDialogProps) {
  const sorted = useMemo(() => [...guests].sort(byVmid), [guests])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [query, setQuery] = useState('')
  const [maxWorkers, setMaxWorkers] = useState<number | undefined>()
  const [timeout, setTimeoutValue] = useState<number | undefined>()
  const [forceStop, setForceStop] = useState(true)
  const [toDisk, setToDisk] = useState(false)
  const [statestorage, setStatestorage] = useState<string | undefined>()
  const [target, setTarget] = useState<string | undefined>()
  const [online, setOnline] = useState(true)
  const [withLocalDisks, setWithLocalDisks] = useState(true)

  useEffect(() => {
    if (!open) return
    const ids = initialSelection ?? sorted.filter((g) => bulkCandidate(action, g)).map((g) => g.vmid)
    setSelected(new Set(ids))
    setQuery('')
    setMaxWorkers(undefined)
    setTimeoutValue(undefined)
    setForceStop(true)
    setToDisk(scope.kind === 'node')
    setStatestorage(undefined)
    setTarget(undefined)
    setOnline(true)
    setWithLocalDisks(true)
  }, [open, action])

  const q = query.trim().toLowerCase()
  const shown = q ? sorted.filter((g) => `${g.vmid} ${g.name ?? ''} ${g.tags ?? ''}`.toLowerCase().includes(q)) : sorted
  const chosen = sorted.filter((g) => selected.has(g.vmid))
  const runningCts = action === 'migrate' && chosen.some((g) => g.type === 'lxc' && g.status === 'running')
  const sourceNodes = [...new Set(chosen.map((g) => g.node))]
  const statNode = scope.kind === 'node' ? scope.node : chosen[0]?.node

  const toggle = (vmid: number, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s)
      if (on) next.add(vmid)
      else next.delete(vmid)
      return next
    })
  const allShown = shown.length > 0 && shown.every((g) => selected.has(g.vmid))

  const canSubmit = chosen.length > 0 && (action !== 'migrate' || !!target)

  const submit = () => {
    const form = {
      action,
      vmids: chosen.map((g) => g.vmid),
      maxWorkers,
      timeout,
      forceStop,
      toDisk,
      statestorage,
      target,
      online,
      withLocalDisks,
    }
    const title = `${BULK_LABEL[action]}（${chosen.length} 台）`
    const start =
      scope.kind === 'node'
        ? (() => {
            const { action: a, params } = nodeBulkParams(form)
            return nodeBulkAction(scope.node, a, params)
          })()
        : clusterBulkAction(action, clusterBulkParams(form))
    return runTask(start, { title, node: scope.kind === 'node' ? scope.node : undefined }).then((h) => {
      onStarted?.()
      return h
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={scope.kind === 'node' ? `${BULK_LABEL[action]} · ${scope.node}` : BULK_LABEL[action]}
      description={`已选 ${chosen.length} / ${sorted.length} 台客户机`}
      size="lg"
      submitLabel={`${SUBMIT[action]} ${chosen.length} 台`}
      submitDisabled={!canSubmit}
      onSubmit={submit}
    >
      {action === 'migrate' && (
        <FormRow>
          <FormField label="目标节点" name="target" required>
            <NodeSelect value={target} onValueChange={setTarget} exclude={scope.kind === 'node' ? [scope.node] : sourceNodes.length === 1 ? sourceNodes : []} />
          </FormField>
          <FormField label="并行任务数" name="max-workers">
            <NumberInput value={maxWorkers} onChange={setMaxWorkers} min={1} max={64} placeholder="1" stepper />
          </FormField>
        </FormRow>
      )}
      {action === 'migrate' && (
        <div className="grid gap-1">
          {scope.kind === 'cluster' && (
            <SwitchField label="在线迁移" description="运行中的虚拟机在线迁移，容器以重启模式迁移。" checked={online} onCheckedChange={setOnline} />
          )}
          <SwitchField label="允许迁移本地磁盘" checked={withLocalDisks} onCheckedChange={setWithLocalDisks} />
          {runningCts && <Notice tone="warn" title="运行中的容器会以重启模式迁移（先关机，迁移后再启动）" />}
        </div>
      )}
      {action === 'shutdown' && (
        <FormRow>
          <FormField label="超时" name="timeout" hint="每台客户机等待关机的时间。">
            <NumberInput value={timeout} onChange={setTimeoutValue} min={0} max={7200} unit="秒" placeholder="180" />
          </FormField>
          <FormField label="并行任务数" name="max-workers">
            <NumberInput value={maxWorkers} onChange={setMaxWorkers} min={1} max={64} placeholder="自动" stepper />
          </FormField>
        </FormRow>
      )}
      {action === 'shutdown' && (
        <SwitchField label="超时后强制停止" description="超过时间仍未关机的客户机会被直接断电。" checked={forceStop} onCheckedChange={setForceStop} />
      )}
      {action === 'suspend' &&
        (scope.kind === 'node' ? (
          <Notice tone="info" title="虚拟机会休眠到磁盘">节点批量挂起会把内存写入磁盘后停止，下次启动时恢复。只适用于虚拟机。</Notice>
        ) : (
          <>
            <SwitchField label="挂起到磁盘（休眠）" description="关闭时只暂停在内存中，主机重启会丢失状态。" checked={toDisk} onCheckedChange={setToDisk} />
            {toDisk && statNode && (
              <FormField label="状态存储" name="statestorage">
                <StorageSelect node={statNode} content="images" value={statestorage} onValueChange={setStatestorage} emptyOption="自动" />
              </FormField>
            )}
          </>
        ))}
      {(action === 'start' || action === 'suspend') && (
        <FormSection collapsible title="高级选项">
          <FormField label="并行任务数" name="max-workers">
            <NumberInput value={maxWorkers} onChange={setMaxWorkers} min={1} max={64} placeholder="自动" stepper />
          </FormField>
        </FormSection>
      )}

      <section aria-label="客户机" className="grid gap-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="按名称、ID 或标签筛选" aria-label="筛选客户机" className="pl-9" />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={shown.length === 0}
            className="shrink-0 pointer-coarse:h-11"
            onClick={() =>
              setSelected((s) => {
                const next = new Set(s)
                for (const g of shown) {
                  if (allShown) next.delete(g.vmid)
                  else next.add(g.vmid)
                }
                return next
              })
            }
          >
            {allShown ? '全不选' : '全选'}
          </Button>
        </div>
        <ul className="max-h-[min(22rem,40dvh)] divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/70">
          {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">没有匹配的客户机</li>}
          {shown.map((g) => {
            const on = selected.has(g.vmid)
            const fits = bulkCandidate(action, g)
            return (
              <li key={g.id}>
                <label
                  className={cn(
                    'flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 transition-colors select-none hover:bg-foreground/[0.03]',
                    on && 'bg-brand/[0.06] paper:bg-secondary/60',
                  )}
                >
                  <Checkbox checked={on} onCheckedChange={(c) => toggle(g.vmid, c === true)} aria-label={`${guestName(g)}（${g.vmid}）`} />
                  <StatusDot status={g.template === 1 ? 'template' : g.status} pulse={false} decorative className="w-2" />
                  <ResourceIcon type={g.type} template={g.template === 1} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{guestName(g)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <span className="tabular">{g.vmid}</span>
                      {scope.kind === 'cluster' && ` · ${g.node}`} · {g.template === 1 ? '模板' : statusLabel(g.status)}
                    </span>
                  </span>
                  {on && !fits && <span className="shrink-0 text-[11px] text-warning-strong">{action === 'suspend' && g.type === 'lxc' ? '容器不支持' : '状态不符，会跳过'}</span>}
                </label>
              </li>
            )
          })}
        </ul>
      </section>
    </FormDialog>
  )
}
