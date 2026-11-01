import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2, UserMinus, UsersRound } from 'lucide-react'

import { accessKeys, deleteGroup, useGroup, useUsers } from '@/api/access-users'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorCard, LoadingRows } from '@/components/QueryState'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

import { AddMembersDialog, GroupEditDialog, setMembership } from './GroupDialogs'
import { fullName } from './model'
import { groupsPath, userPath } from './paths'
import { ListHeader, UserAvatar, UserName } from './ui'
import { useAccess } from './useAccess'

/** /datacenter/users/groups/:groupid — comment and members. */
export function GroupDetail() {
  const groupid = useParams().groupid ?? ''
  const group = useGroup(groupid)
  const users = useUsers()
  const { groupAllocate, userModify } = useAccess()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [kicking, setKicking] = useState<string | null>(null)

  const back = (
    <Link
      to={groupsPath()}
      className="-ml-2 inline-flex min-h-11 w-fit items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="size-4" />
      全部组
    </Link>
  )

  if (group.isError && !group.data) {
    return (
      <div className="grid gap-3">
        {back}
        <ErrorCard error={group.error} onRetry={() => void group.refetch()} title="无法读取组" />
      </div>
    )
  }

  const members = [...(group.data?.members ?? [])].sort()
  const candidates = (users.data ?? []).map((u) => u.userid).filter((u) => !members.includes(u)).sort()
  const byId = new Map((users.data ?? []).map((u) => [u.userid, u]))

  return (
    <div className="grid gap-(--section-gap)">
      <div className="grid gap-2">
        {back}
        <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span aria-hidden className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-muted-foreground paper:bg-secondary">
              <UsersRound className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-foreground">{groupid}</h2>
              {group.data ? (
                <p className="truncate text-sm text-muted-foreground">{group.data.comment || '没有备注'}</p>
              ) : (
                <Skeleton className="mt-1 h-4 w-32" />
              )}
            </div>
          </div>
          {groupAllocate && group.data && (
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto" role="toolbar" aria-label="组操作">
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil />
                编辑
              </Button>
              <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setRemoving(true)}>
                <Trash2 />
                删除
              </Button>
            </div>
          )}
        </div>
      </div>

      <GlassCard flush className="overflow-hidden">
        <ListHeader title="成员" subtitle={group.data ? `${members.length} 个用户` : '正在读取…'}>
          {userModify && group.data && (
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus />
              添加成员
            </Button>
          )}
        </ListHeader>
        {group.isPending ? (
          <LoadingRows rows={2} />
        ) : members.length === 0 ? (
          <EmptyState icon={UsersRound} title="这个组还没有成员" />
        ) : (
          <ul aria-label="成员列表" className="divide-y divide-border/60">
            {members.map((m) => {
              const u = byId.get(m)
              return (
                <li key={m} data-testid="member-row" data-userid={m} className="flex items-center gap-1 pr-2 pl-(--card-p) lg:pr-(--card-p)">
                  <Link to={userPath(m)} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                    <UserAvatar userid={m} muted={u?.enable === 0} className="size-8 text-xs" />
                    <div className="min-w-0 flex-1">
                      <UserName userid={m} className="block text-sm" />
                      {u && (fullName(u) || u.email) && <div className="truncate text-xs text-muted-foreground">{fullName(u) || u.email}</div>}
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-faint lg:hidden" aria-hidden />
                  </Link>
                  {userModify && (
                    <Button variant="ghost" size="icon" aria-label={`把 ${m} 移出组`} title="移出组" className="shrink-0 text-muted-foreground hover:text-destructive pointer-coarse:size-11" onClick={() => setKicking(m)}>
                      <UserMinus />
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </GlassCard>

      <GroupEditDialog groupid={groupid} comment={group.data?.comment} open={editing} onOpenChange={setEditing} />
      <AddMembersDialog groupid={groupid} candidates={candidates} open={adding} onOpenChange={setAdding} />
      <ConfirmDialog
        open={!!kicking}
        onOpenChange={(o) => !o && setKicking(null)}
        title={`把 ${kicking ?? ''} 移出组？`}
        description="用户通过这个组获得的权限会一起失去。"
        confirmLabel="移出"
        destructive
        onConfirm={() =>
          runTask(setMembership(kicking!, groupid, false), { title: `把 ${kicking} 移出 ${groupid}`, syncSuccessMessage: '已移出', invalidate: [accessKeys.all()] })
        }
      />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="删除这个组？"
        description={`成员会离开组 ${groupid}，授予这个组的权限也会删除。用户本身不受影响。`}
        confirmLabel="删除"
        destructive
        typeToConfirm={groupid}
        onConfirm={async () => {
          await runTask(deleteGroup(groupid), { title: `删除组 ${groupid}`, syncSuccessMessage: `已删除组 ${groupid}`, invalidate: [accessKeys.all()] })
          navigate(groupsPath(), { replace: true })
        }}
      />
    </div>
  )
}
