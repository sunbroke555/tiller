import { useEffect, useId, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from 'lucide-react'

import { completeTfa, login, type PendingTfa, type TfaMethod } from '@/api/auth'
import { useDomains } from '@/api/queries'
import { getLogoutReason } from '@/api/session'
import { useSession } from '@/api/useSession'
import { AmbientBackground } from '@/components/AmbientBackground'
import { GlassCard } from '@/components/GlassCard'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { errorMessage } from '@/lib/errors'

import { ThemeQuickSwitch } from './ThemeQuickSwitch'

const LAST_LOGIN_KEY = 'pve-web:last-login'

function loadLastLogin(): { username: string; realm: string } {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_LOGIN_KEY) ?? 'null') as { username?: unknown; realm?: unknown } | null
    return {
      username: typeof v?.username === 'string' ? v.username : '',
      realm: typeof v?.realm === 'string' ? v.realm : '',
    }
  } catch {
    return { username: '', realm: '' }
  }
}

function saveLastLogin(username: string, realm: string) {
  try {
    localStorage.setItem(LAST_LOGIN_KEY, JSON.stringify({ username, realm }))
  } catch {
    // ignore
  }
}

/** Only allow in-app redirects after login. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

const REASON_TEXT = {
  expired: '登录已过期，请重新登录',
  unauthorized: '登录状态已失效，请重新登录',
} as const

export function LoginPage() {
  const session = useSession()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = safeNext(params.get('next'))
  const [pending, setPending] = useState<PendingTfa | null>(null)
  const [notice] = useState(() => {
    const r = getLogoutReason()
    return r === 'expired' || r === 'unauthorized' ? REASON_TEXT[r] : null
  })

  if (session) return <Navigate to={next} replace />

  const done = () => navigate(next, { replace: true })

  return (
    <div className="relative flex min-h-dvh flex-col">
      <AmbientBackground />
      <div className="relative z-10 flex justify-end p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <ThemeQuickSwitch />
      </div>
      <main className="relative z-10 flex flex-1 items-start justify-center px-4 pt-[6vh] pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex flex-col items-center gap-4 text-center">
            <Logo className="size-14 rounded-2xl" />
            <div>
              <h1 className="text-2xl font-semibold paper:text-3xl">PVE Web</h1>
              <p className="mt-1 text-sm text-muted-foreground">登录 Proxmox VE</p>
            </div>
          </div>
          <GlassCard strong className="p-6 sm:p-7">
            {pending ? (
              <TfaForm pending={pending} onBack={() => setPending(null)} onDone={done} />
            ) : (
              <PasswordForm notice={notice} onTfa={setPending} onDone={done} />
            )}
          </GlassCard>
        </div>
      </main>
    </div>
  )
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive ring-1 ring-destructive/20 ring-inset">
      {message}
    </p>
  )
}

function PasswordForm({
  notice,
  onTfa,
  onDone,
}: {
  notice: string | null
  onTfa: (p: PendingTfa) => void
  onDone: () => void
}) {
  const last = loadLastLogin()
  const [username, setUsername] = useState(last.username)
  const [password, setPassword] = useState('')
  const [realm, setRealm] = useState(last.realm)
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const domains = useDomains()
  const ids = { user: useId(), pass: useId(), realm: useId() }

  // Default realm: last used, else the server default, else pam.
  useEffect(() => {
    if (realm || !domains.data) return
    const preferred = domains.data.find((d) => d.default === 1) ?? domains.data.find((d) => d.realm === 'pam') ?? domains.data[0]
    if (preferred) setRealm(preferred.realm)
  }, [domains.data, realm])

  const realms = domains.data ?? (realm ? [{ realm, type: realm, comment: '' }] : [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('请输入用户名和密码')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const effectiveRealm = realm || 'pam'
      const result = await login({ username, password, realm: effectiveRealm })
      saveLastLogin(username.trim(), effectiveRealm)
      if (result.kind === 'tfa') onTfa(result.pending)
      else onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      {notice && !error && (
        <p className="rounded-xl bg-warning/10 px-3 py-2.5 text-sm text-warning ring-1 ring-warning/20 ring-inset">{notice}</p>
      )}
      <FormError message={error} />
      <div className="grid gap-2">
        <Label htmlFor={ids.user}>用户名</Label>
        <Input
          id={ids.user}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="root"
          autoFocus={!username}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={ids.pass}>密码</Label>
        <div className="relative">
          <Input
            id={ids.pass}
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="pr-11"
            autoFocus={!!username}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
            className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={ids.realm}>认证域</Label>
        <Select value={realm} onValueChange={setRealm} disabled={!domains.data && domains.isPending}>
          <SelectTrigger id={ids.realm} className="w-full">
            <SelectValue placeholder={domains.isPending ? '加载中…' : '选择认证域'} />
          </SelectTrigger>
          <SelectContent>
            {realms.map((d) => (
              <SelectItem key={d.realm} value={d.realm}>
                <span>{d.comment || d.realm}</span>
                <span className="text-xs text-muted-foreground">@{d.realm}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {domains.isError && <p className="text-xs text-muted-foreground">无法读取认证域列表，默认使用 pam</p>}
      </div>
      <Button type="submit" size="lg" className="mt-1 w-full" disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        登录
      </Button>
    </form>
  )
}

function TfaForm({ pending, onBack, onDone }: { pending: PendingTfa; onBack: () => void; onDone: () => void }) {
  const { challenge } = pending
  const methods: TfaMethod[] = []
  if (challenge.totp) methods.push('totp')
  if (challenge.yubico) methods.push('yubico')
  if (challenge.recovery !== null) methods.push('recovery')
  const [method, setMethod] = useState<TfaMethod>(methods[0] ?? 'totp')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()

  async function submit(value: string) {
    if (!value.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await completeTfa(pending, method, value)
      onDone()
    } catch (err) {
      setError(errorMessage(err))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const onlyWebauthn = methods.length === 0 && (challenge.webauthn || challenge.u2f)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit(code)
      }}
      className="grid gap-5"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/12 text-brand paper:bg-secondary paper:text-foreground">
          <ShieldCheck className="size-5" />
        </span>
        <div>
          <h2 className="text-lg font-semibold">两步验证</h2>
          <p className="text-sm text-muted-foreground">{pending.username}</p>
        </div>
      </div>

      {methods.length > 1 && (
        <Tabs value={method} onValueChange={(v) => { setMethod(v as TfaMethod); setCode(''); setError(null) }}>
          <TabsList className="w-full">
            {methods.map((m) => (
              <TabsTrigger key={m} value={m}>
                {METHOD_LABEL[m]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <FormError message={error} />

      {onlyWebauthn ? (
        <p className="text-sm text-muted-foreground">
          该账户只配置了 WebAuthn / U2F 安全密钥，本界面暂不支持，请使用官方界面登录或为账户添加 TOTP。
        </p>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor={inputId}>{METHOD_PROMPT[method]}</Label>
          <Input
            id={inputId}
            value={code}
            onChange={(e) => {
              const v = method === 'totp' ? e.target.value.replace(/\D/g, '').slice(0, 8) : e.target.value
              setCode(v)
              // Most authenticators use 6 digits: submit as soon as it is complete.
              if (method === 'totp' && v.length === 6) void submit(v)
            }}
            inputMode={method === 'totp' ? 'numeric' : 'text'}
            autoComplete={method === 'totp' ? 'one-time-code' : 'off'}
            autoCapitalize="none"
            spellCheck={false}
            className={method === 'totp' ? 'text-center text-lg tracking-[0.4em] tabular' : 'tabular'}
            placeholder={method === 'totp' ? '000000' : method === 'recovery' ? 'xxxx-xxxx-xxxx-xxxx' : ''}
            autoFocus
          />
          {method === 'recovery' && challenge.recovery && (
            <p className="text-xs text-muted-foreground">
              {challenge.recovery.length > 0
                ? `可用的恢复码编号：${challenge.recovery.join('、')}`
                : '没有剩余的恢复码'}
            </p>
          )}
          {(challenge.webauthn || challenge.u2f) && (
            <p className="text-xs text-muted-foreground">安全密钥（WebAuthn）登录暂不支持。</p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="lg" onClick={onBack} disabled={busy}>
          <ArrowLeft /> 返回
        </Button>
        {!onlyWebauthn && (
          <Button type="submit" size="lg" className="flex-1" disabled={busy || !code.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
            验证
          </Button>
        )}
      </div>
    </form>
  )
}

const METHOD_LABEL: Record<TfaMethod, string> = {
  totp: '验证器',
  yubico: 'Yubico OTP',
  recovery: '恢复码',
}

const METHOD_PROMPT: Record<TfaMethod, string> = {
  totp: '输入验证器 App 中的 6 位验证码',
  yubico: '按下 YubiKey 输入 OTP',
  recovery: '输入一个恢复码',
}
