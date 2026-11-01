import { useState, type ReactNode } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'

import { useBackupConfig, type StorageVolume } from '@/api/storage-browser'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { STORAGE_CONTENT_LABEL } from '@/features/storage/types'
import { errorMessage } from '@/lib/errors'
import { DASH, formatBytes, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { VolumeAction } from './volumeActions'
import { VolumeBadges } from './VolumeBadges'
import { volumeName, volumeSize, volumeTime, volumeVmid } from './volumes'

export interface VolumeDetailsDialogProps {
  volume: StorageVolume
  /** "VM 100 · web" when the owning guest is known. */
  owner?: string
  actions: VolumeAction[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Everything about one volume plus its actions; the phone's main way to act on a row. */
export function VolumeDetailsDialog({ volume: v, owner, actions, open, onOpenChange }: VolumeDetailsDialogProps) {
  const size = volumeSize(v)
  const time = volumeTime(v)
  const vmid = volumeVmid(v)
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={<span className="break-all">{volumeName(v)}</span>}
      description={STORAGE_CONTENT_LABEL[v.content] ?? v.content}
      size="md"
    >
      <div className="grid gap-5 pb-2">
        <dl className="grid gap-0 text-sm">
          <Row label="卷 ID">
            <CopyText text={v.volid} />
          </Row>
          <Row label="格式">{v.format || DASH}</Row>
          <Row label="大小">
            {size.bytes !== undefined ? `${size.approximate ? '约 ' : ''}${formatBytes(size.bytes)}` : DASH}
          </Row>
          {v.used !== undefined && v.used !== v.size && <Row label="实际占用">{formatBytes(v.used)}</Row>}
          <Row label={v.content === 'backup' ? '备份时间' : '创建时间'}>{time ? formatDateTime(time) : DASH}</Row>
          {vmid !== undefined && <Row label="所属">{owner ?? `${vmid}`}</Row>}
          {v.content === 'backup' && <Row label="备注">{v.notes ? <span className="whitespace-pre-line">{v.notes}</span> : DASH}</Row>}
          {(v.protected === 1 || v.encrypted || v.verification) && (
            <Row label="状态">
              <VolumeBadges volume={v} className="justify-end" />
            </Row>
          )}
          {v.parent && <Row label="基础镜像">{v.parent}</Row>}
        </dl>

        {actions.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {actions.map((a) => (
              <Button
                key={a.id}
                type="button"
                variant="outline"
                disabled={!!a.disabled}
                title={a.disabled ?? undefined}
                onClick={a.run}
                className={cn('h-11 justify-start', a.destructive && 'text-destructive hover:text-destructive', a.id === 'restore' && 'col-span-2 sm:col-span-1')}
              >
                <a.icon />
                {a.label}
              </Button>
            ))}
            {[...new Set(actions.map((a) => a.disabled).filter(Boolean))].map((reason) => (
              <p key={reason} className="col-span-2 text-xs text-muted-foreground">
                {reason}
              </p>
            ))}
          </div>
        )}
      </div>
    </ResponsiveDialog>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-start justify-between gap-4 border-b border-border/60 py-2.5 last:border-b-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-all text-foreground">{children}</dd>
    </div>
  )
}

function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="inline-flex items-start gap-1.5">
      <span className="font-mono text-xs leading-5">{text}</span>
      <button
        type="button"
        aria-label="复制卷 ID"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
        className="-my-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:size-9"
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  )
}

export interface BackupConfigDialogProps {
  node: string
  volume: StorageVolume
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The guest configuration stored in a backup (vzdump/extractconfig). */
export function BackupConfigDialog({ node, volume, open, onOpenChange }: BackupConfigDialogProps) {
  const cfg = useBackupConfig(node, open ? volume.volid : null)
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="备份中的配置"
      description={<span className="break-all">{volumeName(volume)}</span>}
    >
      {cfg.isPending ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> 正在读取…
        </div>
      ) : cfg.isError ? (
        <p className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{errorMessage(cfg.error)}</p>
      ) : (
        <pre className="mb-2 overflow-x-auto rounded-xl bg-foreground/[0.04] p-3 font-mono text-xs leading-relaxed whitespace-pre text-foreground paper:bg-secondary/60">
          {cfg.data.trim() || '（空）'}
        </pre>
      )}
    </ResponsiveDialog>
  )
}
