// Building blocks shared by the four container config tabs: the config hook
// (pending-aware load, save, revert), section cards, rows with a pending note
// and a "more" menu, inline switches, the pending banner and a segmented
// control.

import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronRight, Clock, EllipsisVertical, Loader2, Pencil, RefreshCw, Undo2, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'

import { revertLxcPending, updateLxcConfig, useLxcPending } from '@/api/lxc-config'
import { queryKeys } from '@/api/queries'
import { useSession } from '@/api/useSession'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { SectionHeader } from '@/components/PageHeader'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { GuestTabProps } from '@/features/guest/types'
import { errorMessage } from '@/lib/errors'
import { configUpdateParams, type ConfigValues } from '@/lib/propstring'
import { guestName } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { formatKeyValue, keyLabel, tabOfKey, type ConfigTab } from './labels'
import { parsePending, type LxcPendingConfig, type PendingChange } from './model'

// ------------------------------------------------------------------ hook

export interface LxcConfigApi {
  node: string
  vmid: number
  name: string
  running: boolean
  isRoot: boolean
  config: LxcPendingConfig | undefined
  /** Effective config (pending applied); {} while loading. */
  cfg: Record<string, string>
  isPending: boolean
  isError: boolean
  error: unknown
  refetch: () => void
  /**
   * PUT only the changed keys of `after` (cleared ones go to `delete`) with
   * the digest of the loaded config. Resolves to false when nothing changed.
   * Rejects with the API error (FormDialog shows it).
   */
  save: (after: ConfigValues, title: string) => Promise<boolean>
  /** PUT raw params (no digest), e.g. { delete: 'mp0' }. */
  send: (params: Record<string, string | number | undefined>, title: string) => Promise<void>
  revert: (keys: readonly string[], title?: string) => Promise<void>
}

export function useLxcConfig({ node, vmid, guest }: GuestTabProps): LxcConfigApi {
  const query = useLxcPending(node, vmid)
  const session = useSession()
  const config = useMemo(() => (query.data ? parsePending(query.data) : undefined), [query.data])
  const cfg = config?.effective ?? EMPTY
  const name = guestName(guest)
  const invalidate = [queryKeys.guest(node, 'lxc', vmid)]

  // Single-key removals go without digest (like the official UI): a volume task
  // that just finished changes the digest, and a delete cannot clobber an edit.
  const send: LxcConfigApi['send'] = async (params, title) => {
    await runTask(updateLxcConfig(node, vmid, params), {
      title,
      invalidate,
      syncSuccessMessage: `${title}：已保存`,
    })
  }

  return {
    node,
    vmid,
    name,
    running: guest.status === 'running',
    isRoot: session?.username === 'root@pam',
    config,
    cfg,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
    save: async (after, title) => {
      const params = configUpdateParams(cfg, after, { digest: config?.digest })
      if (!params) return false
      await runTask(updateLxcConfig(node, vmid, params), { title, invalidate, syncSuccessMessage: `${title}：已保存` })
      return true
    },
    send,
    revert: async (keys, title = '撤销待生效的更改') => {
      await runTask(revertLxcPending(node, vmid, keys), { title, invalidate, syncSuccessMessage: `${title}：已撤销` })
    },
  }
}

const EMPTY: Record<string, string> = {}

// --------------------------------------------------------------- states

/** Loading skeleton / error state shared by the tabs; renders children once loaded. */
export function TabBody({ api, children }: { api: LxcConfigApi; children: ReactNode }) {
  if (api.isPending) {
    return (
      <div className="grid gap-(--section-gap)" aria-busy="true" aria-label="加载中">
        {[0, 1].map((i) => (
          <div key={i} className="grid gap-3">
            <Skeleton className="h-4 w-24" />
            <GlassCard flush className="divide-y divide-border/70 overflow-hidden">
              {[0, 1, 2].map((j) => (
                <div key={j} className="flex items-center gap-3 px-(--card-p) py-4">
                  <Skeleton className="size-9 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-4 w-40" />
                  </div>
                </div>
              ))}
            </GlassCard>
          </div>
        ))}
      </div>
    )
  }
  if (api.isError) {
    return (
      <GlassCard>
        <EmptyState
          icon={AlertTriangle}
          title="无法加载容器配置"
          description={errorMessage(api.error)}
          action={
            <Button variant="outline" onClick={api.refetch}>
              <RefreshCw /> 重试
            </Button>
          }
        />
      </GlassCard>
    )
  }
  return <div className="grid gap-(--section-gap)">{children}</div>
}

// ------------------------------------------------------------- sections

