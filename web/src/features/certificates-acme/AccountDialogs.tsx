// ACME account dialogs: register (directory, ToS, EAB), details, update the
// contact email and deactivate. Mirrors PVE.node.ACMEAccountCreate and
// Proxmox.window.ACMEAccountView. All but listing are root@pam only.

import { useState } from 'react'
import { ExternalLink, Loader2, Mail, Search, UserX } from 'lucide-react'

import {
  certKeys,
  deactivateAcmeAccount,
  registerAcmeAccount,
  updateAcmeAccount,
  useAcmeAccount,
  useAcmeDirectories,
  useAcmeMeta,
} from '@/api/certificates-acme'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { CheckboxField, FieldInput, FormDialog, FormField, FormSection, SelectField } from '@/components/form'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'

import {
  ACCOUNT_STATUS_LABEL,
  CUSTOM_DIRECTORY,
  accountEmail,
  accountFormErrors,
  accountRegisterParams,
  directoryLabel,
  directoryMetaInfo,
  validateEmail,
  type AccountForm,
} from './model'
import { Fact } from './shared'

function UrlLink({ url }: { url: string | undefined }) {
  if (!url) return <>—</>
  if (!/^https?:\/\//.test(url)) return <span className="break-all">{url}</span>
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-start gap-1 break-all text-brand-strong underline-offset-2 hover:underline paper:text-foreground">
      {url}
      <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
    </a>
  )
}

// ---------------------------------------------------------------- register

const EMPTY_FORM: AccountForm = {
  name: '',
  contact: '',
  directory: '',
  customUrl: '',
  tosAccepted: false,
  eabKid: '',
  eabHmacKey: '',
}

