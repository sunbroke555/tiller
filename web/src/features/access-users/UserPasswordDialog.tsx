import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { setUserPassword } from '@/api/access-users'
import { FieldInput, FormDialog, FormField } from '@/components/form'

import { USER_PASSWORD_MIN } from './model'
import { useAccess } from './useAccess'

/** Set another user's password (Proxmox.window.PasswordEdit as opened from the users list). */
export function UserPasswordDialog({
  userid,
  realmType,
  open,
  onOpenChange,
}: {
  userid: string
  realmType: string | undefined
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { self, confirmPassword } = useAccess()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  useEffect(() => {
    if (!open) {
      setCurrent('')
      setNext('')
      setRepeat('')
    }
  }, [open])

  const tooShort = next.length > 0 && next.length < USER_PASSWORD_MIN
  const mismatch = repeat.length > 0 && repeat !== next
  const invalid = next.length < USER_PASSWORD_MIN || repeat !== next || (confirmPassword && !current)

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="设置密码"
      description={userid}
      submitLabel="设置密码"
      submitDisabled={invalid}
      onSubmit={async () => {
        await setUserPassword(userid, next, confirmPassword ? current : undefined)
        toast.success(`已修改 ${userid} 的密码`)
      }}
    >
      <input type="text" name="username" autoComplete="username" value={userid} readOnly hidden />
      {confirmPassword && (
        <FormField label="你的当前密码" name="confirmation-password" required hint={`以 ${self} 的身份确认这次修改`}>
          <FieldInput type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </FormField>
      )}
      <FormField label="新密码" name="password" required hint={`至少 ${USER_PASSWORD_MIN} 个字符`} error={tooShort ? `至少 ${USER_PASSWORD_MIN} 个字符` : undefined}>
        <FieldInput type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </FormField>
      <FormField label="再次输入新密码" required error={mismatch ? '两次输入的密码不一致' : undefined}>
        <FieldInput type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </FormField>
      {realmType === 'pam' && <p className="text-xs text-muted-foreground">PAM 认证域：只修改当前连接节点上的系统密码。</p>}
    </FormDialog>
  )
}
