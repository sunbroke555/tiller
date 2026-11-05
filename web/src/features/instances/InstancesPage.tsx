import { useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Pencil, Plus, Server, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { getInstanceScope } from '@/api/instance-scope'
import { deleteInstance, instancesKey, instanceUrl, saveInstance, useInstances, type PveInstance } from '@/api/instances'
import { AmbientBackground } from '@/components/AmbientBackground'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { GlassCard } from '@/components/GlassCard'
import { Logo } from '@/components/Logo'
import { FieldInput, FormDialog, FormField, SelectField, SwitchField } from '@/components/form'
import { Button } from '@/components/ui/button'
import { ThemeQuickSwitch } from '@/features/auth/ThemeQuickSwitch'

export default function InstancesPage() {
  const catalog = useInstances(true)
  const queryClient = useQueryClient()
  const current = getInstanceScope()?.id
  const [editing, setEditing] = useState<PveInstance | 'new' | null>(null)
  const [removing, setRemoving] = useState<PveInstance | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: instancesKey })

  return (
    <div className="relative isolate min-h-dvh">
      <AmbientBackground />
      <header className="relative mx-auto flex max-w-4xl items-center justify-between px-5 py-6 sm:px-8">
        <Link to="/" className="flex items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"><Logo /><span className="font-semibold">Tiller</span></Link>
        <ThemeQuickSwitch />
      </header>
      <main className="relative mx-auto max-w-4xl px-5 pt-5 pb-12 sm:px-8">
        <Link to="/" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />返回概览</Link>
        <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-sans text-2xl font-semibold">实例管理</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">添加 PVE 地址和登录凭据，统一查看和管理资源。</p>
          </div>
          {catalog.data?.canManage && <Button size="lg" onClick={() => setEditing('new')}><Plus />添加实例</Button>}
        </div>
        {catalog.isPending ? (
          <p role="status" className="py-10 text-sm text-muted-foreground">正在读取实例…</p>
        ) : catalog.isError ? (
          <GlassCard><p role="alert" className="mb-4 text-sm text-destructive">无法读取实例列表</p><Button variant="outline" onClick={() => void catalog.refetch()}>重试</Button></GlassCard>
        ) : (
          <>
            <ul className="grid gap-4" aria-label="PVE 实例列表">
              {catalog.data.instances.map((instance) => (
                <li key={instance.id}>
                  <GlassCard className="flex flex-col gap-5 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand-strong"><Server className="size-5" aria-hidden /></span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <h2 className="font-sans text-base font-medium break-all">{instance.name}</h2>
                          {instance.id === current && <span className="text-xs text-brand-strong">当前实例</span>}
                        </div>
                        <p className="mt-1 text-sm break-all text-muted-foreground">{instance.url}</p>
                        <p className="mt-1.5 text-xs text-muted-foreground">{!instance.hasCredential ? '待配置登录凭据' : `${instance.authMode === 'password' ? `账号密码 · ${instance.username}@${instance.realm}` : `API Token · ${instance.tokenId}`} · ${instance.insecureTLS ? '已跳过证书校验' : instance.fingerprint ? '使用固定证书指纹' : '验证服务器证书'}`}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {catalog.data.canManage && <>
                        <Button variant="ghost" size="icon" aria-label={`编辑 ${instance.name}`} onClick={() => setEditing(instance)}><Pencil /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive" aria-label={`删除 ${instance.name}`} onClick={() => setRemoving(instance)}><Trash2 /></Button>
                      </>}
                      <Button variant={instance.id === current ? 'outline' : 'default'} asChild><a href={instanceUrl(instance)}>{'进入实例'}<ArrowRight /></a></Button>
                    </div>
                  </GlassCard>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
      {editing && <InstanceDialog existing={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={async (instance) => {
        await refresh()
        toast.success(editing === 'new' ? '实例已添加' : '实例已更新')
        if (instance.id === current && instance.version !== getInstanceScope()?.version) window.location.assign(instanceUrl(instance))
      }} />}
      {removing && <ConfirmDialog open onOpenChange={(open) => { if (!open) setRemoving(null) }} title={`删除连接「${removing.name}」？`} description="这会从 Tiller 移除该连接，不会删除 PVE 上的虚拟机、容器或其他资源。" confirmLabel="删除连接" destructive onConfirm={async () => {
        await deleteInstance(removing)
        if (removing.id === current) window.location.assign('/instances')
        else await refresh()
        toast.success('连接已删除')
      }} />}
    </div>
  )
}

function InstanceDialog({ existing, onClose, onSaved }: {
  existing: PveInstance | undefined
  onClose: () => void
  onSaved: (instance: PveInstance) => Promise<void>
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [url, setUrl] = useState(existing?.url ?? '')
  const [fingerprint, setFingerprint] = useState(existing?.fingerprint ?? '')
  const [insecureTLS, setInsecureTLS] = useState(existing?.insecureTLS ?? false)
  const [tokenId, setTokenId] = useState(existing?.tokenId ?? '')
  const [tokenSecret, setTokenSecret] = useState('')
  const originalMode = existing?.authMode ?? (existing?.tokenId ? 'token' : 'password')
  const [authMode, setAuthMode] = useState<'password' | 'token'>(originalMode)
  const [username, setUsername] = useState(existing?.username ?? '')
  const [realm, setRealm] = useState(existing?.realm ?? 'pam')
  const [password, setPassword] = useState('')
  const identityChanged = authMode !== originalMode || (authMode === 'password'
    ? username.trim() !== (existing?.username ?? '') || realm.trim() !== (existing?.realm ?? 'pam')
    : tokenId.trim() !== (existing?.tokenId ?? ''))
  const needsSecret = !existing?.hasCredential || identityChanged || url.trim() !== existing?.url || fingerprint.trim() !== existing?.fingerprint || insecureTLS !== existing?.insecureTLS
  const credentialMissing = authMode === 'password' ? !username.trim() || !realm.trim() || (needsSecret && !password) : !tokenId.trim() || (needsSecret && !tokenSecret.trim())
  return (
    <FormDialog open onOpenChange={(open) => { if (!open) onClose() }} title={existing ? '编辑实例' : '添加实例'} description="使用 PVE 账号密码或 API Token 连接，凭据加密保存在 Tiller 服务端。" submitLabel={existing ? '保存连接' : '添加实例'} submitDisabled={!name.trim() || !url.trim() || credentialMissing} onSubmit={async () => {
      const credentials = authMode === 'password' ? { username: username.trim(), realm: realm.trim(), password } : { tokenId: tokenId.trim(), tokenSecret: tokenSecret.trim() }
      const result = await saveInstance({ name: name.trim(), url: url.trim(), fingerprint: fingerprint.trim(), insecureTLS, authMode, ...credentials }, existing)
      await onSaved(result)
    }}>
      <FormField label="实例名称" required><FieldInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="例如：家中集群" autoFocus /></FormField>
      <FormField label="PVE 地址" required hint="集群只需填写其中一个节点的地址。"><FieldInput type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://192.168.1.10:8006" autoCapitalize="none" spellCheck={false} /></FormField>
      <FormField label="认证方式" required><SelectField value={authMode} onValueChange={(mode) => { if (mode) { setAuthMode(mode); setPassword(''); setTokenSecret('') } }} options={[{ value: 'password', label: '账号密码' }, { value: 'token', label: 'API Token' }]} /></FormField>
      {authMode === 'password' ? <>
        <FormField label="PVE 用户名" required hint="填写 PVE 账户，例如 root；也可以直接填写 root@pam。"><FieldInput value={username} onChange={(e) => setUsername(e.target.value)} onBlur={() => {
          const at = username.lastIndexOf('@')
          if (at >= 0 && username.slice(at + 1)) { setUsername(username.slice(0, at)); setRealm(username.slice(at + 1)) }
        }} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="root" maxLength={128} /></FormField>
        <FormField label="认证域" required hint="Linux PAM 账户填 pam，PVE 内部账户填 pve；其他认证域填写其 ID。"><FieldInput value={realm} onChange={(e) => setRealm(e.target.value)} autoCapitalize="none" spellCheck={false} maxLength={64} /></FormField>
        <FormField label="PVE 密码" required={needsSecret} hint={existing?.hasCredential && originalMode === 'password' ? '密码不会回显。仅改名称时可留空；修改连接或账户时需重新填写。' : '使用此 PVE 账户的密码，保存前会验证登录。'}><FieldInput type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></FormField>
        <p className="text-xs leading-relaxed text-muted-foreground">后台自动维护 PVE 会话。启用了两步验证的 PVE 账户请使用 API Token。</p>
      </> : <>
      <FormField label="Token ID" required hint="在 PVE 的「数据中心 → 权限 → API Token」中创建，并授予需要的资源权限。"><FieldInput value={tokenId} onChange={(e) => setTokenId(e.target.value)} placeholder="tiller@pve!tiller" autoCapitalize="none" spellCheck={false} /></FormField>
      <FormField label="Token Secret" required={needsSecret} hint={existing?.hasCredential && originalMode === 'token' ? '已保存的密钥不会回显。仅改名称时可留空；更改连接或 Token ID 时请重新填写。' : '创建 Token 时仅显示一次。'}><FieldInput type="password" autoComplete="new-password" value={tokenSecret} onChange={(e) => setTokenSecret(e.target.value)} /></FormField>
      </>}
      <FormField label="SHA-256 证书指纹" disabled={insecureTLS} hint="自签名证书可填写 PVE 证书页面的指纹；留空时按系统信任链验证。"><FieldInput value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} placeholder="AA:BB:CC:…" autoCapitalize="none" spellCheck={false} /></FormField>
      <SwitchField label="跳过证书校验" description="仅用于实验环境。" checked={insecureTLS} onCheckedChange={(checked) => { setInsecureTLS(checked); if (checked) setFingerprint('') }} />
      {existing && <p className="text-xs leading-relaxed text-muted-foreground">更改地址、证书或认证配置后，已有页面需重新选择该实例。</p>}
    </FormDialog>
  )
}
