// Ceph pools: list (size/min_size, PGs, autoscaler, CRUSH rule, usage,
// application), create / edit, destroy (official PVE.node.Ceph.PoolList,
// PVE.CephPoolInputPanel, PVE.Ceph.PoolEdit).

import { useEffect, useMemo, useState } from 'react'
import { Database, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react'

import {
  cephKeys,
  createPool,
  destroyPool,
  updatePool,
  useCephConfigValues,
  useCephPools,
  useCephRules,
  usePoolStatus,
  type CephPool,
  type PgAutoscaleMode,
  type PoolApplication,
} from '@/api/ceph'
import { CheckboxField, FieldInput, FormDialog, FormField, FormRow, FormSection, NumberInput, SelectField, SwitchField } from '@/components/form'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { DASH, formatBytes, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  defaultPoolForm,
  minSizeFor,
  minSizeWarning,
  poolApplications,
  poolCreateParams,
  poolFormError,
  poolFormFromStatus,
  poolUpdateParams,
  type PoolForm,
} from './model'
import { Chip, Notice, RefreshButton, useCephAccess } from './ui'
import { GlassCard } from '@/components/GlassCard'

type Dialog = { kind: 'create' } | { kind: 'edit' | 'destroy'; pool: string } | null

export function PoolsView({ apiNode }: { apiNode: string }) {
  const pools = useCephPools(apiNode)
  const access = useCephAccess()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [shown, setShown] = useState<Dialog>(null)
  if (dialog && dialog !== shown) setShown(dialog)
  const close = (o: boolean) => !o && setDialog(null)
  const list = useMemo(() => [...(pools.data ?? [])].sort((a, b) => a.pool_name.localeCompare(b.pool_name)), [pools.data])

  return (
    <div className="grid min-w-0 gap-(--section-gap)">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-sm font-medium">
          存储池 <span className="text-muted-foreground tabular">{pools.data ? list.length : ''}</span>
        </h2>
        <RefreshButton onClick={() => void pools.refetch()} busy={pools.isFetching} />
        {access.canModify && (
          <Button onClick={() => setDialog({ kind: 'create' })} className="pointer-coarse:h-11">
            <Plus /> 创建
          </Button>
        )}
      </div>
      {pools.isPending ? (
        <LoadingRows rows={3} />
      ) : pools.error ? (
        <ErrorState error={pools.error} onRetry={() => void pools.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Database}
          title="还没有存储池"
          description="存储池保存 RBD 磁盘镜像或 CephFS 数据。创建时可以直接添加为虚拟机/容器存储。"
          action={
            access.canModify ? (
              <Button onClick={() => setDialog({ kind: 'create' })}>
                <Plus /> 创建存储池
              </Button>
            ) : undefined
          }
        />
      ) : (
        <GlassCard flush className="overflow-hidden">
          <ul className="divide-y divide-border/60" aria-label="存储池">
            {list.map((p) => (
              <PoolItem
                key={p.pool_name}
                pool={p}
                canModify={access.canModify}
                onEdit={() => setDialog({ kind: 'edit', pool: p.pool_name })}
                onDestroy={() => setDialog({ kind: 'destroy', pool: p.pool_name })}
              />
            ))}
          </ul>
        </GlassCard>
      )}

      <PoolDialog
        apiNode={apiNode}
        pool={shown?.kind === 'edit' ? shown.pool : null}
        existing={list.map((p) => p.pool_name)}
        open={dialog?.kind === 'create' || dialog?.kind === 'edit'}
        onOpenChange={close}
      />
      <DestroyPoolDialog apiNode={apiNode} pool={shown?.kind === 'destroy' ? shown.pool : null} open={dialog?.kind === 'destroy'} onOpenChange={close} />
    </div>
  )
}

function PoolItem({ pool, canModify, onEdit, onDestroy }: { pool: CephPool; canModify: boolean; onEdit: () => void; onDestroy: () => void }) {
  const apps = poolApplications(pool.application_metadata)
  const usage = typeof pool.percent_used === 'number' ? pool.percent_used : null
  const pgPending = pool.pg_num_final && pool.pg_num_final !== pool.pg_num
  return (
    <li className="flex items-center gap-2 px-2 py-1.5 sm:px-3" data-pool={pool.pool_name}>
      <button
        type="button"
        onClick={canModify ? onEdit : undefined}
        disabled={!canModify}
        className="grid min-h-14 min-w-0 flex-1 gap-1 rounded-lg px-2 py-1.5 text-left outline-none enabled:hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring lg:grid-cols-[minmax(10rem,1.2fr)_repeat(4,minmax(5rem,auto))_minmax(9rem,1fr)] lg:items-center lg:gap-4"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate font-medium">{pool.pool_name}</span>
          <span className="text-xs text-muted-foreground tabular">#{pool.pool}</span>
          {pool.type === 'erasure' && <Chip tone="info">纠删码</Chip>}
          {apps.map((a) => (
            <Chip key={a} tone="unknown">
              {a}
            </Chip>
          ))}
        </span>
        <span className="text-xs text-muted-foreground lg:text-sm lg:text-foreground">
          <span className="lg:hidden">副本 </span>
          <span className="tabular" data-testid="pool-size">
            {pool.size}/{pool.min_size}
          </span>
        </span>
        <span className="hidden text-sm tabular lg:block" title={pgPending ? `最优 PG 数：${pool.pg_num_final}` : undefined}>
          {pool.pg_num} PG{pgPending ? ` → ${pool.pg_num_final}` : ''}
        </span>
        <span className="hidden text-sm lg:block">{pool.pg_autoscale_mode ?? DASH}</span>
        <span className="hidden truncate text-sm lg:block">{pool.crush_rule_name ?? DASH}</span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-secondary" aria-hidden>
            <span className={cn('block h-full rounded-full bg-brand', (usage ?? 0) >= 0.85 && 'bg-destructive')} style={{ width: `${Math.min((usage ?? 0) * 100, 100)}%` }} />
          </span>
          <span className="tabular">
            {formatPercent(usage)} · {formatBytes(pool.bytes_used ?? 0)}
          </span>
          <span className="lg:hidden">
            · {pool.pg_num} PG · {pool.pg_autoscale_mode}
          </span>
        </span>
      </button>
      {canModify && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`${pool.pool_name} 操作`} className="shrink-0 pointer-coarse:size-11">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> 编辑
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDestroy}>
              <Trash2 /> 销毁
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}

const AUTOSCALE: { value: PgAutoscaleMode; label: string }[] = [
  { value: 'on', label: 'on（自动调整）' },
  { value: 'warn', label: 'warn（只提示）' },
  { value: 'off', label: 'off' },
]

const APPLICATIONS: { value: PoolApplication; label: string }[] = [
  { value: 'rbd', label: 'rbd（虚拟机/容器磁盘）' },
  { value: 'cephfs', label: 'cephfs' },
  { value: 'rgw', label: 'rgw（对象网关）' },
]

/** Create (pool = null) or edit one pool. */
function PoolDialog({
  apiNode,
  pool,
  existing,
  open,
  onOpenChange,
}: {
  apiNode: string
  pool: string | null
  existing: string[]
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const isCreate = !pool
  const access = useCephAccess()
  const status = usePoolStatus(open && pool ? apiNode : null, pool)
  const defaults = useCephConfigValues(apiNode, ['global:osd_pool_default_size', 'global:osd_pool_default_min_size'], open && isCreate)
  const rules = useCephRules(apiNode, open)
  const [form, setForm] = useState<PoolForm>(defaultPoolForm())
  const [initial, setInitial] = useState<PoolForm | null>(null)
  const [touched, setTouched] = useState(false)

  const defSize = Number(defaults.data?.global?.['osd-pool-default-size'] ?? 3) || 3
  const defMin = Number(defaults.data?.global?.['osd-pool-default-min-size'] ?? 2) || 2
  useEffect(() => {
    if (!open) return
    setTouched(false)
    if (isCreate) {
      setForm(defaultPoolForm(defSize, defMin))
      setInitial(null)
    }
  }, [open, isCreate, defSize, defMin])
  useEffect(() => {
    if (open && !isCreate && status.data) {
      const f = poolFormFromStatus(status.data)
      setForm(f)
      setInitial(f)
    }
  }, [open, isCreate, status.data])

  const set = <K extends keyof PoolForm>(k: K, v: PoolForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const error = poolFormError(form, isCreate ? existing : [])
  const warning = minSizeWarning(form.size, form.minSize)
  const update = initial ? poolUpdateParams(initial, form) : null
  const loading = !isCreate && (status.isPending || !initial)
  const ruleOptions = (rules.data ?? []).map((r) => ({ value: r.name, label: r.name }))
  if (form.crushRule && !ruleOptions.some((o) => o.value === form.crushRule)) ruleOptions.unshift({ value: form.crushRule, label: form.crushRule })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isCreate ? '创建存储池' : `编辑存储池 ${pool}`}
      size="lg"
      submitLabel={isCreate ? '创建' : '保存'}
      submitDisabled={loading || !!error || (!isCreate && !update)}
      onSubmit={() =>
        isCreate
          ? runTask(createPool(apiNode, poolCreateParams(form)), { title: `创建存储池 ${form.name.trim()}`, invalidate: [cephKeys.all(), ['pve', 'cluster', 'resources']] })
          : runTask(updatePool(apiNode, pool!, update!), { title: `修改存储池 ${pool}`, invalidate: [cephKeys.all()] })
      }
    >
      {!isCreate && status.error ? (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} compact />
      ) : loading ? (
        <div className="grid gap-3">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
        </div>
      ) : (
        <>
          <FormRow>
            <FormField label="名称" name="name" required error={touched && isCreate ? error && /名称|同名/.test(error) ? error : undefined : undefined}>
              <FieldInput
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                onBlur={() => setTouched(true)}
                disabled={!isCreate}
                placeholder="vm-pool"
                autoCapitalize="off"
                spellCheck={false}
              />
            </FormField>
            <FormField label="应用" name="application">
              <SelectField value={form.application} onValueChange={(v) => set('application', v ?? 'rbd')} options={APPLICATIONS} aria-label="应用" />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="副本数（size）" name="size" required>
              <NumberInput
                value={form.size}
                onChange={(v) => {
                  const size = v ?? 1
                  setForm((f) => ({ ...f, size, minSize: minSizeFor(size, f.minSize) }))
                }}
                min={1}
                max={7}
                stepper
                aria-label="副本数"
              />
            </FormField>
            <FormField label="最小副本数（min_size）" name="min_size" required>
              <NumberInput value={form.minSize} onChange={(v) => set('minSize', v ?? 1)} min={1} max={7} stepper aria-label="最小副本数" />
            </FormField>
          </FormRow>
          {warning && <Notice tone="warn">{warning}</Notice>}
          <FormRow>
            <FormField label="CRUSH 规则" name="crush_rule">
              <SelectField value={form.crushRule} onValueChange={(v) => set('crushRule', v ?? '')} options={ruleOptions} loading={rules.isPending} aria-label="CRUSH 规则" />
            </FormField>
            <FormField label="PG 自动伸缩" name="pg_autoscale_mode">
              <SelectField value={form.autoscale} onValueChange={(v) => set('autoscale', v ?? 'on')} options={AUTOSCALE} aria-label="PG 自动伸缩" />
            </FormField>
          </FormRow>
          <FormField label="PG 数" name="pg_num" hint={form.autoscale === 'on' ? '自动伸缩开启时会被自动调整' : undefined}>
            <NumberInput value={form.pgNum} onChange={(v) => set('pgNum', v ?? 1)} min={1} max={32768} aria-label="PG 数" />
          </FormField>
          {isCreate && (
            <SwitchField
              label="添加为存储"
              description={access.canAddStorage ? '同时添加同名的 RBD 存储（虚拟机磁盘和容器）。' : '没有权限（需要 /storage 上的 Datastore.Allocate）。'}
              checked={form.addStorages && access.canAddStorage}
              onCheckedChange={(v) => set('addStorages', v)}
              disabled={!access.canAddStorage}
            />
          )}
          <FormSection title="自动伸缩目标" description="帮助 PG 自动伸缩估算最终的 PG 数；目标比例优先。" collapsible defaultOpen={!isCreate && (form.targetRatio != null || form.targetSizeGiB != null || form.pgNumMin != null)}>
            <FormRow>
              <FormField label="目标比例" name="target_size_ratio" hint="相对其他设置了比例的池">
                <NumberInput value={form.targetRatio} onChange={(v) => set('targetRatio', v ?? null)} min={0} decimal placeholder="0.0" aria-label="目标比例" />
              </FormField>
              <FormField label="目标大小" name="target_size">
                <NumberInput value={form.targetSizeGiB} onChange={(v) => set('targetSizeGiB', v ?? null)} min={0} decimal unit="GiB" placeholder="0" aria-label="目标大小" />
              </FormField>
            </FormRow>
            <FormField label="最小 PG 数" name="pg_num_min">
              <NumberInput value={form.pgNumMin} onChange={(v) => set('pgNumMin', v ?? null)} min={0} max={32768} placeholder="0" aria-label="最小 PG 数" />
            </FormField>
          </FormSection>
        </>
      )}
    </FormDialog>
  )
}

