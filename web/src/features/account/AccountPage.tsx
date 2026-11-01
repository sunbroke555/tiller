import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight,
  Fingerprint,
  KeyRound,
  Keyboard,
  LifeBuoy,
  LockKeyhole,
  LogOut,
  Palette,
  Plus,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
  type LucideIcon,
} from 'lucide-react'

import { logout } from '@/api/auth'
import { useClusterStatus, useVersion } from '@/api/queries'
import { canChangePassword, tfaKey, useOwnTfa, type TfaEntry, type TfaType } from '@/api/shell'
import { useSession } from '@/api/useSession'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { openShortcutsHelp } from '@/components/layout/KeyboardShortcuts'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { PasswordDialog } from './PasswordDialog'
import { AddRecoveryDialog, AddTotpDialog, AddWebauthnDialog, AddYubicoDialog, ChangeTfaDialog } from './TfaDialogs'

const TFA_META: Record<TfaType, { label: string; icon: LucideIcon }> = {
  totp: { label: '验证器（TOTP）', icon: Smartphone },
  webauthn: { label: '安全密钥（WebAuthn）', icon: Fingerprint },
  recovery: { label: '恢复码', icon: LifeBuoy },
  yubico: { label: 'Yubico OTP', icon: KeyRound },
  u2f: { label: 'U2F（旧版）', icon: KeyRound },
}

type AddKind = 'totp' | 'webauthn' | 'recovery' | 'yubico'
type Change = { entry: TfaEntry; mode: 'delete' | 'enable' | 'disable' }

