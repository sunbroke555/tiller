import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ChevronRight, Plus, UsersRound } from 'lucide-react'

import { useGroups, type GroupEntry } from '@/api/access-users'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { Button } from '@/components/ui/button'

import { GroupEditDialog } from './GroupDialogs'
import { groupPath } from './paths'
import { ListHeader } from './ui'
import { useAccess } from './useAccess'

export function groupMembers(g: Pick<GroupEntry, 'users'>): string[] {
  return (g.users ?? '').split(',').map((s) => s.trim()).filter(Boolean).sort()
}

/** /datacenter/users/groups (PVE.dc.GroupView). */
export function GroupsView() {
  const groups = useGroups()
  const { groupAllocate } = useAccess()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const list = [...(groups.data ?? [])].sort((a, b) => a.groupid.localeCompare(b.groupid))

  return (
    <GlassCard flush className="overflow-hidden">
      <ListHeader
        title="组"
        subtitle={groups.isPending ? '正在读取…' : list.length ? `${list.length} 个组` : '还没有组'}
        fetching={groups.isFetching}
        onRefresh={() => void groups.refetch()}
      >
        {groupAllocate && (
          <Button onClick={() => setCreating(true)}>
            <Plus />
            新建
          </Button>
        )}
      </ListHeader>
      {groups.isError && !groups.data ? (
        <ErrorState compact error={groups.error} onRetry={() => void groups.refetch()} />
      ) : groups.isPending ? (
        <LoadingRows rows={2} />
      ) : list.length === 0 ? (
        <EmptyState icon={UsersRound} title="还没有组" description="把用户放进组里，再给组授予权限，比逐个给用户授权更好管理。" />
      ) : (
        <ul aria-label="组列表" className="divide-y divide-border/60">
          {list.map((g) => {
            const members = groupMembers(g)
            return (
              <li key={g.groupid} data-testid="group-row" data-group={g.groupid}>
                <Link
                  to={groupPath(g.groupid)}
                  className="flex min-h-16 items-center gap-3 px-(--card-p) py-3 transition-colors outline-none hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset paper:hover:bg-secondary/50"
                >
                  <span
                    aria-hidden
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-muted-foreground paper:bg-secondary"
                  >
                    <UsersRound className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate font-medium">{g.groupid}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular">{members.length} 个成员</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[g.comment, members.join('、')].filter(Boolean).join(' · ') || '没有成员'}
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      <GroupEditDialog groupid={null} open={creating} onOpenChange={setCreating} onCreated={(id) => navigate(groupPath(id))} />
    </GlassCard>
  )
}
