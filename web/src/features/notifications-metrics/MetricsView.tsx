// External metric servers (status.cfg): Graphite, InfluxDB, OpenTelemetry —
// list, add by type, edit, enable/disable, delete. PVE tests the connection
// when an enabled server is saved, so an unreachable server can only be
// saved disabled; the error is shown in the dialog / toast.

import { useMemo, useState } from 'react'
import { BarChart3, ChevronRight, Ellipsis, Pencil, Power, PowerOff, Trash2 } from 'lucide-react'

import {
  METRIC_TYPES,
  deleteMetricServer,
  isMetricType,
  updateMetricServer,
  useMetricServerDetails,
  useMetricServers,
  type MetricServer,
  type MetricType,
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

import { MetricServerDialog } from './MetricServerDialog'
import { METRIC_INFO, isOn, metricProtocol, metricToggleParams, metricTypeLabel } from './model'
import { DisabledPill, ListHeader, Pill, ReadOnlyNote, TypeBadgeIcon } from './ui'

type Dialog = { kind: 'pick' } | { kind: 'edit'; type: MetricType; id?: string } | { kind: 'remove' | 'disable'; server: MetricServer } | null

export function MetricsView() {
  const perms = usePermissions()
  const canSee = perms.can({ privs: 'Sys.Audit' })
  const canEdit = perms.can({ privs: 'Sys.Modify' })
  const servers = useMetricServers(canSee)

  const [dialog, setDialog] = useState<Dialog>(null)
  const [last, setLast] = useState<Dialog>(null)
  if (dialog && dialog !== last) setLast(dialog)
  const close = (o: boolean) => {
    if (!o) setDialog((d) => (d === last ? null : d))
  }

  const ids = useMemo(() => (servers.data ?? []).map((s) => s.id).sort(), [servers.data])
  const details = useMetricServerDetails(ids)
  // The list has only id/type/server/port/disable: merge in each server's full config.
  const all = useMemo(
    () => [...(servers.data ?? [])].sort((a, b) => a.id.localeCompare(b.id)).map((s) => ({ ...details.get(s.id), ...s })),
    [servers.data, details],
  )
  const toggleOpts = (s: MetricServer, enable: boolean) => ({
    title: `${enable ? '启用' : '禁用'}指标服务器 ${s.id}`,
    syncSuccessMessage: `已${enable ? '启用' : '禁用'}指标服务器 ${s.id}`,
  })

  if (!canSee) return <ReadOnlyNote>你没有查看指标服务器的权限（需要 / 上的 Sys.Audit）。</ReadOnlyNote>

  return (
    <div className="grid gap-3">
      {!canEdit && <ReadOnlyNote>只读：你没有修改指标服务器的权限（需要 / 上的 Sys.Modify）。</ReadOnlyNote>}
      <GlassCard flush className="overflow-hidden">
        <ListHeader
          title="指标服务器"
          subtitle={
            servers.isPending ? (
              '正在读取…'
            ) : (
              <>
                {all.length} 个服务器<span className="max-sm:hidden"> · 节点、客户机和存储的状态定时推送过去</span>
              </>
            )
          }
          fetching={servers.isFetching}
          onRefresh={() => void servers.refetch()}
          addLabel="添加服务器"
          onAdd={canEdit ? () => setDialog({ kind: 'pick' }) : undefined}
        />
        {servers.isPending ? (
          <div className="grid gap-2 p-(--card-p)">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : servers.isError ? (
          <ErrorState error={servers.error} onRetry={() => void servers.refetch()} compact />
        ) : all.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="没有指标服务器"
            description="把节点、客户机和存储的运行数据推送到 Graphite、InfluxDB 或 OpenTelemetry，在 Grafana 等工具里长期保存和查看。"
          />
        ) : (
          <ul aria-label="指标服务器列表" className="divide-y divide-border/60">
            {all.map((s) => (
              <ServerRow
                key={s.id}
                server={s}
                canEdit={canEdit}
                onEdit={() => isMetricType(s.type) && setDialog({ kind: 'edit', type: s.type, id: s.id })}
                onToggle={(enable) =>
                  enable ? fireTask(updateMetricServer(s.id, metricToggleParams(s, true)), toggleOpts(s, true)) : setDialog({ kind: 'disable', server: s })
                }
                onRemove={() => setDialog({ kind: 'remove', server: s })}
              />
            ))}
          </ul>
        )}
      </GlassCard>

      {last?.kind === 'pick' && (
        <ResponsiveDialog open={dialog === last} onOpenChange={close} title="添加指标服务器" description="选择服务器类型" size="lg">
          <div className="grid gap-2 pb-2">
            {METRIC_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setDialog({ kind: 'edit', type: t })}
                className="flex min-h-14 items-center gap-3 rounded-xl border border-border/70 px-3 py-2.5 text-left transition-colors hover:border-brand/40 hover:bg-accent paper:hover:border-primary/40"
              >
                <TypeBadgeIcon kind="metric" type={t} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{METRIC_INFO[t].label}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{METRIC_INFO[t].description}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
              </button>
            ))}
          </div>
        </ResponsiveDialog>
      )}
      {last?.kind === 'edit' && <MetricServerDialog open={dialog === last} onOpenChange={close} type={last.type} id={last.id} canEdit={canEdit} />}
      {last?.kind === 'disable' && (
        <ConfirmDialog
          open={dialog === last}
          onOpenChange={close}
          title={`禁用指标服务器 ${last.server.id}？`}
          description="禁用后不再向它推送数据。配置保留，随时可以重新启用（启用时会先测试连接）。"
          confirmLabel="禁用"
          onConfirm={() => runTask(updateMetricServer(last.server.id, metricToggleParams(last.server, false)), toggleOpts(last.server, false))}
        />
      )}
      {last?.kind === 'remove' && (
        <ConfirmDialog
          open={dialog === last}
          onOpenChange={close}
          destructive
          title={`删除指标服务器 ${last.server.id}？`}
          description="只删除这里的配置，服务器上已收到的数据不受影响。"
          confirmLabel="删除"
          typeToConfirm={last.server.id}
          onConfirm={() =>
            runTask(deleteMetricServer(last.server.id), { title: `删除指标服务器 ${last.server.id}`, syncSuccessMessage: `已删除指标服务器 ${last.server.id}` })
          }
        />
      )}
    </div>
  )
}

