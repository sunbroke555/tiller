import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Search } from 'lucide-react'

import { pullOciImage, queryOciTags, storageKeys } from '@/api/storage-browser'
import { FieldInput, FormDialog, FormField } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { parseOciReference, validOciTag } from './volumes'

export interface OciPullDialogProps {
  node: string
  storage: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** "latest" first, then newest-looking versions (natural sort, descending). */
export function sortOciTags(tags: readonly string[]): string[] {
  return [...tags].sort((a, b) => {
    if (a === 'latest') return -1
    if (b === 'latest') return 1
    return b.localeCompare(a, undefined, { numeric: true })
  })
}

const MAX_TAGS = 60

/** Pull an OCI image (Docker Hub, GHCR, …) as an application container template. */
export function OciPullDialog({ node, storage, open, onOpenChange }: OciPullDialogProps) {
  const [reference, setReference] = useState('')
  const [tag, setTag] = useState('')
  const [filename, setFilename] = useState('')
  const [tags, setTags] = useState<string[] | null>(null)
  const [querying, setQuerying] = useState(false)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) return
    setReference('')
    setTag('')
    setFilename('')
    setTags(null)
    setQueryError(null)
    setTouched(false)
  }, [open])

  const changeReference = (value: string) => {
    setReference(value)
    setTags(null)
    setQueryError(null)
  }

  /** "nginx:1.27" entered: split into repository and tag (on blur, so "host:5000/…" can be typed). */
  const splitTag = () => {
    const parsed = parseOciReference(reference)
    if (parsed?.tag) {
      setReference(parsed.repository)
      setTag(parsed.tag)
    }
  }

  const query = async () => {
    splitTag()
    const parsed = parseOciReference(reference)
    if (!parsed) {
      setQueryError('镜像地址无效')
      return
    }
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    setQuerying(true)
    setQueryError(null)
    try {
      const list = await queryOciTags(node, parsed.repository, ac.signal)
      setTags(sortOciTags(list))
      if (!tag && list.includes('latest')) setTag('latest')
    } catch (e) {
      if (!ac.signal.aborted) setQueryError(errorMessage(e))
    } finally {
      if (abort.current === ac) setQuerying(false)
    }
  }

  const shownTags = useMemo(() => {
    if (!tags) return []
    const q = tag.trim().toLowerCase()
    const matching = q && !tags.includes(tag.trim()) ? tags.filter((t) => t.toLowerCase().includes(q)) : tags
    return matching.slice(0, MAX_TAGS)
  }, [tags, tag])

  const refValid = !!parseOciReference(reference) && !parseOciReference(reference)?.tag
  const refError = touched && !refValid ? '镜像地址无效，例如 docker.io/library/nginx' : (queryError ?? undefined)
  const tagError = touched && !validOciTag(tag) ? '请输入或选择标签' : undefined

  const submit = async () => {
    setTouched(true)
    const parsed = parseOciReference(reference)
    if (parsed?.tag) {
      // Submitted with "repo:tag" still in the field (Enter without blur).
      await runPull(parsed.repository, parsed.tag)
      return
    }
    if (!refValid || !validOciTag(tag)) throw new Error('请检查标记的字段')
    await runPull(reference.trim(), tag.trim())
  }

  const runPull = async (repository: string, t: string) => {
    const full = `${repository}:${t}`
    await runTask(pullOciImage(node, storage, full, filename.trim() || undefined), {
      title: `拉取 ${full}`,
      invalidate: [storageKeys.contentAll(node, storage), storageKeys.status(node, storage)],
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="拉取 OCI 镜像"
      description="从镜像仓库拉取镜像，保存为应用容器模板"
      submitLabel="拉取"
      onSubmit={submit}
    >
      <FormField label="镜像" name="reference" error={refError} required hint="例如 docker.io/library/nginx 或 ghcr.io/owner/app">
        <div className="flex gap-2">
          <FieldInput
            value={reference}
            onChange={(e) => changeReference(e.target.value)}
            onBlur={splitTag}
            placeholder="docker.io/library/nginx"
            spellCheck={false}
            autoCapitalize="off"
            className="flex-1"
          />
          <Button type="button" variant="outline" onClick={() => void query()} disabled={querying || !reference.trim()}>
            {querying ? <Loader2 className="animate-spin" /> : <Search />}
            查询标签
          </Button>
        </div>
      </FormField>

      <FormField label="标签" name="tag" error={tagError} required>
        <FieldInput
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="latest"
          spellCheck={false}
          autoCapitalize="off"
        />
      </FormField>
      {tags && (
        <div className="-mt-2 grid gap-2">
          <div className="text-xs text-muted-foreground">
            共 {tags.length} 个标签{shownTags.length < tags.length ? `，显示 ${shownTags.length} 个（输入以筛选）` : ''}
          </div>
          <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto" role="listbox" aria-label="可用标签">
            {shownTags.map((t) => (
              <button
                key={t}
                type="button"
                role="option"
                aria-selected={t === tag}
                onClick={() => setTag(t)}
                className={cn(
                  'h-8 rounded-full border px-3 font-mono text-xs transition-colors pointer-coarse:h-9',
                  t === tag
                    ? 'border-brand bg-brand/12 text-foreground'
                    : 'border-border bg-secondary text-secondary-foreground hover:bg-accent',
                )}
              >
                {t}
              </button>
            ))}
            {shownTags.length === 0 && <span className="text-xs text-muted-foreground">没有匹配的标签</span>}
          </div>
        </div>
      )}

      <FormField label="文件名" name="filename" hint="留空则使用 <镜像>_<标签>">
        <FieldInput value={filename} onChange={(e) => setFilename(e.target.value)} spellCheck={false} autoCapitalize="off" />
      </FormField>
    </FormDialog>
  )
}
