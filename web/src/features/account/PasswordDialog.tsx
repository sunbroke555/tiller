import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { changePassword, needsPasswordConfirmation } from '@/api/shell'
import { FieldInput, FormDialog, FormField } from '@/components/form'

const MIN_LENGTH = 5

/** PUT /access/password for the logged-in user (pam / pve realms). */
export function PasswordDialog({ userid, open, onOpenChange }: { userid: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const confirm = needsPasswordConfirmation(userid)

  useEffect(() => {
    if (!open) {
      setCurrent('')
      setNext('')
      setRepeat('')
    }
  }, [open])

  const tooShort = next.length > 0 && next.length < MIN_LENGTH
  const mismatch = repeat.length > 0 && repeat !== next
  const invalid = !next || next.length < MIN_LENGTH || repeat !== next || (confirm && !current)

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="修改密码"
      description={userid}
      submitLabel="修改密码"
      submitDisabled={invalid}
      onSubmit={async () => {
        await changePassword(userid, next, confirm ? current : undefined)
        toast.success('密码已修改', { description: '当前登录不受影响，下次登录请使用新密码。' })
      }}
    >
      {/* Hidden user name helps password managers save the new password. */}
      <input type="text" name="username" autoComplete="username" value={userid} readOnly hidden />
      <div className="grid gap-4">
        {confirm && (
          <FormField label="当前密码" name="confirmation-password" required>
            <FieldInput type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </FormField>
        )}
        <FormField
          label="新密码"
          name="password"
          required
          hint={`至少 ${MIN_LENGTH} 个字符`}
          error={tooShort ? `至少 ${MIN_LENGTH} 个字符` : undefined}
        >
          <FieldInput type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </FormField>
        <FormField label="再次输入新密码" required error={mismatch ? '两次输入的密码不一致' : undefined}>
          <FieldInput type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </FormField>
      </div>
    </FormDialog>
  )
}