export function RegisterAccountDialog({
  open,
  onOpenChange,
  existing,
  onRegistered,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existing: string[]
  /** After the registration task ended OK. */
  onRegistered?: (name: string) => void
}) {
  const directories = useAcmeDirectories(open)
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM)
  /** Custom directory URL the user asked to look up. */
  const [queried, setQueried] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [last, setLast] = useState(open)
  if (open !== last) {
    setLast(open)
    if (open) {
      setForm(EMPTY_FORM)
      setQueried('')
      setShowErrors(false)
    }
  }
  // Preselect the first known directory (Let's Encrypt V2) once loaded.
  const dirs = [...(directories.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  if (open && !form.directory && dirs[0]) setForm({ ...form, directory: dirs[0].url })

  const set = <K extends keyof AccountForm>(key: K, value: AccountForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const custom = form.directory === CUSTOM_DIRECTORY
  const metaUrl = custom ? queried : form.directory
  const meta = useAcmeMeta(open ? metaUrl || undefined : undefined)
  const metaInfo = meta.isSuccess ? directoryMetaInfo(meta.data) : undefined
  const defaultExists = existing.includes('default')
  const errors = accountFormErrors(form, metaInfo, { defaultExists, existing })
  const err = (k: keyof typeof errors) => (showErrors ? errors[k] : undefined)
  const showEab = custom || !!metaInfo?.eabRequired
  const name = form.name.trim() || 'default'

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="注册 ACME 账户"
      description="账户在所有节点共用。注册时 PVE 会联系 CA，需要能访问外网。"
      submitLabel="注册"
      onSubmit={async () => {
        setShowErrors(true)
        if (custom && queried !== form.customUrl.trim()) {
          setQueried(form.customUrl.trim())
          throw new Error('已查询目录信息，请确认服务条款后再提交')
        }
        if (metaUrl && meta.isPending) throw new Error('正在获取目录信息，请稍候')
        if (meta.isError) throw new Error(`无法获取目录信息：${errorMessage(meta.error)}`)
        const first = Object.values(errors)[0]
        if (first) throw new Error(first)
        const handle = await runTask(registerAcmeAccount(accountRegisterParams(form, metaInfo)), {
          title: `注册 ACME 账户 ${name}`,
          invalidate: [certKeys.accounts()],
        })
        void handle.done.then((o) => {
          if (o.state !== 'error') onRegistered?.(name)
        })
      }}
    >
      <FormField label="账户名称" name="name" error={err('name')} hint={defaultExists ? undefined : '留空则为 default'}>
        <FieldInput
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder={defaultExists ? '' : 'default'}
          className="font-mono"
          autoCapitalize="off"
          spellCheck={false}
        />
      </FormField>
      <FormField label="邮箱" name="contact" required error={err('contact')}>
        <FieldInput type="email" inputMode="email" value={form.contact} onChange={(e) => set('contact', e.target.value)} placeholder="admin@example.com" />
      </FormField>
      <FormField label="ACME 目录" name="directory" required error={err('directory')}>
        <SelectField
          value={form.directory || undefined}
          onValueChange={(v) => {
            setForm((f) => ({ ...f, directory: v ?? '', tosAccepted: false }))
          }}
          loading={directories.isPending}
          options={[
            ...dirs.map((d) => ({ value: d.url, label: d.name, description: directoryLabel(d.url) })),
            { value: CUSTOM_DIRECTORY, label: '自定义', description: '其他 ACME CA' },
          ]}
          placeholder="选择目录"
        />
      </FormField>
      {custom && (
        <FormField label="目录地址" name="directory-url" required>
          <div className="flex gap-2">
            <FieldInput
              value={form.customUrl}
              onChange={(e) => setForm((f) => ({ ...f, customUrl: e.target.value, tosAccepted: false }))}
              placeholder="https://acme.example.com/directory"
              className="font-mono"
              inputMode="url"
              autoCapitalize="off"
              spellCheck={false}
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0 pointer-coarse:h-11"
              disabled={!/^https?:\/\//.test(form.customUrl.trim())}
              onClick={() => setQueried(form.customUrl.trim())}
            >
              <Search /> 查询
            </Button>
          </div>
        </FormField>
      )}

      <div className="grid gap-2" aria-live="polite">
        {!metaUrl ? (
          <p className="text-xs text-muted-foreground">{custom ? '输入目录地址后点“查询”，获取服务条款。' : '选择目录后会获取服务条款。'}</p>
        ) : meta.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> 正在获取服务条款…
          </p>
        ) : meta.isError ? (
          <p role="alert" className="text-sm text-destructive">
            无法获取目录信息：{errorMessage(meta.error)}
          </p>
        ) : metaInfo?.termsOfService ? (
          <>
            <p className="text-sm">
              服务条款：
              <UrlLink url={metaInfo.termsOfService} />
            </p>
            <CheckboxField label="我已阅读并同意服务条款" checked={form.tosAccepted} onCheckedChange={(v) => set('tosAccepted', v)} />
            {err('tos') && (
              <p role="alert" className="text-xs text-destructive">
                {err('tos')}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">这个 CA 不需要同意服务条款。</p>
        )}
      </div>

      {showEab && (
        <FormSection
          title="外部账户绑定（EAB）"
          description={metaInfo?.eabRequired ? '这个 CA 要求 EAB，凭据由 CA 提供。' : '可选。部分商业 CA（如 ZeroSSL）需要。'}
        >
          <FormField label="EAB Key ID" name="eab-kid" required={!!metaInfo?.eabRequired} error={err('eab-kid')}>
            <FieldInput value={form.eabKid} onChange={(e) => set('eabKid', e.target.value)} className="font-mono" autoCapitalize="off" spellCheck={false} />
          </FormField>
          <FormField label="EAB HMAC 密钥" name="eab-hmac-key" required={!!metaInfo?.eabRequired} error={err('eab-hmac-key')}>
            <FieldInput value={form.eabHmacKey} onChange={(e) => set('eabHmacKey', e.target.value)} className="font-mono" autoCapitalize="off" spellCheck={false} />
          </FormField>
        </FormSection>
      )}
    </FormDialog>
  )
}

// ----------------------------------------------------------------- details

export function AccountDetailsDialog({
  name,
  open,
  onOpenChange,
  canManage,
}: {
  name: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** root@pam: details, email change and deactivation. */
  canManage: boolean
}) {
  const detail = useAcmeAccount(name, open && canManage)
  const directories = useAcmeDirectories(open)
  const [emailOpen, setEmailOpen] = useState(false)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const d = detail.data
  const email = accountEmail(d?.account?.contact)
  const status = d?.account?.status

  return (
    <>
      <ResponsiveDialog
        open={open}
        onOpenChange={onOpenChange}
        size="md"
        title={<span className="font-mono">{name}</span>}
        description="ACME 账户"
        footer={
          <>
            {canManage && d && status !== 'deactivated' && (
              <Button variant="outline" className="mr-auto text-destructive hover:text-destructive" onClick={() => setDeactivateOpen(true)}>
                <UserX /> 注销账户
              </Button>
            )}
            {canManage && d && status !== 'deactivated' && (
              <Button variant="outline" onClick={() => setEmailOpen(true)}>
                <Mail /> 修改邮箱
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </>
        }
        bodyClassName="grid gap-2"
      >
        {!canManage ? (
          <p className="text-sm text-muted-foreground">只有 root@pam 能查看和管理 ACME 账户。</p>
        ) : detail.isPending ? (
          <LoadingRows rows={3} />
        ) : detail.isError ? (
          <ErrorState compact error={detail.error} onRetry={() => void detail.refetch()} title="无法读取账户" />
        ) : (
          d && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Fact label="邮箱">{email ?? '—'}</Fact>
              <Fact label="状态">{status ? (ACCOUNT_STATUS_LABEL[status] ?? status) : '—'}</Fact>
              <Fact label="创建时间">{d.account?.createdAt ? formatIso(d.account.createdAt) : '—'}</Fact>
              <Fact label="CA">{directoryLabel(d.directory, directories.data)}</Fact>
              <Fact label="目录地址" wide>
                <UrlLink url={d.directory} />
              </Fact>
              <Fact label="服务条款" wide>
                <UrlLink url={d.tos} />
              </Fact>
              {d.location && (
                <Fact label="账户地址" wide>
                  <span className="font-mono text-xs break-all">{d.location}</span>
                </Fact>
              )}
            </div>
          )
        )}
      </ResponsiveDialog>

      {name && (
        <UpdateEmailDialog name={name} current={email ?? ''} open={emailOpen} onOpenChange={setEmailOpen} />
      )}
      {name && (
        <ConfirmDialog
          open={deactivateOpen}
          onOpenChange={setDeactivateOpen}
          destructive
          typeToConfirm={name}
          title={`注销 ACME 账户 ${name}？`}
          description="账户在 CA 处被停用，无法恢复，本地的账户文件也会删除。使用它的节点需要换一个账户才能续期证书。"
          confirmLabel="注销"
          onConfirm={async () => {
            await runTask(deactivateAcmeAccount(name), { title: `注销 ACME 账户 ${name}`, invalidate: [certKeys.acme()] })
            onOpenChange(false)
          }}
        />
      )}
    </>
  )
}

function formatIso(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function UpdateEmailDialog({ name, current, open, onOpenChange }: { name: string; current: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [contact, setContact] = useState(current)
  const [showErrors, setShowErrors] = useState(false)
  const [last, setLast] = useState(open)
  if (open !== last) {
    setLast(open)
    if (open) {
      setContact(current)
      setShowErrors(false)
    }
  }
  const error = validateEmail(contact)
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="修改账户邮箱"
      description={`ACME 账户 ${name}`}
      submitDisabled={contact.trim() === current}
      onSubmit={async () => {
        setShowErrors(true)
        if (error) throw new Error(error)
        await runTask(updateAcmeAccount(name, { contact: contact.trim() }), {
          title: `更新 ACME 账户 ${name}`,
          invalidate: [certKeys.account(name)],
        })
      }}
    >
      <FormField label="邮箱" name="contact" required error={showErrors ? error : undefined}>
        <FieldInput type="email" inputMode="email" value={contact} onChange={(e) => setContact(e.target.value)} />
      </FormField>
    </FormDialog>
  )
}
