import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Search } from 'lucide-react'

import {
  CHECKSUM_ALGORITHMS,
  downloadFromUrl,
  queryUrlMetadata,
  storageKeys,
  type ChecksumAlgorithm,
  type TransferContent,
  type UrlMetadata,
} from '@/api/storage-browser'
import { FieldInput, FormDialog, FormField, FormRow, FormSection, SelectField, SwitchField } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'
import { formatBytes } from '@/lib/format'

import { ContentPicker } from './ContentPicker'
import {
  CHECKSUM_LABEL,
  DOWNLOAD_COMPRESSIONS,
  downloadDefaults,
  filenameFromUrl,
  isHttpUrl,
  validateChecksum,
  validateFilename,
  type DownloadCompression,
} from './volumes'

export interface DownloadUrlDialogProps {
  node: string
  storage: string
  contents: TransferContent[]
  initialContent?: TransferContent
  open: boolean
  onOpenChange: (open: boolean) => void
}

const COMPRESSION_LABEL: Record<DownloadCompression, string> = { gz: 'GZIP', lzo: 'LZO', zst: 'ZSTD', bz2: 'BZIP2' }

/** Let the node download a file from a URL (ISO, template, import file). */
export function DownloadUrlDialog({ node, storage, contents, initialContent, open, onOpenChange }: DownloadUrlDialogProps) {
  const [content, setContent] = useState<TransferContent>(initialContent ?? contents[0] ?? 'iso')
  const [url, setUrl] = useState('')
  const [filename, setFilename] = useState('')
  const [filenameEdited, setFilenameEdited] = useState(false)
  const [meta, setMeta] = useState<UrlMetadata | null>(null)
  const [querying, setQuerying] = useState(false)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [verify, setVerify] = useState(true)
  const [compression, setCompression] = useState<DownloadCompression | undefined>()
  const [algorithm, setAlgorithm] = useState<ChecksumAlgorithm | undefined>()
  const [checksum, setChecksum] = useState('')
  const [touched, setTouched] = useState(false)
  const queryAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) return
    setContent(initialContent && contents.includes(initialContent) ? initialContent : (contents[0] ?? 'iso'))
    setUrl('')
    setFilename('')
    setFilenameEdited(false)
    setMeta(null)
    setQueryError(null)
    setVerify(true)
    setCompression(undefined)
    setAlgorithm(undefined)
    setChecksum('')
    setTouched(false)
  }, [open])

  const changeUrl = (value: string) => {
    setUrl(value)
    setMeta(null)
    setQueryError(null)
    if (!filenameEdited) setFilename(filenameFromUrl(value.trim()))
  }

  const query = async () => {
    if (!isHttpUrl(url)) {
      setQueryError('请输入 http:// 或 https:// 开头的地址')
      return
    }
    queryAbort.current?.abort()
    const ac = new AbortController()
    queryAbort.current = ac
    setQuerying(true)
    setQueryError(null)
    try {
      const m = await queryUrlMetadata(node, url.trim(), verify, ac.signal)
      setMeta(m)
      const d = downloadDefaults(m, content)
      if (d.filename) {
        setFilename(d.filename)
        setFilenameEdited(false)
      }
      setCompression(d.compression)
    } catch (e) {
      if (!ac.signal.aborted) setQueryError(errorMessage(e))
    } finally {
      if (queryAbort.current === ac) setQuerying(false)
    }
  }

  const urlError = touched && !isHttpUrl(url) ? '请输入 http:// 或 https:// 开头的地址' : (queryError ?? undefined)
  const filenameError = (touched || filename) && url ? (validateFilename(filename, content) ?? undefined) : undefined
  const checksumError = touched ? (validateChecksum(algorithm, checksum) ?? undefined) : undefined

  const submit = async () => {
    setTouched(true)
    if (!isHttpUrl(url) || validateFilename(filename, content) || validateChecksum(algorithm, checksum)) {
      throw new Error('请检查标记的字段')
    }
    const name = filename.trim()
    await runTask(
      downloadFromUrl(node, storage, {
        url: url.trim(),
        content,
        filename: name,
        'verify-certificates': verify,
        compression: content === 'iso' ? compression : undefined,
        'checksum-algorithm': algorithm,
        checksum: algorithm ? checksum.trim() : undefined,
      }),
      {
        title: `下载 ${name}`,
        invalidate: [storageKeys.contentAll(node, storage), storageKeys.status(node, storage)],
      },
    )
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="从 URL 下载"
      description={`由节点 ${node} 直接下载到 ${storage}`}
      submitLabel="下载"
      onSubmit={submit}
    >
      {contents.length > 1 && (
        <FormField label="内容类型">
          <ContentPicker
            value={content}
            options={contents}
            onChange={(c) => {
              setContent(c as TransferContent)
              if (meta) {
                const d = downloadDefaults(meta, c as TransferContent)
                if (d.filename && !filenameEdited) setFilename(d.filename)
                setCompression(d.compression)
              }
            }}
          />
        </FormField>
      )}

      <FormField label="URL" name="url" error={urlError} required>
        <div className="flex gap-2">
          <FieldInput
            value={url}
            onChange={(e) => changeUrl(e.target.value)}
            type="url"
            inputMode="url"
            placeholder="https://example.com/debian.iso"
            spellCheck={false}
            autoCapitalize="off"
            className="flex-1"
          />
          <Button type="button" variant="outline" onClick={() => void query()} disabled={querying || !url.trim()}>
            {querying ? <Loader2 className="animate-spin" /> : meta ? <Check /> : <Search />}
            查询
          </Button>
        </div>
      </FormField>

      {meta && (
        <dl className="grid grid-cols-2 gap-2 rounded-xl bg-foreground/[0.035] px-3 py-2.5 text-sm paper:bg-secondary/60">
          <div className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">文件大小</dt>
            <dd className="truncate tabular">{meta.size ? formatBytes(meta.size) : '未知'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">MIME 类型</dt>
            <dd className="truncate">{meta.mimetype || '未知'}</dd>
          </div>
        </dl>
      )}

      <FormField label="保存为" name="filename" error={filenameError} required hint="查询 URL 会自动填入文件名">
        <FieldInput
          value={filename}
          onChange={(e) => {
            setFilename(e.target.value)
            setFilenameEdited(true)
          }}
          spellCheck={false}
          autoCapitalize="off"
        />
      </FormField>

      <FormSection collapsible title="高级选项" description={algorithm ? `校验 ${CHECKSUM_LABEL[algorithm]}` : undefined}>
        <FormRow>
          <FormField label="校验算法">
            <SelectField
              value={algorithm}
              onValueChange={(v) => setAlgorithm(v as ChecksumAlgorithm | undefined)}
              emptyOption="不校验"
              options={CHECKSUM_ALGORITHMS.map((a) => ({ value: a, label: CHECKSUM_LABEL[a] }))}
            />
          </FormField>
          {content === 'iso' && (
            <FormField label="解压" name="compression" hint="下载后解压，例如 .iso.gz">
              <SelectField
                value={compression}
                onValueChange={(v) => setCompression(v as DownloadCompression | undefined)}
                emptyOption="不解压"
                options={DOWNLOAD_COMPRESSIONS.map((c) => ({ value: c, label: COMPRESSION_LABEL[c] }))}
              />
            </FormField>
          )}
        </FormRow>
        {algorithm && (
          <FormField label="校验和" name="checksum" error={checksumError} required>
            <FieldInput
              value={checksum}
              onChange={(e) => setChecksum(e.target.value)}
              className="font-mono text-xs"
              spellCheck={false}
              autoCapitalize="off"
            />
          </FormField>
        )}
        <SwitchField
          label="校验 TLS 证书"
          description="关闭后也会下载证书无效的 https 地址"
          checked={verify}
          onCheckedChange={(v) => {
            setVerify(v)
            setMeta(null)
          }}
        />
      </FormSection>
    </FormDialog>
  )
}
