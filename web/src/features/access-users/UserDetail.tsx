import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, KeyRound, LockOpen, Pencil, ShieldCheck, Trash2 } from 'lucide-react'

import { accessKeys, useAllTfa, useUsers } from '@/api/access-users'
import { GlassCard } from '@/components/GlassCard'
import { ErrorCard } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Chip, InfoList } from '@/features/guest-backup/ui'
import { formatDateTime } from '@/lib/format'

import { expireLabel, fullName, splitUserid, userGroups } from './model'
import { groupPath, usersPath } from './paths'
import { TfaAddDialog } from './TfaDialogs'
import { TfaUserCard } from './TfaUserCard'
import { TokenList } from './TokenList'
import { ExpireChip, TfaChip, UserAvatar } from './ui'
import { useAccess } from './useAccess'
import { useUserActions } from './useUserActions'

/** /datacenter/users/user/:userid — one user: details, groups, API tokens, TFA. */
export function UserDetail() {
  const userid = useParams().userid ?? ''
  const users = useUsers()
  const tfa = useAllTfa()
  const { self, userModify } = useAccess()
  const actions = useUserActions({ afterDelete: usersPath() })
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const u = users.data?.find((x) => x.userid === userid)
  const { name, realm } = splitUserid(userid)

  const back = (
    <Link
      to={usersPath()}
      className="-ml-2 inline-flex min-h-11 w-fit items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="size-4" />
      全部用户
    </Link>
  )

  if ((users.isError && !users.data) || (users.data && !u)) {
    return (
      <div className="grid gap-3">
        {back}
        <ErrorCard
          error={users.error ?? new Error(`用户 ${userid} 不存在，或你没有查看它的权限`)}
          onRetry={() => void users.refetch()}
          title="无法读取用户"
        />
      </div>
    )
  }

  const allowed = u ? actions.allowed(u) : null
  const tfaUser = tfa.data?.find((x) => x.userid === userid) ?? { userid, entries: [] }
  const lockInfo = u ? { ...tfaUser, 'tfa-locked-until': u['tfa-locked-until'] ?? tfaUser['tfa-locked-until'], 'totp-locked': u['totp-locked'] ?? tfaUser['totp-locked'] } : tfaUser
  const groups = u ? userGroups(u) : []
  const refreshTfa = () => void queryClient.invalidateQueries({ queryKey: accessKeys.all() })

  return (
    <div className="grid gap-(--section-gap)">
      <div className="grid gap-2">
        {back}
        <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <UserAvatar userid={userid} muted={u?.enable === 0} className="size-12 text-lg" />
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="truncate text-lg font-semibold text-foreground">{name}</h2>
                {u ? (
                  <>
                    {u.enable === 0 && <Chip>已停用</Chip>}
                    <ExpireChip expire={u.expire} />
                    <TfaChip user={u} />
                  </>
                ) : (
                  <Skeleton className="h-5 w-20" />
                )}
              </div>
              <p className="truncate text-sm text-muted-foreground">
                @{realm}
                {u && fullName(u) && ` · ${fullName(u)}`}
              </p>
            </div>
          </div>
          {u && allowed && (
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap" role="toolbar" aria-label="用户操作">
              {allowed.edit && (
                <Button variant="outline" onClick={() => actions.edit(userid)}>
                  <Pencil />
                  编辑
                </Button>
              )}
              {allowed.password && (
                <Button variant="outline" onClick={() => actions.password(u)}>
                  <KeyRound />
                  设置密码
                </Button>
              )}
              <Button variant="outline" onClick={() => actions.permissions(userid)}>
                <ShieldCheck />
                权限
              </Button>
              {allowed.unlock && (
                <Button variant="outline" onClick={() => actions.unlock(userid)}>
                  <LockOpen />
                  解锁 TFA
                </Button>
              )}
              {allowed.remove && (
                <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => actions.remove(userid)}>
                  <Trash2 />
                  删除
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <GlassCard>
        {u ? (
          <InfoList
            items={[
              { label: '用户 ID', value: userid, mono: true },
              { label: '认证域', value: u['realm-type'] && u['realm-type'] !== realm ? `${realm}（${u['realm-type']}）` : realm },
              { label: '状态', value: u.enable === 0 ? '已停用' : '已启用' },
              { label: '过期', value: expireLabel(u.expire) },
              { label: '姓名', value: fullName(u) || '—' },
              { label: '邮箱', value: u.email || '—' },
              {
                label: '组',
                value: groups.length ? (
                  <span className="flex flex-wrap justify-end gap-1 sm:justify-start">
                    {groups.map((g) => (
                      <Link key={g} to={groupPath(g)} className="rounded-full hover:underline">
                        <Chip tone="brand">{g}</Chip>
                      </Link>
                    ))}
                  </span>
                ) : (
                  '—'
                ),
              },
              ...(u.comment ? [{ label: '备注', value: u.comment }] : []),
              ...(u['tfa-locked-until'] ? [{ label: 'TFA 锁定到', value: formatDateTime(u['tfa-locked-until']) }] : []),
            ]}
          />
        ) : (
          <div className="grid gap-2.5" aria-busy="true">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-48" />
          </div>
        )}
      </GlassCard>

      <TokenList userid={userid} />

      <TfaUserCard
        user={lockInfo}
        canManage={userModify || userid === self}
        canUnlock={userModify}
        onAdd={() => setAdding(true)}
        onUnlock={() => actions.unlock(userid)}
        onChanged={refreshTfa}
      />
      <TfaAddDialog
        users={[userid]}
        fixedUser={userid}
        hasRecovery={() => tfaUser.entries.some((e) => e.type === 'recovery')}
        open={adding}
        onOpenChange={setAdding}
        onDone={refreshTfa}
      />
      {actions.host}
    </div>
  )
}
