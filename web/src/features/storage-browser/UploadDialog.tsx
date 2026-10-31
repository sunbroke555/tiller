import { useEffect, useRef, useState, type DragEvent } from 'react'
import { FileUp, Loader2, Upload, X } from 'lucide-react'

import {
  CHECKSUM_ALGORITHMS,
  storageKeys,
  uploadToStorage,
  type ChecksumAlgorithm,
  type TransferContent,
  type UploadHandle,
  type UploadProgress,
} from '@/api/storage-browser'
import { FieldInput, FormError, FormField, FormSection, SelectField } from '@/components/form'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { trackTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { STORAGE_CONTENT_LABEL } from '@/features/storage/types'
import { errorMessage } from '@/lib/errors'
import { formatBytes, formatDuration, formatRate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { ContentPicker } from './ContentPicker'
import { UPLOAD_HINT } from './labels'
import { CHECKSUM_LABEL, uploadAccept, uploadFilename, validateChecksum, validateFilename } from './volumes'

export interface UploadDialogProps {
  node: string
  storage: string
  /** Content types the storage accepts uploads for (iso / vztmpl / import). */
  contents: TransferContent[]
  initialContent?: TransferContent
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Transfer {
  progress: UploadProgress
  startedAt: number
  /** Bytes/s, smoothed. */
  rate: number
}

/**
 * Upload an ISO, container template or import file with a progress bar.
 * The file streams through the Go server to PVE, which then starts a task to
 * move it into place; that task shows up in the task toast.
 */
export function UploadDialog({ node, storage, contents, initialContent, open, onOpenChange }: UploadDialogProps) {
  const [content, setContent] = useState<TransferContent>(initialContent ?? contents[0] ?? 'iso')
  const [file, setFile] = useState<File | null>(null)
  const [filename, setFilename] = useState('')
  const [algorithm, setAlgorithm] = useState<ChecksumAlgorithm | undefined>()
  const [checksum, setChecksum] = useState('')
  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [dragging, setDragging] = useState(false)
  const handle = useRef<UploadHandle | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const uploading = transfer !== null

  useEffect(() => {
    if (!open) return
    setContent(initialContent && contents.includes(initialContent) ? initialContent : (contents[0] ?? 'iso'))
    setFile(null)
    setFilename('')
    setAlgorithm(undefined)
    setChecksum('')
    setTransfer(null)
    setError(null)
    setTouched(false)
    // Reset only when (re)opened.
  }, [open])

  // Leaving the page would cancel the transfer: ask first.
  useEffect(() => {
    if (!uploading) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [uploading])

  // Abort when the dialog unmounts mid-upload (e.g. navigation inside the app).
  useEffect(() => () => handle.current?.abort(), [])

  const pick = (f: File | undefined | null) => {
    if (!f) return
    setFile(f)
    setFilename(uploadFilename(f.name, content))
    setError(null)
  }

  const changeContent = (c: TransferContent) => {
    setContent(c)
    if (file) setFilename(uploadFilename(file.name, c))
  }

  const filenameError = file || touched ? validateFilename(filename, content) : null
  const checksumError = touched ? validateChecksum(algorithm, checksum) : null
  const canSubmit = !!file && !validateFilename(filename, content) && !validateChecksum(algorithm, checksum)

  const start = async () => {
    setTouched(true)
    if (!file || !canSubmit || uploading) return
    setError(null)
    const startedAt = performance.now()
    let last = { t: startedAt, loaded: 0 }
    setTransfer({ progress: { loaded: 0, total: file.size }, startedAt, rate: 0 })
    const h = uploadToStorage(
      { node, storage, content, file, filename: filename.trim(), checksumAlgorithm: algorithm, checksum },
      (progress) => {
        const now = performance.now()
        const dt = (now - last.t) / 1000
        setTransfer((prev) => {
          if (!prev) return prev
          if (dt < 0.4) return { ...prev, progress }
          const instant = (progress.loaded - last.loaded) / dt
          last = { t: now, loaded: progress.loaded }
          return { ...prev, progress, rate: prev.rate ? prev.rate * 0.7 + instant * 0.3 : instant }
        })
      },
    )
    handle.current = h
    try {
      const upid = await h.promise
      handle.current = null
      void trackTask(upid, {
        title: `上传 ${filename.trim()}`,
        invalidate: [storageKeys.contentAll(node, storage), storageKeys.status(node, storage)],
      })
      onOpenChange(false)
    } catch (e) {
      handle.current = null
      setTransfer(null)
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(errorMessage(e))
    }
  }

  const cancel = () => {
    if (uploading) {
      handle.current?.abort()
      return
    }
    onOpenChange(false)
  }

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    setDragging(false)
    if (!uploading) pick(e.dataTransfer.files[0])
  }

  const pct = transfer && transfer.progress.total > 0 ? transfer.progress.loaded / transfer.progress.total : 0
  const eta =
    transfer && transfer.rate > 0 ? (transfer.progress.total - transfer.progress.loaded) / transfer.rate : undefined

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : cancel())}
      dismissible={!uploading}
      title="上传文件"
      description={`上传到 ${storage}`}
      wrap={(sections) => (
        <form
          className="flex min-h-0 flex-1 flex-col"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void start()
          }}
        >
          {sections}
        </form>
      )}
      footer={
        <>
          <Button type="button" variant="outline" onClick={cancel}>
            {uploading ? (
              <>
                <X /> 取消上传
              </>
            ) : (
              '取消'
            )}
          </Button>
          <Button type="submit" disabled={uploading || !file}>
            {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
            {uploading ? '上传中…' : '上传'}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 pt-1 pb-2">
        {error && <FormError>{error}</FormError>}

        {contents.length > 1 && (
          <FormField label="内容类型">
            <ContentPicker
              value={content}
              options={contents}
              onChange={(c) => changeContent(c as TransferContent)}
              disabled={uploading}
            />
          </FormField>
        )}

        <label
          onDragOver={(e) => {
            e.preventDefault()
            if (!uploading) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'group relative flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-4 py-5 text-center transition-colors',
            'hover:border-brand/50 hover:bg-brand/[0.04] focus-within:ring-2 focus-within:ring-ring',
            dragging && 'border-brand bg-brand/[0.06]',
            uploading && 'pointer-events-none opacity-80',
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={uploadAccept(content)}
            className="sr-only"
            aria-label="选择文件"
            disabled={uploading}
            onChange={(e) => pick(e.target.files?.[0])}
          />
          <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-brand/10 text-brand ring-1 ring-brand/15 ring-inset paper:bg-secondary paper:text-foreground/70 paper:ring-border">
            <FileUp className="size-5" aria-hidden />
          </span>
          {file ? (
            <span className="grid max-w-full gap-0.5">
              <span className="truncate text-sm font-medium text-foreground">{file.name}</span>
              <span className="text-xs text-muted-foreground tabular">
                {formatBytes(file.size)}
                {file.type ? ` · ${file.type}` : ''} · 点击更换
              </span>
            </span>
          ) : (
            <span className="grid gap-0.5">
              <span className="text-sm font-medium text-foreground">
                <span className="pointer-fine:hidden">选择文件</span>
                <span className="hidden pointer-fine:inline">选择文件，或拖到这里</span>
              </span>
              <span className="text-xs text-muted-foreground">{UPLOAD_HINT[content]}</span>
            </span>
          )}
        </label>

        {transfer && (
          <div className="grid gap-2" aria-live="polite">
            <Progress value={pct * 100} aria-label="上传进度" />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground tabular">
              <span>
                <b className="font-medium text-foreground">{(pct * 100).toFixed(1)}%</b> ·{' '}
                {formatBytes(transfer.progress.loaded)} / {formatBytes(transfer.progress.total)}
              </span>
              <span>
                {pct >= 1
                  ? '等待服务器处理…'
                  : transfer.rate > 0
                    ? `${formatRate(transfer.rate)}${eta !== undefined ? ` · 剩余 ${formatDuration(eta)}` : ''}`
                    : '正在连接…'}
              </span>
            </div>
          </div>
        )}

        <FormField label="保存为" name="filename" error={filenameError ?? undefined} hint="PVE 会把文件名中的特殊字符替换为下划线">
          <FieldInput
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            disabled={uploading}
            placeholder={content === 'iso' ? 'debian-13.iso' : content === 'vztmpl' ? 'debian-13-standard.tar.zst' : 'appliance.ova'}
            spellCheck={false}
            autoCapitalize="off"
          />
        </FormField>

        <FormSection collapsible title="校验和" description={algorithm ? CHECKSUM_LABEL[algorithm] : '可选'}>
          <FormField label="算法">
            <SelectField
              value={algorithm}
              onValueChange={(v) => setAlgorithm(v as ChecksumAlgorithm | undefined)}
              emptyOption="不校验"
              options={CHECKSUM_ALGORITHMS.map((a) => ({ value: a, label: CHECKSUM_LABEL[a] }))}
              disabled={uploading}
            />
          </FormField>
          {algorithm && (
            <FormField label="校验和" name="checksum" error={checksumError ?? undefined} required>
              <FieldInput
                value={checksum}
                onChange={(e) => setChecksum(e.target.value)}
                disabled={uploading}
                className="font-mono text-xs"
                spellCheck={false}
                autoCapitalize="off"
                placeholder="十六进制字符串"
              />
            </FormField>
          )}
        </FormSection>
        <p className="text-xs leading-relaxed text-muted-foreground">
          上传期间请保持此页面打开。文件先暂存到节点的 /var/tmp，再由任务移动到 {storage} 的
          {STORAGE_CONTENT_LABEL[content]}目录。
        </p>
      </div>
    </ResponsiveDialog>
  )
}
