import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { accessKeys, createToken, updateToken, useUsers, type TokenSecret } from '@/api/access-users'
import { FieldInput, FormDialog, FormField, FormRow, SwitchField } from '@/components/form'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/features/account/TfaDialogs'

import {
  createTokenParams,
  emptyTokenForm,
  tokenFormFrom,
  tokenIdError,
  updateTokenParams,
  type TokenForm,
  type TokenRow,
} from './model'
import { ExpireField, UserSelect } from './ui'
import { useAccess } from './useAccess'

/** Add (token null) or edit an API token (PVE.dc.TokenEdit). */
export function TokenEditDialog({
  token,
  userid,
  open,
  onOpenChange,
  onSecret,
}: {
  token: TokenRow | null
  /** Owner preset for a new token (the user page); otherwise the logged-in user. */
  userid?: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onSecret: (s: TokenSecret) => void
}) {
  const create = token === null
  const { self, userModify } = useAccess()
  const queryClient = useQueryClient()
  // Only admins may pick another owner.
  const users = useUsers()
  const [form, setForm] = useState<TokenForm>(emptyTokenForm(''))
  const [initial, setInitial] = useState<TokenForm | null>(null)

  useEffect(() => {
    if (!open) return
    const f = token ? tokenFormFrom(token) : emptyTokenForm(userid ?? self)
    setForm(f)
    setInitial(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = <K extends keyof TokenForm>(k: K, v: TokenForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const idErr = tokenIdError(form.tokenid)
  const changes = !create && initial ? updateTokenParams(initial, form) : null
  const ready = create ? !!form.userid && form.tokenid.length >= 2 && !idErr : changes !== null
  const owners = userModify ? (users.data ?? []).map((u) => u.userid).sort() : [self]

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={token ? `编辑令牌 ${token.id}` : '新建 API 令牌'}
      submitLabel={create ? '创建' : '保存'}
      submitDisabled={!ready}
      onSubmit={async () => {
        if (!token) {
          const res = await createToken(form.userid, form.tokenid, createTokenParams(form))
          onSecret(res)
        } else if (changes) {
          await updateToken(token.userid, token.tokenid, changes)
          toast.success('已保存')
        }
        void queryClient.invalidateQueries({ queryKey: accessKeys.all() })
      }}
    >
      {create && (
        <FormRow>
          <FormField label="用户" name="userid" required>
            {userModify && !userid ? (
              <UserSelect users={owners} value={form.userid} onChange={(v) => set('userid', v)} loading={users.isPending} />
            ) : (
              <FieldInput value={form.userid} readOnly disabled />
            )}
          </FormField>
          <FormField label="令牌 ID" name="tokenid" required error={idErr} hint="以字母开头，至少 2 个字符">
            <FieldInput
              value={form.tokenid}
              onChange={(e) => set('tokenid', e.target.value.trim())}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
          </FormField>
        </FormRow>
      )}
      <SwitchField
        label="权限分离"
        description={form.privsep ? '令牌只拥有单独授予它的权限（推荐）' : '令牌拥有所属用户的全部权限'}
        checked={form.privsep}
        onCheckedChange={(v) => set('privsep', v)}
      />
      <FormField label="过期时间" name="expire" hint="留空表示永不过期；用户过期时令牌也会失效">
        <ExpireField value={form.expire} onChange={(v) => set('expire', v)} />
      </FormField>
      <FormField label="备注" name="comment">
        <FieldInput value={form.comment} onChange={(e) => set('comment', e.target.value)} />
      </FormField>
    </FormDialog>
  )
}

/** The token secret, shown exactly once after creating or regenerating (PVE.dc.TokenShow). */
export function TokenSecretDialog({ secret, open, onOpenChange }: { secret: TokenSecret | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="令牌密钥"
      description="密钥只显示这一次，关闭后无法再查看。请现在复制并妥善保存。"
      footer={
        <Button className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
          我已保存
        </Button>
      }
    >
      {secret && (
        <div className="grid gap-4 pb-2">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">令牌 ID</span>
            <code data-testid="token-id" className="rounded-lg bg-foreground/[0.05] px-3 py-2 font-mono text-[13px] break-all select-all paper:bg-secondary">
              {secret['full-tokenid']}
            </code>
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">密钥</span>
            <code data-testid="token-secret" className="rounded-lg bg-foreground/[0.05] px-3 py-2 font-mono text-[13px] break-all select-all paper:bg-secondary">
              {secret.value}
            </code>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={secret.value} label="复制密钥" />
            <CopyButton text={`PVEAPIToken=${secret['full-tokenid']}=${secret.value}`} label="复制 Authorization 头" />
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning-strong" aria-hidden />
            使用方式：请求头 Authorization: PVEAPIToken=&lt;令牌 ID&gt;=&lt;密钥&gt;
          </p>
        </div>
      )}
    </ResponsiveDialog>
  )
}