function DestroyPoolDialog({ apiNode, pool, open, onOpenChange }: { apiNode: string; pool: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [removeStorages, setRemoveStorages] = useState(true)
  const [force, setForce] = useState(false)
  const [typed, setTyped] = useState('')
  useEffect(() => {
    if (open) {
      setRemoveStorages(true)
      setForce(false)
      setTyped('')
    }
  }, [open])
  if (!pool) return null
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`销毁存储池 ${pool}`}
      description="池中的所有数据都会被永久删除。"
      destructive
      submitLabel="销毁"
      submitDisabled={typed !== pool}
      onSubmit={() =>
        runTask(destroyPool(apiNode, pool, { remove_storages: removeStorages ? 1 : 0, ...(force ? { force: 1 } : {}) }), {
          title: `销毁存储池 ${pool}`,
          invalidate: [cephKeys.all(), ['pve', 'cluster', 'resources']],
        })
      }
    >
      <CheckboxField label="同时删除存储" description="删除使用这个池、由 pveceph 管理的存储配置。" checked={removeStorages} onCheckedChange={setRemoveStorages} />
      <CheckboxField
        label="强制销毁"
        description="不检查池中是否还有虚拟机磁盘镜像，直接销毁。检查本身失败时（例如存储的密钥文件无法识别）也可以用它。"
        checked={force}
        onCheckedChange={setForce}
      />
      <FormField label={`输入 ${pool} 以确认`} required>
        <FieldInput value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="off" autoComplete="off" spellCheck={false} aria-label="确认名称" />
      </FormField>
    </FormDialog>
  )
}
