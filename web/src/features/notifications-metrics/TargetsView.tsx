// Notification targets: list (type, origin, enabled, comment, recipients /
// server), add by type, edit, enable/disable, send a test, delete — or reset
// a modified built-in target (mail-to-root) to its defaults.

import { useMemo, useState } from 'react'
import { Bell, ChevronRight, Ellipsis, Pencil, Power, PowerOff, RotateCcw, Send, Trash2 } from 'lucide-react'

import {
  TARGET_TYPES,
  deleteEndpoint,
  isTargetType,
  updateEndpoint,
  useAllEndpoints,
  useNotificationMatchers,
  useNotificationTargets,
  type NotificationTarget,
  type TargetType,
} from '@/api/notifications-metrics'
import { usePermissions } from '@/api/permissions'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState } from '@/components/QueryState'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
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

import { ORIGIN_LABEL, TARGET_INFO, asList, isOn, targetSummary } from './model'
import { TargetEditDialog } from './TargetEditDialog'
import { TestTargetDialog } from './TestTargetDialog'
import { DisabledPill, ListHeader, Pill, ReadOnlyNote, TypeBadgeIcon } from './ui'

const NOTIF_PATH = '/mapping/notifications'

type Dialog =
  | { kind: 'pick' }
  | { kind: 'edit'; type: TargetType; name?: string }
  | { kind: 'test'; name: string }
  | { kind: 'remove' | 'reset' | 'disable'; target: NotificationTarget }
  | null

export function TargetsView() {
  const perms = usePermissions()
  const canSee = perms.can({ privs: ['Mapping.Audit', 'Mapping.Modify'], any: true, path: NOTIF_PATH })
  const canEdit = perms.can({ privs: 'Mapping.Modify', path: NOTIF_PATH })
  const targets = useNotificationTargets()
  const endpoints = useAllEndpoints()
  const matchers = useNotificationMatchers()

  const [dialog, setDialog] = useState<Dialog>(null)
  const [last, setLast] = useState<Dialog>(null)
  if (dialog && dialog !== last) setLast(dialog)
  const close = (o: boolean) => {
    if (!o) setDialog((d) => (d === last ? null : d))
  }

  const all = useMemo(() => [...(targets.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [targets.data])
  const usedBy = (name: string) => (matchers.data ?? []).filter((m) => asList(m.target).includes(name)).map((m) => m.name)

  const toggleOpts = (t: NotificationTarget, enable: boolean) => ({
    title: `${enable ? '启用' : '禁用'}通知目标 ${t.name}`,
    syncSuccessMessage: `已${enable ? '启用' : '禁用'}通知目标 ${t.name}`,
  })
  const toggleStart = (t: NotificationTarget, enable: boolean) =>
    updateEndpoint(t.type as TargetType, t.name, enable ? { delete: ['disable'] } : { disable: 1 })

  return (
    <div className="grid gap-3">
      {!canEdit && canSee && <ReadOnlyNote>只读：你没有修改通知设置的权限（需要 /mapping/notifications 上的 Mapping.Modify）。</ReadOnlyNote>}
      <GlassCard flush className="overflow-hidden">
        <ListHeader
          title="通知目标"
          subtitle={
            targets.isPending ? (
              '正在读取…'
            ) : (
              <>
                {all.length} 个目标<span className="max-sm:hidden"> · 匹配规则决定哪些通知发到哪里</span>
              </>
            )
          }
          fetching={targets.isFetching}
          onRefresh={() => void targets.refetch()}
          addLabel="添加目标"
          onAdd={canEdit ? () => setDialog({ kind: 'pick' }) : undefined}
        />
        {targets.isPending ? (
          <div className="grid gap-2 p-(--card-p)">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : targets.isError ? (
          <ErrorState error={targets.error} onRetry={() => void targets.refetch()} compact />
        ) : all.length === 0 ? (
          <EmptyState icon={Bell} title="没有通知目标" description="添加邮件、Gotify 或 Webhook 目标，再用匹配规则把通知发过去。" />
        ) : (
          <ul aria-label="通知目标列表" className="divide-y divide-border/60">
            {all.map((t) => (
              <TargetRow
                key={t.name}
                target={t}
                summary={targetSummary(t.type, endpoints.get(t.name))}
                usedBy={usedBy(t.name)}
                canEdit={canEdit}
                onEdit={() => isTargetType(t.type) && setDialog({ kind: 'edit', type: t.type, name: t.name })}
                onTest={() => setDialog({ kind: 'test', name: t.name })}
                onToggle={(enable) =>
                  enable
                    ? fireTask(toggleStart(t, true), toggleOpts(t, true))
                    : setDialog({ kind: 'disable', target: t })
                }
                onRemove={() => setDialog({ kind: t.origin === 'modified-builtin' ? 'reset' : 'remove', target: t })}
              />
            ))}
          </ul>
        )}
      </GlassCard>
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        内置目标 mail-to-root 把邮件发给 root@pam 用户设置的邮箱，不能删除；修改后可以重置回默认。备份计划选“使用全局通知设置”时，就按这里的目标和匹配规则发送。
      </p>

      {last?.kind === 'pick' && (
        <ResponsiveDialog open={dialog === last} onOpenChange={close} title="添加通知目标" description="选择目标类型" size="lg">
          <div className="grid gap-2 pb-2 sm:grid-cols-2">
            {TARGET_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setDialog({ kind: 'edit', type: t })}
                className="flex min-h-14 items-center gap-3 rounded-xl border border-border/70 px-3 py-2.5 text-left transition-colors hover:border-brand/40 hover:bg-accent paper:hover:border-primary/40"
              >
                <TypeBadgeIcon kind="target" type={t} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{TARGET_INFO[t].label}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{TARGET_INFO[t].description}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
              </button>
            ))}
          </div>
        </ResponsiveDialog>
      )}
      {last?.kind === 'edit' && <TargetEditDialog open={dialog === last} onOpenChange={close} type={last.type} name={last.name} canEdit={canEdit} />}
      {last?.kind === 'test' && <TestTargetDialog open={dialog === last} onOpenChange={close} name={last.name} />}
      {last?.kind === 'disable' && (
        <ConfirmDialog
          open={dialog === last}
          onOpenChange={close}
          title={`禁用通知目标 ${last.target.name}？`}
          description="禁用后，匹配规则不会再往这个目标发送通知。配置保留，随时可以重新启用。"
          confirmLabel="禁用"
          onConfirm={() => runTask(toggleStart(last.target, false), toggleOpts(last.target, false))}
        />
      )}
      {last?.kind === 'remove' && (
        <ConfirmDialog
          open={dialog === last}
          onOpenChange={close}
          destructive
          title={`删除通知目标 ${last.target.name}？`}
          description={
            usedBy(last.target.name).length
              ? `匹配规则 ${usedBy(last.target.name).join('、')} 引用了它，删除前请先从这些规则里移除，否则删除会失败。`
              : '删除后不能恢复。'
          }
          confirmLabel="删除"
          typeToConfirm={last.target.name}
          onConfirm={() =>
            isTargetType(last.target.type)
              ? runTask(deleteEndpoint(last.target.type, last.target.name), {
                  title: `删除通知目标 ${last.target.name}`,
                  syncSuccessMessage: `已删除通知目标 ${last.target.name}`,
                })
              : undefined
          }
        />
      )}
      {last?.kind === 'reset' && (
        <ConfirmDialog
          open={dialog === last}
          onOpenChange={close}
          title={`把 ${last.target.name} 重置为默认设置？`}
          description="内置目标会恢复到安装时的配置，你做的修改会丢失。"
          confirmLabel="重置"
          onConfirm={() =>
            isTargetType(last.target.type)
              ? runTask(deleteEndpoint(last.target.type, last.target.name), {
                  title: `重置通知目标 ${last.target.name}`,
                  syncSuccessMessage: `已重置 ${last.target.name}`,
                })
              : undefined
          }
        />
      )}
    </div>
  )
}

