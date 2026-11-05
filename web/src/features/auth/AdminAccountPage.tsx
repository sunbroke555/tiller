import { useState, type FormEvent } from 'react'
import { ArrowLeft, LogOut } from 'lucide-react'
import { changeLocalPassword, logoutLocal } from '@/api/local-auth'
import { useSession } from '@/api/useSession'
import { AmbientBackground } from '@/components/AmbientBackground'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function AdminAccountPage() {
  const session = useSession()
  const [old, setOld] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (password !== confirm) { setError('两次输入的新密码不一致'); return }
    setBusy(true); setError('')
    try { await changeLocalPassword(old, password) } catch (e) { setError(e instanceof Error ? e.message : '修改失败') } finally { setBusy(false) }
  }
  return <div className="relative isolate min-h-dvh"><AmbientBackground /><main className="relative mx-auto max-w-xl px-5 py-8"><a href="/" className="mb-8 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" />返回概览</a><h1 className="mb-2 font-sans text-2xl font-semibold">管理员账户</h1><p className="mb-7 text-sm text-muted-foreground">当前用户：{session?.username}</p><GlassCard><h2 className="mb-2 font-sans font-semibold">修改密码</h2><p className="mb-6 text-sm text-muted-foreground">保存后所有设备会退出登录，需要使用新密码登录。</p><form className="grid gap-5" onSubmit={(e) => void submit(e)}>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="grid gap-2"><Label htmlFor="current-password">当前密码</Label><Input id="current-password" type="password" autoComplete="current-password" required value={old} onChange={(e) => setOld(e.target.value)} /></div><div className="grid gap-2"><Label htmlFor="new-password">新密码</Label><Input id="new-password" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} /><p className="text-xs text-muted-foreground">至少 12 个字符。</p></div><div className="grid gap-2"><Label htmlFor="confirm-password">确认新密码</Label><Input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div><Button disabled={busy}>保存新密码</Button></form></GlassCard><Button variant="outline" className="mt-6" onClick={() => void logoutLocal().catch((e: Error) => setError(e.message))}><LogOut />退出 Tiller</Button></main></div>
}
