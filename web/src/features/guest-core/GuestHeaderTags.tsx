import { useId, useRef, useState } from 'react'
import { Check, LoaderCircle, Plus } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { get } from '@/api/client'
import { setDcOptions } from '@/api/dc-options'
import { guestBase, guestCoreKeys, updateGuestConfig, useClusterOptions, type ClusterOptions, type GuestConfig } from '@/api/guest-core'
import { usePermissions } from '@/api/permissions'
import { queryKeys, useClusterResources } from '@/api/queries'
import { isGuest, type GuestResource } from '@/api/types'
import { useSession } from '@/api/useSession'
import { TagChip, useTagStyle } from '@/components/TagChip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { errorMessage } from '@/lib/errors'
import { hexToRgb, orderTags, parseTagStyle, splitTags, tagColors, type TagStyle } from '@/lib/tags'

import { tagAccessError, tagColorParams, tagStyleString } from './tagEditing'
import { tagError } from './tags'

const COLORS = ['E7A6B5', 'D9B86F', 'B5C98D', '83BDA9', '82BBDD', 'A7A0DA', 'C2A4CB', 'B8BDC6']
const toHex = (rgb: readonly number[]) => rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()

/** Tags stay visible and editable beside the guest's status on every tab. */
export function GuestHeaderTags({ guest }: { guest: GuestResource }) {
  const style = useTagStyle()
  const perms = usePermissions()
  const session = useSession()
  const ready = session?.username === 'root@pam' || perms.ready
  const canColor = ready && perms.can({ privs: 'Sys.Modify', path: '/' })
  const canAdd = ready && perms.can({ privs: 'VM.Config.Options' }, { kind: 'guest', vmid: guest.vmid, pool: guest.pool })
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5" aria-label="客户机标签">
      {orderTags(splitTags(guest.tags), style).map((tag) => canColor ? (
        <TagPopover key={tag} guest={guest} tag={tag} canColor={canColor} style={style} />
      ) : <TagChip key={tag} tag={tag} shape="full" size="md" tagStyle={style} />)}
      {canAdd && <TagPopover guest={guest} canColor={canColor} style={style} />}
    </span>
  )
}

