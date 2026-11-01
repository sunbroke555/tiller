// "ACME 账户与插件": the cluster-wide ACME accounts and DNS challenge plugins
// (datacenter → ACME in the official UI, PVE.dc.ACMEClusterView).

import { useMemo, useState } from 'react'
import { Lock, Pencil, Plug, Plus, Trash2, UserRound } from 'lucide-react'

import {
  certKeys,
  createAcmePlugin,
  deleteAcmePlugin,
  updateAcmePlugin,
  useAcmeAccounts,
  useAcmeChallengeSchema,
  useAcmePlugin,
  useAcmePlugins,
  type AcmePlugin,
} from '@/api/certificates-acme'
import { useNodes } from '@/api/queries'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { CheckboxField, FieldInput, FieldTextarea, FormDialog, FormField, FormSection, NumberInput, SwitchField, pveFlag } from '@/components/form'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { runTask } from '@/components/tasks/tracker'

import { AccountDetailsDialog, RegisterAccountDialog } from './AccountDialogs'
import {
  DEFAULT_VALIDATION_DELAY,
  MAX_VALIDATION_DELAY,
  buildPluginData,
  parseNodeList,
  pluginDataToForm,
  pluginParams,
  schemaFields,
  validateConfigId,
} from './model'
import { Combobox, EmptyRow, HeaderButton, ListRow, NeutralPill, Notice, Section } from './shared'

export function AcmeClusterSection({ isRoot, canModifyRoot, nodeAccount }: { isRoot: boolean; canModifyRoot: boolean; nodeAccount: string | undefined }) {
  return (
    <section aria-label="ACME 账户与插件" className="grid min-w-0 gap-(--section-gap) border-t border-border/60 pt-(--section-gap)">
      <header className="grid gap-1">
        <h2 className="text-base font-medium">ACME 账户与插件</h2>
        <p className="text-xs text-muted-foreground">整个集群共用，所有节点申请证书时都从这里选。</p>
      </header>
      <AccountsBlock isRoot={isRoot} nodeAccount={nodeAccount} />
      <PluginsBlock canModify={canModifyRoot} />
    </section>
  )
}

// ---------------------------------------------------------------- accounts

function AccountsBlock({ isRoot, nodeAccount }: { isRoot: boolean; nodeAccount: string | undefined }) {
  const accounts = useAcmeAccounts()
  const [registerOpen, setRegisterOpen] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)
  const [lastViewing, setLastViewing] = useState<string | null>(null)
  if (viewing && viewing !== lastViewing) setLastViewing(viewing)
  const list = accounts.data ?? []

  return (
    <>
      <Section
        title="ACME 账户"
        action={
          isRoot && (
            <HeaderButton icon={Plus} onClick={() => setRegisterOpen(true)}>
              注册账户
            </HeaderButton>
          )
        }
      >
        {accounts.isPending ? (
          <LoadingRows rows={1} />
        ) : accounts.isError ? (
          <ErrorState compact error={accounts.error} onRetry={() => void accounts.refetch()} title="无法读取 ACME 账户" />
        ) : list.length === 0 ? (
          <EmptyRow>还没有 ACME 账户{isRoot ? '' : '（只有 root@pam 能注册）'}。</EmptyRow>
        ) : (
          <div role="list" aria-label="ACME 账户" className="divide-y divide-border/70">
            {list.map((a) => (
              <div role="listitem" key={a.name}>
                <ListRow
                  icon={UserRound}
                  title={<span className="font-mono">{a.name}</span>}
                  openLabel={`查看账户 ${a.name}`}
                  badges={a.name === nodeAccount && <NeutralPill tone="brand">本节点使用</NeutralPill>}
                  onOpen={() => setViewing(a.name)}
                />
              </div>
            ))}
          </div>
        )}
      </Section>
      <RegisterAccountDialog open={registerOpen} onOpenChange={setRegisterOpen} existing={list.map((a) => a.name)} />
      <AccountDetailsDialog name={lastViewing} open={!!viewing} onOpenChange={(o) => !o && setViewing(null)} canManage={isRoot} />
    </>
  )
}

