// /datacenter/storage — storage.cfg: every storage definition with type,
// content, location, shared / enabled flags, node restriction and retention;
// add (all types), edit, enable/disable, remove, and links to the per-node
// storage browser.

import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CircleSlash, Ellipsis, FolderOpen, HardDrive, Pencil, Plus, Power, PowerOff, RefreshCw, Share2, Trash2 } from 'lucide-react'

import { p, put } from '@/api/client'
import { usePermissions } from '@/api/permissions'
import { useClusterResources } from '@/api/queries'
import { deleteStorage, isStorageType, useStorageDefs, type StorageDef, type StorageType } from '@/api/storage-config'
import { isStorage } from '@/api/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState } from '@/components/QueryState'
import { fireTask, runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { STORAGE_CONTENT_LABEL, storageContents } from '@/features/storage/types'
import { storageTypeLabel } from '@/features/storage-browser/labels'
import { storagePath } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { ALL_CONTENTS, retentionSummary, storageLocation, toggleParams } from './model'
import { PbsKeyDialog } from './PbsKeyDialog'
import { StorageEditDialog } from './StorageEditDialog'
import { TypeIcon } from './TypeIcon'
import { TypePickerDialog } from './TypePickerDialog'

type Dialog =
  | { kind: 'pick' }
  | { kind: 'edit'; type: StorageType; storage?: string }
  | { kind: 'remove' | 'disable'; def: StorageDef }
  | { kind: 'key'; storage: string; key: string }
  | null

export default function StorageConfigPage() {
  const defs = useStorageDefs()
  const perms = usePermissions()
  const canAdd = perms.can({ privs: 'Datastore.Allocate', path: '/storage' })
  const { data: placements } = useClusterResources({
    select: (all) => all.filter(isStorage).map((s) => ({ node: s.node, storage: s.storage })),
  })
  const [filter, setFilter] = useState('all')
  const [dialog, setDialog] = useState<Dialog>(null)
  // Keep the last dialog mounted while it animates out.
  const [last, setLast] = useState<Dialog>(null)
  if (dialog && dialog !== last) setLast(dialog)
  // Close only the dialog that asked: a save may already have opened the next one (PBS key).
  const close = (o: boolean) => {
    if (!o) setDialog((d) => (d === last ? null : d))
  }

  const all = defs.data ?? []
  const types = useMemo(() => [...new Set(all.map((d) => d.type))].sort((a, b) => storageTypeLabel(a).localeCompare(storageTypeLabel(b))), [all])
  const shown = filter === 'all' || !types.includes(filter) ? all : all.filter((d) => d.type === filter)
  const nodesOf = (id: string) => (placements ?? []).filter((s) => s.storage === id).map((s) => s.node).sort()

  const toggle = (def: StorageDef, enable: boolean) =>
    runTask(put(p`/storage/${def.storage}`, toggleParams(def, enable)), {
      title: `${enable ? '启用' : '禁用'}存储 ${def.storage}`,
      syncSuccessMessage: `已${enable ? '启用' : '禁用'}存储 ${def.storage}`,
    })

  return (
    <div className="grid gap-(--section-gap)">
      <GlassCard flush className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-(--card-p) py-3">
          <div className="min-w-0 flex-1">
            <h2 className="heading text-base font-medium text-foreground">存储定义</h2>
            <p className="text-xs text-muted-foreground">
              {defs.isPending ? (
                '正在读取…'
              ) : (
                <>
                  {all.length} 个存储<span className="max-sm:hidden"> · 配置对整个数据中心生效</span>
                </>
              )}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="刷新"
            title="刷新"
            onClick={() => void defs.refetch()}
            disabled={defs.isFetching}
            className="text-muted-foreground"
          >
            <RefreshCw className={cn(defs.isFetching && 'animate-spin')} />
          </Button>
          {canAdd && (
            <Button onClick={() => setDialog({ kind: 'pick' })}>
              <Plus />
              添加存储
            </Button>
          )}
        </div>

        {types.length > 1 && (
          <div className="overflow-x-auto scrollbar-none border-b border-border/60 px-(--card-p) py-2.5">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={types.includes(filter) ? filter : 'all'}
              onValueChange={(v) => v && setFilter(v)}
              aria-label="按类型筛选"
              className="w-max"
            >
              <ToggleGroupItem value="all" className="px-3 text-xs pointer-coarse:h-9">
                全部
              </ToggleGroupItem>
              {types.map((t) => (
                <ToggleGroupItem key={t} value={t} className="px-3 text-xs whitespace-nowrap pointer-coarse:h-9">
                  {storageTypeLabel(t)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}

        {defs.isPending ? (
          <div className="grid gap-2 p-(--card-p)">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : defs.isError ? (
          <ErrorState error={defs.error} onRetry={() => void defs.refetch()} compact />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={HardDrive}
            title="没有存储"
            description={canAdd ? '添加目录、NFS、SMB、PBS 等存储，用来存放磁盘、ISO、模板和备份。' : '当前账号看不到任何存储定义。'}
            action={
              canAdd && (
                <Button variant="outline" onClick={() => setDialog({ kind: 'pick' })}>
                  <Plus />
                  添加存储
                </Button>
              )
            }
          />
        ) : (
          <ul aria-label="存储列表" className="divide-y divide-border/60">
            {shown.map((def) => (
              <StorageRow
                key={def.storage}
                def={def}
                nodes={nodesOf(def.storage)}
                canEdit={perms.can({ privs: 'Datastore.Allocate' }, { kind: 'storage', storage: def.storage })}
                onEdit={() => isStorageType(def.type) && setDialog({ kind: 'edit', type: def.type, storage: def.storage })}
                onToggle={(enable) =>
                  enable
                    ? fireTask(put(p`/storage/${def.storage}`, toggleParams(def, true)), {
                        title: `启用存储 ${def.storage}`,
                        syncSuccessMessage: `已启用存储 ${def.storage}`,
                      })
                    : setDialog({ kind: 'disable', def })
                }
                onRemove={() => setDialog({ kind: 'remove', def })}
              />
            ))}
          </ul>
        )}
      </GlassCard>

      {last?.kind === 'pick' && (
        <TypePickerDialog
          open={dialog === last}
          onOpenChange={close}
          onPick={(type) => setDialog({ kind: 'edit', type })}
        />
      )}
      {last?.kind === 'edit' && (
        <StorageEditDialog
          open={dialog === last}
          onOpenChange={close}
          type={last.type}
          storageId={last.storage}
          onSaved={(storage, result) => {
            const key = result?.config?.['encryption-key']
            if (key) setDialog({ kind: 'key', storage, key })
          }}
        />
      )}
      {last?.kind === 'key' && <PbsKeyDialog open={dialog === last} onOpenChange={close} storage={last.storage} keyText={last.key} />}
      {last?.kind === 'remove' && (
        <ConfirmDialog
          open={dialog === last}
          onOpenChange={close}
          destructive
          title={`删除存储 ${last.def.storage}？`}
          description="只删除存储配置，存储上的数据不会被删除。引用这个存储的磁盘、备份任务和模板将无法访问它。"
          confirmLabel="删除"
          typeToConfirm={last.def.storage}
          onConfirm={() =>
            runTask(deleteStorage(last.def.storage), {
              title: `删除存储 ${last.def.storage}`,
              syncSuccessMessage: `已删除存储 ${last.def.storage}`,
            })
          }
        />
      )}
      {last?.kind === 'disable' && (
        <ConfirmDialog
          open={dialog === last}
          onOpenChange={close}
          title={`禁用存储 ${last.def.storage}？`}
          description="禁用后各节点不再激活这个存储：上面的磁盘无法启动，备份任务也不能写入。配置和数据保留，随时可以重新启用。"
          confirmLabel="禁用"
          onConfirm={() => toggle(last.def, false)}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------------ row

function StorageRow({
  def,
  nodes,
  canEdit,
  onEdit,
  onToggle,
  onRemove,
}: {
  def: StorageDef
  /** Nodes where the storage shows up (for the browser links). */
  nodes: string[]
  canEdit: boolean
  onEdit: () => void
  onToggle: (enable: boolean) => void
  onRemove: () => void
}) {
  const disabled = def.disable === 1
  const shared = def.shared === 1
  const editable = canEdit && isStorageType(def.type)
  const contents = ALL_CONTENTS.filter((c) => storageContents(def.content).includes(c))
  const location = storageLocation(def)
  const restricted = def.nodes ? def.nodes.split(',').filter(Boolean) : []
  const retention = retentionSummary(def['prune-backups'])

  const body = (
    <>
      <TypeIcon type={def.type} className={cn(disabled && 'opacity-50')} />
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('truncate font-medium text-foreground', disabled && 'text-muted-foreground')}>{def.storage}</span>
          <span className="text-xs text-muted-foreground">{storageTypeLabel(def.type)}</span>
          {shared && (
            <span className="inline-flex items-center gap-1 rounded-full bg-info/12 px-2 py-0.5 text-[11px] text-info paper:bg-secondary paper:text-foreground/70">
              <Share2 className="size-3" aria-hidden />
              共享
            </span>
          )}
          {disabled && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/12 px-2 py-0.5 text-[11px] text-destructive paper:bg-secondary">
              <CircleSlash className="size-3" aria-hidden />
              已禁用
            </span>
          )}
        </span>
        {location && <span className="truncate font-mono text-xs text-muted-foreground">{location}</span>}
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {contents.map((c) => (
            <span key={c} className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
              {STORAGE_CONTENT_LABEL[c]}
            </span>
          ))}
          <span className="text-[11px] text-muted-foreground">
            {restricted.length ? `节点：${restricted.join('、')}` : '所有节点'}
            {retention && ` · 保留：${retention}`}
          </span>
        </span>
      </span>
    </>
  )

  return (
    <li className="flex items-center gap-1 pr-2 transition-colors hover:bg-foreground/[0.03] lg:pr-(--card-p) paper:hover:bg-secondary/50" data-storage={def.storage}>
      {editable ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`编辑 ${def.storage}`}
          className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-(--card-p) text-left"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-(--card-p)">{body}</div>
      )}

      {nodes.length === 1 && (
        <Button variant="ghost" size="sm" asChild className="shrink-0 text-muted-foreground max-sm:size-11 max-sm:px-0">
          <Link to={storagePath(nodes[0]!, def.storage)} aria-label={`浏览 ${def.storage} 的内容`} title="浏览内容">
            <FolderOpen />
            <span className="max-sm:sr-only">浏览</span>
          </Link>
        </Button>
      )}

      {(canEdit || nodes.length > 1) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`${def.storage} 的操作`} className="shrink-0 text-muted-foreground pointer-coarse:size-11">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {nodes.length > 1 && (
              <>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">浏览内容</DropdownMenuLabel>
                {nodes.map((n) => (
                  <DropdownMenuItem key={n} asChild>
                    <Link to={storagePath(n, def.storage)}>
                      <FolderOpen />
                      {n}
                    </Link>
                  </DropdownMenuItem>
                ))}
                {canEdit && <DropdownMenuSeparator />}
              </>
            )}
            {canEdit && (
              <>
                <DropdownMenuItem onSelect={onEdit} disabled={!editable}>
                  <Pencil />
                  {editable ? '编辑' : '不支持编辑此类型'}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onToggle(disabled)}>
                  {disabled ? <Power /> : <PowerOff />}
                  {disabled ? '启用' : '禁用'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                  <Trash2 />
                  删除
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}
