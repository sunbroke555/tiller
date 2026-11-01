// The node's ACME settings: which account it uses, its domains (HTTP or DNS
// challenge, plugin, alias) and ordering / renewing / revoking the
// certificate. Mirrors PVE.node.ACME and PVE.node.ACMEDomainEdit.

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Ban, Globe, Pencil, Plus, RefreshCw, Send, Trash2, UserRound } from 'lucide-react'

import {
  certKeys,
  orderAcmeCertificate,
  renewAcmeCertificate,
  revokeAcmeCertificate,
  updateNodeAcmeConfig,
  useAcmeAccounts,
  useAcmePlugins,
  useCertificates,
  useNodeAcmeConfig,
  type AcmePlugin,
  type NodeAcmeConfig,
} from '@/api/certificates-acme'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FieldInput, FormDialog, FormField, SelectField, type SelectOption } from '@/components/form'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import { RegisterAccountDialog } from './AccountDialogs'
import {
  ACME_DOMAIN_SLOTS,
  CUSTOM_CERT_FILE,
  accountChangeParams,
  acmeDomains,
  domainEditParams,
  domainRemoveParams,
  freeDomainSlot,
  nodeAcmeAccount,
  validateAcmeAlias,
  validateAcmeDomain,
  type AcmeChallengeType,
  type AcmeDomainEntry,
} from './model'
import { EmptyRow, HeaderButton, ListRow, NeutralPill, Notice, Section } from './shared'

type Pending = { kind: 'order' } | { kind: 'renew' } | { kind: 'revoke' } | { kind: 'remove'; entry: AcmeDomainEntry }

