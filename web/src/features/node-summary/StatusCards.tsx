import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, CircleHelp, FileText, Package, XCircle } from 'lucide-react'

import {
  REPO_STATUS_TEXT,
  SUBSCRIPTION_LEVEL_LABEL,
  SUBSCRIPTION_STATUS_LABEL,
  bootModeLabel,
  cpuModelLabel,
  kernelLabel,
  managerVersion,
  parseLoadavg,
  repoStatus,
  useAptRepositories,
  useNodeSubscription,
  type NodeStatusDetail,
} from '@/api/node-summary'
import { GlassCard } from '@/components/GlassCard'
import { UsageBar } from '@/components/UsageBar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DASH, formatBytes, formatCores, formatPercent, formatUptime, formatUsage, ratio } from '@/lib/format'
import { cn } from '@/lib/utils'
import { highValueTone, METRIC_TEXT, USAGE_HINT, usageTone, type MetricTone } from '@/lib/metric-status'

function Stat({ label, value, detail, tone, hint }: { label: string; value: ReactNode; detail?: ReactNode; tone?: MetricTone; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-foreground/[0.03] px-3 py-2.5 ring-1 ring-border/60 ring-inset paper:bg-secondary/50">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div
        title={hint}
        className={cn(
          'mt-0.5 truncate text-xl leading-tight font-medium tabular',
          tone && METRIC_TEXT[tone],
        )}
      >
        {value}
      </div>
      {detail && <div className="mt-0.5 truncate text-[11px] text-muted-foreground tabular">{detail}</div>}
    </div>
  )
}

/** CPU, load, IO delay, memory, root disk, swap, KSM. */
export function ResourceCard({ status, loading, className }: { status: NodeStatusDetail | undefined; loading: boolean; className?: string }) {
  if (loading && !status) return <Skeleton className={cn('h-72 rounded-2xl', className)} />
  const s = status ?? {}
  const load = parseLoadavg(s.loadavg)
  const cpus = s.cpuinfo?.cpus
  const loadPerCpu = load && cpus ? load[0] / cpus : null
  const mem = s.memory
  const memRatio = ratio(mem?.used, mem?.total)
  return (
    <GlassCard className={cn('grid content-start gap-4', className)} role="region" aria-label="资源使用">
      <h2 className="text-sm font-medium">资源使用</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="CPU"
          value={formatPercent(s.cpu)}
          detail={cpus ? `${formatCores(cpus)}${s.cpuinfo?.sockets ? ` · ${s.cpuinfo.sockets} 插槽` : ''}` : undefined}
          tone={usageTone(s.cpu)}
          hint={USAGE_HINT}
        />
        <Stat
          label="负载（1 分钟）"
          value={load ? load[0].toFixed(2) : DASH}
          detail={load ? `5/15分 ${load[1].toFixed(2)} · ${load[2].toFixed(2)}` : undefined}
          tone={highValueTone(loadPerCpu, 1, 1.5)}
          hint="每核平均负载 ≥ 1 为警告，≥ 1.5 为严重"
        />
        <Stat label="IO 延迟" value={formatPercent(s.wait)} tone={highValueTone(s.wait, 0.1, 0.2)} hint="IO 等待 ≥ 10% 为警告，≥ 20% 为严重" />
        <Stat label="运行时间" value={formatUptime(s.uptime)} />
      </div>
      <div className="grid gap-3.5">
        <UsageBar
          label="内存"
          value={memRatio}
          detail={`${formatUsage(mem?.used, mem?.total)}${mem?.available !== undefined ? ` · 可用 ${formatBytes(mem.available)}` : ''}`}
        />
        <UsageBar label="根分区 /" value={ratio(s.rootfs?.used, s.rootfs?.total)} detail={formatUsage(s.rootfs?.used, s.rootfs?.total)} />
        {s.swap?.total !== 0 && (
          <UsageBar
            label="交换分区"
            value={ratio(s.swap?.used, s.swap?.total)}
            detail={formatUsage(s.swap?.used, s.swap?.total)}
            showPercent={!!s.swap?.total}
          />
        )}
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-muted-foreground">KSM 共享</span>
          <span className="text-foreground/90 tabular">{formatBytes(s.ksm?.shared ?? 0)}</span>
        </div>
      </div>
    </GlassCard>
  )
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2 first:pt-0 last:pb-0 sm:grid-cols-[7rem_1fr] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:pt-px">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  )
}

