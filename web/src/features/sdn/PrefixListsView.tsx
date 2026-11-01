// Prefix lists and their entries (seq, permit/deny, prefix, ge/le). Used by
// route maps (match) and fabric route filters.

import { useMemo, useState } from 'react'
import { ListFilter, Pencil, Plus, Trash2 } from 'lucide-react'

import {
  createPrefixList,
  createPrefixListEntry,
  deletePrefixList,
  deletePrefixListEntry,
  updatePrefixListEntry,
  usePrefixLists,
  type PrefixListEntry,
} from '@/api/sdn'
import { EmptyState } from '@/components/EmptyState'
import { CheckboxField, FieldInput, FormDialog, FormField, FormRow } from '@/components/form'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

import {
  describePrefixEntry,
  nextPrefixSeq,
  parsePrefixListEntries,
  prefixEntryForm,
  prefixEntryParams,
  prefixEntryUpdateParams,
  validatePrefixEntry,
  type PrefixEntryForm,
} from './model'
import { effective } from './pending'
import { AddButton, DeleteDialog, ObjectRow, PendingChip, RowMenu, SdnCard, sdnWrite, useDialog, useSdnCanEdit } from './ui'

type Dialog =
  | { kind: 'add-list' }
  | { kind: 'delete-list'; id: string }
  | { kind: 'add-entry'; id: string; next: number }
  | { kind: 'edit-entry' | 'delete-entry'; id: string; entry: PrefixListEntry }

