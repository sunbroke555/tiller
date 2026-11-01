// Pool management of the datacenter (PVE.dc.PoolView): create, edit comment,
// delete (only empty pools). Members are managed on the pool page.

import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ChevronRight, Ellipsis, FolderTree, Pencil, Plus, Trash2 } from 'lucide-react'

import { usePermissions } from '@/api/permissions'
import { useClusterResources } from '@/api/queries'
import { usePools } from '@/api/shell'
import { isGuest } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/QueryState'
import { ResourceIcon } from '@/components/ResourceIcon'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { poolPath } from '@/features/pool/paths'

import { poolDepth } from './logic'
import { DeletePoolDialog, PoolEditDialog } from './PoolDialogs'
import { ListCard, ListSkeleton } from './ui'

type Dialog = { kind: 'create' } | { kind: 'edit' | 'delete'; poolid: string; comment?: string } | null

export function PoolsAdminView() {
  const pools = usePools()
  const perms = usePermissions()
  const guestCounts = useClusterResources({
    select: (all) => {
      const m = new Map<string, number>()
      for (const g of all.filter(isGuest)) if (g.pool) m.set(g.pool, (m.get(g.pool) ?? 0) + 1)
      return m
    },
  })
  const canCreate = perms.can({ privs: 'Pool.Allocate', path: '/pool', anywhere: true })
  const canAllocate = (poolid: string) => perms.can({ privs: 'Pool.Allocate', path: `/pool/${poolid}` })
  const [dialog, setDialog] = useState<Dialog>(null)
  const [last, setLast] = useState<Dialog>(null)
  if (dialog && dialog !== last) setLast(dialog)
  const close = (o: boolean) => {
    if (!o) setDialog((d) => (d === last ? null : d))
  }
  const list = useMemo(() => [...(pools.data ?? [])].sort((a, b) => a.poolid.localeCompare(b.poolid)), [pools.data])

  return (
    <>
      <ListCard
        title="资源池"
        summary={pools.isPending ? '正在读取…' : `${list.length} 个资源池`}
        onRefresh={() => void pools.refetch()}
        refreshing={pools.isFetching}
        actions={
          <Button onClick={() => setDialog({ kind: 'create' })} disabled={!canCreate} title={canCreate ? undefined : '需要 Pool.Allocate 权限'}>
            <Plus />
            创建
          </Button>
        }
      >
        {pools.isPending ? (
          <ListSkeleton />
        ) : pools.isError ? (
          <ErrorState error={pools.error} onRetry={() => void pools.refetch()} compact />
        ) : list.length === 0 ? (
          <EmptyState
            icon={FolderTree}
            title="还没有资源池"
            description="资源池把客户机和存储分组，给整组授权比逐个授权方便。"
            action={
              canCreate ? (
                <Button variant="outline" onClick={() => setDialog({ kind: 'create' })}>
                  <Plus />
                  创建资源池
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-border/60" aria-label="资源池列表">
            {list.map((p) => {
              const depth = poolDepth(p.poolid)
              const name = p.poolid.split('/').pop()
              const allowed = canAllocate(p.poolid)
              const count = guestCounts.data?.get(p.poolid) ?? 0
              return (
                <li key={p.poolid} className="flex items-center gap-1 pr-2 transition-colors hover:bg-foreground/[0.03] lg:pr-(--card-p) paper:hover:bg-secondary/50" data-testid="pool-row" data-pool={p.poolid}>
                  <Link to={poolPath(p.poolid)} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-(--card-p)" aria-label={`打开资源池 ${p.poolid}`}>
                    <span style={{ width: depth * 20 }} className="shrink-0" aria-hidden />
                    <ResourceIcon type="pool" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate font-medium text-foreground">{name}</span>
                        {depth > 0 && <span className="truncate font-mono text-[11px] text-muted-foreground">{p.poolid}</span>}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {count} 台客户机{p.comment ? ` · ${p.comment}` : ''}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
                  </Link>
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`${p.poolid} 的操作`} className="shrink-0 text-muted-foreground pointer-coarse:size-11">
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-40">
                      <DropdownMenuItem disabled={!allowed} onSelect={() => setDialog({ kind: 'edit', poolid: p.poolid, comment: p.comment })}>
                        <Pencil />
                        编辑说明
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" disabled={!allowed} onSelect={() => setDialog({ kind: 'delete', poolid: p.poolid })}>
                        <Trash2 />
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              )
            })}
          </ul>
        )}
      </ListCard>

      {last?.kind === 'create' && <PoolEditDialog open={dialog === last} onOpenChange={close} />}
      {last?.kind === 'edit' && <PoolEditDialog open={dialog === last} onOpenChange={close} poolid={last.poolid} comment={last.comment} />}
      {last?.kind === 'delete' && <DeletePoolDialog open={dialog === last} onOpenChange={close} poolid={last.poolid} />}
    </>
  )
}
