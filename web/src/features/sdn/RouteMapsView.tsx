// Route maps: entries grouped by route map (order, permit/deny, match, set,
// call, exit action). A route map exists as long as it has entries.

import { useMemo, useState, type ReactNode } from 'react'
import { Pencil, Plus, Route, Trash2 } from 'lucide-react'

import { createRouteMapEntry, deleteRouteMapEntry, updateRouteMapEntry, useRouteMapEntries, usePrefixLists, type RouteMapEntry } from '@/api/sdn'
import { EmptyState } from '@/components/EmptyState'
import { FieldInput, FormDialog, FormField, FormRow, FormSection, SelectField } from '@/components/form'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

import {
  MATCH_KEYS,
  ROUTE_TYPES,
  SET_KEYS,
  describeRouteMapEntry,
  routeMapCreateParams,
  routeMapForm,
  routeMapUpdateParams,
  validateRouteMap,
  type KeyValue,
  type RouteMapForm,
} from './model'
import { effective } from './pending'
import { useRouteMapIds } from './PluginDialogs'
import { AddButton, DeleteDialog, ObjectRow, SdnCard, sdnWrite, useDialog, useSdnCanEdit } from './ui'

type Dialog = { kind: 'add'; id?: string } | { kind: 'edit' | 'delete'; entry: RouteMapEntry }

