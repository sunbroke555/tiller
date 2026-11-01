import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Download, File, FileArchive, Folder, FolderOpen, HardDrive, Link2, Loader2, RotateCw } from 'lucide-react'

import { isPveApiError } from '@/api/client'
import { decodeFilePath, fetchFileRestoreList, fileRestoreDownloadUrl, type FileRestoreEntry } from '@/api/guest-backup'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { errorMessage } from '@/lib/errors'
import { formatBytes, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { PXAR_TYPE_LABEL, backupFileName, fileRestoreDownloadable } from './logic'
import { Notice } from './ui'

export interface FileRestoreDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  node: string
  /** PBS storage holding the backup. */
  storage: string
  volid: string
  /** VM archives: expand the disk images at the root (like the official browser). */
  isVm?: boolean
}

type Load = { state: 'loading'; attempt: number } | { state: 'ok'; entries: FileRestoreEntry[] } | { state: 'error'; message: string }

const ROOT = '/'
/** VM backups answer 503 until the restore VM has booted; retry for a while. */
const MAX_RETRIES = 10

/**
 * Browse a PBS backup and download files or folders (zip / tar.zst)
 * through /file-restore/list and /file-restore/download.
 */
export function FileRestoreDialog({ open, onOpenChange, node, storage, volid, isVm }: FileRestoreDialogProps) {
  const [loads, setLoads] = useState<Record<string, Load>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set([ROOT]))
  const [selected, setSelected] = useState<FileRestoreEntry | null>(null)
  const aborter = useRef<AbortController | null>(null)

  const load = useCallback(
    async (filepath: string) => {
      const ac = aborter.current
      if (!ac) return
      for (let attempt = 0; ; attempt++) {
        setLoads((l) => ({ ...l, [filepath]: { state: 'loading', attempt } }))
        try {
          const entries = await fetchFileRestoreList(node, storage, volid, filepath, ac.signal)
          entries.sort((a, b) => Number(b.type === 'd' || b.type === 'v') - Number(a.type === 'd' || a.type === 'v') || a.text.localeCompare(b.text))
          setLoads((l) => ({ ...l, [filepath]: { state: 'ok', entries } }))
          return entries
        } catch (e) {
          if (ac.signal.aborted) return
          if (isPveApiError(e) && e.status === 503 && attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, 2000))
            continue
          }
          setLoads((l) => ({ ...l, [filepath]: { state: 'error', message: errorMessage(e) } }))
          return
        }
      }
    },
    [node, storage, volid],
  )

  useEffect(() => {
    if (!open) return
    aborter.current = new AbortController()
    setLoads({})
    setExpanded(new Set([ROOT]))
    setSelected(null)
    void load(ROOT).then((entries) => {
      // Like the official browser: expand VM disk images, or a single archive.
      const auto = (entries ?? []).filter((e) => !e.leaf && (isVm || (entries ?? []).length === 1))
      if (auto.length) {
        setExpanded((s) => new Set([...s, ...auto.map((e) => e.filepath)]))
        for (const e of auto) void load(e.filepath)
      }
    })
    return () => aborter.current?.abort()
  }, [open, load, isVm])

  const toggle = (e: FileRestoreEntry) => {
    setSelected(e)
    if (e.leaf) return
    const opening = !expanded.has(e.filepath)
    const next = new Set(expanded)
    if (opening) next.add(e.filepath)
    else next.delete(e.filepath)
    setExpanded(next)
    const state = loads[e.filepath]?.state
    if (opening && (!state || state === 'error')) void load(e.filepath)
  }

  const download = (tar: boolean) => {
    if (!selected) return
    const a = document.createElement('a')
    a.href = fileRestoreDownloadUrl(node, storage, volid, selected.filepath, { tar: selected.type === 'd' && tar })
    a.download = selected.type === 'd' ? `${selected.text}${tar ? '.tar.zst' : '.zip'}` : selected.text
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const canDownload = !!selected && fileRestoreDownloadable(selected.type)
  const root = loads[ROOT]

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title="文件级恢复"
      description={<span className="block truncate font-mono text-xs">{backupFileName(volid)}</span>}
      bodyClassName="px-0 sm:px-0"
      footer={
        <>
          <span className="mr-auto hidden min-w-0 truncate self-center text-xs text-muted-foreground sm:block" title={selected ? decodeFilePath(selected.filepath) : undefined}>
            {selected ? decodeFilePath(selected.filepath) : '选择要下载的文件或文件夹'}
          </span>
          {selected?.type === 'd' ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button type="button" disabled={!canDownload}>
                  <Download />
                  下载文件夹
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top">
                <DropdownMenuItem onSelect={() => download(false)} className="pointer-coarse:min-h-11">
                  <FileArchive /> .zip
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => download(true)} className="pointer-coarse:min-h-11">
                  <FileArchive /> .tar.zst
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button type="button" disabled={!canDownload} onClick={() => download(false)} title={selected && !canDownload ? `${PXAR_TYPE_LABEL[selected.type] ?? '此类型'}不能直接下载，请下载上级文件夹` : undefined}>
              <Download />
              下载
            </Button>
          )}
        </>
      }
    >
      <div className="min-h-64 border-y border-border/60" role="tree" aria-label="备份中的文件">
        {!root || root.state === 'loading' ? (
          <LoadingRow depth={0} attempt={root?.state === 'loading' ? root.attempt : 0} isVm={isVm} />
        ) : root.state === 'error' ? (
          <div className="grid gap-3 p-5">
            <Notice tone="error">{root.message}</Notice>
            <Button variant="outline" className="justify-self-start" onClick={() => void load(ROOT)}>
              <RotateCw /> 重试
            </Button>
          </div>
        ) : root.entries.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">备份中没有文件。</p>
        ) : (
          <Entries
            entries={root.entries}
            depth={0}
            loads={loads}
            expanded={expanded}
            selected={selected}
            onToggle={toggle}
            onRetry={(fp) => void load(fp)}
            isVm={isVm}
          />
        )}
      </div>
    </ResponsiveDialog>
  )
}

