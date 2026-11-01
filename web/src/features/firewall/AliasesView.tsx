// Aliases (name → IP/CIDR) of the datacenter or a guest.

import { useState } from 'react'
import { AtSign, Pencil, Plus, Trash2 } from 'lucide-react'

import { firewallApi, useFirewallAliases, type FirewallAlias, type FirewallScope } from '@/api/firewall'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorCard, LoadingRows } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { FieldInput, FormDialog, FormField } from '@/components/form'

import { validateAddress, validateName } from './model'
import { HeaderButton, ListSection, RowMenu, ValidationError, useDialog, useFormState } from './ui'
import { fwWrite } from './write'

export function AliasesView({ scope, canEdit }: { scope: FirewallScope; canEdit: boolean }) {
  const query = useFirewallAliases(scope)
  const edit = useDialog<FirewallAlias | undefined>()
  const remove = useDialog<FirewallAlias>()
  const aliases = [...(query.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const add = canEdit ? (
    <HeaderButton icon={Plus} variant="default" onClick={() => edit.show(undefined)}>
      添加别名
    </HeaderButton>
  ) : undefined

  let body
  if (query.isPending) {
    body = (
      <GlassCard flush>
        <LoadingRows rows={3} />
      </GlassCard>
    )
  } else if (query.isError) {
    body = <ErrorCard error={query.error} onRetry={() => void query.refetch()} />
  } else if (aliases.length === 0) {
    body = (
      <GlassCard>
        <EmptyState
          icon={AtSign}
          title="没有别名"
          description="给常用的 IP 或网段起个名字，在规则的源/目的里引用。"
          action={
            canEdit ? (
              <Button onClick={() => edit.show(undefined)}>
                <Plus /> 添加别名
              </Button>
            ) : undefined
          }
        />
      </GlassCard>
    )
  }

  return (
    <>
      {body ?? (
        <ListSection title={`别名 ${aliases.length}`} action={add}>
          {aliases.map((a) => (
            <div key={a.name} className="flex min-w-0 items-stretch" data-alias={a.name}>
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => edit.show(a)}
                className="flex min-h-14 min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-0.5 px-(--card-p) py-(--row-py) text-left outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] disabled:cursor-default disabled:hover:bg-transparent"
                aria-label={`别名 ${a.name}：${a.cidr}`}
              >
                <span className="min-w-0 truncate font-mono font-medium sm:w-48">{a.name}</span>
                <span className="min-w-0 truncate font-mono text-[13px] text-muted-foreground sm:w-56">{a.cidr}</span>
                {a.comment && <span className="w-full min-w-0 truncate text-xs text-muted-foreground sm:w-auto sm:flex-1">{a.comment}</span>}
              </button>
              {canEdit && (
                <RowMenu
                  label={`别名 ${a.name}`}
                  className="mr-1 self-center"
                  actions={[
                    { id: 'edit', label: '编辑', icon: Pencil, onSelect: () => edit.show(a) },
                    { id: 'delete', label: '删除', icon: Trash2, destructive: true, separated: true, onSelect: () => remove.show(a) },
                  ]}
                />
              )}
            </div>
          ))}
        </ListSection>
      )}

      <AliasDialog {...edit.props} scope={scope} alias={edit.data} />
      <ConfirmDialog
        {...remove.props}
        title={`删除别名 ${remove.data?.name ?? ''}？`}
        description="引用这个别名的规则和 IPSet 会失效（规则显示错误）。"
        confirmLabel="删除"
        destructive
        onConfirm={async () => {
          const a = remove.data
          if (a) await fwWrite(firewallApi.deleteAlias(scope, a.name, a.digest), `删除别名 ${a.name}`, scope)
        }}
      />
    </>
  )
}

function AliasDialog({
  open,
  onOpenChange,
  scope,
  alias,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: FirewallScope
  alias: FirewallAlias | undefined
}) {
  const [form, setForm] = useFormState(open, () => ({ name: alias?.name ?? '', cidr: alias?.cidr ?? '', comment: alias?.comment ?? '' }))
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function submit() {
    const found: Record<string, string> = {}
    const name = validateName(form.name)
    if (name) found.name = name
    const cidr = form.cidr.trim() ? validateAddress(form.cidr) : '必填'
    if (cidr) found.cidr = cidr
    setErrors(found)
    if (Object.keys(found).length) throw new ValidationError()
    const n = form.name.trim()
    if (alias) {
      await fwWrite(
        firewallApi.updateAlias(scope, alias.name, {
          rename: n !== alias.name ? n : undefined,
          cidr: form.cidr.trim(),
          comment: form.comment.trim(),
          digest: alias.digest,
        }),
        `别名 ${n}`,
        scope,
      )
    } else {
      await fwWrite(firewallApi.createAlias(scope, { name: n, cidr: form.cidr.trim(), comment: form.comment.trim() || undefined }), `添加别名 ${n}`, scope)
    }
  }

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={alias ? `编辑别名 ${alias.name}` : '添加别名'} size="sm" onSubmit={submit} submitLabel={alias ? '保存' : '添加'}>
      <FormField label="名称" name={alias ? 'rename' : 'name'} required error={errors.name} hint={alias ? '改名后，引用旧名称的规则需要手动更新' : undefined}>
        <FieldInput value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="例如 office" spellCheck={false} autoCapitalize="off" />
      </FormField>
      <FormField label="IP/CIDR" name="cidr" required error={errors.cidr}>
        <FieldInput value={form.cidr} onChange={(e) => setForm((f) => ({ ...f, cidr: e.target.value }))} placeholder="192.168.10.0/24" spellCheck={false} autoCapitalize="off" />
      </FormField>
      <FormField label="注释" name="comment">
        <FieldInput value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} placeholder="可选" />
      </FormField>
    </FormDialog>
  )
}
