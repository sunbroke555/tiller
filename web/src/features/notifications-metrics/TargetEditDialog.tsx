// Add / edit one notification target. One dialog for the four types; the
// fields follow the official edit panels (model.ts builds the params).

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  createEndpoint,
  fetchEndpoint,
  notificationKeys,
  updateEndpoint,
  useMailUsers,
  type TargetType,
} from '@/api/notifications-metrics'
import { FieldInput, FieldTextarea, FormDialog, FormField, FormRow, FormSection, NumberInput, SelectField, SwitchField } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ChipSelect, Notice } from '@/features/storage-config/fields'
import { useOpenSnapshot } from '@/hooks/useOpenSnapshot'

import {
  DEFAULT_MAIL_AUTHOR,
  SMTP_MODES,
  TARGET_INFO,
  WEBHOOK_BODY_EXAMPLE,
  WEBHOOK_METHODS,
  WEBHOOK_TEMPLATE_VARS,
  initialTargetForm,
  isBuiltin,
  smtpDefaultPort,
  targetParams,
  validateTarget,
  type SmtpMode,
  type TargetForm,
  type WebhookMethod,
} from './model'
import { KeyValueEditor } from './ui'

export interface TargetEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: TargetType
  /** Set to edit this target; unset to add a new one of `type`. */
  name?: string | undefined
  canEdit: boolean
}

export function TargetEditDialog({ open, onOpenChange, type, name, canEdit }: TargetEditDialogProps) {
  const create = !name
  const info = TARGET_INFO[type]
  const q = useQuery({
    queryKey: notificationKeys.endpoint(type, name ?? ''),
    queryFn: ({ signal }) => fetchEndpoint(type, name!, signal),
    enabled: open && !create,
    staleTime: 0,
  })
  const snap = useOpenSnapshot(open, q.data)

  const [form, setForm] = useState<TargetForm | null>(null)
  const [seeded, setSeeded] = useState<unknown>(null)
  const [tried, setTried] = useState(false)
  const source: unknown = create ? type : snap
  if (open && source && seeded !== source) {
    setSeeded(source)
    setForm(initialTargetForm(type, create ? undefined : snap))
    setTried(false)
  } else if (!open && seeded !== null) {
    setSeeded(null)
  }
  const set = <K extends keyof TargetForm>(k: K, v: TargetForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))

  const errors = useMemo(() => (form ? validateTarget(form, create) : {}), [form, create])
  const err = (k: string) => (tried ? errors[k] : undefined)

  async function submit() {
    if (!form) return
    setTried(true)
    if (Object.keys(validateTarget(form, create)).length) throw new Error('请先修正标出的问题')
    if (create) {
      const n = form.name.trim()
      await runTask(createEndpoint(type, targetParams(form, true)), { title: `添加通知目标 ${n}`, syncSuccessMessage: `已添加通知目标 ${n}` })
    } else {
      await runTask(updateEndpoint(type, name, targetParams(form, false, snap?.digest)), {
        title: `保存通知目标 ${name}`,
        syncSuccessMessage: `已保存通知目标 ${name}`,
      })
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={create ? `添加 ${info.label} 目标` : `${canEdit ? '编辑' : '查看'}通知目标 ${name}`}
      description={create ? info.description : `${info.label}${snap && isBuiltin(snap.origin) ? ' · 内置目标' : ''}`}
      onSubmit={submit}
      submitLabel={create ? '添加' : '保存'}
      submitDisabled={!form || !canEdit}
    >
      {q.isError && !create ? (
        <Notice tone="error">读取目标配置失败：{q.error.message}</Notice>
      ) : !form ? (
        <div className="grid gap-3">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      ) : (
        <TargetFields form={form} set={set} create={create} err={err} builtin={!!snap && isBuiltin(snap.origin)} />
      )}
    </FormDialog>
  )
}

type Setter = <K extends keyof TargetForm>(k: K, v: TargetForm[K]) => void

