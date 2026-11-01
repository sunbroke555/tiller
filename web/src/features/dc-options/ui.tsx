// Building blocks of the datacenter options screens: section cards, option
// rows (tap to edit, "恢复默认" in the row menu), dialog/form state helpers
// and a small editable tag list.

import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { ChevronRight, Ellipsis, Plus, RotateCcw, X, type LucideIcon } from 'lucide-react'

import { GlassCard } from '@/components/GlassCard'
import { SectionHeader } from '@/components/PageHeader'
import { TagChip } from '@/components/TagChip'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { tagListError } from './model'

// ------------------------------------------------------------ state

/** Dialog state that keeps its data while the close animation runs. */
export function useDialog<T>() {
  const [state, setState] = useState<{ data: T; open: boolean } | null>(null)
  return {
    data: state?.data,
    show: (data: T) => setState({ data, open: true }),
    props: {
      open: !!state?.open,
      onOpenChange: (open: boolean) => setState((s) => (s ? { ...s, open } : s)),
    },
  }
}

/** Form state re-initialised from `init` each time the dialog opens. */
export function useFormState<T>(open: boolean, init: () => T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(init)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      // Return the fresh value right away: later hooks of the same render
      // (a form initialised from a snapshot) must not see the stale one.
      const fresh = init()
      setState(fresh)
      return [fresh, setState]
    }
  }
  return [state, setState]
}

/** Thrown by onSubmit when client-side validation fails (FormDialog shows the message). */
export class ValidationError extends Error {
  constructor(message = '请先修正标出的问题') {
    super(message)
    this.name = 'ValidationError'
  }
}

export const hasErrors = (e: object) => Object.values(e).some(Boolean)

// ------------------------------------------------------------ layout

export function Section({ id, title, action, children, className }: { id: string; title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={`${id}-heading`} data-section={id} className={cn('min-w-0', className)}>
      <SectionHeader title={<span id={`${id}-heading`}>{title}</span>} className="mb-2.5 min-h-9">
        {action}
      </SectionHeader>
      <GlassCard flush className="overflow-hidden">
        <div className="divide-y divide-border/70">{children}</div>
      </GlassCard>
    </section>
  )
}

export function IconTile({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand-strong ring-1 ring-brand/15 ring-inset sm:mt-0',
        'paper:bg-secondary paper:text-foreground/70 paper:ring-border',
        className,
      )}
    >
      <Icon className="size-[18px]" />
    </span>
  )
}

/**
 * One option: icon, label, current value (muted when it is the default).
 * Tapping opens the editor; a set value gets a menu with "恢复默认".
 */
export function OptionRow({
  id,
  icon,
  label,
  value,
  isDefault,
  detail,
  onEdit,
  onReset,
}: {
  id: string
  icon: LucideIcon
  label: string
  value: ReactNode
  isDefault: boolean
  detail?: ReactNode
  onEdit?: () => void
  onReset?: () => void
}) {
  const body = (
    <>
      <IconTile icon={icon} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate font-medium">{label}</span>
        <span className={cn('min-w-0 text-[13px] leading-snug break-words text-muted-foreground', isDefault && 'text-faint')}>{value}</span>
        {detail && <span className="min-w-0 text-xs leading-relaxed break-words text-muted-foreground">{detail}</span>}
      </span>
      {onEdit && !onReset && <ChevronRight className="mt-2.5 size-4 shrink-0 self-start text-faint sm:mt-0 sm:self-center" aria-hidden />}
    </>
  )
  const cls = 'flex min-h-16 w-full min-w-0 flex-1 items-start gap-3 px-(--card-p) py-(--row-py) text-left sm:items-center compact:min-h-12'
  return (
    <div className="flex min-w-0 items-stretch" data-option={id}>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`${label}：${typeof value === 'string' ? value : ''}，编辑`}
          className={cn(
            cls,
            'transition-colors outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] active:bg-foreground/[0.05] paper:hover:bg-secondary/50',
          )}
        >
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
      {onReset && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`更多操作：${label}`} className="mr-1 size-11 shrink-0 self-center text-muted-foreground lg:size-9">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuLabel className="max-w-64 truncate text-xs text-muted-foreground">{label}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={onReset} className="pointer-coarse:min-h-11">
              <RotateCcw /> 恢复默认
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

// ------------------------------------------------------------ tag list editor

/** Add/remove tags (Enter or "添加"); used for the user allow list and registered tags. */
export function TagListEditor({
  tags,
  onChange,
  suggestions = [],
  label,
  emptyText = '没有标签',
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  suggestions?: readonly string[]
  label: string
  emptyText?: string
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | undefined>()
  const add = (tag: string) => {
    const err = tagListError(tag, tags)
    setError(err)
    if (err) return
    onChange([...tags, tag.trim()])
    setDraft('')
  }
  const lower = new Set(tags.map((t) => t.toLowerCase()))
  const offer = suggestions.filter((s) => !lower.has(s.toLowerCase())).slice(0, 12)

  return (
    <div className="grid gap-3">
      <ul aria-label={label} className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-border bg-(--field) p-2">
        {tags.length === 0 && <li className="px-1 text-sm text-faint">{emptyText}</li>}
        {tags.map((t) => (
          <li key={t} className="inline-flex items-center gap-0.5">
            <TagChip tag={t} size="md" />
            <button
              type="button"
              aria-label={`移除 ${t}`}
              onClick={() => onChange(tags.filter((x) => x !== t))}
              className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground pointer-coarse:size-9"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          value={draft}
          aria-label={`添加${label}`}
          placeholder="输入标签名"
          aria-invalid={!!error}
          onChange={(e) => {
            setDraft(e.target.value)
            setError(undefined)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            }
          }}
          className="pointer-coarse:h-11"
        />
        <Button type="button" variant="outline" onClick={() => add(draft)} className="shrink-0 pointer-coarse:h-11">
          <Plus /> 添加
        </Button>
      </div>
      {error && <p className="-mt-1 text-xs text-destructive">{error}</p>}
      {offer.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">在用的标签：</span>
          {offer.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} aria-label={`添加 ${s}`} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <TagChip tag={s} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
