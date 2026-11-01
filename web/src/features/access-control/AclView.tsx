// The ACL list (PVE.dc.ACLView): every entry of /access/acl in the
// datacenter, or only those on one path (guest, storage, pool pages).

import { useMemo, useState } from 'react'
import { ArrowDownToLine, ChevronDown, KeyRound, Plus, Search, ShieldCheck, Trash2, User, Users } from 'lucide-react'

import { accessKeys, updateAcl, useAcl, type AclEntry, type AclSubjectType } from '@/api/access-control'
import { usePermissions } from '@/api/permissions'
import { useClusterResources } from '@/api/queries'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/QueryState'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { PermissionChecker } from '@/lib/permissions'
import { cn } from '@/lib/utils'

import { AclAddDialog } from './AclAddDialog'
import { ACL_SUBJECT_LABEL, aclKey, aclRemoveParams, aclModifyCheck, compareAcl, describeAclPath, guestNamesByPath } from './logic'
import { ListCard, ListSkeleton, Pill, SubjectIcon } from './ui'

export interface AclViewProps {
  /** Show and add entries on this path only (guest / storage / pool pages). */
  path?: string
  /** Pool of the guest or storage (its /pool/<id> ACL also allows changes). */
  pool?: string | undefined
}

/** May the user change the ACL on `path` (or, with `pool`, via the pool)? */
export function canModifyAcl(perms: PermissionChecker, path: string, pool?: string): boolean {
  const check = aclModifyCheck(path)
  if (pool) return perms.can({ ...check, path: [check.path as string, `/pool/${pool}`] })
  return perms.can(check)
}

type Filter = 'all' | AclSubjectType

