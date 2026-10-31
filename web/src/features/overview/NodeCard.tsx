import { useMemo } from 'react'
import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'

import { useNodeRrd } from '@/api/queries'
import type { NodeResource, StorageResource } from '@/api/types'
import { GlassCard } from '@/components/GlassCard'
import { ResourceIcon } from '@/components/ResourceIcon'
import { Sparkline } from '@/components/Sparkline'
import { StatusDot } from '@/components/StatusDot'
import { UsageBar } from '@/components/UsageBar'
import { formatCores, formatPercent, formatUptime, formatUsage, ratio } from '@/lib/format'
import { nodePath, statusLabel } from '@/lib/resources'

interface NodeCardProps {
  node: NodeResource
  /** Storages active on this node (used for the storage bar). */
  storages: StorageResource[]
}

export function NodeCard({ node, storages }: NodeCardProps) {
  const online = node.status === 'online'
  const rrd = useNodeRrd(node.node, 'hour', { enabled: online })
  const cpuHistory = useMemo(() => (rrd.data ?? []).map((p) => p.cpu), [rrd.data])
  // Scale to the recent peak (at least 10%) so an idle node is not a flat line.
  const cpuScale = useMemo(
    () => Math.min(1, Math.max(0.1, ...cpuHistory.map((v) => (v ?? 0) * 1.25))),
    [cpuHistory],
  )

  const storage = useMemo(() => {
    const active = storages.filter((s) => s.status === 'available' && (s.maxdisk ?? 0) > 0)
    return {
      count: active.length,
      used: active.reduce((sum, s) => sum + (s.disk ?? 0), 0),
      total: active.reduce((sum, s) => sum + (s.maxdisk ?? 0), 0),
    }
  }, [storages])

  return (
    <GlassCard asChild interactive>
      <Link to={nodePath(node.node)} className="group">
        <div className="flex items-center gap-3">
          <ResourceIcon type="node" variant="tile" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{node.node}</span>
              <StatusDot status={node.status} decorative />
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {online ? `运行 ${formatUptime(node.uptime)}` : statusLabel(node.status)}
              {node.maxcpu ? ` · ${formatCores(node.maxcpu)}` : ''}
            </div>
          </div>
          <ChevronRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5" />
        </div>

        {online ? (
          <>
            <div className="mt-4 flex items-end gap-3">
              <div className="shrink-0">
                <div className="text-xs text-muted-foreground">CPU</div>
                <div className="text-2xl leading-tight font-medium tabular">{formatPercent(node.cpu)}</div>
              </div>
              <Sparkline values={cpuHistory} min={0} max={cpuScale} className="h-10 flex-1" aria-label="最近一小时 CPU 使用率" />
            </div>
            <div className="mt-4 grid gap-3">
              <UsageBar label="内存" value={ratio(node.mem, node.maxmem)} detail={formatUsage(node.mem, node.maxmem)} />
              <UsageBar
                label={storage.count > 0 ? `存储 · ${storage.count} 个` : '根磁盘'}
                value={storage.count > 0 ? ratio(storage.used, storage.total) : ratio(node.disk, node.maxdisk)}
                detail={storage.count > 0 ? formatUsage(storage.used, storage.total) : formatUsage(node.disk, node.maxdisk)}
              />
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">节点不在线，无法获取资源使用情况。</p>
        )}
      </Link>
    </GlassCard>
  )
}
