// Security groups (datacenter): the list and one group's rules. A group is
// used by inserting it into a scope's rules ("插入安全组").

import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ChevronLeft, ChevronRight, Layers, Pencil, Plus, Trash2 } from 'lucide-react'

import { firewallApi, fwKeys, useSecurityGroups, type SecurityGroup } from '@/api/firewall'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorCard, LoadingRows } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { FieldInput, FormDialog, FormField } from '@/components/form'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

import { validateName } from './model'
import type { FirewallNav } from './nav'
import { RulesView } from './RulesView'
import { HeaderButton, ListSection, RowMenu, SectionNote, ValidationError, useDialog, useFormState } from './ui'
import { fwWrite } from './write'

const DC = { kind: 'dc' } as const

export function GroupsView({ canEdit, nav }: { canEdit: boolean; nav: FirewallNav }) {
  const query = useSecurityGroups()
  const desktop = useIsDesktop()
  const navigate = useNavigate()
  const edit = useDialog<SecurityGroup | undefined>()
  const remove = useDialog<SecurityGroup>()
  const groups = [...(query.data ?? [])].sort((a, b) => a.group.localeCompare(b.group))
  const selected = nav.item ? groups.find((g) => g.group === nav.item) : undefined

  const list = (
    <ListSection
      title={`安全组 ${groups.length}`}
      action={
        canEdit ? (
          <HeaderButton icon={Plus} onClick={() => edit.show(undefined)}>
            新建
          </HeaderButton>
        ) : undefined
      }
    >
      {groups.length === 0 && <SectionNote>还没有安全组。安全组是一组可复用的规则，插入到数据中心、节点或客户机的规则中使用。</SectionNote>}
      {groups.map((g) => (
        <div key={g.group} className={cn('flex min-w-0 items-stretch', selected?.group === g.group && 'bg-brand/8 paper:bg-secondary')} data-group={g.group}>
          <Link
            to={nav.href('groups', g.group)}
            aria-current={selected?.group === g.group ? 'page' : undefined}
            className={cn(
              'flex min-h-14 min-w-0 flex-1 items-center gap-3 px-(--card-p) py-(--row-py) outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05]',
            )}
          >
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate font-mono font-medium">{g.group}</span>
              {g.comment && <span className="truncate text-xs text-muted-foreground">{g.comment}</span>}
            </span>
            <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
          </Link>
          {canEdit && (
            <RowMenu
              label={`安全组 ${g.group}`}
              className="mr-1 self-center"
              actions={[
                { id: 'edit', label: '重命名 / 注释', icon: Pencil, onSelect: () => edit.show(g) },
                { id: 'delete', label: '删除', icon: Trash2, destructive: true, separated: true, onSelect: () => remove.show(g) },
              ]}
            />
          )}
        </div>
      ))}
    </ListSection>
  )

  const detail = selected ? (
    <section key={selected.group} aria-label={`安全组 ${selected.group}`} className="grid min-w-0 gap-3">
      <Link to={nav.href('groups')} className="-ml-1 inline-flex w-fit items-center gap-1 rounded-md px-1 py-1 text-sm text-muted-foreground hover:text-foreground lg:hidden">
        <ChevronLeft className="size-4" aria-hidden /> 全部安全组
      </Link>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <h2 className="truncate font-mono text-base font-medium">{selected.group}</h2>
          {selected.comment && <p className="text-xs text-muted-foreground">{selected.comment}</p>}
        </div>
        {canEdit && (
          <RowMenu
            label={`安全组 ${selected.group}`}
            actions={[
              { id: 'edit', label: '重命名 / 注释', icon: Pencil, onSelect: () => edit.show(selected) },
              { id: 'delete', label: '删除安全组', icon: Trash2, destructive: true, separated: true, onSelect: () => remove.show(selected) },
            ]}
          />
        )}
      </div>
      <RulesView scope={{ kind: 'group', group: selected.group }} canEdit={canEdit} title="组内规则" emptyHint="组内还没有规则。" />
    </section>
  ) : nav.item && query.data ? (
    <GlassCard>
      <EmptyState
        icon={Layers}
        title={`没有找到安全组 ${nav.item}`}
        action={
          <Button asChild variant="outline">
            <Link to={nav.href('groups')}>返回列表</Link>
          </Button>
        }
      />
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
      <div className="grid items-start gap-(--section-gap) lg:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)]">
        {list}
        {detail ?? (
          <GlassCard>
            <EmptyState icon={Layers} title="选择一个安全组" description="查看和编辑组内的规则。" />
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
      <GroupDialog {...edit.props} group={edit.data} onSaved={(name) => navigate(nav.href('groups', name), { replace: true })} />
      <ConfirmDialog
        {...remove.props}
        title={`删除安全组 ${remove.data?.group ?? ''}？`}
        description="只能删除空的、没有被任何规则引用的安全组：先删除组内规则和插入它的规则。"
        confirmLabel="删除"
        destructive
        onConfirm={async () => {
          const g = remove.data
          if (!g) return
          await fwWrite(firewallApi.deleteGroup(g.group), `删除安全组 ${g.group}`, DC, { also: [fwKeys.groups()] })
          if (nav.item === g.group) navigate(nav.href('groups'), { replace: true })
        }}
      />
    </>
  )
}

function GroupDialog({
  open,
  onOpenChange,
  group,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: SecurityGroup | undefined
  onSaved: (name: string) => void
}) {
  const [form, setForm] = useFormState(open, () => ({ name: group?.group ?? '', comment: group?.comment ?? '' }))
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const e = validateName(form.name)
    setError(e)
    if (e) throw new ValidationError()
    const name = form.name.trim()
    if (group) {
      if (name === group.group && form.comment.trim() === (group.comment ?? '')) return
      await fwWrite(firewallApi.updateGroup(group.group, name, form.comment.trim(), group.digest), `安全组 ${name}`, DC)
      if (name !== group.group) onSaved(name)
    } else {
      await fwWrite(firewallApi.createGroup(name, form.comment.trim() || undefined), `新建安全组 ${name}`, DC)
      onSaved(name)
    }
  }

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={group ? `编辑安全组 ${group.group}` : '新建安全组'} size="sm" onSubmit={submit} submitLabel={group ? '保存' : '新建'}>
      <FormField label="名称" name="group" required error={error} hint={group ? '改名后，插入了这个组的规则会一起更新' : undefined}>
        <FieldInput value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="例如 webserver" spellCheck={false} autoCapitalize="off" />
      </FormField>
      <FormField label="注释" name="comment">
        <FieldInput value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} placeholder="可选" />
      </FormField>
    </FormDialog>
  )
}
