import { useState } from 'react'
import { Link } from 'react-router'
import { ChevronRight, Ellipsis, KeyRound, LockOpen, Pencil, Plus, ShieldCheck, Trash2, Users } from 'lucide-react'

import { useUsers, type UserEntry } from '@/api/access-users'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Chip } from '@/features/guest-backup/ui'

import { fullName, userGroups, userMatches } from './model'
import { userPath } from './paths'
import { ExpireChip, ListHeader, SearchBox, TfaChip, UserAvatar, UserName } from './ui'
import { useUserActions, type UserActions } from './useUserActions'

/** /datacenter/users — all users (PVE.dc.UserView). */
export function UsersView() {
  const users = useUsers()
  const actions = useUserActions()
  const [q, setQ] = useState('')
  const all = [...(users.data ?? [])].sort((a, b) => a.userid.localeCompare(b.userid))
  const list = all.filter((u) => userMatches(u, q))
  const disabled = all.filter((u) => u.enable === 0).length

  return (
    <div className="grid gap-3">
      {all.length > 6 && <SearchBox value={q} onChange={setQ} placeholder="按用户名、姓名、邮箱、组过滤" label="过滤用户" />}
      <GlassCard flush className="overflow-hidden">
        <ListHeader
          title="用户"
          subtitle={users.isPending ? '正在读取…' : `${all.length} 个用户${disabled ? ` · ${disabled} 个已停用` : ''}`}
          fetching={users.isFetching}
          onRefresh={() => void users.refetch()}
        >
          {actions.canModify && (
            <Button onClick={actions.create}>
              <Plus />
              新建
            </Button>
          )}
        </ListHeader>
        {users.isError && !users.data ? (
          <ErrorState compact error={users.error} onRetry={() => void users.refetch()} />
        ) : users.isPending ? (
          <LoadingRows rows={3} />
        ) : list.length === 0 ? (
          <EmptyState icon={Users} title={q ? '没有匹配的用户' : '没有用户'} />
        ) : (
          <ul aria-label="用户列表" className="divide-y divide-border/60">
            {list.map((u) => (
              <UserRow key={u.userid} user={u} actions={actions} />
            ))}
          </ul>
        )}
      </GlassCard>
      {actions.host}
    </div>
  )
}

function UserRow({ user: u, actions }: { user: UserEntry; actions: UserActions }) {
  const enabled = u.enable !== 0
  const name = fullName(u)
  const groups = userGroups(u)
  const tokens = u.tokens?.length ?? 0
  const allowed = actions.allowed(u)
  const detail = [name, u.email, u.comment].filter(Boolean).join(' · ')
  return (
    <li
      data-testid="user-row"
      data-userid={u.userid}
      className="group/row flex items-center gap-3 pr-2 pl-(--card-p) transition-colors hover:bg-foreground/[0.03] lg:pr-(--card-p) paper:hover:bg-secondary/50"
    >
      <Link
        to={userPath(u.userid)}
        className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-lg py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <UserAvatar userid={u.userid} muted={!enabled} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <UserName userid={u.userid} className={enabled ? undefined : 'opacity-70'} />
            {!enabled && <Chip>已停用</Chip>}
            <ExpireChip expire={u.expire} />
            <TfaChip user={u} />
          </div>
          {detail && <div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div>}
          {(groups.length > 0 || tokens > 0) && (
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
              {groups.map((g) => (
                <Chip key={g} tone="brand">
                  {g}
                </Chip>
              ))}
              {tokens > 0 && <span className="text-xs text-muted-foreground">{tokens} 个 API 令牌</span>}
            </div>
          )}
        </div>
        <ChevronRight className="size-4 shrink-0 text-faint lg:hidden" aria-hidden />
      </Link>
      <div className="hidden shrink-0 lg:flex">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`${u.userid} 的操作`} className="text-muted-foreground">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {allowed.edit && (
              <DropdownMenuItem onSelect={() => actions.edit(u.userid)}>
                <Pencil />
                编辑…
              </DropdownMenuItem>
            )}
            {allowed.password && (
              <DropdownMenuItem onSelect={() => actions.password(u)}>
                <KeyRound />
                设置密码…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => actions.permissions(u.userid)}>
              <ShieldCheck />
              查看权限
            </DropdownMenuItem>
            {allowed.unlock && (
              <DropdownMenuItem onSelect={() => actions.unlock(u.userid)}>
                <LockOpen />
                解锁两步验证…
              </DropdownMenuItem>
            )}
            {allowed.remove && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => actions.remove(u.userid)}>
                  <Trash2 />
                  删除…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}