export function AclView({ path, pool }: AclViewProps) {
  const fixed = path !== undefined
  const acl = useAcl()
  const perms = usePermissions()
  const names = useClusterResources({ select: guestNamesByPath })
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<AclSubjectType | null>(null)
  const [lastType, setLastType] = useState<AclSubjectType>('user')
  const [removing, setRemoving] = useState<AclEntry | null>(null)

  const all = useMemo(() => [...(acl.data ?? [])].filter((e) => !fixed || e.path === path).sort(compareAcl), [acl.data, fixed, path])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter(
      (e) =>
        (filter === 'all' || e.type === filter) &&
        (!q || e.path.toLowerCase().includes(q) || e.ugid.toLowerCase().includes(q) || e.roleid.toLowerCase().includes(q) || describeAclPath(e.path, names.data).toLowerCase().includes(q)),
    )
  }, [all, filter, query, names.data])

  // Datacenter: anyone with Permissions.Modify somewhere may add (the path picker narrows it).
  const canAdd = fixed ? canModifyAcl(perms, path, pool) : perms.can({ privs: ['Permissions.Modify', 'VM.Allocate', 'Datastore.Allocate', 'Pool.Allocate'], any: true, anywhere: true, path: '/' })

  const open = (type: AclSubjectType) => {
    setLastType(type)
    setAdding(type)
  }

  const addMenu = (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button disabled={!canAdd} title={canAdd ? undefined : '没有修改权限的权限'}>
          <Plus />
          添加
          <ChevronDown className="opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onSelect={() => open('user')}>
          <User />
          用户权限
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => open('group')}>
          <Users />
          组权限
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => open('token')}>
          <KeyRound />
          API 令牌权限
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const counts = useMemo(() => {
    const c = { user: 0, group: 0, token: 0 }
    for (const e of all) c[e.type]++
    return c
  }, [all])

  const summary = acl.isPending
    ? '正在读取…'
    : all.length === 0
      ? '没有权限条目'
      : `${all.length} 条${fixed ? '' : ` · ${counts.user} 用户 · ${counts.group} 组 · ${counts.token} 令牌`}`

  return (
    <>
      <ListCard
        title={fixed ? '权限' : '访问权限（ACL）'}
        summary={<span data-testid="acl-summary">{summary}</span>}
        onRefresh={() => void acl.refetch()}
        refreshing={acl.isFetching}
        actions={addMenu}
        toolbar={
          !fixed && all.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={filter}
                onValueChange={(v) => v && setFilter(v as Filter)}
                aria-label="按类型筛选"
                className="w-max"
              >
                <ToggleGroupItem value="all" className="px-3 text-xs pointer-coarse:h-9">
                  全部
                </ToggleGroupItem>
                {(['user', 'group', 'token'] as const).map((t) => (
                  <ToggleGroupItem key={t} value={t} className="px-3 text-xs whitespace-nowrap pointer-coarse:h-9">
                    {ACL_SUBJECT_LABEL[t]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <div className="relative min-w-40 flex-1 sm:max-w-64">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="路径、用户、角色" aria-label="搜索权限" className="h-9 pl-8" />
              </div>
            </div>
          ) : undefined
        }
      >
        {acl.isPending ? (
          <ListSkeleton />
        ) : acl.isError ? (
          <ErrorState error={acl.error} onRetry={() => void acl.refetch()} compact />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={all.length ? '没有匹配的条目' : '还没有权限条目'}
            description={
              all.length
                ? undefined
                : fixed
                  ? '这里只列出直接设在这个对象上的权限，从上级路径传播下来的权限不在此列。'
                  : '给用户、组或 API 令牌在某个路径上分配角色。勾选“传播”后，权限对下级路径同样生效。'
            }
            action={
              !all.length && canAdd ? (
                <Button variant="outline" onClick={() => open('user')}>
                  <Plus />
                  添加用户权限
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="hidden items-center gap-3 border-b border-border/60 px-(--card-p) py-2 text-xs text-muted-foreground lg:flex" aria-hidden>
              {!fixed && <span className="w-64 shrink-0">路径</span>}
              <span className="min-w-0 flex-1">用户 / 组 / API 令牌</span>
              <span className="w-44 shrink-0">角色</span>
              {!fixed && <span className="w-14 shrink-0">传播</span>}
              <span className="w-11 shrink-0" />
            </div>
            <ul className="divide-y divide-border/60" aria-label="权限条目">
              {shown.map((e) => (
                <AclRow key={aclKey(e)} entry={e} fixed={fixed} names={names.data} canEdit={canModifyAcl(perms, e.path, fixed ? pool : undefined)} onRemove={() => setRemoving(e)} />
              ))}
            </ul>
          </>
        )}
      </ListCard>

      <AclAddDialog open={adding !== null} onOpenChange={(o) => !o && setAdding(null)} type={adding ?? lastType} path={path} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        destructive
        title="删除这条权限？"
        description={
          removing && (
            <>
              {ACL_SUBJECT_LABEL[removing.type]} <span className="font-medium text-foreground">{removing.ugid}</span> 将失去在{' '}
              <span className="font-mono text-foreground">{removing.path}</span> 上的角色 <span className="font-medium text-foreground">{removing.roleid}</span>
              {removing.propagate ? '（及下级路径）' : ''}。
            </>
          )
        }
        confirmLabel="删除"
        onConfirm={async () => {
          if (!removing) return
          await runTask(updateAcl(aclRemoveParams(removing)), {
            title: `删除 ${removing.ugid} 在 ${removing.path} 的权限`,
            syncSuccessMessage: '已删除权限',
            invalidate: [accessKeys.all()],
          })
        }}
      />
    </>
  )
}

function AclRow({
  entry: e,
  fixed,
  names,
  canEdit,
  onRemove,
}: {
  entry: AclEntry
  fixed: boolean
  names: ReadonlyMap<string, string> | undefined
  canEdit: boolean
  onRemove: () => void
}) {
  const subject = e.type === 'group' ? `@${e.ugid}` : e.ugid
  return (
    <li className="flex items-center gap-3 py-2.5 pr-2 pl-(--card-p) lg:pr-(--card-p)" data-testid="acl-row" data-path={e.path} data-ugid={e.ugid} data-role={e.roleid}>
      <div className="grid min-w-0 flex-1 gap-1 lg:flex lg:items-center lg:gap-3">
        {!fixed && (
          <div className="min-w-0 lg:w-64 lg:shrink-0">
            <div className="truncate font-mono text-[13px] text-foreground">{e.path}</div>
            <div className="truncate text-xs text-muted-foreground">{describeAclPath(e.path, names)}</div>
          </div>
        )}
        <div className="flex min-w-0 items-center gap-2 lg:flex-1">
          <SubjectIcon type={e.type} />
          <span className="truncate text-sm font-medium text-foreground" title={`${ACL_SUBJECT_LABEL[e.type]} ${e.ugid}`}>
            {subject}
          </span>
          <span className="sr-only">（{ACL_SUBJECT_LABEL[e.type]}）</span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 lg:w-44 lg:shrink-0">
          <Pill tone="brand" className="font-medium">
            {e.roleid}
          </Pill>
          {!fixed && (
            <span className={cn('text-[11px] text-muted-foreground lg:hidden', !e.propagate && 'text-warning-strong')}>{e.propagate ? '传播到下级' : '不传播'}</span>
          )}
        </div>
        {!fixed && (
          <div className="hidden w-14 shrink-0 lg:block">
            {e.propagate ? (
              <ArrowDownToLine className="size-4 text-muted-foreground" aria-label="传播" />
            ) : (
              <span className="text-xs text-muted-foreground">否</span>
            )}
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 text-muted-foreground hover:text-destructive pointer-coarse:size-11"
        aria-label={`删除 ${e.ugid} 在 ${e.path} 的 ${e.roleid}`}
        title={canEdit ? '删除' : '没有修改这里权限的权限'}
        disabled={!canEdit}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </li>
  )
}