function ServerRow({
  server: s,
  canEdit,
  onEdit,
  onToggle,
  onRemove,
}: {
  server: MetricServer
  canEdit: boolean
  onEdit: () => void
  onToggle: (enable: boolean) => void
  onRemove: () => void
}) {
  const disabled = isOn(s.disable)
  const known = isMetricType(s.type)
  const extra = s.type === 'influxdb' && s.influxdbproto && s.influxdbproto !== 'udp' ? [s.organization, s.bucket].filter(Boolean).join(' / ') : s.type === 'graphite' ? (s.path ?? '') : ''
  const body = (
    <>
      <TypeBadgeIcon kind="metric" type={s.type} dim={disabled} />
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('truncate font-medium text-foreground', disabled && 'text-muted-foreground')}>{s.id}</span>
          <span className="text-xs text-muted-foreground">{metricTypeLabel(s.type)}</span>
          <Pill>{metricProtocol(s)}</Pill>
          {disabled && <DisabledPill />}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {s.server}:{s.port}
          {s.type === 'opentelemetry' && (s['otel-path'] ?? '/v1/metrics')}
          {extra && ` · ${extra}`}
        </span>
      </span>
    </>
  )
  return (
    <li className="flex items-center gap-1 pr-2 transition-colors hover:bg-foreground/[0.03] lg:pr-(--card-p) paper:hover:bg-secondary/50" data-metric={s.id}>
      {known ? (
        <button type="button" onClick={onEdit} aria-label={`${canEdit ? '编辑' : '查看'} ${s.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-(--card-p) text-left">
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-(--card-p)">{body}</div>
      )}
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`${s.id} 的操作`} className="shrink-0 text-muted-foreground pointer-coarse:size-11">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onSelect={onEdit} disabled={!known}>
              <Pencil />
              编辑
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onToggle(disabled)}>
              {disabled ? <Power /> : <PowerOff />}
              {disabled ? '启用' : '禁用'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              <Trash2 />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}
