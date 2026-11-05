import { useState, type FormEvent } from 'react'
import { ArrowRight, BookOpen, Eye, EyeOff, Loader2, LockKeyhole } from 'lucide-react'
import { loginLocal, type AuthState } from '@/api/local-auth'
import { AmbientBackground } from '@/components/AmbientBackground'
import { GlassCard } from '@/components/GlassCard'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ThemeQuickSwitch } from './ThemeQuickSwitch'

export function LocalLoginPage({ setup, onSuccess }: { setup: boolean; onSuccess: (state: AuthState) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (setup && password !== confirm) { setError('两次输入的密码不一致'); return }
    setBusy(true); setError('')
    try { onSuccess(await loginLocal(username.trim(), password, setup)) }
    catch (e) { setError(e instanceof Error ? e.message : '登录失败') }
    finally { setBusy(false) }
  }
  return <div className="relative isolate flex min-h-dvh flex-col">
    <AmbientBackground />
    <header className="relative mx-auto flex w-full max-w-7xl items-center justify-between px-6 pt-6 sm:px-10 sm:pt-8">
      <div className="flex items-center gap-3"><Logo className="size-10" /><span className="text-xl font-semibold">Tiller</span></div><ThemeQuickSwitch />
    </header>
    <main className="relative flex flex-1 items-center justify-center px-5 py-10 sm:py-14">
      <div className="w-full max-w-[440px]">
        <GlassCard strong className="overflow-hidden rounded-3xl p-0">
          <div className="h-1 bg-brand/70" aria-hidden />
          <div className="p-6 sm:p-9">
            <h1 className="font-sans text-2xl font-semibold">{setup ? '设置管理员' : '登录 Tiller'}</h1>
            <p className="mt-2 mb-8 text-sm leading-relaxed text-muted-foreground">{setup ? '创建你的 Tiller 账户，开始管理所有 PVE。' : '一个账户，管理所有实例。'}</p>
            <form onSubmit={(e) => void submit(e)} className="grid gap-5">
              {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
              <div className="grid gap-2"><Label htmlFor="admin-username">{setup ? '管理员用户名' : '用户名'}</Label><Input id="admin-username" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus maxLength={40} value={username} onChange={(e) => setUsername(e.target.value)} className="h-12 rounded-xl pointer-coarse:h-12" />{setup && <p className="text-xs text-muted-foreground">3 到 40 位字母、数字、下划线、点或短横线。</p>}</div>
              <div className="grid gap-2"><Label htmlFor="admin-password">密码</Label><div className="relative"><Input id="admin-password" type={visible ? 'text' : 'password'} autoComplete={setup ? 'new-password' : 'current-password'} required minLength={setup ? 12 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 rounded-xl pr-12 pointer-coarse:h-12" /><Button type="button" variant="ghost" size="icon" className="absolute top-1 right-1" aria-label={visible ? '隐藏密码' : '显示密码'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff /> : <Eye />}</Button></div>{setup && <p className="text-xs text-muted-foreground">至少 12 个字符，可使用一段容易记住的长密码。</p>}</div>
              {setup && <div className="grid gap-2"><Label htmlFor="admin-confirm">确认密码</Label><Input id="admin-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-12 rounded-xl pointer-coarse:h-12" /></div>}
              <Button className="mt-1 h-12 rounded-xl pointer-coarse:h-12" disabled={busy || !username.trim() || !password}>{busy ? <Loader2 className="animate-spin" /> : null}{setup ? '创建管理员' : '登录'}<ArrowRight /></Button>
            </form>
          </div>
          <div className="flex gap-2.5 border-t border-border bg-foreground/[0.02] px-6 py-4 text-xs leading-relaxed text-muted-foreground sm:px-9"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" /><p>{setup ? '此账户用于登录 Tiller，PVE 连接稍后单独添加。' : '使用你设置的 Tiller 管理员账户登录。'}</p></div>
        </GlassCard>
        <div className="mt-4 flex justify-center"><Button asChild variant="ghost" size="sm" className="text-muted-foreground"><a href="/docs/" target="_blank" rel="noopener noreferrer"><BookOpen />使用文档</a></Button></div>
      </div>
    </main>
  </div>
}
