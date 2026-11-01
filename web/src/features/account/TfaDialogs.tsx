import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Download, KeyRound } from 'lucide-react'
import { toast } from 'sonner'

import { addTfa, deleteTfa, needsPasswordConfirmation, updateTfa, type TfaEntry } from '@/api/shell'
import { FieldInput, FormDialog, FormField } from '@/components/form'
import { QrCode } from '@/components/QrCode'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { groupSecret, randomTotpSecret, totpUri } from '@/lib/totp'
import { attestationToPve, registrationOptions, webauthnErrorMessage, webauthnSupport } from '@/lib/webauthn'

interface Common {
  userid: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onDone: () => void
}

function PasswordField({ userid, value, onChange }: { userid: string; value: string; onChange: (v: string) => void }) {
  if (!needsPasswordConfirmation(userid)) return null
  return (
    <FormField label="当前密码" name="password" required hint="确认是你本人在修改两步验证">
      <FieldInput type="password" autoComplete="current-password" value={value} onChange={(e) => onChange(e.target.value)} />
    </FormField>
  )
}

function useReset(open: boolean, reset: () => void) {
  useEffect(() => {
    if (open) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}

export function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true)
            setTimeout(() => setDone(false), 1500)
          },
          () => toast.error('无法访问剪贴板'),
        )
      }
    >
      {done ? <Check /> : <Copy />} {done ? '已复制' : label}
    </Button>
  )
}

// ------------------------------------------------------------------ TOTP

export function AddTotpDialog({ userid, open, onOpenChange, onDone }: Common) {
  const [secret, setSecret] = useState('')
  const [description, setDescription] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  useReset(open, () => {
    setSecret(randomTotpSecret())
    setDescription('验证器 App')
    setCode('')
    setPassword('')
  })
  const issuer = `Proxmox - ${typeof window !== 'undefined' ? window.location.hostname : 'pve'}`
  const uri = useMemo(() => (secret ? totpUri({ issuer, account: userid, secret }) : ''), [issuer, userid, secret])

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="添加验证器（TOTP）"
      description="用 Google Authenticator、Microsoft Authenticator、1Password 等 App 扫码"
      submitLabel="验证并添加"
      submitDisabled={code.length < 6 || !description.trim() || (needsPasswordConfirmation(userid) && !password)}
      onSubmit={async () => {
        await addTfa(userid, { type: 'totp', description: description.trim(), totp: uri, value: code, password: password || undefined })
        toast.success('已添加验证器')
        onDone()
      }}
    >
      <div className="grid gap-4">
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          {uri && <QrCode value={uri} label="TOTP 二维码" className="size-44 shrink-0" />}
          <div className="grid w-full min-w-0 gap-2 text-sm">
            <p className="text-muted-foreground">无法扫码时，在 App 中手动输入密钥：</p>
            <code data-testid="totp-secret" className="rounded-lg bg-foreground/[0.05] px-3 py-2 font-mono text-[13px] tracking-wide break-all select-all paper:bg-secondary">
              {groupSecret(secret)}
            </code>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={secret} label="复制密钥" />
              <Button type="button" variant="ghost" size="sm" onClick={() => setSecret(randomTotpSecret())} className="pointer-coarse:h-11">
                换一个密钥
              </Button>
            </div>
          </div>
        </div>
        <FormField label="说明" name="description" required>
          <FieldInput value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} />
        </FormField>
        <FormField label="App 显示的验证码" name="value" required>
          <FieldInput
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            className="tracking-[0.3em] tabular"
          />
        </FormField>
        <PasswordField userid={userid} value={password} onChange={setPassword} />
      </div>
    </FormDialog>
  )
}

// -------------------------------------------------------------- recovery

