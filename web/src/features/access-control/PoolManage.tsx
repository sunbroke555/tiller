// Management controls of the pool page (/pool/<id>): add / remove members,
// edit, delete (Pool.Allocate on /pool/<id>), and the pool's permissions.

import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ChevronDown, Ellipsis, ListMinus, Monitor, Pencil, Plus, Database, Trash2 } from 'lucide-react'

import { usePermissions } from '@/api/permissions'
import type { PoolInfo } from '@/api/shell'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

import { AclView, canModifyAcl } from './AclView'
import { AddGuestsDialog, AddStorageDialog, DeletePoolDialog, PoolEditDialog, RemoveMembersDialog } from './PoolDialogs'

type Dialog = 'guests' | 'storage' | 'remove' | 'edit' | 'delete' | null

/** Header buttons of the pool page; nothing when the user may not change the pool. */
export function PoolManageActions({ pool }: { pool: PoolInfo }) {
  const perms = usePermissions()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [last, setLast] = useState<Dialog>(null)
  if (dialog && dialog !== last) setLast(dialog)
  const close = (o: boolean) => {
    if (!o) setDialog((d) => (d === last ? null : d))
  }
  if (!perms.can({ privs: 'Pool.Allocate', path: `/pool/${pool.poolid}` })) return null
  const members = pool.members ?? []

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button>
            <Plus />
            <span className="max-sm:sr-only">添加成员</span>
            <ChevronDown className="opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem onSelect={() => setDialog('guests')}>
            <Monitor />
            客户机
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog('storage')}>
            <Database />
            存储
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="资源池操作" className="pointer-coarse:size-11">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem onSelect={() => setDialog('edit')}>
            <Pencil />
            编辑说明
          </DropdownMenuItem>
          <DropdownMenuItem disabled={members.length === 0} onSelect={() => setDialog('remove')}>
            <ListMinus />
            移除成员
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog('delete')}>
            <Trash2 />
            删除资源池
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {last === 'guests' && <AddGuestsDialog open={dialog === last} onOpenChange={close} poolid={pool.poolid} />}
      {last === 'storage' && <AddStorageDialog open={dialog === last} onOpenChange={close} poolid={pool.poolid} members={members} />}
      {last === 'remove' && <RemoveMembersDialog open={dialog === last} onOpenChange={close} poolid={pool.poolid} members={members} />}
      {last === 'edit' && <PoolEditDialog open={dialog === last} onOpenChange={close} poolid={pool.poolid} comment={pool.comment} />}
      {last === 'delete' && (
        <DeletePoolDialog open={dialog === last} onOpenChange={close} poolid={pool.poolid} onDeleted={() => void navigate('/datacenter/permissions/pools')} />
      )}
    </div>
  )
}

/** The pool's own ACL entries (pool page "权限"), shown when the user may change them. */
export function PoolPermissions({ poolid }: { poolid: string }) {
  const perms = usePermissions()
  const path = `/pool/${poolid}`
  if (!canModifyAcl(perms, path)) return null
  return (
    <section aria-label="资源池权限">
      <AclView path={path} />
    </section>
  )
}