export function PrefixListsView() {
  const lists = usePrefixLists()
  const canEdit = useSdnCanEdit()
  const dialog = useDialog<Dialog>()
  const items = useMemo(
    () =>
      (lists.data ?? [])
        .map((raw) => ({ raw, eff: effective(raw) }))
        .sort((a, b) => a.eff.id.localeCompare(b.eff.id))
        .map((l) => ({ ...l, entries: parsePrefixListEntries(l.eff.entries) })),
    [lists.data],
  )
  const shown = dialog.shown

  return (
    <div className="grid gap-(--section-gap)">
      <SdnCard
        title="前缀列表"
        testId="sdn-prefix-lists"
        summary={lists.isPending ? '正在读取…' : `${items.length} 个前缀列表 · 供 Route Map 匹配和 Fabric 路由过滤`}
        onRefresh={() => void lists.refetch()}
        refreshing={lists.isFetching}
        actions={<AddButton onAdd={() => dialog.open({ kind: 'add-list' })} disabled={!canEdit && '没有 SDN.Allocate 权限'} />}
      >
        {lists.isPending ? (
          <LoadingRows rows={3} className="p-(--card-p)" />
        ) : lists.error ? (
          <ErrorState error={lists.error} onRetry={() => void lists.refetch()} compact />
        ) : items.length === 0 ? (
          <EmptyState icon={ListFilter} title="还没有前缀列表" description="例如：只允许 10.0.0.0/8 里掩码不超过 /24 的路由。" />
        ) : (
          <div className="divide-y divide-border/60">
            {items.map(({ raw, eff, entries }) => {
              const alive = raw.state !== 'deleted'
              return (
                <section key={eff.id} data-testid="sdn-prefix-list" data-id={eff.id}>
                  <div className="flex flex-wrap items-center gap-2 bg-foreground/[0.02] px-(--card-p) py-2 paper:bg-secondary/40">
                    <ListFilter className="size-4 text-muted-foreground" aria-hidden />
                    <span className={cn('font-medium', !alive && 'text-muted-foreground line-through')}>{eff.id}</span>
                    <PendingChip obj={raw} />
                    <span className="text-xs text-muted-foreground">{entries.length} 个条目</span>
                    <span className="flex-1" />
                    {canEdit && alive && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => dialog.open({ kind: 'add-entry', id: eff.id, next: nextPrefixSeq(entries) })}>
                          <Plus />
                          条目
                        </Button>
                        <RowMenu label={eff.id} actions={[{ label: '删除前缀列表', icon: Trash2, destructive: true, onSelect: () => dialog.open({ kind: 'delete-list', id: eff.id }) }]} />
                      </>
                    )}
                  </div>
                  {entries.length > 0 && (
                    <ul aria-label={`${eff.id} 的条目`}>
                      {entries.map((e) => (
                        <ObjectRow
                          key={e.seq}
                          testId="sdn-prefix-entry"
                          rowKey={`${eff.id}/${e.seq}`}
                          title={
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-[13px] text-muted-foreground tabular">seq {e.seq}</span>
                              <span className={cn(e.action === 'deny' ? 'text-destructive' : 'text-success-strong')}>{e.action === 'deny' ? '拒绝' : '允许'}</span>
                              <span className="font-mono text-[13px]">{describePrefixEntry(e)}</span>
                            </span>
                          }
                          onOpen={canEdit && alive ? () => dialog.open({ kind: 'edit-entry', id: eff.id, entry: e }) : undefined}
                          actions={
                            canEdit && alive
                              ? [
                                  { label: '编辑', icon: Pencil, onSelect: () => dialog.open({ kind: 'edit-entry', id: eff.id, entry: e }) },
                                  { label: '删除', icon: Trash2, destructive: true, onSelect: () => dialog.open({ kind: 'delete-entry', id: eff.id, entry: e }) },
                                ]
                              : undefined
                          }
                        />
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </SdnCard>

      {shown?.kind === 'add-list' && <PrefixListDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} />}
      {shown?.kind === 'delete-list' && (
        <DeleteDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} what="前缀列表" name={shown.id} isNew={false} run={() => deletePrefixList(shown.id)} />
      )}
      {shown?.kind === 'add-entry' && <PrefixEntryDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} id={shown.id} next={shown.next} />}
      {shown?.kind === 'edit-entry' && <PrefixEntryDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} id={shown.id} entry={shown.entry} />}
      {shown?.kind === 'delete-entry' && (
        <DeleteDialog
          open={dialog.isOpen}
          onOpenChange={dialog.onOpenChange}
          what="条目"
          name={`${shown.id} seq ${shown.entry.seq}`}
          isNew={false}
          run={() => deletePrefixListEntry(shown.id, shown.entry.seq)}
        />
      )}
    </div>
  )
}

function EntryFields({ form, set, errors }: { form: PrefixEntryForm; set: (k: keyof PrefixEntryForm, v: string) => void; errors: Record<string, string> }) {
  return (
    <>
      <FormRow>
        <FormField label="前缀" name="prefix" required error={errors.prefix}>
          <FieldInput value={form.prefix} onChange={(e) => set('prefix', e.target.value)} placeholder="10.0.0.0/8" autoComplete="off" />
        </FormField>
        <FormField label="动作" name="action">
          <ToggleGroup type="single" variant="outline" value={form.action} onValueChange={(v) => v && set('action', v)} className="w-max">
            <ToggleGroupItem value="permit" className="px-4">
              允许
            </ToggleGroupItem>
            <ToggleGroupItem value="deny" className="px-4">
              拒绝
            </ToggleGroupItem>
          </ToggleGroup>
        </FormField>
      </FormRow>
      <FormRow cols={3}>
        <FormField label="序号" name="seq" error={errors.seq}>
          <FieldInput value={form.seq} onChange={(e) => set('seq', e.target.value)} inputMode="numeric" />
        </FormField>
        <FormField label="掩码 ≥ (ge)" name="ge" error={errors.ge}>
          <FieldInput value={form.ge} onChange={(e) => set('ge', e.target.value)} inputMode="numeric" placeholder="可选" />
        </FormField>
        <FormField label="掩码 ≤ (le)" name="le" error={errors.le}>
          <FieldInput value={form.le} onChange={(e) => set('le', e.target.value)} inputMode="numeric" placeholder="可选" />
        </FormField>
      </FormRow>
    </>
  )
}

function PrefixListDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [id, setId] = useState('')
  const [withEntry, setWithEntry] = useState(true)
  const [form, setForm] = useState<PrefixEntryForm>(() => prefixEntryForm(undefined, 5))
  const [touched, setTouched] = useState(false)
  const errors: Record<string, string> = withEntry ? validatePrefixEntry(form) : {}
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id.trim()) || id.trim().length > 32) errors.id = '字母、数字、_ 和 -（最多 32 个）'
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="添加前缀列表"
      submitLabel="添加"
      onSubmit={async () => {
        setTouched(true)
        if (Object.keys(errors).length) throw new Error('请检查标红的字段')
        const p = prefixEntryParams(form)
        const entry = Object.entries({ action: p.action, prefix: p.prefix, ge: p.ge, le: p.le, seq: p.seq })
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(',')
        await sdnWrite(createPrefixList({ id: id.trim(), ...(withEntry ? { entries: [entry] } : {}) }), `添加前缀列表 ${id.trim()}`)
      }}
    >
      <FormField label="名称" name="id" required error={touched ? errors.id : undefined}>
        <FieldInput value={id} onChange={(e) => setId(e.target.value)} placeholder="例如 pl-lan" autoComplete="off" />
      </FormField>
      <CheckboxField label="同时添加第一个条目" checked={withEntry} onCheckedChange={setWithEntry} />
      {withEntry && <EntryFields form={form} set={(k, v) => setForm((f) => ({ ...f, [k]: v }))} errors={touched ? errors : {}} />}
    </FormDialog>
  )
}

function PrefixEntryDialog({ open, onOpenChange, id, entry, next }: { open: boolean; onOpenChange: (o: boolean) => void; id: string; entry?: PrefixListEntry; next?: number }) {
  const create = !entry
  const [form, setForm] = useState<PrefixEntryForm>(() => prefixEntryForm(entry, next))
  const [touched, setTouched] = useState(false)
  const errors = validatePrefixEntry(form)
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={create ? `给 ${id} 添加条目` : `编辑 ${id} seq ${entry.seq}`}
      submitLabel={create ? '添加' : '保存'}
      onSubmit={async () => {
        setTouched(true)
        if (Object.keys(errors).length) throw new Error('请检查标红的字段')
        if (create) await sdnWrite(createPrefixListEntry(id, prefixEntryParams(form)), `给 ${id} 添加条目`)
        else {
          const params = prefixEntryUpdateParams(entry, form)
          if (params) await sdnWrite(updatePrefixListEntry(id, entry.seq, params), `修改 ${id} seq ${entry.seq}`)
        }
      }}
    >
      <EntryFields form={form} set={(k, v) => setForm((f) => ({ ...f, [k]: v }))} errors={touched ? errors : {}} />
      {!create && <p className="-mt-2 text-xs text-muted-foreground">改序号会移动条目；留空 ge/le 表示精确匹配前缀长度。</p>}
    </FormDialog>
  )
}