export function AddRecoveryDialog({ userid, open, onOpenChange, onDone }: Common) {
  const [password, setPassword] = useState('')
  const [keys, setKeys] = useState<string[] | null>(null)
  useReset(open, () => {
    setPassword('')
    setKeys(null)
  })

  if (keys) {
    const text = keys.map((k, i) => `${i}: ${k}`).join('\n')
    return (
      <ResponsiveDialog
        open={open}
        onOpenChange={onOpenChange}
        title="保存你的恢复码"
        description="每个恢复码只能用一次。它们只显示这一次，请现在保存到安全的地方。"
        footer={
          <Button className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
            我已保存
          </Button>
        }
      >
        <ol data-testid="recovery-keys" className="grid gap-1.5 rounded-xl bg-foreground/[0.04] p-3.5 font-mono text-sm ring-1 ring-border ring-inset sm:grid-cols-2 paper:bg-secondary/60">
          {keys.map((k, i) => (
            <li key={k} className="flex gap-2">
              <span className="w-5 text-right text-muted-foreground tabular">{i}</span>
              <span className="select-all">{k}</span>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap gap-2">
          <CopyButton text={text} label="复制全部" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([`${userid} 的 Proxmox VE 恢复码\n\n${text}\n`], { type: 'text/plain' }))
              const a = document.createElement('a')
              a.href = url
              a.download = `pve-recovery-${userid.replace(/[^\w.-]/g, '_')}.txt`
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            <Download /> 下载
          </Button>
        </div>
      </ResponsiveDialog>
    )
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="生成恢复码"
      description="手机或安全密钥丢失时，可以用恢复码登录。每个账户只能有一组恢复码。"
      submitLabel="生成"
      closeOnSuccess={false}
      submitDisabled={needsPasswordConfirmation(userid) && !password}
      onSubmit={async () => {
        const res = await addTfa(userid, { type: 'recovery', password: password || undefined })
        setKeys(res?.recovery ?? [])
        onDone()
      }}
    >
      <PasswordField userid={userid} value={password} onChange={setPassword} />
      {!needsPasswordConfirmation(userid) && <p className="text-sm text-muted-foreground">将生成一组新的恢复码。</p>}
    </FormDialog>
  )
}

// -------------------------------------------------------------- WebAuthn

export function AddWebauthnDialog({ userid, open, onOpenChange, onDone }: Common) {
  const [description, setDescription] = useState('')
  const [password, setPassword] = useState('')
  const [waiting, setWaiting] = useState(false)
  useReset(open, () => {
    setDescription('安全密钥')
    setPassword('')
    setWaiting(false)
  })
  const support = webauthnSupport()

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="添加安全密钥（WebAuthn）"
      description="YubiKey、手机或电脑自带的通行密钥"
      submitLabel={waiting ? '请按下安全密钥…' : '注册'}
      submitDisabled={support !== 'ok' || !description.trim() || (needsPasswordConfirmation(userid) && !password)}
      onSubmit={async () => {
        const step1 = await addTfa(userid, { type: 'webauthn', description: description.trim(), password: password || undefined })
        if (!step1?.challenge) throw new Error('PVE 没有返回 WebAuthn challenge，请检查数据中心 WebAuthn 设置')
        const { options, challenge } = registrationOptions(step1.challenge)
        let cred: PublicKeyCredential
        setWaiting(true)
        try {
          cred = (await navigator.credentials.create(options)) as PublicKeyCredential
        } catch (e) {
          throw new Error(webauthnErrorMessage(e))
        } finally {
          setWaiting(false)
        }
        await addTfa(userid, {
          type: 'webauthn',
          challenge,
          value: attestationToPve(cred as unknown as Parameters<typeof attestationToPve>[0]),
          password: password || undefined,
        })
        toast.success('已添加安全密钥')
        onDone()
      }}
    >
      <div className="grid gap-4">
        {support !== 'ok' && (
          <p className="rounded-xl bg-warning/10 px-3 py-2.5 text-sm text-warning-strong ring-1 ring-warning/20 ring-inset">
            {support === 'insecure'
              ? '安全密钥只能在 HTTPS（或 localhost）下使用。请用 HTTPS 访问 PVE Web 后再添加。'
              : '这个浏览器不支持 WebAuthn。'}
          </p>
        )}
        <FormField label="说明" name="description" required>
          <FieldInput value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} />
        </FormField>
        <PasswordField userid={userid} value={password} onChange={setPassword} />
        <p className="text-xs text-muted-foreground">
          需要先在数据中心选项中配置 WebAuthn（ID 与 Origin 要和当前访问的网址一致）。
        </p>
      </div>
    </FormDialog>
  )
}

// ---------------------------------------------------------------- Yubico

export function AddYubicoDialog({ userid, open, onOpenChange, onDone }: Common) {
  const [description, setDescription] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  useReset(open, () => {
    setDescription('YubiKey')
    setOtp('')
    setPassword('')
  })
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="添加 Yubico OTP"
      description="需要认证域配置了 Yubico 服务器"
      submitLabel="添加"
      submitDisabled={otp.length < 12 || !description.trim() || (needsPasswordConfirmation(userid) && !password)}
      onSubmit={async () => {
        await addTfa(userid, { type: 'yubico', description: description.trim(), value: otp.trim(), password: password || undefined })
        toast.success('已添加 YubiKey')
        onDone()
      }}
    >
      <div className="grid gap-4">
        <FormField label="说明" name="description" required>
          <FieldInput value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} />
        </FormField>
        <FormField label="OTP" name="value" required hint="光标放在这里，按一下 YubiKey">
          <FieldInput value={otp} onChange={(e) => setOtp(e.target.value)} autoComplete="off" spellCheck={false} />
        </FormField>
        <PasswordField userid={userid} value={password} onChange={setPassword} />
      </div>
    </FormDialog>
  )
}

// --------------------------------------------- toggle / delete (password)

export function ChangeTfaDialog({
  userid,
  entry,
  mode,
  open,
  onOpenChange,
  onDone,
}: Common & { entry: TfaEntry | null; mode: 'delete' | 'enable' | 'disable' }) {
  const [password, setPassword] = useState('')
  useReset(open, () => setPassword(''))
  const label = entry?.description || entry?.type || ''
  const title = mode === 'delete' ? `删除“${label}”？` : mode === 'enable' ? `启用“${label}”？` : `停用“${label}”？`
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        mode === 'delete'
          ? '删除后不能再用它登录。如果这是唯一的第二因素，账户将只需要密码。'
          : mode === 'disable'
            ? '停用后登录时不会再要求这个因素。'
            : undefined
      }
      destructive={mode !== 'enable'}
      submitLabel={mode === 'delete' ? '删除' : mode === 'enable' ? '启用' : '停用'}
      submitDisabled={!entry || (needsPasswordConfirmation(userid) && !password)}
      onSubmit={async () => {
        if (!entry) return
        if (mode === 'delete') await deleteTfa(userid, entry.id, password || undefined)
        else await updateTfa(userid, entry.id, { enable: mode === 'enable', password: password || undefined })
        onDone()
      }}
    >
      {needsPasswordConfirmation(userid) ? (
        <PasswordField userid={userid} value={password} onChange={setPassword} />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <KeyRound className="size-4" /> {label}
        </p>
      )}
    </FormDialog>
  )
}
