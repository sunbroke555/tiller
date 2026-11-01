// Roles (PVE.dc.RoleView): built-in roles are read-only; custom roles can be
// created, edited and deleted (Sys.Modify on /access).

import { useMemo, useState } from 'react'
import { ChevronRight, Copy, Ellipsis, Lock, Pencil, Plus, Shapes, Trash2 } from 'lucide-react'

import { accessKeys, deleteRole, useAcl, useRoles, type RoleInfo } from '@/api/access-control'
import { usePermissions } from '@/api/permissions'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/QueryState'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import { groupPrivileges, parsePrivs } from './logic'
import { BuiltinRoleDialog, RoleDialog } from './RoleDialog'
import { ListCard, ListSkeleton, Pill } from './ui'

type Filter = 'all' | 'custom' | 'builtin'

type Dialog =
  | { kind: 'create'; privs?: string[] }
  | { kind: 'edit' | 'view' | 'delete'; role: RoleInfo }
  | null

export function RolesView() {
  const roles = useRoles()
  const perms = usePermissions()
  const canEdit = perms.can({ privs: 'Sys.Modify', path: '/access' })
  const [filter, setFilter] = useState<Filter>('all')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [last, setLast] = useState<Dialog>(null)
  if (dialog && dialog !== last) setLast(dialog)
  const close = (o: boolean) => {
    if (!o) setDialog((d) => (d === last ? null : d))
  }

  const list = useMemo(
    () =>
      [...(roles.data ?? [])].sort((a, b) => (a.special ?? 0) - (b.special ?? 0) || a.roleid.localeCompare(b.roleid)),
    [roles.data],
  )
  const custom = list.filter((r) => !r.special).length
  const shown = list.filter((r) => filter === 'all' || (filter === 'custom' ? !r.special : !!r.special))

  const open = (r: RoleInfo) => setDialog(r.special || !canEdit ? { kind: 'view', role: r } : { kind: 'edit', role: r })

  return (
    <>
      <ListCard
        title="角色"
        summary={roles.isPending ? '正在读取…' : `${list.length} 个角色 · ${custom} 个自定义`}
        onRefresh={() => void roles.refetch()}
        refreshing={roles.isFetching}
        actions={
          <Button onClick={() => setDialog({ kind: 'create' })} disabled={!canEdit} title={canEdit ? undefined : '需要 /access 上的 Sys.Modify'}>
            <Plus />
            创建
          </Button>
        }
        toolbar={
          <ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} aria-label="筛选角色" className="w-max">
            <ToggleGroupItem value="all" className="px-3 text-xs pointer-coarse:h-9">
              全部
            </ToggleGroupItem>
            <ToggleGroupItem value="custom" className="px-3 text-xs pointer-coarse:h-9">
              自定义
            </ToggleGroupItem>
            <ToggleGroupItem value="builtin" className="px-3 text-xs pointer-coarse:h-9">
              内置
            </ToggleGroupItem>
          </ToggleGroup>
        }
      >
        {roles.isPending ? (
          <ListSkeleton />
        ) : roles.isError ? (
          <ErrorState error={roles.error} onRetry={() => void roles.refetch()} compact />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={Shapes}
            title={filter === 'custom' ? '还没有自定义角色' : '没有角色'}
            description={filter === 'custom' ? '内置角色不够用时，创建一个只包含所需权限的角色。' : undefined}
            action={
              filter === 'custom' && canEdit ? (
                <Button variant="outline" onClick={() => setDialog({ kind: 'create' })}>
                  <Plus />
                  创建角色
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-border/60" aria-label="角色列表">
            {shown.map((r) => (
              <RoleRow
                key={r.roleid}
                role={r}
                canEdit={canEdit}
                onOpen={() => open(r)}
                onEdit={() => setDialog({ kind: 'edit', role: r })}
                onClone={() => setDialog({ kind: 'create', privs: parsePrivs(r.privs) })}
                onDelete={() => setDialog({ kind: 'delete', role: r })}
              />
            ))}
          </ul>
        )}
      </ListCard>

      {last?.kind === 'create' && <RoleDialog open={dialog === last} onOpenChange={close} initialPrivs={last.privs} />}
      {last?.kind === 'edit' && <RoleDialog open={dialog === last} onOpenChange={close} role={last.role} />}
      {last?.kind === 'view' && (
        <BuiltinRoleDialog
          open={dialog === last}
          onOpenChange={close}
          role={last.role}
          onClone={canEdit ? () => setDialog({ kind: 'create', privs: parsePrivs(last.role.privs) }) : undefined}
        />
      )}
      {last?.kind === 'delete' && <DeleteRoleDialog open={dialog === last} onOpenChange={close} role={last.role} />}
    </>
  )
}

function RoleRow({
  role: r,
  canEdit,
  onOpen,
  onEdit,
  onClone,
  onDelete,
}: {
  role: RoleInfo
  canEdit: boolean
  onOpen: () => void
  onEdit: () => void
  onClone: () => void
  onDelete: () => void
}) {
  const privs = parsePrivs(r.privs)
  const groups = groupPrivileges(privs)
  const builtin = !!r.special
  return (
    <li className="flex items-center gap-1 pr-2 transition-colors hover:bg-foreground/[0.03] lg:pr-(--card-p) paper:hover:bg-secondary/50" data-testid="role-row" data-role={r.roleid}>
      <button type="button" onClick={onOpen} aria-label={`${builtin ? '查看' : '编辑'}角色 ${r.roleid}`} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-(--card-p) text-left">
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate font-medium text-foreground">{r.roleid}</span>
            {builtin ? (
              <Pill>
                <Lock />
                内置
              </Pill>
            ) : (
              <Pill tone="brand">自定义</Pill>
            )}
            <span className="text-xs text-muted-foreground tabular">{privs.length} 项权限</span>
          </span>
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {privs.length === 0 ? '没有任何权限' : groups.map((g) => `${g.label} ${g.privs.length}`).join(' · ')}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-faint lg:hidden" aria-hidden />
      </button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${r.roleid} 的操作`} className="shrink-0 text-muted-foreground pointer-coarse:size-11">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {builtin ? (
            <DropdownMenuItem onSelect={onOpen}>
              <Lock />
              查看权限
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onEdit} disabled={!canEdit}>
              <Pencil />
              编辑
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onClone} disabled={!canEdit}>
            <Copy />
            复制为新角色
          </DropdownMenuItem>
          {!builtin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete} disabled={!canEdit}>
                <Trash2 />
                删除
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function DeleteRoleDialog({ open, onOpenChange, role }: { open: boolean; onOpenChange: (o: boolean) => void; role: RoleInfo }) {
  const acl = useAcl(open)
  const uses = (acl.data ?? []).filter((e) => e.roleid === role.roleid).length
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      destructive
      title={`删除角色 ${role.roleid}？`}
      description={
        uses > 0
          ? `有 ${uses} 条权限使用这个角色，删除后它们一并失效。`
          : '没有权限条目使用这个角色。'
      }
      confirmLabel="删除"
      typeToConfirm={role.roleid}
      onConfirm={() =>
        runTask(deleteRole(role.roleid), {
          title: `删除角色 ${role.roleid}`,
          syncSuccessMessage: `已删除角色 ${role.roleid}`,
          invalidate: [accessKeys.roles(), accessKeys.acl()],
        })
      }
    />
  )
}
