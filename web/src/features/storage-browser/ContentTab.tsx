import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { AlertTriangle, Download, Ellipsis, Package, RefreshCw, Search, Upload, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'

import { useClusterResources } from '@/api/queries'
import {
  deleteVolume,
  storageKeys,
  updateVolume,
  useStorageContent,
  type StorageVolume,
} from '@/api/storage-browser'
import { isGuest, type GuestType, type StorageContent } from '@/api/types'
import { useSession } from '@/api/useSession'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { SelectField } from '@/components/form'
import { GlassCard } from '@/components/GlassCard'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { STORAGE_CONTENT_LABEL, type StorageTabProps } from '@/features/storage/types'
import { errorMessage } from '@/lib/errors'
import { DASH, formatBytes, formatDateTime } from '@/lib/format'
import { guestPath } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { BackupConfigDialog, VolumeDetailsDialog } from './VolumeDetailsDialog'
import { DownloadUrlDialog } from './DownloadUrlDialog'
import { ImportDialog } from './ImportDialog'
import { CONTENT_ICON, CONTENT_ITEM } from './labels'
import { NotesDialog } from './NotesDialog'
import { downloadDenied, transferContents, uploadDenied } from './permissions'
import { PruneDialog } from './PruneDialog'
import { RestoreDialog } from './RestoreDialog'
import { TemplateCatalogDialog } from './TemplateCatalogDialog'
import { UploadDialog } from './UploadDialog'
import { volumeActions, type VolumeAction, type VolumeDialogKind } from './volumeActions'
import { VolumeBadges } from './VolumeBadges'
import {
  backupGuestType,
  deleteBlockedReason,
  filterVolumes,
  sortVolumes,
  volumeName,
  volumeSize,
  volumeTime,
  volumeVmid,
  volumeVmids,
} from './volumes'

interface GuestInfo {
  node: string
  type: GuestType
  name: string
}

/** VMID → guest, for owner names and the "disk still in use" check. */
function useGuestIndex(): Map<number, GuestInfo> {
  const { data } = useClusterResources({ select: (all) => all.filter(isGuest) })
  return useMemo(
    () => new Map((data ?? []).map((g) => [g.vmid, { node: g.node, type: g.type, name: g.name ?? '' }] as const)),
    [data],
  )
}

type ToolDialog = 'upload' | 'download' | 'templates'

/**
 * One content type of a storage (backups, ISO images, templates, disks…):
 * search, VMID filter, a row per volume with its actions, and dialogs for
 * restore, notes, protection, prune, import and delete.
 */
export default function ContentTab({ node, storage, resource, content }: StorageTabProps) {
  const navigate = useNavigate()
  const session = useSession()
  const list = useStorageContent(node, storage, content)
  const guests = useGuestIndex()
  const guestNodes = useMemo(() => new Map([...guests].map(([k, g]) => [k, g.node])), [guests])
  const [query, setQuery] = useState('')
  const [vmidFilter, setVmidFilter] = useState<string | undefined>()
  const [dialog, setDialog] = useState<{ kind: VolumeDialogKind; volume: StorageVolume } | null>(null)
  const [lastDialog, setLastDialog] = useState(dialog)
  const [tool, setTool] = useState<ToolDialog | null>(null)
  if (dialog && dialog !== lastDialog) setLastDialog(dialog)

  const all = useMemo(() => sortVolumes(list.data ?? [], content), [list.data, content])
  const vmids = useMemo(() => volumeVmids(all), [all])
  const vmid = vmidFilter ? Number(vmidFilter) : undefined
  const shown = useMemo(() => filterVolumes(all, query, vmid), [all, query, vmid])
  const showVmidFilter = (content === 'backup' || content === 'images' || content === 'rootdir') && vmids.length > 1

  const transfer = transferContents(resource.content, resource.plugintype)
  const canTransfer = content === 'iso' || content === 'vztmpl' || content === 'import'
  const shared = resource.shared === 1
  const isPbs = resource.plugintype === 'pbs'
  const invalidate = [storageKeys.contentAll(node, storage), storageKeys.status(node, storage)]

  const ownerLabel = (v: StorageVolume): string | undefined => {
    const id = volumeVmid(v)
    if (id === undefined) return undefined
    const g = guests.get(id)
    const kind = v.content === 'rootdir' || backupGuestType(v) === 'lxc' ? 'CT' : 'VM'
    return g ? `${kind} ${id}${g.name ? ` · ${g.name}` : ''}` : `${kind} ${id}`
  }

  const actionsFor = (v: StorageVolume): VolumeAction[] => {
    const id = volumeVmid(v)
    const g = id !== undefined ? guests.get(id) : undefined
    return volumeActions(v, {
      open: (kind, volume) => setDialog({ kind, volume }),
      toggleProtected: (volume) => {
        const protect = volume.protected !== 1
        setDialog(null)
        runTask(updateVolume(node, storage, volume.volid, { protected: protect }), {
          title: protect ? '保护备份' : '取消保护',
          syncSuccessMessage: protect ? '备份已设为受保护' : '已取消保护',
          invalidate,
        }).catch((e: unknown) => toast.error(protect ? '保护失败' : '取消保护失败', { description: errorMessage(e) }))
      },
      openGuest: g && id !== undefined ? () => navigate(guestPath({ node: g.node, type: g.type, vmid: id })) : undefined,
      deleteBlocked: deleteBlockedReason(v, { guests: guestNodes, node, shared }),
      isPbs,
    })
  }

  const close = (open: boolean) => {
    if (!open) setDialog(null)
  }
  const d = lastDialog
  const dType = d ? backupGuestType(d.volume) : null
  const dVmid = d ? volumeVmid(d.volume) : undefined

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={content === 'backup' ? '搜索名称、格式、备注' : '搜索名称、格式'}
            aria-label="搜索"
            className="pl-9"
          />
        </div>
        {showVmidFilter && (
          <div className="w-36 shrink-0">
            <SelectField
              value={vmidFilter}
              onValueChange={setVmidFilter}
              emptyOption="全部 VMID"
              aria-label="按 VMID 筛选"
              options={vmids.map((n) => ({
                value: String(n),
                label: String(n),
                description: guests.get(n)?.name,
              }))}
            />
          </div>
        )}
        {list.data && (
          <span className="ml-auto text-xs text-muted-foreground tabular">
            {shown.length === all.length ? `${all.length} 项` : `${shown.length} / ${all.length} 项`}
          </span>
        )}
      </div>

      <GlassCard flush className="overflow-hidden">
        {list.isPending ? (
          <ListSkeleton />
        ) : list.isError ? (
          <EmptyState
            icon={AlertTriangle}
            title="无法读取存储内容"
            description={errorMessage(list.error)}
            action={
              <Button variant="outline" onClick={() => void list.refetch()}>
                <RefreshCw /> 重试
              </Button>
            }
          />
        ) : all.length === 0 ? (
          <EmptyContent
            content={content}
            actions={
              canTransfer && transfer.length > 0 ? (
                <div className="flex flex-wrap justify-center gap-2">
                  {content === 'vztmpl' && (
                    <Button onClick={() => setTool('templates')} disabled={!!uploadDenied(session?.cap)}>
                      <Package /> 容器模板
                    </Button>
                  )}
                  <Button
                    variant={content === 'vztmpl' ? 'outline' : 'default'}
                    onClick={() => setTool('upload')}
                    disabled={!!uploadDenied(session?.cap)}
                  >
                    <Upload /> 上传
                  </Button>
                  <Button variant="outline" onClick={() => setTool('download')} disabled={!!downloadDenied(session?.cap)}>
                    <Download /> 从 URL 下载
                  </Button>
                </div>
              ) : undefined
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState icon={Search} title="没有匹配的项目" description="换个关键词或清除 VMID 筛选。" />
        ) : (
          <ul className="divide-y divide-border/70" aria-label={content ? STORAGE_CONTENT_LABEL[content] : '内容'}>
            {shown.map((v) => (
              <VolumeRow
                key={v.volid}
                volume={v}
                owner={ownerLabel(v)}
                ownerMissing={volumeVmid(v) !== undefined && !guests.has(volumeVmid(v)!)}
                actions={actionsFor(v)}
                onOpen={() => setDialog({ kind: 'details', volume: v })}
              />
            ))}
          </ul>
        )}
      </GlassCard>

      {d?.kind === 'details' && (
        <VolumeDetailsDialog
          volume={d.volume}
          owner={ownerLabel(d.volume)}
          actions={actionsFor(d.volume)}
          open={dialog === d}
          onOpenChange={close}
        />
      )}
      {d?.kind === 'delete' && (
        <ConfirmDialog
          open={dialog === d}
          onOpenChange={close}
          destructive
          title={`删除${CONTENT_ITEM[d.volume.content] ?? '文件'}？`}
          description={
            <>
              <span className="font-medium break-all text-foreground">{volumeName(d.volume)}</span> 将从 {storage}{' '}
              永久删除，无法恢复。
            </>
          }
          confirmLabel="删除"
          typeToConfirm={dVmid !== undefined ? String(dVmid) : volumeName(d.volume)}
          onConfirm={() =>
            runTask(deleteVolume(node, storage, d.volume.volid), {
              title: `删除 ${volumeName(d.volume)}`,
              syncSuccessMessage: `已删除 ${volumeName(d.volume)}`,
              invalidate,
            })
          }
        />
      )}
      {d?.kind === 'notes' && (
        <NotesDialog node={node} storage={storage} volume={d.volume} open={dialog === d} onOpenChange={close} />
      )}
      {d?.kind === 'config' && <BackupConfigDialog node={node} volume={d.volume} open={dialog === d} onOpenChange={close} />}
      {d?.kind === 'restore' && dType && (
        <RestoreDialog node={node} volume={d.volume} type={dType} isPbs={isPbs} open={dialog === d} onOpenChange={close} />
      )}
      {d?.kind === 'prune' && (
        <PruneDialog
          node={node}
          storage={storage}
          backups={all}
          group={dType && dVmid !== undefined ? { type: dType, vmid: dVmid } : undefined}
          open={dialog === d}
          onOpenChange={close}
        />
      )}
      {d?.kind === 'import' && (
        <ImportDialog node={node} storage={storage} volume={d.volume} open={dialog === d} onOpenChange={close} />
      )}

      {canTransfer && (
        <>
          <UploadDialog
            node={node}
            storage={storage}
            contents={transfer}
            initialContent={content}
            open={tool === 'upload'}
            onOpenChange={(o) => !o && setTool(null)}
          />
          <DownloadUrlDialog
            node={node}
            storage={storage}
            contents={transfer}
            initialContent={content}
            open={tool === 'download'}
            onOpenChange={(o) => !o && setTool(null)}
          />
        </>
      )}
      {content === 'vztmpl' && (
        <TemplateCatalogDialog node={node} storage={storage} open={tool === 'templates'} onOpenChange={(o) => !o && setTool(null)} />
      )}
    </div>
  )
}

function VolumeRow({
  volume: v,
  owner,
  ownerMissing,
  actions,
  onOpen,
}: {
  volume: StorageVolume
  owner?: string
  ownerMissing: boolean
  actions: VolumeAction[]
  onOpen: () => void
}) {
  const Icon: LucideIcon = CONTENT_ICON[v.content] ?? Package
  const time = volumeTime(v)
  const size = volumeSize(v)
  const name = volumeName(v)
  const isBackup = v.content === 'backup'
  const isDisk = v.content === 'images' || v.content === 'rootdir'
  const title = isBackup && owner ? owner : name
  const meta = [
    isBackup ? null : isDisk ? (owner ? `${owner}${ownerMissing ? '（不存在）' : ''}` : null) : null,
    time ? formatDateTime(time) : null,
    v.format,
  ].filter(Boolean)

  return (
    <li className="flex items-stretch">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${name} 详情`}
        className={cn(
          'group flex min-h-14 min-w-0 flex-1 items-center gap-3 py-(--row-py) pl-(--card-p) text-left transition-colors outline-none compact:min-h-12',
          'hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] active:bg-foreground/[0.05] paper:hover:bg-secondary/50',
        )}
      >
        <span className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-muted-foreground sm:inline-flex paper:bg-secondary">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-foreground" title={name}>
              {title}
            </span>
            <VolumeBadges volume={v} className="hidden flex-nowrap sm:inline-flex" />
            {isDisk && ownerMissing && (
              <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-warning/15 px-1.5 text-[11px] text-warning paper:bg-secondary paper:text-foreground/75">
                孤立
              </span>
            )}
          </span>
          <span className="truncate text-xs text-muted-foreground tabular">
            {meta.join(' · ') || DASH}
          </span>
          {isBackup && v.notes && <span className="truncate text-xs text-foreground/70">{v.notes}</span>}
          <VolumeBadges volume={v} className="mt-0.5 sm:hidden" />
        </span>
        <span className="shrink-0 pl-2 text-right text-sm text-foreground/85 tabular">
          {size.bytes !== undefined ? `${size.approximate ? '~' : ''}${formatBytes(size.bytes)}` : DASH}
        </span>
      </button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${name} 的操作`}
            className="flex w-12 shrink-0 items-center justify-center text-muted-foreground transition-colors outline-none hover:bg-foreground/[0.03] hover:text-foreground focus-visible:bg-foreground/[0.05] lg:w-14"
          >
            <Ellipsis className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {actions.map((a) => (
            <ActionItem key={a.id} action={a} />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function ActionItem({ action: a }: { action: VolumeAction }) {
  return (
    <>
      {a.destructive && <DropdownMenuSeparator />}
      <DropdownMenuItem
        variant={a.destructive ? 'destructive' : 'default'}
        disabled={!!a.disabled}
        title={a.disabled ?? undefined}
        onSelect={a.run}
        className="min-h-9 pointer-coarse:min-h-11"
      >
        <a.icon />
        {a.label}
      </DropdownMenuItem>
    </>
  )
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-border/70" aria-busy="true" aria-label="加载中">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-(--card-p) py-4">
          <Skeleton className="hidden size-9 rounded-xl sm:block" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  )
}

const EMPTY_TEXT: Record<StorageContent, string> = {
  backup: '在客户机的备份页或数据中心的备份任务中创建备份。',
  iso: '上传 ISO 镜像，或让节点从 URL 直接下载。',
  vztmpl: '从官方模板目录下载，或上传自己的模板。',
  images: '创建虚拟机时选择这个存储，磁盘就会出现在这里。',
  rootdir: '创建容器时选择这个存储，容器卷就会出现在这里。',
  snippets: '片段（cloud-init、钩子脚本）需要在节点上直接放到存储的 snippets 目录。',
  import: '上传 OVA 或磁盘镜像，然后导入为虚拟机。',
}

function EmptyContent({ content, actions }: { content: StorageContent | undefined; actions?: ReactNode }) {
  const Icon = content ? CONTENT_ICON[content] : Package
  return (
    <EmptyState
      icon={Icon}
      title={content ? `还没有${/^[A-Za-z]/.test(STORAGE_CONTENT_LABEL[content]) ? ' ' : ''}${STORAGE_CONTENT_LABEL[content]}` : '存储是空的'}
      description={content ? EMPTY_TEXT[content] : undefined}
      action={actions}
    />
  )
}