/** CPU model, kernel, boot mode, versions, plus package versions / report buttons. */
export function SystemInfoCard({
  status,
  loading,
  onPackages,
  onReport,
  className,
}: {
  status: NodeStatusDetail | undefined
  loading: boolean
  onPackages: () => void
  onReport: () => void
  className?: string
}) {
  if (loading && !status) return <Skeleton className={cn('h-72 rounded-2xl', className)} />
  const s = status ?? {}
  return (
    <GlassCard className={cn('flex flex-col gap-4', className)} role="region" aria-label="系统信息">
      <h2 className="text-sm font-medium">系统信息</h2>
      <dl className="divide-y divide-border/60">
        <InfoRow label="CPU 型号">{cpuModelLabel(s.cpuinfo) ?? DASH}</InfoRow>
        <InfoRow label="内核版本">
          <span className="tabular text-[13px]">{kernelLabel(s) ?? DASH}</span>
        </InfoRow>
        <InfoRow label="启动模式">{bootModeLabel(s['boot-info']) ?? DASH}</InfoRow>
        <InfoRow label="管理器版本">
          <span className="tabular text-[13px]">{managerVersion(s.pveversion) ? `pve-manager ${managerVersion(s.pveversion)}` : DASH}</span>
        </InfoRow>
      </dl>
      <div className="mt-auto grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={onPackages}>
          <Package /> 软件包版本
        </Button>
        <Button variant="outline" onClick={onReport}>
          <FileText /> 系统报告
        </Button>
      </div>
    </GlassCard>
  )
}

const TONE_ICON = {
  ok: { icon: CheckCircle2, cls: 'text-success-strong' },
  warn: { icon: AlertTriangle, cls: 'text-warning-strong' },
  bad: { icon: XCircle, cls: 'text-destructive' },
  unknown: { icon: CircleHelp, cls: 'text-muted-foreground' },
} as const

/** Repository status and subscription (read-only), like the official status panel. */
export function RepoSubscriptionCard({ node, className }: { node: string; className?: string }) {
  const repos = useAptRepositories(node)
  const sub = useNodeSubscription(node)
  const active = sub.data?.status?.toLowerCase() === 'active'
  const status = repos.data && sub.data ? repoStatus(repos.data['standard-repos'] ?? [], active) : repos.isError ? 'unknown' : null
  const text = status ? REPO_STATUS_TEXT[status] : null
  const Icon = text ? TONE_ICON[text.tone].icon : null
  const subLabel = sub.data ? (SUBSCRIPTION_STATUS_LABEL[sub.data.status] ?? sub.data.status) : null
  const level = sub.data?.level ? SUBSCRIPTION_LEVEL_LABEL[sub.data.level] ?? sub.data.level : null

  return (
    <GlassCard className={cn('grid content-start gap-4', className)} role="region" aria-label="软件源与订阅">
      <h2 className="text-sm font-medium">软件源与订阅</h2>
      {repos.isPending || sub.isPending ? (
        <div className="grid gap-2">
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-10 rounded-xl" />
        </div>
      ) : (
        <>
          {text && Icon && (
            <div className="flex items-start gap-3">
              <Icon className={cn('mt-0.5 size-5 shrink-0', TONE_ICON[text.tone].cls)} aria-hidden />
              <div className="min-w-0">
                <div className="text-sm font-medium">{text.title}</div>
                {text.detail && <p className="mt-0.5 text-xs text-muted-foreground">{text.detail}</p>}
                {repos.isError && <p className="mt-0.5 text-xs text-muted-foreground">无法读取软件源配置（需要 Sys.Audit 权限）。</p>}
              </div>
            </div>
          )}
          <div className="flex items-start gap-3">
            {active ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-strong" aria-hidden />
            ) : (
              <CircleHelp className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium">
                订阅：{sub.isError ? '无法读取' : subLabel}
                {level && <span className="font-normal text-muted-foreground"> · {level}</span>}
              </div>
              <p className="mt-0.5 text-xs break-words text-muted-foreground">
                {active
                  ? [sub.data?.productname, sub.data?.nextduedate && `到期 ${sub.data.nextduedate}`].filter(Boolean).join(' · ')
                  : '没有有效的企业订阅，可以使用 no-subscription 软件源获取更新。'}
              </p>
              {sub.data?.serverid && (
                <p className="mt-1 text-[11px] text-faint tabular">服务器 ID {sub.data.serverid}</p>
              )}
            </div>
          </div>
        </>
      )}
    </GlassCard>
  )
}
