import { Link } from 'react-router'
import { Activity, ShieldCheck } from 'lucide-react'

import type { GuestConfig, GuestStatusCurrent } from '@/api/guest-core'
import type { GuestResource } from '@/api/types'
import { GlassCard } from '@/components/GlassCard'
import { StatusDot } from '@/components/StatusDot'
import { Skeleton } from '@/components/ui/skeleton'
import { DASH, formatBytes, formatUptime, formatUsage } from '@/lib/format'
import { nodePath } from '@/lib/resources'

import { CardTitle, InfoList, InfoRow } from './parts'
import { powerState } from './power'
import { haStateLabel, osTypeLabel, qmpStatusLabel } from './labels'

interface StatusCardProps {
  guest: GuestResource
  status: GuestStatusCurrent | undefined
  config: GuestConfig | undefined
  /** QEMU: result of the agent query (true = answered, false = failed, undefined = unknown). */
  agentResponds?: boolean
}

/** Live status details: state, uptime, HA, lock, sizes, agent, QEMU version. */
export function StatusCard({ guest, status, config, agentResponds }: StatusCardProps) {
  const qemu = guest.type === 'qemu'
  const ps = powerState(guest)
  const stateText = ps.hibernated
    ? '已休眠（状态保存在磁盘）'
    : qemuStateText(status, guest.status)
  const ha = status?.ha
  const lock = status?.lock ?? guest.lock

  return (
    <GlassCard>
      <CardTitle title="状态" icon={Activity} />
      {!status && !config ? (
        <div className="grid gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      ) : (
        <InfoList>
          <InfoRow label="状态">
            <span className="inline-flex items-center gap-2">
              <StatusDot status={ps.hibernated ? 'suspended' : guest.status} decorative />
              {stateText}
            </span>
          </InfoRow>
          <InfoRow label="运行时间">{formatUptime(status?.uptime ?? guest.uptime)}</InfoRow>
          <InfoRow label="节点">
            <Link to={nodePath(guest.node)} className="underline-offset-2 hover:underline">
              {guest.node}
            </Link>
          </InfoRow>
          <InfoRow label="高可用">{ha?.managed ? haStateLabel(ha.state) : guest.hastate ? haStateLabel(guest.hastate) : '未加入'}</InfoRow>
          {lock && <InfoRow label="锁">{lock === 'suspended' ? '休眠（suspended）' : lock}</InfoRow>}
          <InfoRow label="处理器">{status?.cpus ?? guest.maxcpu ? `${status?.cpus ?? guest.maxcpu} 核` : DASH}</InfoRow>
          <InfoRow label="内存">
            {formatBytes(status?.maxmem ?? guest.maxmem)}
            {qemu && status?.memhost !== undefined && status.status === 'running' && (
              <span className="block text-xs text-muted-foreground">主机侧占用 {formatBytes(status.memhost)}</span>
            )}
          </InfoRow>
          {!qemu && <InfoRow label="交换">{status?.maxswap ? formatUsage(status.swap, status.maxswap) : formatBytes(status?.maxswap ?? 0)}</InfoRow>}
          <InfoRow label={qemu ? '启动磁盘' : '根磁盘'}>
            {qemu ? ((status?.maxdisk ?? guest.maxdisk) ? formatBytes(status?.maxdisk ?? guest.maxdisk) : <span className="text-muted-foreground">无</span>) : formatUsage(status?.disk ?? guest.disk, status?.maxdisk ?? guest.maxdisk)}
          </InfoRow>
          {config?.ostype && <InfoRow label="系统类型">{osTypeLabel(config.ostype)}</InfoRow>}
          {!qemu && config && <InfoRow label="类型">{config.unprivileged ? '非特权容器' : '特权容器'}</InfoRow>}
          {qemu && (
            <InfoRow label="Guest Agent">
              {status?.agent !== 1 ? (
                <span className="text-muted-foreground">未启用</span>
              ) : status.status !== 'running' ? (
                '已启用'
              ) : agentResponds === undefined ? (
                '已启用'
              ) : agentResponds ? (
                <span className="text-success-strong">运行中</span>
              ) : (
                <span className="text-warning-strong">未响应</span>
              )}
            </InfoRow>
          )}
          {qemu && status?.['running-qemu'] && (
            <InfoRow label="QEMU" mono>
              {status['running-qemu']}
              {status['running-machine'] && (
                <span className="block text-xs text-muted-foreground">{status['running-machine']}</span>
              )}
            </InfoRow>
          )}
          {config?.protection === 1 && (
            <InfoRow label="删除保护">
              <span className="inline-flex items-center gap-1.5 text-success-strong">
                <ShieldCheck className="size-4" aria-hidden />
                已启用
              </span>
            </InfoRow>
          )}
        </InfoList>
      )}
    </GlassCard>
  )
}

function qemuStateText(status: GuestStatusCurrent | undefined, fallback: string): string {
  if (status?.qmpstatus && status.qmpstatus !== status.status) return qmpStatusLabel(status.qmpstatus)
  return qmpStatusLabel(status?.status ?? fallback)
}