export function RouteMapsView() {
  const entries = useRouteMapEntries()
  const canEdit = useSdnCanEdit()
  const dialog = useDialog<Dialog>()
  const groups = useMemo(() => {
    const map = new Map<string, { raw: RouteMapEntry; eff: RouteMapEntry }[]>()
    for (const raw of entries.data ?? []) {
      const eff = effective(raw)
      const list = map.get(eff['route-map-id']) ?? []
      map.set(eff['route-map-id'], list)
      list.push({ raw, eff })
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, list]) => ({ id, entries: list.sort((a, b) => a.eff.order - b.eff.order) }))
  }, [entries.data])

  return (
    <div className="grid gap-(--section-gap)">
      <SdnCard
        title="Route Map"
        testId="sdn-route-maps"
        summary={entries.isPending ? '正在读取…' : `${groups.length} 个 Route Map · 过滤或改写 BGP / Fabric 路由，按序号依次匹配`}
        onRefresh={() => void entries.refetch()}
        refreshing={entries.isFetching}
        actions={<AddButton label="添加条目" onAdd={() => dialog.open({ kind: 'add' })} disabled={!canEdit && '没有 SDN.Allocate 权限'} />}
      >
        {entries.isPending ? (
          <LoadingRows rows={3} className="p-(--card-p)" />
        ) : entries.error ? (
          <ErrorState error={entries.error} onRetry={() => void entries.refetch()} compact />
        ) : groups.length === 0 ? (
          <EmptyState icon={Route} title="还没有 Route Map" description="添加第一个条目时会同时创建 Route Map。控制器和 Fabric 的重分发可以引用它。" />
        ) : (
          <div className="divide-y divide-border/60">
            {groups.map((g) => (
              <section key={g.id} data-testid="sdn-route-map" data-id={g.id}>
                <div className="flex items-center gap-2 bg-foreground/[0.02] px-(--card-p) py-2 paper:bg-secondary/40">
                  <Route className="size-4 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{g.id}</span>
                  <span className="text-xs text-muted-foreground">{g.entries.length} 个条目</span>
                  <span className="flex-1" />
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={() => dialog.open({ kind: 'add', id: g.id })}>
                      <Plus />
                      条目
                    </Button>
                  )}
                </div>
                <ul aria-label={`${g.id} 的条目`}>
                  {g.entries.map(({ raw, eff }) => (
                    <ObjectRow
                      key={`${eff.order}`}
                      testId="sdn-route-map-entry"
                      rowKey={`${g.id}/${eff.order}`}
                      title={
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-[13px] text-muted-foreground tabular">#{eff.order}</span>
                          <span className={cn(eff.action === 'deny' ? 'text-destructive' : 'text-success-strong')}>{eff.action === 'deny' ? '拒绝' : '允许'}</span>
                        </span>
                      }
                      obj={raw}
                      detail={<span className="break-words">{describeRouteMapEntry(eff)}</span>}
                      onOpen={canEdit && raw.state !== 'deleted' ? () => dialog.open({ kind: 'edit', entry: eff }) : undefined}
                      actions={
                        canEdit && raw.state !== 'deleted'
                          ? [
                              { label: '编辑', icon: Pencil, onSelect: () => dialog.open({ kind: 'edit', entry: eff }) },
                              { label: '删除', icon: Trash2, destructive: true, onSelect: () => dialog.open({ kind: 'delete', entry: eff }) },
                            ]
                          : undefined
                      }
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </SdnCard>

      {dialog.shown?.kind === 'add' && (
        <RouteMapEntryDialog
          open={dialog.isOpen}
          onOpenChange={dialog.onOpenChange}
          presetId={dialog.shown.id}
          nextOrder={nextOrder(groups.find((g) => g.id === (dialog.shown as { id?: string }).id)?.entries.map((e) => e.eff.order) ?? [])}
        />
      )}
      {dialog.shown?.kind === 'edit' && <RouteMapEntryDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} entry={dialog.shown.entry} />}
      {dialog.shown?.kind === 'delete' && (
        <DeleteDialog
          open={dialog.isOpen}
          onOpenChange={dialog.onOpenChange}
          what="条目"
          name={`${dialog.shown.entry['route-map-id']} #${dialog.shown.entry.order}`}
          isNew={false}
          run={() => {
            const e = (dialog.shown as { entry: RouteMapEntry }).entry
            return deleteRouteMapEntry(e['route-map-id'], e.order)
          }}
        />
      )}
    </div>
  )
}

function nextOrder(orders: number[]): number {
  return orders.length ? Math.max(...orders) + 10 : 10
}

function KeyValueList({
  label,
  keys,
  value,
  onChange,
  valueInput,
}: {
  label: string
  keys: readonly { key: string; label: string }[]
  value: KeyValue[]
  onChange: (v: KeyValue[]) => void
  valueInput: (kv: KeyValue, set: (v: string) => void, i: number) => ReactNode
}) {
  const update = (i: number, patch: Partial<KeyValue>) => onChange(value.map((kv, j) => (j === i ? { ...kv, ...patch } : kv)))
  return (
    <div className="grid gap-2">
      {value.map((kv, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <div className="min-w-0 flex-1 basis-full sm:basis-auto">
            <SelectField aria-label={`${label} ${i + 1} 属性`} value={kv.key || undefined} onValueChange={(k) => update(i, { key: k ?? '', value: '' })} placeholder="属性" options={keys.map((k) => ({ value: k.key, label: k.label }))} />
          </div>
          <div className="min-w-0 flex-1">{valueInput(kv, (v) => update(i, { value: v }), i)}</div>
          <Button type="button" variant="ghost" size="icon" aria-label={`删除${label} ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" className="w-fit" onClick={() => onChange([...value, { key: '', value: '' }])}>
        <Plus />
        添加{label}
      </Button>
    </div>
  )
}

function RouteMapEntryDialog({
  open,
  onOpenChange,
  entry,
  presetId,
  nextOrder: order = 10,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  entry?: RouteMapEntry
  presetId?: string | undefined
  nextOrder?: number
}) {
  const create = !entry
  const [form, setForm] = useState<RouteMapForm>(() => ({ ...routeMapForm(entry, presetId), ...(entry ? {} : { order: String(order) }) }))
  const [touched, setTouched] = useState(false)
  const errors = validateRouteMap(form, create)
  const err = (k: string) => (touched ? errors[k] : undefined)
  const set = <K extends keyof RouteMapForm>(k: K, v: RouteMapForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const prefixLists = usePrefixLists()
  const plIds = (prefixLists.data ?? []).map(effective).filter((l) => l.state !== 'deleted').map((l) => l.id)
  const mapIds = useRouteMapIds()

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={create ? '添加 Route Map 条目' : `编辑 ${entry['route-map-id']} #${entry.order}`}
      submitLabel={create ? '添加' : '保存'}
      onSubmit={async () => {
        setTouched(true)
        if (Object.keys(errors).length) throw new Error('请检查标红的字段')
        if (create) await sdnWrite(createRouteMapEntry(routeMapCreateParams(form)), `添加 ${form.id.trim()} #${form.order}`)
        else {
          const params = routeMapUpdateParams(entry, form)
          if (params) await sdnWrite(updateRouteMapEntry(entry['route-map-id'], entry.order, params), `修改 ${entry['route-map-id']} #${entry.order}`)
        }
      }}
    >
      <FormRow>
        <FormField label="Route Map" name="route-map-id" required={create} error={err('route-map-id')} hint={create ? '已有的名称会添加到那个 Route Map' : undefined}>
          <FieldInput value={form.id} onChange={(e) => set('id', e.target.value)} disabled={!create} list="sdn-route-map-ids" autoComplete="off" placeholder="例如 rm-out" />
        </FormField>
        <FormField label="序号" name="order" required={create} error={err('order')}>
          <FieldInput value={form.order} onChange={(e) => set('order', e.target.value)} disabled={!create} inputMode="numeric" />
        </FormField>
      </FormRow>
      <datalist id="sdn-route-map-ids">
        {mapIds.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <FormField label="动作" name="action">
        <ToggleGroup type="single" variant="outline" value={form.action} onValueChange={(v) => v && set('action', v as 'permit' | 'deny')} className="w-max">
          <ToggleGroupItem value="permit" className="px-4">
            允许
          </ToggleGroupItem>
          <ToggleGroupItem value="deny" className="px-4">
            拒绝
          </ToggleGroupItem>
        </ToggleGroup>
      </FormField>

      <FormSection title="匹配条件" description="全部满足才算匹配；没有条件 = 匹配所有路由。">
        <KeyValueList
          label="条件"
          keys={MATCH_KEYS}
          value={form.match}
          onChange={(v) => set('match', v)}
          valueInput={(kv, setV, i) => {
            const kind = MATCH_KEYS.find((k) => k.key === kv.key)?.value
            if (kind === 'route-type')
              return <SelectField aria-label={`条件 ${i + 1} 值`} value={kv.value || undefined} onValueChange={(v) => setV(v ?? '')} placeholder="路由类型" options={ROUTE_TYPES.map((r) => ({ value: r.value, label: r.label }))} />
            if (kind === 'prefix-list')
              return <SelectField aria-label={`条件 ${i + 1} 值`} value={kv.value || undefined} onValueChange={(v) => setV(v ?? '')} placeholder={plIds.length ? '前缀列表' : '先添加前缀列表'} options={plIds.map((id) => ({ value: id, label: id }))} />
            return <Input aria-label={`条件 ${i + 1} 值`} value={kv.value} onChange={(e) => setV(e.target.value)} placeholder="值" inputMode={kind === 'int' ? 'numeric' : undefined} disabled={!kv.key} />
          }}
        />
        {err('match') && <p className="text-xs text-destructive">{err('match')}</p>}
      </FormSection>

      <FormSection title="设置">
        <KeyValueList
          label="设置项"
          keys={SET_KEYS}
          value={form.set}
          onChange={(v) => set('set', v)}
          valueInput={(kv, setV, i) => {
            const kind = SET_KEYS.find((k) => k.key === kv.key)?.value
            return (
              <Input
                aria-label={`设置项 ${i + 1} 值`}
                value={kind === 'none' ? '' : kv.value}
                onChange={(e) => setV(e.target.value)}
                placeholder={kind === 'none' ? '不需要值' : '值'}
                disabled={!kv.key || kind === 'none'}
              />
            )
          }}
        />
        {err('set') && <p className="text-xs text-destructive">{err('set')}</p>}
      </FormSection>

      <FormSection title="高级" collapsible defaultOpen={!!(form.call || form.exitKey)}>
        <FormField label="调用 Route Map" name="call">
          <SelectField value={form.call || undefined} onValueChange={(v) => set('call', v ?? '')} emptyOption="不调用" options={mapIds.filter((id) => id !== form.id).map((id) => ({ value: id, label: id }))} />
        </FormField>
        <FormRow>
          <FormField label="匹配后" name="exit-action" error={err('exit-action')}>
            <SelectField
              value={form.exitKey || undefined}
              onValueChange={(v) => set('exitKey', (v ?? '') as RouteMapForm['exitKey'])}
              emptyOption="结束（默认）"
              options={[
                { value: 'on-match-next', label: '继续下一条' },
                { value: 'on-match-goto', label: '跳到指定序号' },
                { value: 'continue', label: 'continue' },
              ]}
            />
          </FormField>
          {form.exitKey === 'on-match-goto' && (
            <FormField label="跳到序号">
              <FieldInput value={form.exitValue} onChange={(e) => set('exitValue', e.target.value)} inputMode="numeric" />
            </FormField>
          )}
        </FormRow>
      </FormSection>
    </FormDialog>
  )
}