function TargetFields({
  form: f,
  set,
  create,
  err,
  builtin,
}: {
  form: TargetForm
  set: Setter
  create: boolean
  err: (k: string) => string | undefined
  builtin: boolean
}) {
  const mail = f.type === 'sendmail' || f.type === 'smtp'
  return (
    <>
      {builtin && <Notice>这是内置目标。修改后列表里显示“内置（已修改）”，随时可以重置回默认设置。</Notice>}
      <FormRow>
        <FormField label="名称" name="name" required={create} error={err('name')} hint={create ? '创建后不能修改' : undefined}>
          <FieldInput value={f.name} onChange={(e) => set('name', e.target.value)} readOnly={!create} placeholder="例如 ops-mail" className="font-mono" autoComplete="off" />
        </FormField>
        <div className="flex items-end pb-1">
          <SwitchField label="启用" checked={f.enable} onCheckedChange={(v) => set('enable', v)} />
        </div>
      </FormRow>

      {f.type === 'smtp' && (
        <FormSection title="SMTP 服务器">
          <FormField label="服务器" name="server" required error={err('server')}>
            <FieldInput value={f.server} onChange={(e) => set('server', e.target.value)} placeholder="mail.example.com" autoComplete="off" inputMode="url" />
          </FormField>
          <FormRow>
            <FormField label="加密" name="mode">
              <SelectField<SmtpMode> value={f.mode} onValueChange={(v) => set('mode', v ?? 'tls')} options={SMTP_MODES.map((m) => ({ value: m.value, label: m.label }))} />
            </FormField>
            <FormField label="端口" name="port" error={err('port')}>
              <NumberInput value={f.port} onChange={(v) => set('port', v)} min={1} max={65535} placeholder={`默认 ${smtpDefaultPort(f.mode)}`} />
            </FormField>
          </FormRow>
          {f.mode === 'insecure' && <Notice tone="warning">不加密时，邮件内容和密码会以明文在网络上传输。</Notice>}
          <SwitchField label="需要认证" description="用用户名和密码登录 SMTP 服务器" checked={f.auth} onCheckedChange={(v) => set('auth', v)} />
          {f.auth && (
            <FormRow>
              <FormField label="用户名" name="username" required error={err('username')}>
                <FieldInput value={f.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" />
              </FormField>
              <FormField label="密码" name="password" required={create || !f.hadAuth} error={err('password')}>
                <FieldInput
                  type="password"
                  value={f.password}
                  onChange={(e) => set('password', e.target.value)}
                  placeholder={!create && f.hadAuth ? '不变' : ''}
                  autoComplete="new-password"
                />
              </FormField>
            </FormRow>
          )}
          <FormField label="发件人地址" name="from-address" required error={err('from-address')}>
            <FieldInput value={f.fromAddress} onChange={(e) => set('fromAddress', e.target.value)} type="email" inputMode="email" placeholder="pve@example.com" />
          </FormField>
        </FormSection>
      )}

      {mail && <Recipients form={f} set={set} err={err} />}

      {f.type === 'gotify' && (
        <>
          <FormField label="服务器地址" name="server" required error={err('server')}>
            <FieldInput value={f.server} onChange={(e) => set('server', e.target.value)} placeholder="https://gotify.example.com" inputMode="url" autoComplete="off" />
          </FormField>
          <FormField label="应用 Token" name="token" required={create} error={err('token')} hint={create ? undefined : '留空表示不变'}>
            <FieldInput type="password" value={f.token} onChange={(e) => set('token', e.target.value)} placeholder={create ? '' : '不变'} autoComplete="new-password" />
          </FormField>
        </>
      )}

      {f.type === 'webhook' && <WebhookFields form={f} set={set} create={create} err={err} />}

      <FormField label="备注" name="comment">
        <FieldInput value={f.comment} onChange={(e) => set('comment', e.target.value)} />
      </FormField>

      {mail && (
        <FormSection collapsible title="高级选项">
          <FormRow>
            <FormField label="作者" name="author" hint="邮件“发件人”显示的名字">
              <FieldInput value={f.author} onChange={(e) => set('author', e.target.value)} placeholder={DEFAULT_MAIL_AUTHOR} />
            </FormField>
            {f.type === 'sendmail' && (
              <FormField label="发件人地址" name="from-address" hint="默认用数据中心选项里的邮件发件人，或 root@主机名">
                <FieldInput value={f.fromAddress} onChange={(e) => set('fromAddress', e.target.value)} type="email" inputMode="email" placeholder="默认" />
              </FormField>
            )}
          </FormRow>
        </FormSection>
      )}
    </>
  )
}

function Recipients({ form: f, set, err }: { form: TargetForm; set: Setter; err: (k: string) => string | undefined }) {
  const users = useMailUsers()
  const options = useMemo(() => {
    const list = (users.data ?? []).map((u) => ({ value: u.userid, label: u.email ? `${u.userid}（${u.email}）` : `${u.userid}（未设邮箱）` }))
    for (const id of f.mailtoUser) if (!list.some((o) => o.value === id)) list.push({ value: id, label: id })
    return list.sort((a, b) => a.value.localeCompare(b.value))
  }, [users.data, f.mailtoUser])
  return (
    <FormSection title="收件人">
      <FormField label="用户" name="mailto-user" hint="发到用户在“用户”设置里填写的邮箱">
        {users.isPending ? (
          <Skeleton className="h-9 rounded-full" />
        ) : (
          <ChipSelect label="收件用户" options={options} value={f.mailtoUser} onChange={(v) => set('mailtoUser', v)} />
        )}
      </FormField>
      <FormField label="其他邮箱" name="mailto" error={err('mailto')} hint="多个地址用空格、逗号或分号分隔">
        <FieldInput value={f.mailto} onChange={(e) => set('mailto', e.target.value)} type="text" inputMode="email" placeholder="admin@example.com, ops@example.com" autoComplete="off" />
      </FormField>
    </FormSection>
  )
}

function WebhookFields({ form: f, set, create, err }: { form: TargetForm; set: Setter; create: boolean; err: (k: string) => string | undefined }) {
  return (
    <>
      <FormRow>
        <FormField label="方法" name="method">
          <SelectField<WebhookMethod> value={f.method} onValueChange={(v) => set('method', v ?? 'post')} options={WEBHOOK_METHODS.map((m) => ({ value: m, label: m.toUpperCase() }))} />
        </FormField>
        <FormField label="URL" name="url" required error={err('url')}>
          <FieldInput value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="https://example.com/hook" inputMode="url" autoComplete="off" className="font-mono text-sm" />
        </FormField>
      </FormRow>
      <FormField label="请求头" name="header" error={err('header')} hint="值可以引用机密：{{ secrets.<名称> }}">
        <KeyValueEditor label="请求头" addLabel="添加请求头" value={f.headers} onChange={(v) => set('headers', v)} />
      </FormField>
      <FormField
        label="请求体"
        name="body"
        labelExtra={
          !f.body && (
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => set('body', WEBHOOK_BODY_EXAMPLE)}>
              填入 JSON 示例
            </Button>
          )
        }
      >
        <FieldTextarea value={f.body} onChange={(e) => set('body', e.target.value)} rows={6} spellCheck={false} placeholder={'{ "text": "{{ escape title }}" }'} className="font-mono text-xs" />
      </FormField>
      <details className="rounded-xl border border-border/60 px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer py-1 text-foreground/80">模板变量</summary>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {WEBHOOK_TEMPLATE_VARS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-foreground/85">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-1.5">URL、请求头和请求体都可以使用模板。</p>
      </details>
      <FormField label="机密" name="secret" error={err('secret')} hint={create ? '存放 token 等敏感值，保存后不再显示' : '已保存的机密不显示，留空表示不变'}>
        <KeyValueEditor label="机密" addLabel="添加机密" secret value={f.secrets} onChange={(v) => set('secrets', v)} />
      </FormField>
    </>
  )
}
