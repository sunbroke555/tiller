import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'

import { accessKeys, deleteUser, unlockTfa, type UserEntry } from '@/api/access-users'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { runTask } from '@/components/tasks/tracker'

import { canSetPassword, isTfaLocked } from './model'
import { userPath } from './paths'
import { PermissionsDialog } from './PermissionsDialog'
import { useAccess } from './useAccess'
import { UserEditDialog } from './UserEditDialog'
import { UserPasswordDialog } from './UserPasswordDialog'

type UserRef = Pick<UserEntry, 'userid' | 'realm-type' | 'tfa-locked-until' | 'totp-locked'>

export interface UserActions {
  canModify: boolean
  create: () => void
  edit: (userid: string) => void
  password: (u: UserRef) => void
  permissions: (userid: string) => void
  unlock: (userid: string) => void
  remove: (userid: string) => void
  /** Which actions apply to this user (official UI's enableFn rules). */
  allowed: (u: UserRef) => { edit: boolean; password: boolean; unlock: boolean; remove: boolean }
  host: ReactNode
}

/** Dialogs and handlers for user actions, shared by the users list and the user page. */
export function useUserActions(opts: { afterDelete?: string } = {}): UserActions {
  const { self, userModify } = useAccess()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<{ open: boolean; userid: string | null }>({ open: false, userid: null })
  const [pw, setPw] = useState<UserRef | null>(null)
  const [permsOf, setPermsOf] = useState<string | null>(null)
  const [unlocking, setUnlocking] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  // Keep the last target while a dialog animates out.
  const [lastPw, setLastPw] = useState<UserRef | null>(null)
  if (pw && pw !== lastPw) setLastPw(pw)

  const host = (
    <>
      <UserEditDialog
        open={editing.open}
        userid={editing.userid}
        onOpenChange={(open) => setEditing((s) => ({ ...s, open }))}
        onCreated={(userid) => navigate(userPath(userid))}
      />
      {lastPw && (
        <UserPasswordDialog userid={lastPw.userid} realmType={lastPw['realm-type']} open={!!pw} onOpenChange={(o) => !o && setPw(null)} />
      )}
      <PermissionsDialog userid={permsOf} open={!!permsOf} onOpenChange={(o) => !o && setPermsOf(null)} />
      <ConfirmDialog
        open={!!unlocking}
        onOpenChange={(o) => !o && setUnlocking(null)}
        title={`解锁 ${unlocking ?? ''} 的两步验证？`}
        description="第二因素被锁定，通常是因为多次输错验证码，这也可能意味着密码已经泄露。确定要解锁吗？"
        confirmLabel="解锁"
        onConfirm={() =>
          runTask(unlockTfa(unlocking!), { title: `解锁 ${unlocking} 的两步验证`, syncSuccessMessage: '已解锁', invalidate: [accessKeys.all()] })
        }
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="删除这个用户？"
        description={removing && `${removing} 的 API 令牌、两步验证和权限设置会一起删除，不能恢复。`}
        confirmLabel="删除"
        destructive
        typeToConfirm={removing ?? undefined}
        onConfirm={async () => {
          const userid = removing!
          await runTask(deleteUser(userid), { title: `删除用户 ${userid}`, syncSuccessMessage: `已删除用户 ${userid}`, invalidate: [accessKeys.all()] })
          if (opts.afterDelete) navigate(opts.afterDelete, { replace: true })
        }}
      />
    </>
  )

  return {
    canModify: userModify,
    create: () => setEditing({ open: true, userid: null }),
    edit: (userid) => setEditing({ open: true, userid }),
    password: setPw,
    permissions: setPermsOf,
    unlock: setUnlocking,
    remove: setRemoving,
    allowed: (u) => ({
      edit: userModify,
      password: canSetPassword(u['realm-type']) && (userModify || u.userid === self),
      unlock: userModify && isTfaLocked(u),
      remove: userModify && u.userid !== 'root@pam',
    }),
    host,
  }
}
