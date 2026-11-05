import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Tag, X } from 'lucide-react'

import { updateGuestConfig, useClusterOptions, type GuestConfig } from '@/api/guest-core'
import { useClusterResources } from '@/api/queries'
import { isGuest, type GuestType } from '@/api/types'
import { usePermissions } from '@/api/permissions'
import { usePveIdentity } from '@/api/instances'
import { FieldInput, FormDialog, FormField } from '@/components/form'
import { GlassCard } from '@/components/GlassCard'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { useOpenSnapshot } from '@/hooks/useOpenSnapshot'
import { configUpdateParams } from '@/lib/propstring'

import { CardAction, CardTitle } from './parts'
import { TagBadge, useTagStyle } from './TagBadge'
import { bypassesTagAccess, joinTags, orderTags, parseUserTagAccess, splitTags, tagError } from './tags'

interface TagsCardProps {
  node: string
  type: GuestType
  vmid: number
  name: string
  /** Tags from /cluster/resources (live). */
  tags: string | undefined
  config: GuestConfig | undefined
  /** May change the tags (VM.Config.Options); read-only otherwise. */
  canEdit?: boolean
}

/** Tags with datacenter colours and an editor sheet. */
export function TagsCard({ node, type, vmid, name, tags, config, canEdit = true }: TagsCardProps) {
  const [open, setOpen] = useState(false)
  const style = useTagStyle()
  const list = orderTags(splitTags(config?.tags ?? tags), style)
  return (
    <GlassCard>
      <CardTitle title="标签" icon={Tag} action={canEdit ? <CardAction label="编辑" icon={Pencil} onClick={() => setOpen(true)} /> : null} />
      {list.length ? (
        <div className="flex flex-wrap gap-1.5">
          {list.map((t) => (
            <TagBadge key={t} tag={t} style={style} size="md" />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{canEdit ? '没有标签。标签可以用来分组、筛选和批量操作。' : '没有标签。'}</p>
      )}
      <TagsDialog open={open} onOpenChange={setOpen} node={node} type={type} vmid={vmid} name={name} config={config} fallback={tags} />
    </GlassCard>
  )
}

function TagsDialog({
  open,
  onOpenChange,
  node,
  type,
  vmid,
  name,
  config: liveConfig,
  fallback,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  node: string
  type: GuestType
  vmid: number
  name: string
  config: GuestConfig | undefined
  fallback: string | undefined
}) {
  // Config and digest as of opening: a concurrent edit is rejected, not undone.
  const config = useOpenSnapshot(open, liveConfig)
  const style = useTagStyle()
  const { data: options } = useClusterOptions()
  const pveUser = usePveIdentity()
  const perms = usePermissions()
  const { data: clusterTags } = useClusterResources({
    enabled: open,
    select: (all) => [...new Set(all.filter(isGuest).flatMap((g) => splitTags(g.tags)))].sort(),
  })
  const [tags, setTags] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTags(splitTags(config?.tags ?? fallback))
      setInput('')
      setError(null)
    }
  }, [open])

  // Users without Sys.Modify are limited by the datacenter's user-tag-access.
  const access = parseUserTagAccess(options)
  const privileged = bypassesTagAccess(perms, pveUser)
  const allowed = useMemo(() => {
    const listed = [...access.list, ...(options?.['allowed-tags'] ?? [])]
    if (privileged || access.mode === 'free') return null
    if (access.mode === 'none') return [] as string[]
    if (access.mode === 'list') return listed
    return [...new Set([...listed, ...(clusterTags ?? [])])]
  }, [privileged, access.mode, access.list, options, clusterTags])

  const suggestions = useMemo(() => {
    const pool = allowed ?? [...new Set([...(clusterTags ?? []), ...(options?.['allowed-tags'] ?? []), ...access.list])]
    const lower = new Set(tags.map((t) => t.toLowerCase()))
    const q = input.trim().toLowerCase()
    return pool.filter((t) => !lower.has(t.toLowerCase()) && (!q || t.toLowerCase().includes(q))).sort().slice(0, 24)
  }, [allowed, clusterTags, options, access.list, tags, input])

  const add = (raw: string) => {
    const t = raw.trim()
    const err = tagError(t, tags, style.caseSensitive)
    if (err) return setError(err)
    if (allowed && !allowed.includes(t)) return setError('只能使用数据中心允许的标签')
    setTags((list) => [...list, t])
    setInput('')
    setError(null)
  }

  const params = configUpdateParams(config, { tags: joinTags(tags) }, { digest: config?.digest })
  const readOnly = allowed !== null && allowed.length === 0

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`编辑标签 · ${name}`}
      description="颜色和排序来自数据中心的标签样式。"
      size="md"
      submitDisabled={!params || readOnly}
      onSubmit={() => runTask(updateGuestConfig(node, type, vmid, params!), { title: `更新 ${name} 的标签`, syncSuccessMessage: '标签已保存' })}
    >
      <div className="flex min-h-11 flex-wrap items-center gap-2" aria-label="当前标签">
        {tags.length === 0 && <span className="text-sm text-muted-foreground">没有标签</span>}
        {tags.map((t) => (
          <TagBadge key={t} tag={t} style={style} size="md" className="pr-1">
            <button
              type="button"
              onClick={() => setTags((list) => list.filter((x) => x !== t))}
              aria-label={`移除标签 ${t}`}
              className="-my-1 inline-flex size-6 items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100 pointer-coarse:size-8"
            >
              <X className="size-3.5" />
            </button>
          </TagBadge>
        ))}
      </div>

      {readOnly ? (
        <p className="text-sm text-muted-foreground">数据中心不允许普通用户修改标签。</p>
      ) : (
        <FormField label="添加标签" error={error ?? undefined} hint={allowed ? '只能从下面的列表中选择。' : '字母、数字和 + _ . -，按回车添加。'}>
          <div className="flex gap-2">
            <FieldInput
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === ' ') {
                  if (input.trim()) {
                    e.preventDefault()
                    add(input)
                  }
                }
              }}
              placeholder="例如 prod"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="flex-1"
            />
            <Button type="button" variant="outline" onClick={() => add(input)} disabled={!input.trim()} className="pointer-coarse:h-11">
              <Plus /> 添加
            </Button>
          </div>
        </FormField>
      )}

      {suggestions.length > 0 && !readOnly && (
        <div className="grid gap-2">
          <span className="text-xs text-muted-foreground">已有标签</span>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => add(t)}
                className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`添加标签 ${t}`}
              >
                <TagBadge tag={t} style={style} size="md" className="opacity-80 transition-opacity hover:opacity-100">
                  <Plus className="size-3" aria-hidden />
                </TagBadge>
              </button>
            ))}
          </div>
        </div>
      )}
    </FormDialog>
  )
}