function Entries({
  entries,
  depth,
  loads,
  expanded,
  selected,
  onToggle,
  onRetry,
  isVm,
}: {
  entries: FileRestoreEntry[]
  depth: number
  loads: Record<string, Load>
  expanded: Set<string>
  selected: FileRestoreEntry | null
  onToggle: (e: FileRestoreEntry) => void
  onRetry: (filepath: string) => void
  isVm: boolean | undefined
}) {
  return (
    <ul role="group">
      {entries.map((e) => {
        const open = expanded.has(e.filepath)
        const child = loads[e.filepath]
        const Icon = e.type === 'v' ? HardDrive : e.type === 'd' ? (open ? FolderOpen : Folder) : e.type === 'l' || e.type === 'h' ? Link2 : File
        const isSel = selected?.filepath === e.filepath
        return (
          <li key={e.filepath} role="treeitem" aria-expanded={e.leaf ? undefined : open} aria-selected={isSel}>
            <button
              type="button"
              onClick={() => onToggle(e)}
              className={cn(
                'flex min-h-11 w-full items-center gap-2 pr-5 text-left text-sm transition-colors outline-none hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset lg:pr-6 paper:hover:bg-secondary/60',
                isSel && 'bg-brand/10 hover:bg-brand/12 paper:bg-secondary',
              )}
              style={{ paddingLeft: `calc(1.25rem + ${depth} * 1.125rem)` }}
            >
              <ChevronRight className={cn('size-4 shrink-0 text-faint transition-transform', open && 'rotate-90', e.leaf && 'invisible')} aria-hidden />
              <Icon className={cn('size-4 shrink-0', e.type === 'd' || e.type === 'v' ? 'text-brand-strong paper:text-foreground/70' : 'text-muted-foreground')} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{e.text}</span>
              {e.leaf && e.size !== undefined && <span className="shrink-0 text-xs text-muted-foreground tabular">{formatBytes(e.size)}</span>}
              {e.mtime ? <span className="hidden w-32 shrink-0 text-right text-xs text-faint tabular sm:block">{formatDateTime(e.mtime)}</span> : null}
            </button>
            {open && !e.leaf && (
              <>
                {!child || child.state === 'loading' ? (
                  <LoadingRow depth={depth + 1} attempt={child?.state === 'loading' ? child.attempt : 0} isVm={isVm} />
                ) : child.state === 'error' ? (
                  <div className="flex items-center gap-2 py-2 pr-5 text-xs text-destructive" style={{ paddingLeft: `calc(2.75rem + ${depth} * 1.125rem)` }}>
                    <span className="min-w-0 flex-1 break-words">{child.message}</span>
                    <Button size="sm" variant="ghost" onClick={() => onRetry(e.filepath)} className="pointer-coarse:h-11">
                      重试
                    </Button>
                  </div>
                ) : child.entries.length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground" style={{ paddingLeft: `calc(2.75rem + ${depth} * 1.125rem)` }}>
                    空
                  </p>
                ) : (
                  <Entries
                    entries={child.entries}
                    depth={depth + 1}
                    loads={loads}
                    expanded={expanded}
                    selected={selected}
                    onToggle={onToggle}
                    onRetry={onRetry}
                    isVm={isVm}
                  />
                )}
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function LoadingRow({ depth, attempt, isVm }: { depth: number; attempt: number; isVm: boolean | undefined }) {
  return (
    <div className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground" style={{ paddingLeft: `calc(1.25rem + ${depth} * 1.125rem)` }}>
      <Loader2 className="size-4 animate-spin" />
      {attempt > 0 || isVm ? '正在启动文件恢复用的小虚拟机，首次打开可能需要一分钟…' : '正在读取…'}
    </div>
  )
}

export default FileRestoreDialog