// ----------------------------------------------------------------- plugins

function PluginsBlock({ canModify }: { canModify: boolean }) {
  const plugins = useAcmePlugins(canModify)
  const schema = useAcmeChallengeSchema(canModify)
  const [editing, setEditing] = useState<{ id?: string } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [lastRemoving, setLastRemoving] = useState<string | null>(null)
  if (removing && removing !== lastRemoving) setLastRemoving(removing)

  const apiNames = useMemo(() => new Map((schema.data ?? []).map((s) => [s.id, s.name])), [schema.data])
  const list = (plugins.data ?? []).filter((p) => p.type === 'dns')

  return (
    <>
      <Section
        title="DNS 插件"
        description="DNS 验证时，PVE 用这些凭据通过 DNS 服务商的 API 创建 TXT 记录（acme.sh 的 dnsapi）。"
        action={
          canModify && (
            <HeaderButton icon={Plus} onClick={() => setEditing({})}>
              添加插件
            </HeaderButton>
          )
        }
      >
        {!canModify ? (
          <EmptyRow>
            <span className="inline-flex items-center gap-2">
              <Lock className="size-4" aria-hidden /> 需要“/”上的 Sys.Modify 权限才能查看和管理 DNS 插件。
            </span>
          </EmptyRow>
        ) : plugins.isPending ? (
          <LoadingRows rows={1} />
        ) : plugins.isError ? (
          <ErrorState compact error={plugins.error} onRetry={() => void plugins.refetch()} title="无法读取 ACME 插件" />
        ) : list.length === 0 ? (
          <EmptyRow>还没有 DNS 插件。只用 HTTP 验证时不需要。</EmptyRow>
        ) : (
          <div role="list" aria-label="DNS 插件" className="divide-y divide-border/70">
            {list.map((p) => {
              const disabled = pveFlag(p.disable)
              const nodes = parseNodeList(p.nodes)
              return (
                <div role="listitem" key={p.plugin}>
                  <ListRow
                    icon={Plug}
                    tone={disabled ? 'muted' : 'brand'}
                    title={<span className="font-mono">{p.plugin}</span>}
                    openLabel={`编辑插件 ${p.plugin}`}
                    menuLabel={p.plugin}
                    badges={disabled && <NeutralPill tone="warning">已禁用</NeutralPill>}
                    meta={
                      <>
                        {apiNames.get(p.api ?? '') ?? p.api}
                        {p.api && apiNames.get(p.api) && apiNames.get(p.api) !== p.api && <span className="font-mono text-xs"> （{p.api}）</span>}
                      </>
                    }
                    detail={
                      [nodes.length ? `仅限节点 ${nodes.join('、')}` : '', p['validation-delay'] !== undefined ? `验证延迟 ${p['validation-delay']} 秒` : '']
                        .filter(Boolean)
                        .join(' · ') || undefined
                    }
                    onOpen={() => setEditing({ id: p.plugin })}
                    actions={[
                      { id: 'edit', label: '编辑', icon: Pencil, onSelect: () => setEditing({ id: p.plugin }) },
                      { id: 'delete', label: '删除', icon: Trash2, destructive: true, separated: true, onSelect: () => setRemoving(p.plugin) },
                    ]}
                  />
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {canModify && <PluginDialog editing={editing} onClose={() => setEditing(null)} existing={(plugins.data ?? []).map((p) => p.plugin)} />}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        destructive
        title={`删除 DNS 插件 ${lastRemoving}？`}
        description="使用这个插件的节点域名将无法完成 DNS 验证，需要改用其他插件。"
        confirmLabel="删除"
        onConfirm={() =>
          runTask(deleteAcmePlugin(lastRemoving!), {
            title: `删除 ACME 插件 ${lastRemoving}`,
            invalidate: [certKeys.plugins()],
            syncSuccessMessage: `已删除插件 ${lastRemoving}`,
          })
        }
      />
    </>
  )
}

// ------------------------------------------------------------ plugin form

function PluginDialog({ editing, onClose, existing }: { editing: { id?: string } | null; onClose: () => void; existing: string[] }) {
  const open = !!editing
  const [last, setLast] = useState(editing)
  const current = editing ?? last
  const editId = current?.id ?? null
  const isCreate = !editId
  const loaded = useAcmePlugin(open ? editId : null)
  const schemas = useAcmeChallengeSchema(open)
  const nodes = useNodes({ enabled: open })

  const [id, setId] = useState('')
  const [api, setApi] = useState('')
  const [delay, setDelay] = useState<number | undefined>()
  const [values, setValues] = useState<Record<string, string>>({})
  const [extra, setExtra] = useState('')
  const [nodeList, setNodeList] = useState<string[]>([])
  const [disable, setDisable] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  /** The loaded plugin the form was filled from (edit). */
  const [original, setOriginal] = useState<AcmePlugin | undefined>()

  const schemaList = useMemo(() => [...(schemas.data ?? [])].filter((s) => s.type === 'dns').sort((a, b) => a.name.localeCompare(b.name)), [schemas.data])
  const fieldsFor = (apiId: string) => schemaFields(schemaList.find((s) => s.id === apiId))
  const fields = fieldsFor(api)
  const selectedSchema = schemaList.find((s) => s.id === api)

  // Reset on open; fill from the loaded plugin once both it and the schema list are there.
  if (editing !== last) {
    setLast(editing)
    if (editing) {
      setId('')
      setApi('')
      setDelay(undefined)
      setValues({})
      setExtra('')
      setNodeList([])
      setDisable(false)
      setShowErrors(false)
      setOriginal(undefined)
    }
  }
  const ready = isCreate || (!!loaded.data && schemas.isSuccess)
  if (open && !isCreate && loaded.data?.plugin === editId && schemas.isSuccess && original?.plugin !== editId) {
    const pl = loaded.data
    setOriginal(pl)
    setApi(pl.api ?? '')
    const form = pluginDataToForm(pl.data, fieldsFor(pl.api ?? ''))
    setValues(form.values)
    setExtra(form.extra)
    setDelay(pl['validation-delay'])
    setNodeList(parseNodeList(pl.nodes))
    setDisable(pveFlag(pl.disable))
  }

  /** Switching API keeps what was typed: known keys move into the new fields. */
  const changeApi = (next: string) => {
    const data = buildPluginData(fields, values, extra)
    const form = pluginDataToForm(data, fieldsFor(next))
    setApi(next)
    setValues(form.values)
    setExtra(form.extra)
  }

  const idError = isCreate
    ? !id.trim()
      ? '请填写插件 ID'
      : (validateConfigId(id.trim(), '插件 ID') ?? (existing.includes(id.trim()) ? `插件 ${id.trim()} 已存在` : null))
    : null
  const apiError = !api ? '请选择 DNS API' : null
  const delayError = delay !== undefined && (delay < 0 || delay > MAX_VALIDATION_DELAY) ? `0 到 ${MAX_VALIDATION_DELAY} 秒` : null

  const allNodes = (nodes.data ?? []).map((n) => n.node).sort()

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={isCreate ? '添加 DNS 插件' : `编辑 DNS 插件 ${editId}`}
      description="凭据以明文保存在 /etc/pve/priv/acme/plugins.cfg（只有 root 可读）。"
      submitLabel={isCreate ? '添加' : '保存'}
      submitDisabled={!ready}
      onSubmit={async () => {
        setShowErrors(true)
        const err = idError ?? apiError ?? delayError
        if (err) throw new Error(err)
        const params = pluginParams(
          { id, api, validationDelay: delay ?? null, data: buildPluginData(fields, values, extra), nodes: nodeList, disable },
          isCreate ? undefined : original,
        )
        const name = isCreate ? id.trim() : editId!
        await runTask(isCreate ? createAcmePlugin(params) : updateAcmePlugin(editId!, params), {
          title: `${isCreate ? '添加' : '修改'} ACME 插件 ${name}`,
          invalidate: [certKeys.plugins()],
          syncSuccessMessage: `已保存插件 ${name}`,
        })
      }}
    >
      {!ready ? (
        loaded.isError ? (
          <ErrorState compact error={loaded.error} title="无法读取插件" />
        ) : (
          <LoadingRows rows={3} />
        )
      ) : (
        <>
          {isCreate && (
            <FormField label="插件 ID" name="id" required error={showErrors ? idError : undefined}>
              <FieldInput value={id} onChange={(e) => setId(e.target.value)} placeholder="cloudflare" className="font-mono" autoCapitalize="off" spellCheck={false} />
            </FormField>
          )}
          <FormField label="DNS API" name="api" required error={showErrors ? apiError : undefined}>
            <Combobox
              value={api}
              onChange={changeApi}
              options={schemaList.map((s) => ({ value: s.id, label: s.name, description: s.id }))}
              loading={schemas.isPending}
              placeholder="选择 DNS 服务商"
              searchPlaceholder="搜索服务商…"
            />
          </FormField>
          {selectedSchema?.schema.description && <Notice icon={Plug}>{selectedSchema.schema.description}</Notice>}

          {fields.length > 0 && (
            <FormSection title="API 凭据" description={api ? `${fields.length} 项` : undefined}>
              {fields.map((f) => (
                <FormField
                  key={f.key}
                  label={f.label}
                  hint={f.description}
                  labelExtra={
                    <span className="font-mono">{[f.label !== f.key ? f.key : '', f.optional ? '可选' : ''].filter(Boolean).join(' · ')}</span>
                  }
                >
                  <FieldInput
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={f.defaultValue}
                    inputMode={f.type === 'string' ? undefined : 'decimal'}
                    className="font-mono"
                    autoCapitalize="off"
                    spellCheck={false}
                    aria-label={f.key}
                  />
                </FormField>
              ))}
            </FormSection>
          )}

          {fields.length > 0 ? (
            <FormSection title="其他 API 数据" collapsible defaultOpen={!!extra.trim()}>
              <ExtraData value={extra} onChange={setExtra} />
            </FormSection>
          ) : (
            api && (
              <FormField label="API 数据" hint="每行一个 KEY=value，变量名见 acme.sh 的 dnsapi 文档。">
                <FieldTextarea
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  className="font-mono text-xs"
                  spellCheck={false}
                  autoCapitalize="off"
                  aria-label="API 数据"
                />
              </FormField>
            )
          )}

          <FormSection title="高级选项" collapsible defaultOpen={delay !== undefined || nodeList.length > 0 || disable}>
            <FormField
              label="验证延迟"
              name="validation-delay"
              error={showErrors ? delayError : undefined}
              hint="创建 TXT 记录后等待多久再请求验证，DNS 记录生效慢时调大。"
            >
              <NumberInput value={delay} onChange={setDelay} min={0} max={MAX_VALIDATION_DELAY} unit="秒" placeholder={String(DEFAULT_VALIDATION_DELAY)} />
            </FormField>
            <FormField label="限定节点" name="nodes" hint="不选则所有节点都可以使用这个插件。">
              <div className="grid gap-0.5 sm:grid-cols-2" role="group" aria-label="限定节点">
                {allNodes.map((n) => (
                  <CheckboxField
                    key={n}
                    label={<span className="font-mono">{n}</span>}
                    checked={nodeList.includes(n)}
                    onCheckedChange={(c) => setNodeList((l) => (c ? [...l, n].sort() : l.filter((x) => x !== n)))}
                  />
                ))}
                {nodeList
                  .filter((n) => !allNodes.includes(n))
                  .map((n) => (
                    <CheckboxField key={n} label={<span className="font-mono">{n}（不在集群中）</span>} checked onCheckedChange={() => setNodeList((l) => l.filter((x) => x !== n))} />
                  ))}
              </div>
            </FormField>
            <SwitchField label="禁用" description="暂时不使用这个插件。" checked={disable} onCheckedChange={setDisable} />
          </FormSection>
        </>
      )}
    </FormDialog>
  )
}

function ExtraData({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <FormField hint="表单里没有的变量，每行一个 KEY=value。">
      <FieldTextarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-20 font-mono text-xs"
        spellCheck={false}
        autoCapitalize="off"
        aria-label="其他 API 数据"
      />
    </FormField>
  )
}
