import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronRight,
  Download,
  File,
  FileArchive,
  Folder,
  HardDrive,
  Link2,
  Loader2,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react'

import {
  FILE_RESTORE_ROOT,
  fileRestoreDownloadUrl,
  useFileRestoreList,
  type FileRestoreEntry,
  type StorageVolume,
} from '@/api/storage-browser'
import { EmptyState } from '@/components/EmptyState'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/errors'
import { formatBytes, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  canDownloadEntry,
  decodeFilepath,
  downloadFilename,
  enterCrumb,
  fileTypeLabel,
  isBrowsable,
  isVmArchive,
  sortEntries,
  type Crumb,
} from './fileRestore'
import { volumeName } from './volumes'

export interface FileRestoreDialogProps {
  node: string
  storage: string
  volume: StorageVolume
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ROOT: Crumb = { filepath: FILE_RESTORE_ROOT, text: '根目录' }

/**
 * PBS file-level restore: browse the backup one directory at a time
 * (drill-down with a breadcrumb, which works on phones unlike a wide tree),
 * download files, or directories as .zip / .tar.zst.
 */
export function FileRestoreDialog({ node, storage, volume, open, onOpenChange }: FileRestoreDialogProps) {
  const [path, setPath] = useState<Crumb[]>([ROOT])
  const current = path[path.length - 1]!
  const list = useFileRestoreList(node, storage, open ? volume.volid : null, current.filepath)
  const vm = isVmArchive(volume.volid, volume.format)
  const slow = useSlowHint(list.isFetching && !list.data, vm ? 3_000 : 8_000)

  const download = (e: Pick<FileRestoreEntry, 'filepath' | 'text' | 'type'>, tar = false) => {
    const a = document.createElement('a')
    a.href = fileRestoreDownloadUrl(node, storage, volume.volid, e.filepath, tar)
    a.download = downloadFilename(e, tar)
    a.rel = 'noopener'
    document.body.append(a)
    a.click()
    a.remove()
  }

  // Container backups have a single archive (root.pxar.didx): open it right
  // away, like the official browser expands a lone child.
  const lone = path.length === 1 && list.data?.length === 1 && isBrowsable(list.data[0]!) ? list.data[0]! : null
  const autoOpened = useRef(false)
  useEffect(() => {
    if (!lone || autoOpened.current) return
    autoOpened.current = true
    setPath([ROOT, { filepath: lone.filepath, text: lone.text, type: lone.type }])
  }, [lone])

  const entries = list.data ? sortEntries(list.data) : []
  // Only real directories download as archives (not disk images or partitions).
  const here = current.type === 'd' ? { filepath: current.filepath, text: current.text, type: current.type } : null

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="文件级恢复"
      description={<span className="break-all">{volumeName(volume)}</span>}
      // The breadcrumb stays put; only the listing scrolls.
      bodyClassName="flex flex-col overflow-hidden px-0 lg:px-0"
      footer={
        here ? (
          <DownloadButton label="下载此目录" onDownload={(tar) => download(here, tar)} directory />
        ) : undefined
      }
    >
      <nav aria-label="路径" className="shrink-0 border-b border-border/60 px-5 lg:px-6">
        <ol className="-mx-2 flex min-h-11 items-center gap-0.5 overflow-x-auto py-1 text-sm whitespace-nowrap">
          {path.map((c, i) => {
            const last = i === path.length - 1
            return (
              <li key={c.filepath} className="flex shrink-0 items-center gap-0.5">
                {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground/70" aria-hidden />}
                <button
                  type="button"
                  disabled={last}
                  aria-current={last ? 'page' : undefined}
                  onClick={() => setPath(path.slice(0, i + 1))}
                  className={cn(
                    'max-w-48 truncate rounded-md px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:py-2.5',
                    last ? 'font-medium text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {c.text}
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {list.isPending ? (
          <div className="grid gap-1 px-5 py-3 lg:px-6" aria-busy="true" aria-label="加载中">
            {slow && (
              <p className="mb-2 flex items-start gap-2 rounded-xl bg-brand/10 px-3 py-2.5 text-sm text-foreground/85 paper:bg-secondary">
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-brand paper:text-foreground/70" aria-hidden />
                {vm
                  ? '正在启动用于恢复的临时虚拟机，第一次打开可能需要一分钟左右。'
                  : '正在从备份服务器读取目录，较大的备份需要一些时间。'}
              </p>
            )}
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5">
                <Skeleton className="size-8 rounded-lg" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        ) : list.isError ? (
          <EmptyState
            icon={AlertTriangle}
            title="无法读取备份内容"
            description={errorMessage(list.error)}
            action={
              <Button variant="outline" onClick={() => void list.refetch()}>
                <RefreshCw /> 重试
              </Button>
            }
          />
        ) : entries.length === 0 ? (
          <EmptyState icon={Folder} title="空目录" />
        ) : (
          <ul className="divide-y divide-border/60 pb-2" aria-label={`${current.text} 中的文件`}>
            {entries.map((e) => (
              <EntryRow
                key={e.filepath}
                entry={e}
                onOpen={() => setPath(enterCrumb(path, { filepath: e.filepath, text: e.text, type: e.type }))}
                onDownload={(tar) => download(e, tar)}
              />
            ))}
          </ul>
        )}
      </div>
    </ResponsiveDialog>
  )
}

/** True after `delay` ms of `active` (shows the "restore VM is starting" hint). */
function useSlowHint(active: boolean, delay: number): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => setSlow(true), delay)
    return () => {
      clearTimeout(t)
      setSlow(false)
    }
  }, [active, delay])
  return slow
}

function entryIcon(e: FileRestoreEntry): LucideIcon {
  if (e.type === 'd') return Folder
  if (e.type === 'v') return /\.(img|fidx)/.test(e.text) ? HardDrive : FileArchive
  if (e.type === 'l' || e.type === 'h') return Link2
  return File
}

function EntryRow({
  entry: e,
  onOpen,
  onDownload,
}: {
  entry: FileRestoreEntry
  onOpen: () => void
  onDownload: (tar: boolean) => void
}) {
  const Icon = entryIcon(e)
  const browsable = isBrowsable(e)
  const downloadable = canDownloadEntry(e.type)
  const meta = [
    fileTypeLabel(e.type),
    e.size !== undefined && e.type !== 'd' ? formatBytes(e.size) : null,
    e.mtime ? formatDateTime(e.mtime) : null,
  ].filter(Boolean)

  const body = (
    <>
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-muted-foreground paper:bg-secondary">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate font-medium text-foreground" title={decodeFilepath(e.filepath)}>
          {e.text}
        </span>
        <span className="truncate text-xs text-muted-foreground tabular">{meta.join(' · ')}</span>
      </span>
      {browsable && <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />}
    </>
  )

  return (
    <li className="flex items-stretch">
      {browsable ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`打开 ${e.text}`}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-5 text-left transition-colors outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] active:bg-foreground/[0.05] lg:pl-6 paper:hover:bg-secondary/50"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-5 lg:pl-6">{body}</div>
      )}
      <div className="flex w-14 shrink-0 items-center justify-center lg:w-16">
        {downloadable ? (
          <DownloadButton label={`下载 ${e.text}`} onDownload={onDownload} directory={e.type === 'd'} iconOnly />
        ) : (
          <span className="sr-only">{fileTypeLabel(e.type)}不能直接下载，请下载上级目录</span>
        )}
      </div>
    </li>
  )
}

/** Files download directly; directories ask for .zip or .tar.zst. */
function DownloadButton({
  label,
  onDownload,
  directory,
  iconOnly,
}: {
  label: string
  onDownload: (tar: boolean) => void
  directory?: boolean
  iconOnly?: boolean
}) {
  // Files download on click; for directories the menu trigger takes over.
  const onClick = directory ? undefined : () => onDownload(false)
  const trigger = iconOnly ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="size-11 text-muted-foreground hover:text-foreground"
    >
      <Download />
    </Button>
  ) : (
    <Button type="button" variant="outline" onClick={onClick}>
      <Download /> {label}
    </Button>
  )
  if (!directory) return trigger
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onSelect={() => onDownload(false)} className="min-h-9 pointer-coarse:min-h-11">
          <FileArchive /> 下载为 .zip
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDownload(true)} className="min-h-9 pointer-coarse:min-h-11">
          <FileArchive /> 下载为 .tar.zst
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