function TargetRow({
  target: t,
  summary,
  usedBy,
  canEdit,
  onEdit,
  onTest,
  onToggle,
  onRemove,
}: {
  target: NotificationTarget
  summary: string
  usedBy: string[]
  canEdit: boolean
  onEdit: () => void
  onTest: () => void
  onToggle: (enable: boolean) => void
  onRemove: () => void
}) {
  const disabled = isOn(t.disable)
  const known = isTargetType(t.type)
  const origin = t.origin ?? 'user-created'
  const body = (
    <>
      <TypeBadgeIcon kind="target" type={t.type} dim={disabled} />
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('truncate font-medium text-foreground', disabled && 'text-muted-foreground')}>{t.name}</span>
          <span className="text-xs text-muted-foreground">{known ? TARGET_INFO[t.type as TargetType].label : t.type}</span>
          {origin !== 'user-created' && <Pill tone="info">{ORIGIN_LABEL[origin]}</Pill>}
          {disabled && <DisabledPill />}
        </span>
        {summary && <span className="truncate font-mono text-xs text-muted-foreground">{summary}</span>}
        {(t.comment || usedBy.length > 0) && (
          <span className="truncate text-xs text-muted-foreground">
            {[t.comment, usedBy.length ? `规则：${usedBy.join('、')}` : ''].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
    </>
  )

  return (
    <li className="flex items-center gap-1 pr-2 transition-colors hover:bg-foreground/[0.03] lg:pr-(--card-p) paper:hover:bg-secondary/50" data-target={t.name}>
      {known ? (
        <button type="button" onClick={onEdit} aria-label={`${canEdit ? '编辑' : '查看'} ${t.name}`} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-(--card-p) text-left">
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-(--card-p)">{body}</div>
      )}
      <Button variant="ghost" size="sm" onClick={onTest} aria-label={`测试 ${t.name}`} title="发送测试通知" className="shrink-0 text-muted-foreground max-sm:size-11 max-sm:px-0">
        <Send />
        <span className="max-sm:sr-only">测试</span>
      </Button>
      {canEdit && known && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`${t.name} 的操作`} className="shrink-0 text-muted-foreground pointer-coarse:size-11">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              编辑
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onTest}>
              <Send />
              发送测试通知
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
                {origin === 'builtin' ? '内置目标不能删除' : '删除'}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}
