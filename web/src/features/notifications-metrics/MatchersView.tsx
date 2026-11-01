// Notification matchers: which notifications go to which targets. List with
// a plain-language summary of the rules, add / edit / enable / delete (or
// reset the built-in default-matcher).

import { useMemo, useState } from 'react'
import { ArrowRight, Ellipsis, Filter, Pencil, Power, PowerOff, RotateCcw, Trash2 } from 'lucide-react'

import { deleteMatcher, updateMatcher, useNotificationMatchers, type NotificationMatcher } from '@/api/notifications-metrics'
import { usePermissions } from '@/api/permissions'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState } from '@/components/QueryState'
import { fireTask, runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { MatcherEditDialog } from './MatcherEditDialog'
import { ORIGIN_LABEL, asList, describeMatcher, isOn } from './model'
import { DisabledPill, ListHeader, Pill, ReadOnlyNote } from './ui'

const NOTIF_PATH = '/mapping/notifications'

type Dialog = { kind: 'edit'; name?: string } | { kind: 'remove' | 'reset' | 'disable'; matcher: NotificationMatcher } | null

export function MatchersView() {
  const perms = usePermissions()
  const canSee = perms.can({ privs: ['Mapping.Audit', 'Mapping.Modify'], any: true, path: NOTIF_PATH })
  const canEdit = perms.can({ privs: 'Mapping.Modify', path: NOTIF_PATH })
  const matchers = useNotificationMatchers()

  const [dialog, setDialog] = useState<Dialog>(null)
  const [last, setLast] = useState<Dialog>(null)
  if (dialog && dialog !== last) setLast(dialog)
  const close = (o: boolean) => {
    if (!o) setDialog((d) => (d === last ? null : d))
  }

  const all = useMemo(() => [...(matchers.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [matchers.data])

  const toggleOpts = (m: NotificationMatcher, enable: boolean) => ({
    title: `${enable ? '启用' : '禁用'}匹配规则 ${m.name}`,
    syncSuccessMessage: `已${enable ? '启用' : '禁用'}匹配规则 ${m.name}`,
  })
  const toggleStart = (m: NotificationMatcher, enable: boolean) => updateMatcher(m.name, enable ? { delete: ['disable'] } : { disable: 1 })

  return (
    <div className="grid gap-3">
      {!canEdit && canSee && <ReadOnlyNote>只读：你没有修改通知设置的权限（需要 /mapping/notifications 上的 Mapping.Modify）。</ReadOnlyNote>}
      <GlassCard flush className="overflow-hidden">
        <ListHeader
          title="匹配规则"
          subtitle={
            matchers.isPending ? (
              '正在读取…'
            ) : (
              <>
                {all.length} 条规则<span className="max-sm:hidden"> · 每条通知会发给所有匹配规则的目标</span>
              </>
            )
          }
          fetching={matchers.isFetching}
          onRefresh={() => void matchers.refetch()}
          addLabel="添加规则"
          onAdd={canEdit ? () => setDialog({ kind: 'edit' }) : undefined}
        />
        {matchers.isPending ? (
          <div className="grid gap-2 p-(--card-p)">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : matchers.isError ? (
          <ErrorState error={matchers.error} onRetry={() => void matchers.refetch()} compact />
        ) : all.length === 0 ? (
          <EmptyState icon={Filter} title="没有匹配规则" description="没有规则时不会发送任何通知。" />
        ) : (
          <ul aria-label="匹配规则列表" className="divide-y divide-border/60">
            {all.map((m) => (
              <MatcherRow
                key={m.name}
                matcher={m}
                canEdit={canEdit}
                onEdit={() => setDialog({ kind: 'edit', name: m.name })}
                onToggle={(enable) => (enable ? fireTask(toggleStart(m, true), toggleOpts(m, true)) : setDialog({ kind: 'disable', matcher: m }))}
                onRemove={() => setDialog({ kind: m.origin === 'modified-builtin' ? 'reset' : 'remove', matcher: m })}
              />
            ))}
          </ul>
        )}
      </GlassCard>
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">内置规则 default-matcher 把所有通知发给 mail-to-root，不能删除；修改后可以重置回默认。</p>

      {last?.kind === 'edit' && <MatcherEditDialog open={dialog === last} onOpenChange={close} name={last.name} canEdit={canEdit} />}
      {last?.kind === 'disable' && (
        <ConfirmDialog
          open={dialog === last}
          onOpenChange={close}
          title={`禁用匹配规则 ${last.matcher.name}？`}
          description="禁用后这条规则不再匹配任何通知。配置保留，随时可以重新启用。"
          confirmLabel="禁用"
          onConfirm={() => runTask(toggleStart(last.matcher, false), toggleOpts(last.matcher, false))}
        />
      )}
      {last?.kind === 'remove' && (
        <ConfirmDialog
          open={dialog === last}
          onOpenChange={close}
          destructive
          title={`删除匹配规则 ${last.matcher.name}？`}
          description="删除后不能恢复，通知目标本身不受影响。"
          confirmLabel="删除"
          typeToConfirm={last.matcher.name}
          onConfirm={() =>
            runTask(deleteMatcher(last.matcher.name), { title: `删除匹配规则 ${last.matcher.name}`, syncSuccessMessage: `已删除匹配规则 ${last.matcher.name}` })
          }
        />
      )}
      {last?.kind === 'reset' && (
        <ConfirmDialog
          open={dialog === last}
          onOpenChange={close}
          title={`把 ${last.matcher.name} 重置为默认设置？`}
          description="内置规则会恢复到安装时的配置，你做的修改会丢失。"
          confirmLabel="重置"
          onConfirm={() => runTask(deleteMatcher(last.matcher.name), { title: `重置匹配规则 ${last.matcher.name}`, syncSuccessMessage: `已重置 ${last.matcher.name}` })}
        />
      )}
    </div>
  )
}

function MatcherRow({
  matcher: m,
  canEdit,
  onEdit,
  onToggle,
  onRemove,
}: {
  matcher: NotificationMatcher
  canEdit: boolean
  onEdit: () => void
  onToggle: (enable: boolean) => void
  onRemove: () => void
}) {
  const disabled = isOn(m.disable)
  const origin = m.origin ?? 'user-created'
  const targets = asList(m.target)
  return (
    <li className="flex items-center gap-1 pr-2 transition-colors hover:bg-foreground/[0.03] lg:pr-(--card-p) paper:hover:bg-secondary/50" data-matcher={m.name}>
      <button type="button" onClick={onEdit} aria-label={`${canEdit ? '编辑' : '查看'} ${m.name}`} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-(--card-p) text-left">
        <span
          aria-hidden
          className={cn(
            'inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand-strong ring-1 ring-brand/15 ring-inset paper:bg-secondary paper:text-foreground/70 paper:ring-border',
            disabled && 'opacity-50',
          )}
        >
          <Filter className="size-4.5" />
        </span>
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn('truncate font-medium text-foreground', disabled && 'text-muted-foreground')}>{m.name}</span>
            {origin !== 'user-created' && <Pill tone="info">{ORIGIN_LABEL[origin]}</Pill>}
            {disabled && <DisabledPill />}
          </span>
          <span className="line-clamp-2 text-xs text-muted-foreground">{describeMatcher(m)}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowRight className="size-3 shrink-0" aria-label="发给" />
            {targets.length ? targets.map((t) => <Pill key={t}>{t}</Pill>) : <span>没有目标</span>}
          </span>
          {m.comment && <span className="truncate text-xs text-muted-foreground">{m.comment}</span>}
        </span>
      </button>
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`${m.name} 的操作`} className="shrink-0 text-muted-foreground pointer-coarse:size-11">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              编辑
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onToggle(disabled)}>
              {disabled ? <Power /> : <PowerOff />}
              {disabled ? '启用' : '禁用'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {origin === 'modified-builtin' ? (
              <DropdownMenuItem onSelect={onRemove}>
                <RotateCcw />
                重置为默认
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="destructive" onSelect={onRemove} disabled={origin === 'builtin'}>
                <Trash2 />
                {origin === 'builtin' ? '内置规则不能删除' : '删除'}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}
