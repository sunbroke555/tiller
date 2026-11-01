// Add / edit an HA resource, remove it, migrate or relocate it.

import { useEffect, useMemo, useState } from 'react'

import {
  createHaResource,
  deleteHaResource,
  haKeys,
  migrateHaResource,
  relocateHaResource,
  updateHaResource,
  useHaResources,
} from '@/api/ha'
import { useClusterResources } from '@/api/queries'
import { isGuest, isNode, type GuestResource } from '@/api/types'
import { FieldInput, FormDialog, FormField, FormRow, NodeSelect, NumberInput, SelectField, SwitchField } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { Skeleton } from '@/components/ui/skeleton'
import { guestName } from '@/lib/resources'

import { REQUEST_STATES, RESOURCE_DEFAULTS, resourceForm, resourceParams, sidFor, type ResourceForm } from './logic'
import { Notice } from './ui'

const INVALIDATE = [haKeys.all(), ['pve', 'cluster', 'resources']] as const

/** Guests that may be added: not templates, not HA managed yet. */
export function addableGuests(guests: readonly GuestResource[], managed: ReadonlySet<string>): GuestResource[] {
  return guests
    .filter((g) => g.template !== 1 && (!g.hastate || g.hastate === 'unmanaged') && !managed.has(sidFor(g.type, g.vmid)))
    .sort((a, b) => a.vmid - b.vmid)
}

export function ResourceDialog({
  open,
  onOpenChange,
  sid,
  guest,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this resource; add a new one when missing. */
  sid?: string
  guest?: GuestResource | undefined
}) {
  const configs = useHaResources()
  const resources = useClusterResources()
  const existing = sid ? (configs.data?.find((c) => c.sid === sid) ?? null) : null
  const isCreate = !sid
  const [form, setForm] = useState<ResourceForm>(RESOURCE_DEFAULTS)
  const [vmid, setVmid] = useState<string | undefined>()
  const set = <K extends keyof ResourceForm>(k: K, v: ResourceForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  const loaded = isCreate || !!existing
  useEffect(() => {
    if (!open || !loaded) return
    setForm(resourceForm(existing))
    setVmid(undefined)
  }, [open, loaded, existing?.digest])

  const all = useMemo(() => (resources.data ?? []).filter(isGuest), [resources.data])
  const nodeCount = (resources.data ?? []).filter(isNode).length
  const managed = useMemo(() => new Set((configs.data ?? []).map((c) => c.sid)), [configs.data])
  const options = useMemo(
    () =>
      addableGuests(all, managed).map((g) => ({
        value: String(g.vmid),
        label: `${g.vmid} · ${guestName(g)}`,
        description: `${g.type === 'qemu' ? '虚拟机' : '容器'} · ${g.node}`,
      })),
    [all, managed],
  )
  const picked = vmid ? all.find((g) => String(g.vmid) === vmid) : undefined

  const submit = () => {
    if (isCreate) {
      if (!picked) throw new Error('请选择客户机')
      const s = sidFor(picked.type, picked.vmid)
      return runTask(createHaResource(resourceParams({ ...form, sid: s }, null)), {
        title: `把 ${guestName(picked)} 加入 HA`,
        syncSuccessMessage: `已把 ${s} 加入 HA`,
        invalidate: INVALIDATE,
      })
    }
    return runTask(updateHaResource(sid!, resourceParams(form, existing)), {
      title: `更新 HA 资源 ${sid}`,
      syncSuccessMessage: 'HA 设置已保存',
      invalidate: INVALIDATE,
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isCreate ? '添加 HA 资源' : `编辑 HA 资源 ${sid}`}
      description={isCreate ? '节点故障时，HA 会在其他节点上自动重启这台客户机。' : guest ? `${guest.vmid} · ${guestName(guest)}` : undefined}
      size="md"
      submitLabel={isCreate ? '添加' : '保存'}
      submitDisabled={!loaded || (isCreate && !picked)}
      onSubmit={submit}
    >
      {!loaded ? (
        <div className="grid gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : (
        <>
          {isCreate && (
            <FormField label="客户机" name="sid" required hint={options.length === 0 && !resources.isPending ? '所有客户机都已在 HA 中' : undefined}>
              <SelectField value={vmid} onValueChange={setVmid} options={options} loading={resources.isPending} placeholder="选择虚拟机或容器" />
            </FormField>
          )}
          <FormField label="请求状态" name="state">
            <SelectField value={form.state} onValueChange={(v) => set('state', v ?? 'started')} options={REQUEST_STATES} />
          </FormField>
          {form.state === 'disabled' && <Notice tone="warning">禁用会停止这台客户机，并且不再在故障时恢复它。</Notice>}
          <FormRow>
            <FormField label="最多重启次数" name="max_restart" hint="启动失败后在同一节点上重试的次数。">
              <NumberInput value={form.maxRestart} onChange={(v) => set('maxRestart', v)} min={0} max={10} stepper />
            </FormField>
            <FormField label="最多迁移次数" name="max_relocate" hint="重启仍失败后换节点的次数。">
              <NumberInput value={form.maxRelocate} onChange={(v) => set('maxRelocate', v)} min={0} max={10} stepper />
            </FormField>
          </FormRow>
          <SwitchField
            label="自动回迁"
            description="节点亲和规则里优先级更高的节点恢复在线后，自动迁回去（failback）。"
            checked={form.failback}
            onCheckedChange={(v) => set('failback', v)}
          />
          <SwitchField
            label="允许自动均衡"
            description="CRS 自动均衡时可以迁移这台客户机（auto-rebalance）。"
            checked={form.autoRebalance}
            onCheckedChange={(v) => set('autoRebalance', v)}
          />
          <FormField label="备注" name="comment">
            <FieldInput value={form.comment} onChange={(e) => set('comment', e.target.value)} placeholder="可选" />
          </FormField>
          {nodeCount > 0 && nodeCount < 3 && <Notice>可靠的 HA 至少需要三个法定票数（节点或 QDevice）。</Notice>}
        </>
      )}
    </FormDialog>
  )
}

export function RemoveResourceDialog({ open, onOpenChange, sid }: { open: boolean; onOpenChange: (open: boolean) => void; sid: string }) {
  const [purge, setPurge] = useState(true)
  useEffect(() => {
    if (open) setPurge(true)
  }, [open])
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`把 ${sid} 移出 HA？`}
      description="客户机本身不受影响，只是不再由 HA 管理（保持当前运行状态）。"
      size="sm"
      destructive
      submitLabel="移出 HA"
      onSubmit={() =>
        runTask(deleteHaResource(sid, purge), { title: `把 ${sid} 移出 HA`, syncSuccessMessage: `已把 ${sid} 移出 HA`, invalidate: INVALIDATE })
      }
    >
      <SwitchField
        label="同时从规则中移除"
        description="从引用它的亲和规则中删掉这个资源；规则只剩它一个时删除整条规则。"
        checked={purge}
        onCheckedChange={setPurge}
      />
    </FormDialog>
  )
}