export function AcmeSection({
  node,
  canModify,
  canSeePlugins,
  isRoot,
  isLocal,
}: {
  node: string
  canModify: boolean
  canSeePlugins: boolean
  isRoot: boolean
  isLocal: boolean
}) {
  const qc = useQueryClient()
  const config = useNodeAcmeConfig(node)
  const accounts = useAcmeAccounts()
  const plugins = useAcmePlugins(canSeePlugins)
  const certs = useCertificates(node)

  const [editing, setEditing] = useState<{ entry?: AcmeDomainEntry } | null>(null)
  const [pickAccount, setPickAccount] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [lastPending, setLastPending] = useState<Pending | null>(null)
  if (pending && pending !== lastPending) setLastPending(pending)

  const cfg = config.data
  const account = nodeAcmeAccount(cfg)
  const accountList = accounts.data ?? []
  const accountExists = accountList.some((a) => a.name === account)
  const domains = acmeDomains(cfg).sort((a, b) => a.domain.localeCompare(b.domain))
  const hasCustom = (certs.data ?? []).some((c) => c.filename === CUSTOM_CERT_FILE)
  const dnsPlugins = (plugins.data ?? []).filter((p) => p.type === 'dns')

  const orderBlocked = !accountExists ? '先选择一个已注册的 ACME 账户' : domains.length === 0 ? '先添加至少一个域名' : null
  const invalidateConfig = [certKeys.nodeConfig(node)]
  const refetchCertsSoon = () => {
    for (const ms of [4000, 10_000]) setTimeout(() => void qc.invalidateQueries({ queryKey: certKeys.info(node) }), ms)
  }

  /** After registering the first account: let this node use it (as the official UI does). */
  const onRegistered = (name: string) => {
    const current = qc.getQueryData<NodeAcmeConfig>(certKeys.nodeConfig(node))
    const known = qc.getQueryData<{ name: string }[]>(certKeys.accounts()) ?? []
    if (!canModify || known.some((a) => a.name === nodeAcmeAccount(current))) return
    void runTask(updateNodeAcmeConfig(node, accountChangeParams(current, name)), {
      title: `${node} 使用 ACME 账户 ${name}`,
      invalidate: invalidateConfig,
      syncSuccessMessage: false,
    }).catch(() => undefined)
  }

  const header = canModify ? (
    <HeaderButton
      icon={Plus}
      onClick={() => setEditing({})}
      disabled={!cfg}
    >
      添加域名
    </HeaderButton>
  ) : undefined

  const footer = canModify && cfg && (
    <>
      <Button
        onClick={() => setPending({ kind: 'order' })}
        disabled={!!orderBlocked}
        title={orderBlocked ?? undefined}
        className="max-sm:flex-1"
      >
        <Send /> 立即申请证书
      </Button>
      <Button
        variant="outline"
        onClick={() => setPending({ kind: 'renew' })}
        disabled={!hasCustom || !accountExists}
        title={!hasCustom ? '还没有 ACME 证书' : undefined}
        className="max-sm:flex-1"
      >
        <RefreshCw /> 续期
      </Button>
      <Button
        variant="outline"
        onClick={() => setPending({ kind: 'revoke' })}
        disabled={!hasCustom || !accountExists}
        title={!hasCustom ? '还没有 ACME 证书' : undefined}
        className="text-destructive hover:text-destructive max-sm:flex-1"
      >
        <Ban /> 吊销
      </Button>
      {orderBlocked && <p className="basis-full text-xs text-muted-foreground">{orderBlocked}后才能申请证书。</p>}
    </>
  )

  const p = lastPending
  return (
    <>
      <Section
        title="ACME 证书"
        description="用 ACME（如 Let's Encrypt）为本节点自动申请受信任的证书。HTTP 验证需要公网能访问本节点的 80 端口，DNS 验证需要 DNS 插件。"
        action={header}
        footer={footer || undefined}
      >
        {config.isPending ? (
          <LoadingRows rows={2} />
        ) : config.isError && !cfg ? (
          <ErrorState compact error={config.error} onRetry={() => void config.refetch()} title="无法读取节点的 ACME 配置" />
        ) : (
          <>
            {accounts.isSuccess && accountList.length === 0 ? (
              <EmptyRow
                action={
                  isRoot && (
                    <Button variant="outline" size="sm" className="pointer-coarse:h-10" onClick={() => setRegisterOpen(true)}>
                      <Plus /> 注册账户
                    </Button>
                  )
                }
              >
                还没有 ACME 账户{isRoot ? '' : '（只有 root@pam 能注册）'}。
              </EmptyRow>
            ) : (
              <ListRow
                icon={UserRound}
                tone={accounts.isSuccess && !accountExists ? 'warning' : 'brand'}
                title="使用的账户"
                meta={
                  <>
                    <span className="font-mono">{account}</span>
                    {accounts.isSuccess && !accountExists && <span className="text-warning-strong">（账户不存在，请重新选择）</span>}
                  </>
                }
                openLabel="更换 ACME 账户"
                onOpen={canModify && accountList.length > 0 ? () => setPickAccount(true) : undefined}
              />
            )}
            {domains.length === 0 ? (
              <EmptyRow>还没有配置域名。</EmptyRow>
            ) : (
              <div role="list" aria-label="ACME 域名" className="divide-y divide-border/70">
                {domains.map((d) => (
                  <div role="listitem" key={`${d.configkey}:${d.domain}`}>
                    <ListRow
                      icon={Globe}
                      title={<span className="font-mono">{d.domain}</span>}
                      openLabel={`编辑域名 ${d.domain}`}
                      menuLabel={d.domain}
                      badges={<NeutralPill tone={d.type === 'dns' ? 'brand' : 'muted'}>{d.type === 'dns' ? 'DNS' : 'HTTP'}</NeutralPill>}
                      meta={
                        d.type === 'dns' ? (
                          <>
                            插件 <span className="font-mono">{d.plugin}</span>
                            {d.alias && (
                              <>
                                {' · '}别名 <span className="font-mono">{d.alias}</span>
                              </>
                            )}
                          </>
                        ) : (
                          'HTTP-01 验证（standalone）'
                        )
                      }
                      onOpen={canModify ? () => setEditing({ entry: d }) : undefined}
                      actions={
                        canModify
                          ? [
                              { id: 'edit', label: '编辑', icon: Pencil, onSelect: () => setEditing({ entry: d }) },
                              { id: 'remove', label: '删除', icon: Trash2, destructive: true, separated: true, onSelect: () => setPending({ kind: 'remove', entry: d }) },
                            ]
                          : []
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Section>

      {cfg && (
        <DomainDialog
          node={node}
          config={cfg}
          editing={editing}
          onClose={() => setEditing(null)}
          plugins={canSeePlugins ? dnsPlugins : undefined}
          pluginsLoading={plugins.isPending && canSeePlugins}
        />
      )}

      <AccountPickerDialog
        open={pickAccount}
        onOpenChange={setPickAccount}
        current={account}
        accounts={accountList.map((a) => a.name)}
        onSubmit={(name) =>
          runTask(updateNodeAcmeConfig(node, accountChangeParams(cfg, name)), {
            title: `${node} 使用 ACME 账户 ${name}`,
            invalidate: invalidateConfig,
            syncSuccessMessage: `${node} 改用 ACME 账户 ${name}`,
          })
        }
      />

      <RegisterAccountDialog open={registerOpen} onOpenChange={setRegisterOpen} existing={accountList.map((a) => a.name)} onRegistered={onRegistered} />

      {p && (
        <ConfirmDialog
          open={pending === p}
          onOpenChange={(o) => !o && setPending(null)}
          {...confirmProps(p, { node, account, domainCount: domains.length, isLocal })}
          onConfirm={async () => {
            if (p.kind === 'remove') {
              await runTask(updateNodeAcmeConfig(node, domainRemoveParams(cfg!, p.entry)), {
                title: `删除 ACME 域名 ${p.entry.domain}`,
                invalidate: invalidateConfig,
                syncSuccessMessage: `已删除域名 ${p.entry.domain}`,
              })
              return
            }
            const start = p.kind === 'order' ? orderAcmeCertificate(node) : p.kind === 'renew' ? renewAcmeCertificate(node, true) : revokeAcmeCertificate(node)
            const title = { order: '申请 ACME 证书', renew: '续期 ACME 证书', revoke: '吊销 ACME 证书' }[p.kind]
            await runTask(start, {
              title: `${title}（${node}）`,
              invalidate: [certKeys.info(node)],
              onSuccess: refetchCertsSoon,
            })
          }}
        />
      )}
    </>
  )
}

function confirmProps(p: Pending, ctx: { node: string; account: string; domainCount: number; isLocal: boolean }) {
  const localNote = ctx.isLocal ? ' Tiller 通过这个节点连接 PVE，pveproxy 重启时会短暂断开。' : ''
  switch (p.kind) {
    case 'order':
      return {
        title: `为 ${ctx.node} 申请证书？`,
        description: `用账户 ${ctx.account} 为 ${ctx.domainCount} 个域名申请证书。成功后替换当前的自定义证书并重启 pveproxy。${localNote}`,
        confirmLabel: '申请',
      }
    case 'renew':
      return {
        title: `续期 ${ctx.node} 的 ACME 证书？`,
        description: `立即向 CA 续期（即使离到期还有 30 天以上）。成功后重启 pveproxy。${localNote}`,
        confirmLabel: '续期',
      }
    case 'revoke':
      return {
        title: `吊销 ${ctx.node} 的 ACME 证书？`,
        description: `证书会在 CA 处被吊销且无法恢复，节点改回使用集群 CA 签发的证书。${localNote}`,
        confirmLabel: '吊销',
        destructive: true,
        typeToConfirm: ctx.node,
      }
    case 'remove':
      return {
        title: `删除域名 ${p.entry.domain}？`,
        description: '只从节点的 ACME 配置中移除，已签发的证书不受影响，下次申请时不再包含它。',
        confirmLabel: '删除',
        destructive: true,
      }
  }
}

// ------------------------------------------------------------- domain

function DomainDialog({
  node,
  config,
  editing,
  onClose,
  plugins,
  pluginsLoading,
}: {
  node: string
  config: NodeAcmeConfig
  editing: { entry?: AcmeDomainEntry } | null
  onClose: () => void
  /** DNS plugins; undefined when the user may not list them (free text then). */
  plugins: AcmePlugin[] | undefined
  pluginsLoading: boolean
}) {
  const open = !!editing
  const [type, setType] = useState<AcmeChallengeType>('standalone')
  const [domain, setDomain] = useState('')
  const [plugin, setPlugin] = useState<string | undefined>()
  const [alias, setAlias] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  /** Config (and digest) as of opening. */
  const [base, setBase] = useState(config)
  const [last, setLast] = useState(editing)
  if (editing !== last) {
    setLast(editing)
    if (editing) {
      const e = editing.entry
      setType(e?.type ?? 'standalone')
      setDomain(e?.domain ?? '')
      setPlugin(e?.plugin)
      setAlias(e?.alias ?? '')
      setShowErrors(false)
      setBase(config)
    }
  }
  const entry = (editing ?? last)?.entry
  const isCreate = !entry

  const domainError = validateAcmeDomain(domain)
  const aliasError = type === 'dns' ? validateAcmeAlias(alias) : null
  const needsSlot = type === 'dns' && (!entry || entry.configkey === 'acme')
  const slotError = needsSlot && !freeDomainSlot(base) ? `最多只能配置 ${ACME_DOMAIN_SLOTS} 个 DNS 验证的域名` : null
  const pluginError = type === 'dns' && !plugin ? '请选择 DNS 插件' : null

  const pluginOptions: SelectOption[] = (plugins ?? []).map((p) => ({
    value: p.plugin,
    label: p.plugin,
    description: p.api,
  }))
  if (plugin && plugins && !plugins.some((p) => p.plugin === plugin)) pluginOptions.unshift({ value: plugin, label: plugin, description: '不存在' })

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={isCreate ? '添加 ACME 域名' : '编辑 ACME 域名'}
      description={`节点 ${node}`}
      submitLabel={isCreate ? '添加' : '保存'}
      onSubmit={async () => {
        setShowErrors(true)
        const err = domainError ?? slotError ?? pluginError ?? aliasError
        if (err) throw new Error(err)
        const params = domainEditParams(base, entry, { type, domain, plugin, alias })
        await runTask(updateNodeAcmeConfig(node, params), {
          title: `${isCreate ? '添加' : '修改'} ACME 域名 ${domain.trim()}`,
          invalidate: [certKeys.nodeConfig(node)],
          syncSuccessMessage: `已保存域名 ${domain.trim()}`,
        })
      }}
    >
      <FormField label="验证方式" error={showErrors ? slotError : undefined}>
        <ToggleGroup
          type="single"
          variant="outline"
          value={type}
          onValueChange={(v) => v && setType(v as AcmeChallengeType)}
          className="w-full *:flex-1"
          aria-label="验证方式"
        >
          <ToggleGroupItem value="standalone" className="pointer-coarse:h-11">
            HTTP
          </ToggleGroupItem>
          <ToggleGroupItem value="dns" className="pointer-coarse:h-11">
            DNS
          </ToggleGroupItem>
        </ToggleGroup>
      </FormField>
      <FormField
        label="域名"
        name="domain"
        required
        error={showErrors ? domainError : undefined}
        hint={type === 'standalone' ? 'CA 会通过 http://<域名>/.well-known/acme-challenge/ 验证，需要能从公网访问本节点的 80 端口。' : undefined}
      >
        <FieldInput
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder={`${node}.example.com`}
          className="font-mono"
          inputMode="url"
          autoCapitalize="off"
          spellCheck={false}
        />
      </FormField>
      {type === 'dns' && (
        <>
          <FormField
            label="DNS 插件"
            name="plugin"
            required
            error={showErrors ? pluginError : undefined}
            hint={plugins && plugins.length === 0 ? '还没有 DNS 插件：先在下方“ACME 账户与插件”中添加。' : undefined}
          >
            {plugins ? (
              <SelectField value={plugin} onValueChange={setPlugin} options={pluginOptions} loading={pluginsLoading} placeholder="选择插件" />
            ) : (
              <FieldInput value={plugin ?? ''} onChange={(e) => setPlugin(e.target.value || undefined)} placeholder="插件 ID" className="font-mono" />
            )}
          </FormField>
          <FormField
            label="验证别名（可选）"
            name="alias"
            error={showErrors ? aliasError : undefined}
            hint="DNS 别名模式：在别名域名下创建 TXT 记录（_acme-challenge 记录用 CNAME 指向它）。"
          >
            <FieldInput
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="_acme-challenge.example.net"
              className="font-mono"
              autoCapitalize="off"
              spellCheck={false}
            />
          </FormField>
        </>
      )}
      {type === 'standalone' && entry?.type === 'dns' && (
        <Notice icon={AlertTriangle}>改为 HTTP 验证后，插件和别名设置会被移除。</Notice>
      )}
    </FormDialog>
  )
}

// ------------------------------------------------------------ account

function AccountPickerDialog({
  open,
  onOpenChange,
  current,
  accounts,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  current: string
  accounts: string[]
  onSubmit: (name: string) => Promise<unknown>
}) {
  const [value, setValue] = useState<string | undefined>(current)
  const [last, setLast] = useState(open)
  if (open !== last) {
    setLast(open)
    if (open) setValue(accounts.includes(current) ? current : accounts[0])
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="选择 ACME 账户"
      description="申请和续期证书时使用的账户"
      submitDisabled={!value || value === current}
      onSubmit={() => onSubmit(value!)}
    >
      <FormField label="账户" name="acme">
        <SelectField value={value} onValueChange={setValue} options={accounts.map((a) => ({ value: a, label: a }))} />
      </FormField>
    </FormDialog>
  )
}