function TagPopover({ guest, tag, canColor, style }: { guest: GuestResource; tag?: string; canColor: boolean; style: TagStyle }) {
  const [open, setOpen] = useState(false)
  const busy = useRef(false)
  return (
    <Popover open={open} onOpenChange={(next) => { if (!busy.current) setOpen(next) }}>
      <PopoverTrigger asChild>
        {tag ? (
          <button type="button" aria-label={`修改标签 ${tag} 的颜色`} title="点击修改颜色" className="rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11">
            <TagChip tag={tag} shape="full" size="md" tagStyle={style} />
          </button>
        ) : (
          <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border px-2 text-xs text-muted-foreground transition-colors hover:border-ring hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11">
            <Plus className="size-3.5" aria-hidden /> 添加标签
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} collisionPadding={12} aria-label={tag ? `修改标签 ${tag} 的颜色` : '添加标签'} className="max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto">
        {open && <TagEditor guest={guest} tag={tag} canColor={canColor} onBusy={(value) => { busy.current = value }} onClose={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  )
}

function TagEditor({ guest, tag, canColor, onBusy, onClose }: { guest: GuestResource; tag?: string; canColor: boolean; onBusy: (busy: boolean) => void; onClose: () => void }) {
  const id = useId()
  const client = useQueryClient()
  const options = useClusterOptions({ refetchOnMount: 'always' })
  const resources = useClusterResources()
  const [input, setInput] = useState(tag ?? '')
  // Undefined preserves the current colour; an empty string restores the default.
  const [color, setColor] = useState<string>()
  const [added, setAdded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const name = input.trim()
  const editing = !!tag || added
  const style = parseTagStyle(tagStyleString(options.data ?? {}))
  const usedTags = [...new Set((resources.data ?? []).filter(isGuest).flatMap((g) => splitTags(g.tags)))]
  const suggestions = [...new Set([...usedTags, ...(options.data?.['allowed-tags'] ?? [])])]
    .filter((t) => !tagError(t, splitTags(guest.tags), style.caseSensitive) && !tagAccessError(t, options.data ?? {}, usedTags, canColor) && t.toLowerCase().includes(name.toLowerCase()))
    .sort().slice(0, 8)
  const validColor = color === undefined || color === '' || !!hexToRgb(color)
  const previewStyle = color === undefined || !validColor || !name || tagError(name, []) ? style : (() => {
    const params = tagColorParams(options.data ?? {}, name, color)
    return parseTagStyle(typeof params['tag-style'] === 'string' ? params['tag-style'] : '')
  })()
  const currentColor = tagColors(name || 'tag', previewStyle)
  const hex = toHex(currentColor.base)

  async function save() {
    if (saving) return
    setError(undefined)
    if (!editing) {
      const validation = tagError(name, splitTags(guest.tags), style.caseSensitive)
      if (validation) return setError(validation)
    }
    if (!validColor) return setError('请输入六位十六进制颜色，例如 #82BBDD')
    setSaving(true)
    onBusy(true)
    let tagSaved = added
    try {
      if (!editing) {
        const latestOptions = await get<ClusterOptions>('/cluster/options')
        const accessError = tagAccessError(name, latestOptions, usedTags, canColor)
        if (accessError) throw new Error(accessError)
        // Merge into the latest config; the digest rejects a subsequent concurrent edit.
        const config = await get<GuestConfig>(`${guestBase(guest.node, guest.type, guest.vmid)}/config`)
        const tags = splitTags(config.tags)
        const validation = tagError(name, tags, parseTagStyle(tagStyleString(latestOptions)).caseSensitive)
        if (validation) throw new Error(validation)
        const next = [...tags, name].join(';')
        await updateGuestConfig(guest.node, guest.type, guest.vmid, { tags: next, digest: config.digest })
        tagSaved = true
        setAdded(true)
        await Promise.all([
          client.invalidateQueries({ queryKey: queryKeys.resources() }),
          client.invalidateQueries({ queryKey: guestCoreKeys.config(guest.node, guest.type, guest.vmid) }),
        ])
      }
      if (canColor && color !== undefined) {
        // Fetch just before merging so other tag colours and unknown options survive.
        const latest = await get<ClusterOptions>('/cluster/options')
        await setDcOptions(tagColorParams(latest, name, color))
        await client.invalidateQueries({ queryKey: guestCoreKeys.clusterOptions() })
      }
      toast.success(tagSaved && !tag ? '标签已添加' : '标签颜色已保存')
      onClose()
    } catch (e) {
      setError(`${tagSaved && !tag ? '标签已添加，颜色未保存，可重试。' : ''}${errorMessage(e)}`)
    } finally {
      setSaving(false)
      onBusy(false)
    }
  }

  return (
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{editing ? '标签颜色' : '添加标签'}</h2>
        {name && !tagError(name, []) && <TagChip tag={name} tagStyle={previewStyle} shape="full" size="md" className="max-w-36" />}
      </div>
      {!editing && (
        <div className="grid gap-2">
          <label htmlFor={`${id}-name`} className="text-xs font-medium">标签名称</label>
          <Input id={`${id}-name`} value={input} onChange={(e) => { setInput(e.target.value); setError(undefined) }} disabled={saving} placeholder="例如 prod" autoComplete="off" autoCapitalize="off" spellCheck={false} />
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="已有标签">
              {suggestions.map((t) => <button key={t} type="button" disabled={saving} onClick={() => setInput(t)} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"><TagChip tag={t} tagStyle={style} shape="full" /></button>)}
            </div>
          )}
        </div>
      )}
      {canColor ? (
        <fieldset disabled={saving || !options.data} className="grid min-w-0 gap-3">
          <legend className="mb-2 text-xs font-medium">颜色</legend>
          <div className="grid grid-cols-8 gap-2 pointer-coarse:grid-cols-4">
            {COLORS.map((value) => (
              <button key={value} type="button" aria-label={`颜色 #${value}`} aria-pressed={currentColor.override && hex === value} onClick={() => setColor(value)} style={{ backgroundColor: `#${value}` }} className="inline-flex size-7 items-center justify-center rounded-full ring-1 ring-black/10 ring-inset outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-9">
                {currentColor.override && hex === value && <Check className="size-4 text-black/70" aria-hidden />}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="relative inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-input focus-within:ring-2 focus-within:ring-ring pointer-coarse:size-11">
              <span className="size-6 rounded-md ring-1 ring-black/10 ring-inset" style={{ backgroundColor: `#${hex}` }} aria-hidden />
              <input type="color" aria-label="自定义标签颜色" value={`#${hex}`} onChange={(e) => setColor(e.target.value.slice(1).toUpperCase())} className="absolute inset-0 size-full cursor-pointer opacity-0" />
            </label>
            <Input aria-label="颜色值" value={color === undefined || color === '' ? `#${hex}` : `#${color.replace(/^#/, '')}`} onChange={(e) => setColor(e.target.value.replace(/^#/, ''))} aria-invalid={!validColor} className="font-mono" spellCheck={false} />
            <Button type="button" variant="ghost" size="sm" onClick={() => setColor('')} className="shrink-0">默认色</Button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">同名标签在当前集群中共用此颜色。</p>
        </fieldset>
      ) : <p className="text-xs text-muted-foreground">使用默认颜色，自定义颜色需要管理员权限。</p>}
      {(error || !validColor || options.isError) && <p role="alert" className="text-xs text-destructive">{error ?? (!validColor ? '请输入六位十六进制颜色，例如 #82BBDD' : '无法读取标签设置，请关闭后重试。')}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onClose}>取消</Button>
        <Button type="submit" size="sm" disabled={saving || !options.data || !name || !validColor || (editing && color === undefined)}>
          {saving && <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
          {saving ? '保存中…' : editing ? '保存颜色' : '添加'}
        </Button>
      </div>
    </form>
  )
}
