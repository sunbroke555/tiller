import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { accessKeys, createUser, updateUser, useGroups, useRealms, useUser } from '@/api/access-users'
import { FieldInput, FormDialog, FormField, FormRow, FormSection, SelectField, SwitchField } from '@/components/form'
import { Skeleton } from '@/components/ui/skeleton'

import {
  USER_PASSWORD_MIN,
  createUserParams,
  emptyUserForm,
  isTfaMarker,
  updateUserParams,
  userFormFromConfig,
  userFormReady,
  validateUserForm,
  type UserForm,
} from './model'
import { ChipPicker, ExpireField } from './ui'

/** Create (userid null) or edit a user: PVE.dc.UserEdit. */
export function UserEditDialog({
  userid,
  open,
  onOpenChange,
  onCreated,
}: {
  userid: string | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated?: (userid: string) => void
}) {
  const create = userid === null
  const queryClient = useQueryClient()
  const config = useUser(open && userid ? userid : undefined)
  const realms = useRealms()
  const groups = useGroups(open)
  const [form, setForm] = useState<UserForm>(emptyUserForm())
  const [initial, setInitial] = useState<UserForm | null>(null)

  // Fill the form once per opening (create: defaults; edit: when the config has loaded).
  useEffect(() => {
    if (!open) {
      setInitial(null)
      return
    }
    if (initial) return
    if (create) {
      const f = emptyUserForm()
      setForm(f)
      setInitial(f)
    } else if (config.data) {
      const f = userFormFromConfig(userid!, config.data)
      setForm(f)
      setInitial(f)
    }
  }, [open, create, userid, config.data, initial])

  const set = <K extends keyof UserForm>(k: K, v: UserForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const errors = validateUserForm(form, create)
  const changes = !create && initial ? updateUserParams(initial, form) : null
  const ready = initial !== null && userFormReady(form, create) && (create || changes !== null)
  const realmOptions = (realms.data ?? [])
    .map((r) => ({ value: r.realm, label: r.realm, description: r.comment || r.type }))
    .sort((a, b) => (a.value === 'pve' ? -1 : b.value === 'pve' ? 1 : a.value.localeCompare(b.value)))
  const groupIds = (groups.data ?? []).map((g) => g.groupid).sort()
  const keysLocked = !create && isTfaMarker(config.data?.keys)

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={create ? '新建用户' : `编辑用户 ${userid}`}
      size="lg"
      submitLabel={create ? '创建' : '保存'}
      submitDisabled={!ready}
      onSubmit={async () => {
        if (create) {
          const params = createUserParams(form)
          await createUser(params)
          toast.success(`已创建用户 ${String(params.userid)}`)
          onCreated?.(String(params.userid))
        } else if (changes) {
          await updateUser(userid!, changes)
          toast.success('已保存')
        }
        void queryClient.invalidateQueries({ queryKey: accessKeys.all() })
      }}
    >
      {!create && !initial ? (
        <div className="grid gap-4" aria-busy="true">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : (
        <>
          {create && (
            <FormRow>
              <FormField label="用户名" name="userid" required error={errors.userid}>
                <FieldInput
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                />
              </FormField>
              <FormField label="认证域" name="realm" required>
                <SelectField value={form.realm} onValueChange={(v) => set('realm', v ?? 'pve')} options={realmOptions} loading={realms.isPending} />
              </FormField>
            </FormRow>
          )}
          {create && form.realm === 'pve' && (
            <FormRow>
              <FormField label="密码" name="password" required hint={`至少 ${USER_PASSWORD_MIN} 个字符`} error={errors.password}>
                <FieldInput type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} />
              </FormField>
              <FormField label="确认密码" required error={errors.confirm}>
                <FieldInput type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} />
              </FormField>
            </FormRow>
          )}
          {create && form.realm && form.realm !== 'pve' && (
            <p className="text-sm text-muted-foreground">
              {form.realm} 认证域的密码由外部系统（PAM、LDAP、AD 或 OpenID）管理，这里只登记用户。
            </p>
          )}

          <FormRow>
            <FormField label="名">
              <FieldInput value={form.firstname} onChange={(e) => set('firstname', e.target.value)} />
            </FormField>
            <FormField label="姓">
              <FieldInput value={form.lastname} onChange={(e) => set('lastname', e.target.value)} />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="邮箱" name="email" error={errors.email}>
              <FieldInput type="email" inputMode="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </FormField>
            <FormField label="过期时间" name="expire" hint="留空表示永不过期">
              <ExpireField value={form.expire} onChange={(v) => set('expire', v)} />
            </FormField>
          </FormRow>
          <FormField label="组" name="groups">
            <ChipPicker
              label="组"
              options={[...new Set([...groupIds, ...form.groups])].sort()}
              value={form.groups}
              onChange={(v) => set('groups', v)}
              empty={groups.isPending ? '正在读取组…' : '还没有组'}
            />
          </FormField>
          <FormField label="备注" name="comment">
            <FieldInput value={form.comment} onChange={(e) => set('comment', e.target.value)} />
          </FormField>
          <SwitchField label="启用" description="停用后这个用户（及其 API 令牌）不能登录" checked={form.enable} onCheckedChange={(v) => set('enable', v)} />
          <FormSection title="高级选项" collapsible>
            <FormField
              label="Key IDs"
              name="keys"
              error={errors.keys}
              hint={keysLocked ? '这个用户使用新的两步验证（在“两步验证”中管理），不能再设置旧的 Yubico Key ID。' : '旧版 Yubico OTP 的 Key ID，多个用逗号分隔。'}
            >
              <FieldInput value={form.keys} onChange={(e) => set('keys', e.target.value)} disabled={keysLocked} spellCheck={false} />
            </FormField>
          </FormSection>
        </>
      )}
    </FormDialog>
  )
}
