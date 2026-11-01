// Per-backup dialogs (details, show config, notes, protection, delete,
// restore, file restore) and useBackupDialogs(), which hosts them. The guest
// Backup tab uses it; the storage browser can reuse it for its backup list:
//
//   const backups = useBackupDialogs({ node, isPBS: plugintype === 'pbs' })
//   <button onClick={() => backups.open('restore', volume)}>恢复</button>
//   {backups.host}

import { useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArchiveRestore,
  Copy,
  FileCode2,
  FolderSearch,
  KeyRound,
  Loader2,
  Lock,
  LockOpen,
  NotebookPen,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  backupGuestType,
  deleteBackup,
  isProtected,
  setBackupProtected,
  updateBackupNotes,
  useBackupConfig,
  type BackupVolume,
} from '@/api/guest-backup'
import { queryKeys } from '@/api/queries'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FieldTextarea, FormDialog, FormField } from '@/components/form'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { fireTask, runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'
import { formatBytes, formatDateTime, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { FileRestoreDialog } from './FileRestoreDialog'
import { backupFileName, formatBackupFormat, parseBackupConfig } from './logic'
import { RestoreDialog, type RestoreTarget } from './RestoreDialog'
import { Chip, ConfigLines, InfoList, Notice } from './ui'

// ---------------------------------------------------------------- config

export function BackupConfigDialog({ open, onOpenChange, node, backup }: { open: boolean; onOpenChange: (o: boolean) => void; node: string; backup: BackupVolume | null }) {
  const config = useBackupConfig(node, backup?.volid, open)
  const info = parseBackupConfig(config.data)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(config.data ?? '')
      toast.success('已复制配置')
    } catch {
      toast.error('无法访问剪贴板')
    }
  }
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="备份中的配置"
      description={backup ? <span className="block truncate font-mono text-xs">{backupFileName(backup.volid)}</span> : undefined}
      footer={
        <>
          <Button type="button" variant="outline" disabled={!config.data} onClick={() => void copy()}>
            <Copy />
            复制
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </>
      }
    >
      <div className="pt-1 pb-2">
        {config.isPending ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 正在从备份中读取配置…
          </p>
        ) : config.error ? (
          <Notice tone="error">{errorMessage(config.error)}</Notice>
        ) : (
          <ConfigLines lines={info.lines} />
        )}
      </div>
    </ResponsiveDialog>
  )
}

// ----------------------------------------------------------------- notes

export function BackupNotesDialog({ open, onOpenChange, node, backup }: { open: boolean; onOpenChange: (o: boolean) => void; node: string; backup: BackupVolume | null }) {
  const qc = useQueryClient()
  const [notes, setNotes] = useState('')
  useEffect(() => {
    if (open) setNotes(backup?.notes ?? '')
  }, [open, backup?.volid])
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="编辑备注"
      description={backup ? <span className="block truncate font-mono text-xs">{backupFileName(backup.volid)}</span> : undefined}
      submitDisabled={!backup || notes === (backup.notes ?? '')}
      onSubmit={async () => {
        if (!backup) return
        await updateBackupNotes(node, backup.storage, backup.volid, notes)
        toast.success('备注已保存')
        await qc.invalidateQueries({ queryKey: queryKeys.storage(node, backup.storage) })
      }}
    >
      <FormField label="备注" name="notes">
        <FieldTextarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-32" placeholder="例如：升级前的完整备份" autoFocus />
      </FormField>
    </FormDialog>
  )
}

// --------------------------------------------------------------- details

export interface BackupItemActions {
  restore: () => void
  config: () => void
  notes: () => void
  protect: () => void
  remove: () => void
  fileRestore?: (() => void) | undefined
}

