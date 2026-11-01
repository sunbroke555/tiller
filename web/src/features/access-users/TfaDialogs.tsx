import { useEffect, useState } from 'react'
import { Fingerprint, KeyRound, LifeBuoy, Smartphone } from 'lucide-react'
import { toast } from 'sonner'

import { updateTfa, type TfaEntry, type TfaType } from '@/api/shell'
import { FieldInput, FormDialog, FormField, SwitchField } from '@/components/form'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { AddRecoveryDialog, AddTotpDialog, AddWebauthnDialog, AddYubicoDialog, useNeedsPassword } from '@/features/account/TfaDialogs'
import { cn } from '@/lib/utils'

import { tfaEditParams } from './model'
import { UserSelect } from './ui'

export type AddKind = Exclude<TfaType, 'u2f'>

export const ADD_KINDS: { kind: AddKind; label: string; hint: string; icon: typeof Smartphone }[] = [
  { kind: 'totp', label: '验证器（TOTP）', hint: '手机 App 生成的 6 位验证码', icon: Smartphone },
  { kind: 'webauthn', label: '安全密钥（WebAuthn）', hint: '需要在这台设备上按下密钥', icon: Fingerprint },
  { kind: 'recovery', label: '恢复码', hint: '每个用户只能有一组', icon: LifeBuoy },
  { kind: 'yubico', label: 'Yubico OTP', hint: '需要认证域配置 Yubico 服务器', icon: KeyRound },
]

/**
 * Add a second factor for any user (TfaView "Add" menu): pick the user (when
 * not fixed) and the type, then the same dialogs as the account page.
 */
export function TfaAddDialog({
  users,
  fixedUser,
  hasRecovery,
  open,
  onOpenChange,
  onDone,
}: {
  users: string[]
  fixedUser?: string
  /** Users that already have recovery keys. */
  hasRecovery: (userid: string) => boolean
  open: boolean
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const [userid, setUserid] = useState('')
  const [kind, setKind] = useState<AddKind | null>(null)
  useEffect(() => {
    if (open) setUserid(fixedUser ?? '')
  }, [open, fixedUser])

  const pick = (k: AddKind) => {
    setKind(k)
    onOpenChange(false)
  }
  const target = fixedUser ?? userid

  return (
    <>
      <ResponsiveDialog
        open={open}
        onOpenChange={onOpenChange}
        title="添加两步验证"
        description={fixedUser}
        footer={
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
        }
      >
        <div className="grid gap-4 pb-2">
          {!fixedUser && (
            <FormField label="用户" required>
              <UserSelect users={users} value={userid} onChange={setUserid} />
            </FormField>
          )}
          <div className="grid gap-2" role="group" aria-label="类型">
            {ADD_KINDS.map(({ kind: k, label, hint, icon: Icon }) => {
              const disabled = !target || (k === 'recovery' && hasRecovery(target))
              return (
                <button
                  key={k}
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(k)}
                  className={cn(
                    'flex min-h-14 items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 ring-border transition-colors ring-inset',
                    'hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-50 paper:hover:bg-secondary/60',
                  )}
                >
                  <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {k === 'recovery' && target && hasRecovery(target) ? '这个用户已经有恢复码' : hint}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </ResponsiveDialog>
      <AddTotpDialog userid={target} open={kind === 'totp'} onOpenChange={(o) => !o && setKind(null)} onDone={onDone} />
      <AddWebauthnDialog userid={target} open={kind === 'webauthn'} onOpenChange={(o) => !o && setKind(null)} onDone={onDone} />
      <AddRecoveryDialog userid={target} open={kind === 'recovery'} onOpenChange={(o) => !o && setKind(null)} onDone={onDone} />
      <AddYubicoDialog userid={target} open={kind === 'yubico'} onOpenChange={(o) => !o && setKind(null)} onDone={onDone} />
    </>
  )
}

/** Edit a TFA entry's description and enabled flag (Proxmox.window.TfaEdit). */
export function TfaEditDialog({
  userid,
  entry,
  open,
  onOpenChange,
  onDone,
}: {
  userid: string
  entry: TfaEntry | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const needsPassword = useNeedsPassword(userid)
  const [description, setDescription] = useState('')
  const [enable, setEnable] = useState(true)
  const [password, setPassword] = useState('')
  useEffect(() => {
    if (open && entry) {
      setDescription(entry.description ?? '')
      setEnable(entry.enable !== 0)
      setPassword('')
    }
  }, [open, entry])

  const before = { description: entry?.description ?? '', enable: entry?.enable !== 0 }
  const params = tfaEditParams(before, { description, enable }, password || undefined)

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="编辑两步验证"
      description={userid}
      submitDisabled={!entry || !params || !description.trim() || (needsPassword && !password)}
      onSubmit={async () => {
        if (!entry || !params) return
        await updateTfa(userid, entry.id, {
          description: params.description as string | undefined,
          enable: params.enable === undefined ? undefined : params.enable === 1,
          password: password || undefined,
        })
        toast.success('已保存')
        onDone()
      }}
    >
      <FormField label="说明" name="description" required>
        <FieldInput value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} />
      </FormField>
      <SwitchField label="启用" description="停用后登录时不会再要求这个因素" checked={enable} onCheckedChange={setEnable} />
      {needsPassword && (
        <FormField label="你的当前密码" name="password" required>
          <FieldInput type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
      )}
    </FormDialog>
  )
}
