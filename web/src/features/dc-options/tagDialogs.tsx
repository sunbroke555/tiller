// Tag options: tag style (shape, ordering, case sensitivity, colour
// overrides with colour pickers), user tag access and registered tags.

import { useMemo } from 'react'
import { Info, Plus, Trash2 } from 'lucide-react'

import type { DcOptions } from '@/api/dc-options'
import { useClusterResources } from '@/api/queries'
import { FormDialog, FormField, SelectField, SwitchField } from '@/components/form'
import { TagChip } from '@/components/TagChip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { collectTags, parseTagStyle, stringToRgb, type TagShape } from '@/lib/tags'
import { cn } from '@/lib/utils'

import { saveOptions, type OptionDialogProps } from './dialogs'
import {
  TAG_ORDERINGS,
  TAG_SHAPES,
  USER_TAG_MODES,
  overlap,
  parseTagList,
  parseTagStyleForm,
  parseUserTagAccessForm,
  rgbToHex,
  tagListValue,
  tagStyleValue,
  userTagAccessValue,
  validateColorOverrides,
  type ColorOverride,
  type TagStyleForm,
  type UserTagAccessForm,
} from './model'
import { TagListEditor, ValidationError, useFormState } from './ui'

/** Tags used by guests (for suggestions). */
function useUsedTags(enabled: boolean): string[] {
  const resources = useClusterResources({ enabled })
  return useMemo(() => collectTags(resources.data ?? []).map((t) => t.tag), [resources.data])
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p role="note" className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

// ------------------------------------------------------------ tag style

/** A row of the colour override editor; `auto` rows follow the tag's hash colour until a colour is picked. */
type OverrideRow = ColorOverride & { key: number; auto?: boolean }
type StyleState = Omit<TagStyleForm, 'colors'> & { colors: OverrideRow[] }

let rowKey = 0
const hashHex = (tag: string) => rgbToHex(stringToRgb(tag))

export function TagStyleDialog({ open, onOpenChange, options }: OptionDialogProps) {
  const snap = useFormState<DcOptions | undefined>(open, () => options)[0]
  const [form, setForm] = useFormState<StyleState>(open, () => {
    const f = parseTagStyleForm(snap?.['tag-style'])
    return { ...f, colors: f.colors.map((c) => ({ ...c, key: ++rowKey })) }
  })
  const [attempted, setAttempted] = useFormState(open, () => false)
  const used = useUsedTags(open)
  const rowErrors = validateColorOverrides(form.colors, form.caseSensitive)
  const preview = useMemo(() => parseTagStyle(tagStyleValue({ ...form, colors: form.colors.filter((_, i) => !rowErrors[i]) })), [form, rowErrors])
  const set = (patch: Partial<StyleState>) => setForm((f) => ({ ...f, ...patch }))
  const setRow = (key: number, patch: Partial<OverrideRow>) =>
    setForm((f) => ({ ...f, colors: f.colors.map((c) => (c.key === key ? { ...c, ...patch } : c)) }))
  const addRow = (tag = '') => setForm((f) => ({ ...f, colors: [...f.colors, { key: ++rowKey, tag, bg: hashHex(tag), fg: '', auto: true }] }))
  const overridden = new Set(form.colors.map((c) => c.tag.trim().toLowerCase()))
  const offer = used.filter((t) => !overridden.has(t.toLowerCase())).slice(0, 10)
  const shape = (form.shape ?? 'circle') as TagShape

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="标签样式"
      description="标签在资源树中的形状、排序和按标签覆盖的颜色。"
      size="lg"
      onSubmit={async () => {
        setAttempted(true)
        if (rowErrors.some(Boolean)) throw new ValidationError()
        const { colors, ...rest } = form
        await saveOptions(snap, { 'tag-style': tagStyleValue({ ...rest, colors: colors.map(({ tag, bg, fg }) => ({ tag, bg, fg })) }) }, '修改标签样式')
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="资源树形状" name="shape">
          <SelectField
            value={form.shape}
            onValueChange={(shape) => set({ shape })}
            emptyOption="默认（圆点）"
            options={Object.entries(TAG_SHAPES).map(([value, label]) => ({
              value,
              label,
              description: value === 'none' ? undefined : <TagChip tag="preview" shape={value as TagShape} tagStyle={preview} />,
            }))}
          />
        </FormField>
        <FormField label="排序" name="ordering">
          <SelectField
            value={form.ordering}
            onValueChange={(ordering) => set({ ordering })}
            emptyOption="默认（按字母顺序）"
            options={Object.entries(TAG_ORDERINGS).map(([value, label]) => ({ value, label }))}
          />
        </FormField>
      </div>
      <SwitchField
        label="区分大小写"
        description="标签名区分大小写（只影响之后的编辑）。"
        checked={form.caseSensitive}
        onCheckedChange={(caseSensitive) => set({ caseSensitive })}
      />

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-medium">颜色覆盖</legend>
        {form.colors.length === 0 && <p className="text-sm text-faint">没有覆盖，标签使用按名称生成的颜色。</p>}
        <ul className="grid gap-2" aria-label="颜色覆盖">
          {form.colors.map((c, i) => (
            <li key={c.key} data-testid="color-override" className="grid gap-1.5 rounded-xl border border-border/70 p-2.5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex">
                <Input
                  value={c.tag}
                  aria-label="标签"
                  placeholder="标签名"
                  aria-invalid={attempted && !!rowErrors[i]}
                  onChange={(e) => setRow(c.key, { tag: e.target.value, ...(c.auto ? { bg: hashHex(e.target.value.trim()) } : {}) })}
                  className="min-w-0 sm:flex-1 pointer-coarse:h-11"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`删除 ${c.tag || '此行'}`}
                  onClick={() => setForm((f) => ({ ...f, colors: f.colors.filter((x) => x.key !== c.key) }))}
                  className="size-11 shrink-0 text-muted-foreground sm:order-last lg:size-9"
                >
                  <Trash2 />
                </Button>
                <div className="col-span-2 flex flex-wrap items-center gap-2">
                  <ColorPicker label={`${c.tag || '标签'} 背景色`} text="背景" value={c.bg} onChange={(bg) => setRow(c.key, { bg, auto: false })} />
                  <ColorPicker label={`${c.tag || '标签'} 文字颜色`} text="文字" value={c.fg} auto onChange={(fg) => setRow(c.key, { fg })} />
                  <span className="ml-auto flex min-w-16 justify-center sm:ml-1">
                    {c.tag.trim() && !rowErrors[i] && <TagChip tag={c.tag.trim()} tagStyle={preview} shape="full" size="md" />}
                  </span>
                </div>
              </div>
              {attempted && rowErrors[i] && <p className="text-xs text-destructive">{rowErrors[i]}</p>}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={() => addRow()} className="pointer-coarse:h-10">
            <Plus /> 添加覆盖
          </Button>
          {offer.length > 0 && <span className="ml-1 text-xs text-muted-foreground">在用的标签：</span>}
          {offer.map((t) => (
            <button key={t} type="button" onClick={() => addRow(t)} aria-label={`为 ${t} 添加颜色覆盖`} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <TagChip tag={t} tagStyle={preview} />
            </button>
          ))}
        </div>
      </fieldset>

      {used.length > 0 && (
        <div className="grid gap-2">
          <span className="text-sm font-medium">预览</span>
          <div className={cn('flex flex-wrap items-center gap-1.5 rounded-xl border border-border/70 p-3')} data-testid="tag-style-preview">
            {(preview.ordering === 'alphabetical' ? [...used].sort((a, b) => a.localeCompare(b)) : used).slice(0, 16).map((t) => (
              <TagChip key={t} tag={t} tagStyle={preview} shape={shape} />
            ))}
          </div>
        </div>
      )}
    </FormDialog>
  )
}

/** Native colour input behind a swatch button; `auto` adds an "自动" choice (empty value). */
function ColorPicker({ label, text, value, onChange, auto }: { label: string; text: string; value: string; onChange: (hex: string) => void; auto?: boolean }) {
  const isAuto = auto && !value
  return (
    <span className="inline-flex items-center gap-1">
      <label
        className="relative inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-(--field) px-2 text-xs text-muted-foreground focus-within:ring-2 focus-within:ring-ring pointer-coarse:h-11"
        title={label}
      >
        <span
          aria-hidden
          className={cn('size-5 rounded-md ring-1 ring-black/10 ring-inset', isAuto && 'bg-[linear-gradient(135deg,#fff_50%,#141413_50%)]')}
          style={isAuto ? undefined : { background: `#${value}` }}
        />
        {isAuto ? `${text}自动` : text}
        <input
          type="color"
          aria-label={label}
          value={`#${value || '000000'}`}
          onChange={(e) => onChange(e.target.value.slice(1).toUpperCase())}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      {auto && value && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')} className="h-9 px-2 text-xs pointer-coarse:h-11" aria-label={`${label}改为自动`}>
          自动
        </Button>
      )}
    </span>
  )
}

// ------------------------------------------------------------ user tag access

export function UserTagAccessDialog({ open, onOpenChange, options }: OptionDialogProps) {
  const snap = useFormState<DcOptions | undefined>(open, () => options)[0]
  const [form, setForm] = useFormState<UserTagAccessForm>(open, () => parseUserTagAccessForm(snap?.['user-tag-access']))
  const used = useUsedTags(open)
  const registered = parseTagList(snap?.['registered-tags'])
  const both = overlap(form.list, registered)
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="用户标签权限"
      description="没有 / 上 Sys.Modify 权限的用户（有客户机的 VM.Config.Options 权限）可以设置哪些标签。"
      onSubmit={() => saveOptions(snap, { 'user-tag-access': userTagAccessValue(form) }, '修改用户标签权限')}
    >
      <FormField label="模式" name="user-allow">
        <SelectField
          value={form.mode}
          onValueChange={(mode) => setForm((f) => ({ ...f, mode }))}
          emptyOption="默认（free）"
          options={Object.entries(USER_TAG_MODES).map(([value, m]) => ({ value, label: m.label, description: m.hint }))}
        />
      </FormField>
      <FormField label="预定义标签" hint="list 和 existing 模式下用户可以使用的标签。">
        <TagListEditor label="预定义标签" tags={form.list} onChange={(list) => setForm((f) => ({ ...f, list }))} suggestions={used} emptyText="没有预定义标签" />
      </FormField>
      {both.length > 0 && <Note>这些标签同时是注册标签（仍需要 Sys.Modify）：{both.join('、')}</Note>}
    </FormDialog>
  )
}

// ------------------------------------------------------------ registered tags

export function RegisteredTagsDialog({ open, onOpenChange, options }: OptionDialogProps) {
  const snap = useFormState<DcOptions | undefined>(open, () => options)[0]
  const [tags, setTags] = useFormState<string[]>(open, () => parseTagList(snap?.['registered-tags']))
  const used = useUsedTags(open)
  const allowed = parseUserTagAccessForm(snap?.['user-tag-access']).list
  const both = overlap(tags, allowed)
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="注册标签"
      description="只有在 / 上有 Sys.Modify 权限的用户才能设置或移除这些标签。"
      onSubmit={() => saveOptions(snap, { 'registered-tags': tagListValue(tags) }, '修改注册标签')}
    >
      <TagListEditor label="注册标签" tags={tags} onChange={setTags} suggestions={used} emptyText="没有注册标签" />
      {both.length > 0 && <Note>这些标签也在用户预定义列表中（仍需要 Sys.Modify）：{both.join('、')}</Note>}
    </FormDialog>
  )
}