const BLOCK_CAUSE: Record<string, string> = { 'node-affinity': '节点亲和规则', 'resource-affinity': '资源亲和规则' }

export function MoveDialog({
  open,
  onOpenChange,
  sid,
  mode: initialMode,
  node,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sid: string
  mode: 'migrate' | 'relocate'
  node: string | undefined
}) {
  const [mode, setMode] = useState(initialMode)
  const [target, setTarget] = useState<string | undefined>()
  useEffect(() => {
    if (open) {
      setMode(initialMode)
      setTarget(undefined)
    }
  }, [open, initialMode])
  const label = mode === 'migrate' ? '迁移' : '重定位'

  const submit = async () => {
    if (!target) throw new Error('请选择目标节点')
    const res = await (mode === 'migrate' ? migrateHaResource(sid, target) : relocateHaResource(sid, target))
    const blocking = res?.['blocking-resources'] ?? []
    if (blocking.length) {
      throw new Error(`无法${label}到 ${target}：被 ${blocking.map((b) => `${b.sid}（${BLOCK_CAUSE[b.cause] ?? b.cause}）`).join('、')} 阻止`)
    }
    const co = res?.['comigrated-resources'] ?? []
    await runTask(Promise.resolve(null), {
      title: `${label} ${sid}`,
      syncSuccessMessage: `已请求把 ${sid} ${label}到 ${target}${co.length ? `，${co.join('、')} 会一起移动（资源亲和）` : ''}`,
      invalidate: INVALIDATE,
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${label} ${sid}`}
      description={node ? `当前在 ${node}` : undefined}
      size="sm"
      submitLabel={label}
      submitDisabled={!target}
      onSubmit={submit}
    >
      <FormField label="方式" name="mode">
        <SelectField
          value={mode}
          onValueChange={(v) => setMode(v ?? 'migrate')}
          options={[
            { value: 'migrate', label: '迁移', description: '运行中的客户机在线迁移' },
            { value: 'relocate', label: '重定位', description: '先停止，在目标节点上重新启动' },
          ]}
        />
      </FormField>
      <FormField label="目标节点" name="node" required>
        <NodeSelect value={target} onValueChange={setTarget} exclude={node ? [node] : undefined} autoSelect />
      </FormField>
      <p className="text-xs text-muted-foreground">请求交给 HA 管理器，几秒内开始执行；进度在 HA 资源列表的状态里显示。</p>
    </FormDialog>
  )
}
