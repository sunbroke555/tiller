// Node page "Ceph" tab: whether Ceph is installed on this node (install
// wizard if not), its version, and the Ceph services, OSDs and log of this
// node. The cluster-wide screens are under /datacenter/ceph.

import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Database, Download, Play, RotateCw, Square } from 'lucide-react'

import { cephErrorState, cephKeys, cephServiceCommand, useCephMetadata, useNodeCephStatus } from '@/api/ceph'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState, LoadingCards } from '@/components/QueryState'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
        {access.canModify && <BulkServiceMenu node={node} />}
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

type Bulk = { action: 'start' | 'stop' | 'restart'; service: 'ceph' | 'mon' | 'mgr' | 'mds' | 'osd' }

const BULK_TARGET: Record<Bulk['service'], string> = {
  ceph: '全部 Ceph 服务',
  mon: '全部监视器',
  mgr: '全部管理器',
  mds: '全部元数据服务器',
  osd: '全部 OSD',
}

const BULK_ACTION: Record<Bulk['action'], string> = { start: '启动', stop: '停止', restart: '重启' }

/** Start / stop / restart every Ceph service (of one type) on this node (service=ceph|mon|…). */
function BulkServiceMenu({ node }: { node: string }) {
  const [pending, setPending] = useState<Bulk | null>(null)
  const [shown, setShown] = useState<Bulk | null>(null)
  if (pending && pending !== shown) setShown(pending)
  const label = shown ? `${BULK_ACTION[shown.action]} ${node} 上的${BULK_TARGET[shown.service]}` : ''
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <RotateCw /> 服务
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>本节点的 Ceph 服务</DropdownMenuLabel>
          {(['restart', 'start', 'stop'] as const).map((action, i) => (
            <div key={action}>
              {i > 0 && <DropdownMenuSeparator />}
              {(['ceph', 'osd', 'mon', 'mgr', 'mds'] as const).map((service) => (
                <DropdownMenuItem key={service} onSelect={() => setPending({ action, service })} variant={action === 'stop' ? 'destructive' : 'default'}>
                  {action === 'restart' ? <RotateCw /> : action === 'start' ? <Play /> : <Square />}
                  {BULK_ACTION[action]}
                  {BULK_TARGET[service]}
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        destructive={shown?.action !== 'start'}
        title={`${label}？`}
        description={
          shown?.action === 'start'
            ? undefined
            : '服务会短暂不可用。维护多个节点时，先在 OSD 页设置 noout，并一次只处理一个节点。'
        }
        confirmLabel={shown ? BULK_ACTION[shown.action] : '确认'}
        onConfirm={() =>
          shown ? runTask(cephServiceCommand(node, shown.action, shown.service), { title: label, invalidate: [cephKeys.all()] }) : undefined
        }
      />
    </>
  )
}