export function ConfigSection({
  title,
  action,
  children,
  className,
  id,
}: {
  title: ReactNode
  /** Header buttons (e.g. "添加"). */
  action?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) {
  const headingId = id ? `${id}-heading` : undefined
  return (
    <section aria-labelledby={headingId} aria-label={headingId ? undefined : typeof title === 'string' ? title : undefined} className={cn('min-w-0', className)}>
      <SectionHeader title={<span id={headingId}>{title}</span>} className="mb-2.5 min-h-9">
        {action}
      </SectionHeader>
      <GlassCard flush className="overflow-hidden">
        <div className="divide-y divide-border/70">{children}</div>
      </GlassCard>
    </section>
  )
}

/** Small action in a section header (44px tap target on touch). */
export function SectionAction({
  icon: Icon,
  children,
  onClick,
  disabled,
  title,
}: {
  icon: LucideIcon
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled} title={title} className="pointer-coarse:h-10">
      <Icon /> {children}
    </Button>
  )
}

// ------------------------------------------------------------------ rows

export interface RowAction {
  id: string
  label: string
  icon: LucideIcon
  onSelect: () => void
  destructive?: boolean
  /** Disabled with this reason shown under the label. */
  disabled?: string | false
  /** Separator above. */
  separated?: boolean
}

export interface ConfigRowProps {
  icon: LucideIcon
  label: ReactNode
  value: ReactNode
  /** Second line (sizes, flags…). */
  detail?: ReactNode
  /** Badges after the value. */
  badges?: ReactNode
  pending?: PendingChange | undefined
  /** How to show the running value of a pending change (defaults to formatKeyValue). */
  formatPending?: (value: string | undefined) => string
  /** Tap on the row. */
  onEdit?: () => void
  editLabel?: string
  /** Extra actions in the "more" menu (edit and revert are added automatically). */
  actions?: RowAction[]
  onRevert?: () => void
  /** Muted value (defaults, "use host settings"). */
  muted?: boolean
  className?: string
}

/**
 * One configuration item. The whole row opens the editor; extra actions
 * (resize, move, remove, revert) sit in a "more" menu at the right. `value`
 * is the configured value; a pending change adds a note with the value still
 * in effect until the restart.
 */
export function ConfigRow({
  icon: Icon,
  label,
  value,
  detail,
  badges,
  pending,
  formatPending,
  onEdit,
  editLabel = '编辑',
  actions = [],
  onRevert,
  muted,
  className,
}: ConfigRowProps) {
  const menu: RowAction[] = [
    ...(onEdit && (actions.length > 0 || (pending && onRevert)) ? [{ id: 'edit', label: editLabel, icon: Pencil, onSelect: onEdit }] : []),
    ...actions,
    ...(pending && onRevert ? [{ id: 'revert', label: '撤销待生效的更改', icon: Undo2, onSelect: onRevert, separated: true }] : []),
  ]
  const key = pending?.key ?? ''
  const fmt = formatPending ?? ((v: string | undefined) => formatKeyValue(key, v))
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          'mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/15 ring-inset sm:mt-0',
          'paper:bg-secondary paper:text-foreground/70 paper:ring-border',
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5 sm:grid-cols-[minmax(8rem,12rem)_1fr] sm:items-baseline sm:gap-x-4">
        <span className="truncate text-xs text-muted-foreground sm:text-sm">{label}</span>
        <span className="grid min-w-0 gap-0.5">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                'min-w-0 truncate font-medium',
                muted && 'font-normal text-muted-foreground',
                pending?.delete && 'text-foreground/70 line-through decoration-foreground/30',
              )}
            >
              {value}
            </span>
            {badges}
          </span>
          {detail && <span className="min-w-0 text-xs leading-relaxed break-words text-muted-foreground">{detail}</span>}
          {pending && (
            <span className="flex min-w-0 items-start gap-1.5 text-xs text-warning">
              <Clock className="mt-px size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                {pending.delete
                  ? '重启后删除'
                  : pending.current === undefined
                    ? '新增，重启后生效'
                    : <>重启后生效 · 当前为 <span className="font-medium">{fmt(pending.current)}</span></>}
              </span>
            </span>
          )}
        </span>
      </span>
    </>
  )
  const rowCls =
    'flex min-h-16 flex-1 items-start gap-3 px-(--card-p) py-(--row-py) text-left sm:items-center compact:min-h-12'
  return (
    <div data-slot="config-row" className={cn('flex min-w-0 items-stretch', className)}>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className={cn(
            rowCls,
            'min-w-0 transition-colors outline-none hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] active:bg-foreground/[0.05] paper:hover:bg-secondary/50',
          )}
        >
          {body}
          {menu.length === 0 && <ChevronRight className="mt-2.5 size-4 shrink-0 self-start text-faint sm:mt-0 sm:self-center" aria-hidden />}
        </button>
      ) : (
        <div className={cn(rowCls, 'min-w-0')}>{body}</div>
      )}
      {menu.length > 0 && <RowMenu label={typeof label === 'string' ? label : '操作'} actions={menu} />}
    </div>
  )
}