/** /account — profile, password, own two-factor entries, links to permissions and preferences. */
export default function AccountPage() {
  const session = useSession()
  const userid = session?.username ?? ''
  const at = userid.lastIndexOf('@')
  const realm = at > 0 ? userid.slice(at + 1) : ''
  const { data: version } = useVersion()
  const { data: status } = useClusterStatus()
  const cluster = status?.find((e) => e.type === 'cluster')
  const [passwordOpen, setPasswordOpen] = useState(false)

  return (
    <>
      <PageHeader title="账户与安全" description="密码、两步验证和你的权限" backTo="/" />
      <div className="grid gap-(--section-gap)">
        <GlassCard className="flex items-center gap-4">
          <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand/12 text-xl font-semibold text-brand-strong uppercase ring-1 ring-brand/20 ring-inset paper:bg-secondary paper:text-foreground paper:ring-border">
            {userid[0] ?? <UserRound />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold" data-testid="account-user">
              {userid}
            </div>
            <div className="truncate text-sm text-muted-foreground">
              {[`认证域 ${realm}`, cluster?.name ?? session?.clustername, version && `PVE ${version.version}`].filter(Boolean).join(' · ')}
            </div>
          </div>
        </GlassCard>

        <section aria-labelledby="acc-security">
          <SectionHeader title={<span id="acc-security">登录</span>} />
          <GlassCard flush className="divide-y divide-border/70 overflow-hidden">
            <Row
              icon={LockKeyhole}
              title="密码"
              description={canChangePassword(userid) ? '修改登录密码' : `${realm} 认证域的密码由外部系统管理`}
              action={
                canChangePassword(userid) && (
                  <Button variant="outline" size="sm" onClick={() => setPasswordOpen(true)} className="pointer-coarse:h-11">
                    修改密码
                  </Button>
                )
              }
            />
            <Row icon={ShieldCheck} title="我的权限" description="查看你在各个路径上的有效权限" to="/account/permissions" />
          </GlassCard>
        </section>

        <TfaSection userid={userid} />

        <section aria-labelledby="acc-more">
          <SectionHeader title={<span id="acc-more">更多</span>} />
          <GlassCard flush className="divide-y divide-border/70 overflow-hidden">
            <Row icon={Palette} title="外观与偏好" description="主题、强调色、列表密度、安装应用" to="/settings/appearance" />
            <Row
              icon={Keyboard}
              title="键盘快捷键"
              description="按 ? 随时查看"
              onClick={() => openShortcutsHelp()}
              className="pointer-coarse:hidden"
            />
            <Row icon={LogOut} title="退出登录" description="清除这台设备上的登录状态" onClick={() => logout()} destructive />
          </GlassCard>
        </section>
      </div>
      {userid && <PasswordDialog userid={userid} open={passwordOpen} onOpenChange={setPasswordOpen} />}
    </>
  )
}

function Row({
  icon: Icon,
  title,
  description,
  action,
  to,
  onClick,
  destructive,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
  to?: string
  onClick?: () => void
  destructive?: boolean
  className?: string
}) {
  const body = (
    <>
      <span
        className={cn(
          'inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] paper:bg-secondary',
          destructive ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 text-left">
        <div className={cn('text-sm font-medium', destructive && 'text-destructive')}>{title}</div>
        {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
      </div>
      {action}
      {(to || onClick) && !action && <ChevronRight className="size-4 shrink-0 text-faint" />}
    </>
  )
  const cls = cn(
    'flex min-h-16 w-full items-center gap-3 px-(--card-p) py-(--row-py)',
    (to || onClick) && 'transition-colors hover:bg-foreground/[0.03] active:bg-foreground/[0.05] paper:hover:bg-secondary/40',
    className,
  )
  if (to)
    return (
      <Link to={to} className={cls}>
        {body}
      </Link>
    )
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls}>
        {body}
      </button>
    )
  return <div className={cls}>{body}</div>
}

function TfaSection({ userid }: { userid: string }) {
  const tfa = useOwnTfa(userid || undefined)
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState<AddKind | null>(null)
  const [change, setChange] = useState<Change | null>(null)
  const [lastChange, setLastChange] = useState<Change | null>(null)
  if (change && change !== lastChange) setLastChange(change)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: tfaKey(userid) })
  const entries = [...(tfa.data ?? [])].sort((a, b) => a.created - b.created)
  const hasRecovery = entries.some((e) => e.type === 'recovery')
  const active = entries.filter((e) => e.enable !== 0 && e.type !== 'recovery').length

  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 pointer-coarse:h-11">
          <Plus /> 添加
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => setAdding('totp')} className="pointer-coarse:min-h-11">
          <Smartphone /> 验证器 App（TOTP）
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setAdding('webauthn')} className="pointer-coarse:min-h-11">
          <Fingerprint /> 安全密钥 / 通行密钥
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setAdding('recovery')} disabled={hasRecovery} className="pointer-coarse:min-h-11">
          <LifeBuoy /> 恢复码{hasRecovery && '（已有）'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setAdding('yubico')} className="pointer-coarse:min-h-11">
          <KeyRound /> Yubico OTP
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <section aria-labelledby="acc-tfa">
      <SectionHeader title={<span id="acc-tfa">两步验证</span>}>{entries.length > 0 && addMenu}</SectionHeader>
      <GlassCard flush className="overflow-hidden">
        {tfa.isPending ? (
          <LoadingRows rows={2} />
        ) : tfa.isError ? (
          <ErrorState compact error={tfa.error} onRetry={() => void tfa.refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="还没有开启两步验证"
            description="添加验证器 App 或安全密钥后，登录时除了密码还需要第二个因素。"
            action={addMenu}
          />
        ) : (
          <>
            <div
              className={cn(
                'flex items-center gap-2 border-b border-border/70 px-(--card-p) py-2.5 text-xs',
                active > 0 ? 'text-success-strong' : 'text-warning-strong',
              )}
            >
              <ShieldCheck className="size-4" aria-hidden />
              {active > 0 ? `已开启 · ${active} 个第二因素` : '没有启用的第二因素，登录只需要密码'}
              {active > 0 && !hasRecovery && <span className="ml-auto text-muted-foreground">建议再生成一组恢复码</span>}
            </div>
            <ul className="divide-y divide-border/70" aria-label="两步验证条目">
              {entries.map((e) => {
                const meta = TFA_META[e.type] ?? TFA_META.totp
                const enabled = e.enable !== 0
                return (
                  <li key={e.id} className="flex min-h-16 items-center gap-3 px-(--card-p) py-(--row-py)">
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-muted-foreground paper:bg-secondary">
                      <meta.icon className="size-[18px]" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn('truncate text-sm font-medium', !enabled && 'text-muted-foreground')}>
                          {e.description || meta.label}
                        </span>
                        {!enabled && <Badge variant="outline">已停用</Badge>}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {meta.label} · 添加于 {formatDateTime(e.created)}
                      </div>
                    </div>
                    {e.type !== 'recovery' && (
                      <Switch
                        // 44px touch area around the 18px switch (the row has no label to tap).
                        className="relative pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1.5 pointer-coarse:after:-inset-y-3.5"
                        checked={enabled}
                        aria-label={enabled ? `停用 ${e.description || meta.label}` : `启用 ${e.description || meta.label}`}
                        onCheckedChange={(v) => setChange({ entry: e, mode: v ? 'enable' : 'disable' })}
                      />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`删除 ${e.description || meta.label}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setChange({ entry: e, mode: 'delete' })}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </GlassCard>

      <AddTotpDialog userid={userid} open={adding === 'totp'} onOpenChange={(o) => !o && setAdding(null)} onDone={refresh} />
      <AddWebauthnDialog userid={userid} open={adding === 'webauthn'} onOpenChange={(o) => !o && setAdding(null)} onDone={refresh} />
      <AddRecoveryDialog userid={userid} open={adding === 'recovery'} onOpenChange={(o) => !o && setAdding(null)} onDone={refresh} />
      <AddYubicoDialog userid={userid} open={adding === 'yubico'} onOpenChange={(o) => !o && setAdding(null)} onDone={refresh} />
      <ChangeTfaDialog
        userid={userid}
        entry={lastChange?.entry ?? null}
        mode={lastChange?.mode ?? 'delete'}
        open={change !== null}
        onOpenChange={(o) => !o && setChange(null)}
        onDone={refresh}
      />
    </section>
  )
}