/** Backup details with all its actions; the phone's main entry point for a backup. */
export function BackupDetailDialog({
  open,
  onOpenChange,
  backup,
  isPBS,
  actions,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  backup: BackupVolume | null
  isPBS: boolean
  actions: BackupItemActions
}) {
  if (!backup) return null
  const prot = isProtected(backup)
  const verify = backup.verification?.state
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={<span className="tabular">{formatDateTime(backup.ctime)}</span>}
      headerExtra={prot ? <Chip tone="warning" icon={<Lock />}>受保护</Chip> : undefined}
      description={`${formatRelativeTime(backup.ctime)} · ${backup.storage} · ${formatBytes(backup.size)}`}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button type="button" onClick={actions.restore}>
            <ArchiveRestore />
            恢复
          </Button>
        </>
      }
    >
      <div className="grid gap-5 pt-1 pb-2">
        <InfoList
          items={[
            { label: '格式', value: formatBackupFormat(backup.format) },
            ...(backup.vmid !== undefined ? [{ label: '客户机', value: <span className="tabular">{backup.vmid}</span> }] : []),
            ...(isPBS
              ? [
                  { label: '加密', value: backup.encrypted ? <span className="inline-flex items-center gap-1"><KeyRound className="size-3.5" /> 已加密</span> : '未加密' },
                  {
                    label: '校验',
                    value: !verify ? '未校验' : verify === 'ok' ? <span className="text-success-strong">通过</span> : <span className="text-destructive">失败</span>,
                  },
                ]
              : []),
          ]}
        />
        <div className="grid gap-1.5">
          <span className="text-sm text-muted-foreground">卷 ID</span>
          <p className="rounded-xl bg-foreground/[0.03] px-3 py-2 font-mono text-xs leading-5 break-all text-foreground select-all paper:bg-secondary/50">
            {backup.volid}
          </p>
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">备注</span>
            <Button type="button" size="sm" variant="ghost" onClick={actions.notes} className="-mr-2 text-muted-foreground">
              <NotebookPen />
              编辑
            </Button>
          </div>
          {backup.notes ? (
            <p className="rounded-xl bg-foreground/[0.03] px-3 py-2 text-sm whitespace-pre-wrap break-words paper:bg-secondary/50">{backup.notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground">无备注</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ActionTile icon={<FileCode2 />} label="显示配置" onClick={actions.config} />
          {actions.fileRestore && <ActionTile icon={<FolderSearch />} label="文件级恢复" onClick={actions.fileRestore} />}
          <ActionTile icon={prot ? <LockOpen /> : <Lock />} label={prot ? '取消保护' : '设为受保护'} onClick={actions.protect} />
          <ActionTile
            icon={<Trash2 />}
            label="删除"
            destructive
            disabled={prot}
            hint={prot ? '受保护的备份不能删除' : undefined}
            onClick={actions.remove}
          />
        </div>
      </div>
    </ResponsiveDialog>
  )
}

function ActionTile({
  icon,
  label,
  onClick,
  destructive,
  disabled,
  hint,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
  hint?: string | undefined
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={cn(
        'flex min-h-12 items-center gap-2.5 rounded-xl border border-border/70 bg-secondary/40 px-3 text-left text-sm font-medium transition-colors outline-none',
        'hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
        destructive ? 'text-destructive' : 'text-foreground [&_svg]:text-muted-foreground',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

/** "校验通过"/"校验失败" icon for PBS rows. */
export function VerifyIcon({ state }: { state: string | undefined }) {
  if (!state) return null
  return state === 'ok' ? (
    <ShieldCheck className="size-3.5 text-success-strong" aria-label="校验通过" />
  ) : (
    <ShieldAlert className="size-3.5 text-destructive" aria-label="校验失败" />
  )
}

// ------------------------------------------------------------------ host

export type BackupDialogKind = 'detail' | 'restore' | 'config' | 'notes' | 'delete' | 'file-restore'

export interface UseBackupDialogsOptions {
  node: string
  /** Storage plugin type per storage id (PBS enables live restore and file restore). */
  isPBS: (storage: string) => boolean
  /** Guest the backups belong to (guest tab): restore can overwrite it. */
  target?: RestoreTarget | undefined
}

/**
 * State + rendering of every per-backup dialog. `open(kind, backup)` shows
 * one; render `host` once. `toggleProtection` acts directly (no dialog).
 */
export function useBackupDialogs({ node, isPBS, target }: UseBackupDialogsOptions) {
  const [state, setState] = useState<{ kind: BackupDialogKind; backup: BackupVolume } | null>(null)
  // Keep the last one mounted while it animates out.
  const [last, setLast] = useState(state)
  if (state && state !== last) setLast(state)

  const open = (kind: BackupDialogKind, backup: BackupVolume) => setState({ kind, backup })
  const close = (o: boolean) => {
    if (!o) setState(null)
  }

  const toggleProtection = (b: BackupVolume) => {
    const next = !isProtected(b)
    fireTask(setBackupProtected(node, b.storage, b.volid, next), {
      title: next ? '设为受保护' : '取消保护',
      syncSuccessMessage: next ? '已设为受保护' : '已取消保护',
      invalidate: [queryKeys.storage(node, b.storage)],
    })
  }

  const actionsFor = (b: BackupVolume): BackupItemActions => ({
    restore: () => open('restore', b),
    config: () => open('config', b),
    notes: () => open('notes', b),
    protect: () => {
      setState(null)
      toggleProtection(b)
    },
    remove: () => open('delete', b),
    fileRestore: isPBS(b.storage) ? () => open('file-restore', b) : undefined,
  })

  const b = last?.backup ?? null
  const kind = last?.kind
  const isOpen = (k: BackupDialogKind) => state !== null && state === last && kind === k
  let host: ReactNode = null
  if (b && kind === 'detail') {
    host = <BackupDetailDialog open={isOpen('detail')} onOpenChange={close} backup={b} isPBS={isPBS(b.storage)} actions={actionsFor(b)} />
  } else if (b && kind === 'restore') {
    host = (
      <RestoreDialog
        open={isOpen('restore')}
        onOpenChange={close}
        node={node}
        backup={b}
        target={target}
        isPBS={isPBS(b.storage)}
      />
    )
  } else if (b && kind === 'config') {
    host = <BackupConfigDialog open={isOpen('config')} onOpenChange={close} node={node} backup={b} />
  } else if (b && kind === 'notes') {
    host = <BackupNotesDialog open={isOpen('notes')} onOpenChange={close} node={node} backup={b} />
  } else if (b && kind === 'file-restore') {
    host = (
      <FileRestoreDialog
        open={isOpen('file-restore')}
        onOpenChange={close}
        node={node}
        storage={b.storage}
        volid={b.volid}
        isVm={backupGuestType(b) === 'qemu'}
      />
    )
  } else if (b && kind === 'delete') {
    host = (
      <ConfirmDialog
        open={isOpen('delete')}
        onOpenChange={close}
        title="删除这个备份？"
        description={
          <>
            <span className="block">
              {formatDateTime(b.ctime)} · {b.storage} · {formatBytes(b.size)}
            </span>
            <span className="mt-1 block break-all font-mono text-xs">{backupFileName(b.volid)}</span>
            <span className="mt-2 block">备份文件会被永久删除，无法恢复。</span>
          </>
        }
        confirmLabel="删除"
        destructive
        // Irreversible: type the guest ID (like deleting it from the storage page).
        typeToConfirm={b.vmid !== undefined ? String(b.vmid) : backupFileName(b.volid)}
        onConfirm={() =>
          runTask(deleteBackup(node, b.storage, b.volid), {
            title: `删除备份 ${backupFileName(b.volid)}`,
            syncSuccessMessage: '备份已删除',
            invalidate: [queryKeys.storage(node, b.storage)],
          })
        }
      />
    )
  }

  return { open, close, toggleProtection, actionsFor, host }
}