export function RowMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  return (
    <div className="flex shrink-0 items-start py-2 pr-2 sm:items-center sm:py-0">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`更多操作：${label}`} className="size-11 text-muted-foreground">
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuLabel className="text-xs text-muted-foreground">{label}</DropdownMenuLabel>
          {actions.map((a) => (
            <MenuItem key={a.id} action={a} />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function MenuItem({ action: a }: { action: RowAction }) {
  return (
    <>
      {a.separated && <DropdownMenuSeparator />}
      <DropdownMenuItem
        variant={a.destructive ? 'destructive' : 'default'}
        disabled={!!a.disabled}
        onSelect={() => a.onSelect()}
        className="pointer-coarse:py-2.5"
      >
        <a.icon />
        <span className="grid">
          <span>{a.label}</span>
          {a.disabled && <span className="text-xs text-muted-foreground">{a.disabled}</span>}
        </span>
      </DropdownMenuItem>
    </>
  )
}

// ------------------------------------------------------------- switches

/**
 * A boolean option toggled in place (saved immediately). Shows the pending
 * value when the change waits for a restart.
 */
export function SwitchRow({
  icon: Icon,
  label,
  description,
  checked,
  pending,
  onChange,
  onRevert,
  disabled,
}: {
  icon: LucideIcon
  label: string
  description?: ReactNode
  checked: boolean
  pending?: PendingChange | undefined
  onChange: (checked: boolean) => Promise<unknown>
  onRevert?: () => void
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const toggle = async (next: boolean) => {
    setBusy(true)
    try {
      await onChange(next)
    } catch (e) {
      toast.error(`${label}：保存失败`, { description: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-slot="config-row" className="flex min-w-0 items-stretch">
      <label className="flex min-h-16 min-w-0 flex-1 cursor-pointer items-center gap-3 px-(--card-p) py-(--row-py) compact:min-h-12">
        <span
          aria-hidden
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/15 ring-inset paper:bg-secondary paper:text-foreground/70 paper:ring-border"
        >
          <Icon className="size-4" />
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-sm font-medium">{label}</span>
          {description && <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>}
          {pending && (
            <span className="flex items-center gap-1.5 text-xs text-warning">
              <Clock className="size-3.5 shrink-0" aria-hidden />
              重启后{pending.delete ? '恢复默认' : pending.next === '1' ? '开启' : '关闭'}
            </span>
          )}
        </span>
        {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
        <Switch checked={checked} disabled={busy || disabled} onCheckedChange={(c) => void toggle(c)} aria-label={label} />
      </label>
      {pending && onRevert && (
        <RowMenu label={label} actions={[{ id: 'revert', label: '撤销待生效的更改', icon: Undo2, onSelect: onRevert }]} />
      )}
    </div>
  )
}

// -------------------------------------------------------- pending banner

/** Pending changes of this tab, with "revert all". */
export function PendingBanner({ api, tab }: { api: LxcConfigApi; tab: ConfigTab }) {
  const [confirm, setConfirm] = useState(false)
  const changes = (api.config?.changes ?? []).filter((c) => tabOfKey(c.key) === tab)
  if (changes.length === 0) return null
  return (
    <div
      role="status"
      className="rounded-2xl border border-warning/30 bg-warning/10 px-(--card-p) py-3 text-sm paper:bg-warning/8"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Clock className="size-4 shrink-0 text-warning" aria-hidden />
        <p className="min-w-0 flex-1 font-medium">
          {changes.length} 项更改将在容器{api.running ? '重启' : '下次启动'}后生效
        </p>
        <Button variant="outline" size="sm" className="pointer-coarse:h-10" onClick={() => setConfirm(true)}>
          <Undo2 /> 全部撤销
        </Button>
      </div>
      <ul className="mt-2 grid gap-1 pl-7 text-xs text-muted-foreground">
        {changes.map((c) => (
          <li key={c.key} className="min-w-0 break-words">
            <span className="text-foreground/85">{keyLabel(c.key)}</span>
            {'：'}
            {c.delete ? (
              <>删除</>
            ) : (
              <>
                <span className="line-through decoration-foreground/30">{formatKeyValue(c.key, c.current)}</span>
                {' → '}
                <span className="text-foreground/85">{formatKeyValue(c.key, c.next)}</span>
              </>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="撤销全部待生效的更改？"
        description={`${changes.map((c) => keyLabel(c.key)).join('、')} 将保持当前值。`}
        confirmLabel="全部撤销"
        onConfirm={() => api.revert(changes.map((c) => c.key))}
      />
    </div>
  )
}

// ------------------------------------------------------------- segmented

export interface SegmentOption<V extends string> {
  value: V
  label: ReactNode
}

/** Full-width segmented control (radio semantics) for 2–5 short choices. */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
  disabled,
  className,
}: {
  value: V
  onChange: (v: V) => void
  options: readonly SegmentOption<V>[]
  'aria-label': string
  disabled?: boolean
  className?: string
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={value}
      onValueChange={(v) => v && onChange(v as V)}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn('grid w-full auto-cols-fr grid-flow-col', className)}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="min-w-0 px-1.5 text-xs sm:text-sm">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** Hint row inside a section (e.g. "仅 root@pam 可以添加设备"). */
export function SectionNote({ children }: { children: ReactNode }) {
  return <p className="px-(--card-p) py-3 text-xs leading-relaxed text-muted-foreground">{children}</p>
}
