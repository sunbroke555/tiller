import { useState } from 'react'
import { AlertTriangle, PowerOff } from 'lucide-react'

import { useNodeStatus } from '@/api/node-summary'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import type { NodeTabProps } from '@/features/node/types'
import { HardwareOverview } from '@/features/node-hardware/HardwareOverview'
import { errorMessage } from '@/lib/errors'

import { NodeCharts } from './NodeCharts'
import { NotesCard } from './NotesCard'
import { PackageVersionsDialog } from './PackageVersionsDialog'
import { RepoSubscriptionCard, ResourceCard, SystemInfoCard } from './StatusCards'
import { SystemReportDialog } from './SystemReportDialog'

/** Node summary: live status, hardware and history charts, then repository/subscription and notes. */
export default function SummaryTab({ node, resource }: NodeTabProps) {
  const online = resource.status === 'online'
  const status = useNodeStatus(node, { enabled: online })
  const [dialog, setDialog] = useState<'packages' | 'report' | null>(null)

  if (!online) {
    return (
      <GlassCard>
        <EmptyState
          icon={PowerOff}
          title="节点不在线"
          description="无法读取状态。如果节点配置了网络唤醒，可以在操作菜单里发送唤醒包。"
        />
      </GlassCard>
    )
  }

  return (
    <div className="grid gap-(--section-gap)">
      {status.isError && !status.data && (
        <GlassCard className="flex items-start gap-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-strong" aria-hidden />
          <span>无法读取节点状态：{errorMessage(status.error)}</span>
        </GlassCard>
      )}
      <div className="grid gap-(--row-gap) lg:grid-cols-3">
        <ResourceCard status={status.data} loading={status.isPending} className="lg:col-span-2" />
        <SystemInfoCard
          status={status.data}
          loading={status.isPending}
          onPackages={() => setDialog('packages')}
          onReport={() => setDialog('report')}
        />
      </div>
      <HardwareOverview node={node} />
      <NodeCharts node={node} />
      <div className="grid gap-(--row-gap) lg:grid-cols-3">
        <RepoSubscriptionCard node={node} />
        <NotesCard node={node} className="lg:col-span-2" />
      </div>
      <PackageVersionsDialog node={node} open={dialog === 'packages'} onOpenChange={(o) => !o && setDialog(null)} />
      <SystemReportDialog node={node} open={dialog === 'report'} onOpenChange={(o) => !o && setDialog(null)} />
    </div>
  )
}
