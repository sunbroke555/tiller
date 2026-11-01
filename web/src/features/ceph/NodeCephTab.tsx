// Node page "Ceph" tab: whether Ceph is installed on this node (install
// wizard if not), its version, and the Ceph services, OSDs and log of this
// node. The cluster-wide screens are under /datacenter/ceph.

import { Link } from 'react-router'
import { ArrowRight, Database, Download } from 'lucide-react'

import { cephErrorState, useCephMetadata, useNodeCephStatus } from '@/api/ceph'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState, LoadingCards } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import type { NodeTabProps } from '@/features/node/types'
import { errorMessage } from '@/lib/errors'

import { cephHref } from './CephPage'
import { LogView } from './LogView'
import { HEALTH_LABEL, healthTone } from './model'
import { OsdView } from './OsdView'
import { ServicesView } from './ServicesView'
import { Chip, Notice, ToneIcon, useCephAccess } from './ui'

export default function NodeCephTab({ node }: NodeTabProps) {
  const status = useNodeCephStatus(node)
  const versions = useCephMetadata('versions', !!status.data)
  const access = useCephAccess()
  const setup = status.error ? cephErrorState(status.error) : null

  if (status.isPending) return <LoadingCards count={2} />

  if (setup === 'not-installed' || setup === 'not-initialized') {
    return (
      <EmptyState
        icon={Database}
        title={setup === 'not-installed' ? `${node} 上没有安装 Ceph` : 'Ceph 尚未配置'}
        description={
          setup === 'not-installed'
            ? '每个运行 Ceph 服务（监视器、OSD…）的节点都需要安装 Ceph。'
            : '软件包已安装，还需要创建集群配置和第一个监视器。'
        }
        action={
          access.isRoot ? (
            <Button asChild>
              <Link to={cephHref('install', node)}>
                <Download /> {setup === 'not-installed' ? '安装 Ceph' : '配置 Ceph'}
              </Link>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">需要以 root@pam 登录才能安装。</p>
          )
        }
      />
    )
  }
  if (setup === 'error') return <ErrorState error={status.error} onRetry={() => void status.refetch()} />

  const tone = healthTone(status.data?.health?.status)
  const version = versions.data?.node?.[node]?.version?.str

  return (
    <div className="grid min-w-0 gap-(--section-gap)">
      <GlassCard className="flex flex-wrap items-center gap-3">
        <ToneIcon tone={status.data ? tone : 'unknown'} className="size-7" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-medium">
            Ceph{version && <span className="font-normal text-muted-foreground">{version}</span>}
            {status.data && (
              <Chip tone={tone === 'unknown' ? 'unknown' : tone} data-testid="node-ceph-health">
                {HEALTH_LABEL[tone]}
              </Chip>
            )}
          </div>
          <div className="text-xs text-muted-foreground">本节点上的 Ceph 服务、OSD 和日志</div>
        </div>
        <Button asChild variant="outline">
          <Link to={cephHref('status')}>
            集群 Ceph <ArrowRight />
          </Link>
        </Button>
      </GlassCard>
      {setup === 'unreachable' && <Notice tone="err">无法连接 Ceph 集群：{errorMessage(status.error)}</Notice>}
      <ServicesView apiNode={node} host={node} />
      <OsdView apiNode={node} host={node} />
      <LogView defaultNode={node} fixedNode />
    </div>
  )
}
