import { useState } from 'react'
import { Link } from 'react-router'
import { Ellipsis, Fingerprint, KeyRound, LifeBuoy, Lock, LockOpen, Pencil, Plus, Smartphone, Trash2, type LucideIcon } from 'lucide-react'

import type { TfaUser } from '@/api/access-users'
import type { TfaEntry, TfaType } from '@/api/shell'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChangeTfaDialog } from '@/features/account/TfaDialogs'
import { Chip } from '@/features/guest-backup/ui'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { TFA_TYPE_LABEL, tfaEntryLocked } from './model'
import { userPath } from './paths'
import { TfaEditDialog } from './TfaDialogs'
import { UserAvatar, UserName } from './ui'

const TYPE_ICON: Record<TfaType, LucideIcon> = {
  totp: Smartphone,
  webauthn: Fingerprint,
  recovery: LifeBuoy,
  yubico: KeyRound,
  u2f: KeyRound,
}

/**
 * One user's second factors (rows of Proxmox.panel.TfaView): edit, delete,
 * lock state and unlock. `onAdd` shows an add button in the header.
 */
export function TfaUserCard({
  user,
  canManage,
  canUnlock,
  linkUser,
  onAdd,
  onUnlock,
  onChanged,
}: {
  user: TfaUser
  canManage: boolean
  canUnlock: boolean
  /** Show the user as a link to their page (the TFA overview). */
  linkUser?: boolean
  onAdd?: () => void
  onUnlock: () => void
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<TfaEntry | null>(null)
  const [removing, setRemoving] = useState<TfaEntry | null>(null)
  const [lastRemoving, setLastRemoving] = useState<TfaEntry | null>(null)
  if (removing && removing !== lastRemoving) setLastRemoving(removing)
  const lockedAll = (user['tfa-locked-until'] ?? 0) * 1000 > Date.now()
  const locked = lockedAll || !!user['totp-locked']
  const entries = [...user.entries].sort((a, b) => a.created - b.created)

  return (
    <GlassCard flush className="overflow-hidden" data-testid="tfa-user" data-userid={user.userid}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-(--card-p) py-3">
        <UserAvatar userid={user.userid} />
        <div className="min-w-0 flex-1">
          {linkUser ? (
            <Link to={userPath(user.userid)} className="block truncate hover:underline">
              <UserName userid={user.userid} />
            </Link>
          ) : (
            <h2 className="heading text-base font-medium">两步验证</h2>
          )}
          <p className="truncate text-xs text-muted-foreground">
            {entries.length ? `${entries.length} 个条目` : '没有第二因素，登录只需要密码'}
          </p>
        </div>
        {onAdd && canManage && (
          <Button variant="outline" size="sm" onClick={onAdd} className="pointer-coarse:h-11">
            <Plus />
            添加
          </Button>
        )}
      </div>
      {locked && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-destructive/20 bg-destructive/[0.06] px-(--card-p) py-2.5 text-sm">
          <Lock className="size-4 shrink-0 text-destructive" aria-hidden />
          <span className="min-w-0 flex-1 text-destructive">
            {lockedAll ? `第二因素已锁定，${formatDateTime(user['tfa-locked-until'])} 自动解锁` : 'TOTP 已锁定（多次输错）'}
          </span>
          {canUnlock && (
            <Button variant="outline" size="sm" onClick={onUnlock} className="pointer-coarse:h-11">
              <LockOpen />
              解锁
            </Button>
          )}
        </div>
      )}
      {entries.length > 0 && (
        <ul className="divide-y divide-border/60" aria-label={`${user.userid} 的两步验证`}>
          {entries.map((e) => {
            const Icon = TYPE_ICON[e.type] ?? KeyRound
            const enabled = e.enable !== 0
            const entryLocked = tfaEntryLocked(user, e)
            const name = e.description || TFA_TYPE_LABEL[e.type] || e.type
            return (
              <li key={e.id} data-testid="tfa-entry" data-type={e.type} className="flex min-h-14 items-center gap-3 py-2.5 pr-2 pl-(--card-p) lg:pr-(--card-p)">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05] text-muted-foreground paper:bg-secondary">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn('truncate text-sm font-medium', !enabled && 'text-muted-foreground')}>{name}</span>
                    {entryLocked ? (
                      <Chip tone="danger" icon={<Lock />}>
                        已锁定
                      </Chip>
                    ) : (
                      !enabled && <Chip>已停用</Chip>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {TFA_TYPE_LABEL[e.type] ?? e.type} · 添加于 {e.created ? formatDateTime(e.created) : '未知'}
                  </div>
                </div>
                {canManage && (
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`${name} 的操作`} className="shrink-0 text-muted-foreground pointer-coarse:size-11">
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-40">
                      {e.type !== 'recovery' && (
                        <>
                          <DropdownMenuItem onSelect={() => setEditing(e)} className="pointer-coarse:min-h-11">
                            <Pencil />
                            编辑…
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(e)} className="pointer-coarse:min-h-11">
                        <Trash2 />
                        删除…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <TfaEditDialog userid={user.userid} entry={editing} open={!!editing} onOpenChange={(o) => !o && setEditing(null)} onDone={onChanged} />
      <ChangeTfaDialog
        userid={user.userid}
        entry={lastRemoving}
        mode="delete"
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        onDone={onChanged}
      />
    </GlassCard>
  )
}
