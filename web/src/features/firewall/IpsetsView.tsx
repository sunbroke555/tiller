// IPSets of the datacenter or a guest: the list and one set's members
// (IP/CIDR or alias, nomatch, comment). Desktop shows both side by side;
// phones show the list, then the selected set with a back link.

import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ChevronLeft, ChevronRight, ListOrdered, Pencil, Plus, Trash2 } from 'lucide-react'

import {
  firewallApi,
  useFirewallIpsets,
  useIpsetEntries,
  type FirewallIpset,
  type FirewallScope,
  type IpsetEntry,
} from '@/api/firewall'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { SectionHeader } from '@/components/PageHeader'
import { ErrorCard, LoadingRows } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { FieldInput, FormDialog, FormField, SwitchField } from '@/components/form'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

import { validateAddress, validateName } from './model'
import type { FirewallNav } from './nav'
import { useRefPickOptions } from './RuleDialog'
import { SuggestInput } from './pickers'
import { Chip, HeaderButton, ListSection, RowMenu, SectionNote, ValidationError, useDialog, useFormState } from './ui'
import { fwWrite } from './write'

export function IpsetsView({ scope, canEdit, nav }: { scope: FirewallScope; canEdit: boolean; nav: FirewallNav }) {
  const query = useFirewallIpsets(scope)
  const desktop = useIsDesktop()
  const navigate = useNavigate()
  const edit = useDialog<FirewallIpset | undefined>()
  const remove = useDialog<FirewallIpset>()
  const sets = [...(query.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const selected = nav.item ? sets.find((s) => s.name === nav.item) : undefined

  const list = (
    <IpsetList
      scope={scope}
      sets={sets}
      selected={nav.item}
      canEdit={canEdit}
      nav={nav}
      onAdd={() => edit.show(undefined)}
      onEdit={(s) => edit.show(s)}
      onRemove={(s) => remove.show(s)}
    />
  )
  const detail = selected ? (
    <IpsetDetail key={selected.name} scope={scope} set={selected} canEdit={canEdit} nav={nav} onEdit={() => edit.show(selected)} onRemove={() => remove.show(selected)} />
  ) : nav.item && query.data ? (
    <GlassCard>
      <EmptyState icon={ListOrdered} title={`没有找到 IPSet ${nav.item}`} action={<Button asChild variant="outline"><Link to={nav.href('ipset')}>返回列表</Link></Button>} />
    </GlassCard>
  ) : null

  let body
  if (query.isPending) {
    body = (
      <GlassCard flush>
        <LoadingRows rows={3} />
      </GlassCard>
    )
  } else if (query.isError) {
    body = <ErrorCard error={query.error} onRetry={() => void query.refetch()} />
  } else if (desktop) {
    body = (
      <div className="grid items-start gap-(--section-gap) lg:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]">
        {list}
        {detail ?? (
          <GlassCard className="hidden lg:block">
            <EmptyState icon={ListOrdered} title="选择一个 IPSet" description="查看和编辑它的成员。" />
          </GlassCard>
        )}
      </div>
    )
  } else {
    body = detail ?? list
  }

  return (
    <>
      {body}
      <IpsetDialog {...edit.props} scope={scope} set={edit.data} onRenamed={(name) => navigate(nav.href('ipset', name), { replace: true })} />
      <DeleteIpsetDialog {...remove.props} scope={scope} set={remove.data} onDeleted={(name) => nav.item === name && navigate(nav.href('ipset'), { replace: true })} />
    </>
  )
}

function IpsetList({
  scope,
  sets,
  selected,
  canEdit,
  nav,
  onAdd,
  onEdit,
  onRemove,
}: {
  scope: FirewallScope
  sets: FirewallIpset[]
  selected: string | undefined
  canEdit: boolean
  nav: FirewallNav
  onAdd: () => void
  onEdit: (s: FirewallIpset) => void
  onRemove: (s: FirewallIpset) => void
}) {
  const add = canEdit ? (
    <HeaderButton icon={Plus} onClick={onAdd}>
      新建
    </HeaderButton>
  ) : undefined
  return (
    <ListSection title={`IPSet ${sets.length}`} action={add}>
      {sets.length === 0 && (
        <SectionNote>
          还没有 IPSet。IPSet 是一组地址，规则里用 +名称 引用。
          {scope.kind === 'guest' && ' 名为 ipfilter-net0 的集合用于网卡 net0 的 IP 过滤（在选项中开启“IP 过滤”）。'}
        </SectionNote>
      )}
      {sets.map((s) => (
        <div key={s.name} className={cn('flex min-w-0 items-stretch', selected === s.name && 'bg-brand/8 paper:bg-secondary')} data-ipset={s.name}>
          <Link
            to={nav.href('ipset', s.name)}
            aria-current={selected === s.name ? 'page' : undefined}
            className={cn(
              'flex min-h-14 min-w-0 flex-1 items-center gap-3 px-(--card-p) py-(--row-py) outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05]',
            )}
          >
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate font-mono font-medium">{s.name}</span>
              {s.comment && <span className="truncate text-xs text-muted-foreground">{s.comment}</span>}
            </span>
            <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
          </Link>
          {canEdit && (
            <RowMenu
              label={`IPSet ${s.name}`}
              className="mr-1 self-center"
              actions={[
                { id: 'edit', label: '重命名 / 注释', icon: Pencil, onSelect: () => onEdit(s) },
                { id: 'delete', label: '删除', icon: Trash2, destructive: true, separated: true, onSelect: () => onRemove(s) },
              ]}
            />
          )}
        </div>
      ))}
    </ListSection>
  )
}

function IpsetDetail({
  scope,
  set,
  canEdit,
  nav,
  onEdit,
  onRemove,
}: {
  scope: FirewallScope
  set: FirewallIpset
  canEdit: boolean
  nav: FirewallNav
  onEdit: () => void
  onRemove: () => void
}) {
  const query = useIpsetEntries(scope, set.name)
  const entryEdit = useDialog<IpsetEntry | undefined>()
  const entryRemove = useDialog<IpsetEntry>()
  const entries = query.data ?? []

  return (
    <section aria-label={`IPSet ${set.name}`} className="grid min-w-0 gap-3">
      <Link to={nav.href('ipset')} className="-ml-1 inline-flex w-fit items-center gap-1 rounded-md px-1 py-1 text-sm text-muted-foreground hover:text-foreground lg:hidden">
        <ChevronLeft className="size-4" aria-hidden /> 全部 IPSet
      </Link>
      <SectionHeader
        title={
          <span className="grid gap-0.5">
            <span className="font-mono text-base text-foreground">{set.name}</span>
            {set.comment && <span className="text-xs font-normal">{set.comment}</span>}
          </span>
        }
        className="mb-0"
      >
        {canEdit && (
          <div className="flex items-center gap-1">
            <HeaderButton icon={Plus} variant="default" onClick={() => entryEdit.show(undefined)}>
              添加成员
            </HeaderButton>
            <RowMenu
              label={`IPSet ${set.name}`}
              actions={[
                { id: 'edit', label: '重命名 / 注释', icon: Pencil, onSelect: onEdit },
                { id: 'delete', label: '删除 IPSet', icon: Trash2, destructive: true, separated: true, onSelect: onRemove },
              ]}
            />
          </div>
        )}
      </SectionHeader>
      {query.isPending ? (
        <GlassCard flush>
          <LoadingRows rows={2} />
        </GlassCard>
      ) : query.isError ? (
        <ErrorCard error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <GlassCard flush className="overflow-hidden">
          <ul className="divide-y divide-border/70" aria-label="成员">
            {entries.length === 0 && <SectionNote>没有成员。添加 IP、CIDR 或别名。</SectionNote>}
            {entries.map((e) => (
              <li key={e.cidr} className="flex min-w-0 items-stretch" data-cidr={e.cidr}>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => entryEdit.show(e)}
                  className="flex min-h-13 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 px-(--card-p) py-(--row-py) text-left outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className={cn('min-w-0 truncate font-mono text-sm', e.nomatch && 'line-through decoration-foreground/30')}>{e.cidr}</span>
                  {!!e.nomatch && <Chip tone="warning">排除（nomatch）</Chip>}
                  {e.errors && <Chip tone="warning">{Object.values(e.errors).join('；')}</Chip>}
                  {e.comment && <span className="w-full min-w-0 truncate text-xs text-muted-foreground sm:w-auto sm:flex-1">{e.comment}</span>}
                </button>
                {canEdit && (
                  <RowMenu
                    label={e.cidr}
                    className="mr-1 self-center"
                    actions={[
                      { id: 'edit', label: '编辑', icon: Pencil, onSelect: () => entryEdit.show(e) },
                      { id: 'delete', label: '删除', icon: Trash2, destructive: true, separated: true, onSelect: () => entryRemove.show(e) },
                    ]}
                  />
                )}
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      <EntryDialog {...entryEdit.props} scope={scope} set={set.name} entry={entryEdit.data} />
      <ConfirmDialog
        {...entryRemove.props}
        title={`从 ${set.name} 删除 ${entryRemove.data?.cidr ?? ''}？`}
        confirmLabel="删除"
        destructive
        onConfirm={async () => {
          const e = entryRemove.data
          if (e) await fwWrite(firewallApi.deleteIpsetEntry(scope, set.name, e.cidr, e.digest), `删除 ${e.cidr}`, scope)
        }}
      />
    </section>
  )
}

function EntryDialog({
  open,
  onOpenChange,
  scope,
  set,
  entry,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: FirewallScope
  set: string
  entry: IpsetEntry | undefined
}) {
  const aliases = useRefPickOptions(scope, open && !entry, 'alias')
  const [form, setForm] = useFormState(open, () => ({ cidr: entry?.cidr ?? '', nomatch: !!entry?.nomatch, comment: entry?.comment ?? '' }))
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!entry) {
      const e = form.cidr.trim() ? validateAddress(form.cidr) : '必填'
      setError(e)
      if (e) throw new ValidationError()
      await fwWrite(
        firewallApi.addIpsetEntry(scope, set, { cidr: form.cidr.trim(), nomatch: form.nomatch, comment: form.comment.trim() || undefined }),
        `添加 ${form.cidr.trim()}`,
        scope,
      )
      return
    }
    if (form.nomatch === !!entry.nomatch && form.comment.trim() === (entry.comment ?? '')) return
    await fwWrite(
      firewallApi.updateIpsetEntry(scope, set, entry.cidr, { nomatch: form.nomatch, comment: form.comment.trim(), digest: entry.digest }),
      entry.cidr,
      scope,
    )
  }

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={entry ? `编辑 ${entry.cidr}` : `添加到 ${set}`} size="sm" onSubmit={submit} submitLabel={entry ? '保存' : '添加'}>
      {!entry && (
        <FormField label="IP/CIDR" name="cidr" required error={error} hint="IP、网段或别名">
          <SuggestInput
            value={form.cidr}
            onChange={(v) => setForm((f) => ({ ...f, cidr: v }))}
            options={aliases}
            placeholder="10.0.0.0/24"
            pickLabel="选择别名"
            emptyText="没有别名"
          />
        </FormField>
      )}
      <SwitchField
        label="排除（nomatch）"
        description="匹配这个地址的包视为不在集合内，用来从大网段中挖掉一部分"
        checked={form.nomatch}
        onCheckedChange={(v) => setForm((f) => ({ ...f, nomatch: v }))}
      />
      <FormField label="注释" name="comment">
        <FieldInput value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} placeholder="可选" />
      </FormField>
    </FormDialog>
  )
}

function IpsetDialog({
  open,
  onOpenChange,
  scope,
  set,
  onRenamed,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: FirewallScope
  set: FirewallIpset | undefined
  onRenamed: (name: string) => void
}) {
  const [form, setForm] = useFormState(open, () => ({ name: set?.name ?? '', comment: set?.comment ?? '' }))
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const e = validateName(form.name)
    setError(e)
    if (e) throw new ValidationError()
    const name = form.name.trim()
    if (set) {
      if (name === set.name && form.comment.trim() === (set.comment ?? '')) return
      await fwWrite(firewallApi.updateIpset(scope, set.name, name, form.comment.trim(), set.digest), `IPSet ${name}`, scope)
      if (name !== set.name) onRenamed(name)
    } else {
      await fwWrite(firewallApi.createIpset(scope, name, form.comment.trim() || undefined), `新建 IPSet ${name}`, scope)
      onRenamed(name)
    }
  }

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={set ? `编辑 IPSet ${set.name}` : '新建 IPSet'} size="sm" onSubmit={submit} submitLabel={set ? '保存' : '新建'}>
      <FormField label="名称" name="name" required error={error} hint={set ? '改名后，引用旧名称的规则需要手动更新' : '规则里用 +名称 引用'}>
        <FieldInput value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="例如 trusted" spellCheck={false} autoCapitalize="off" />
      </FormField>
      <FormField label="注释" name="comment">
        <FieldInput value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} placeholder="可选" />
      </FormField>
    </FormDialog>
  )
}

function DeleteIpsetDialog({
  open,
  onOpenChange,
  scope,
  set,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: FirewallScope
  set: FirewallIpset | undefined
  onDeleted: (name: string) => void
}) {
  const entries = useIpsetEntries(scope, open ? set?.name : undefined)
  const count = entries.data?.length ?? 0
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`删除 IPSet ${set?.name ?? ''}？`}
      description={count > 0 ? `集合里还有 ${count} 个成员，会一起删除。引用它的规则会失效。` : '引用它的规则会失效。'}
      confirmLabel="删除"
      destructive
      typeToConfirm={count > 0 ? set?.name : undefined}
      onConfirm={async () => {
        if (!set) return
        await fwWrite(firewallApi.deleteIpset(scope, set.name, count > 0), `删除 IPSet ${set.name}`, scope)
        onDeleted(set.name)
      }}
    />
  )
}
