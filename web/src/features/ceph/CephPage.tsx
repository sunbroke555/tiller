// /datacenter/ceph/* — the cluster's Ceph: status, services (monitors,
// managers, MDS), OSDs, pools, CephFS, configuration and log, plus the
// install wizard (/datacenter/ceph/install[/<node>]). Node-scoped reads go to
// one node with Ceph installed (useCephNodes); services are managed on the
// node they run on.

import { useEffect, useRef, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Database, Download, TriangleAlert } from 'lucide-react'

import { cephErrorState, useCephMetadata, useCephStatus } from '@/api/ceph'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState, LoadingCards } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { CephFsView } from './CephFsView'
import { ConfigView } from './ConfigView'
import { InstallWizard } from './InstallWizard'
import { LogView } from './LogView'
import { OsdView } from './OsdView'
import { PoolsView } from './PoolsView'
import { ServicesView } from './ServicesView'
import { StatusView } from './StatusView'
import { Notice, useCephAccess } from './ui'
import { useCephNodes } from './useCephNode'

export const CEPH_BASE = '/datacenter/ceph'

type View = 'status' | 'services' | 'osd' | 'pools' | 'cephfs' | 'config' | 'log'

const VIEWS: { id: View; label: string }[] = [
  { id: 'status', label: '状态' },
  { id: 'services', label: '监视器' },
  { id: 'osd', label: 'OSD' },
  { id: 'pools', label: '存储池' },
  { id: 'cephfs', label: 'CephFS' },
  { id: 'config', label: '配置' },
  { id: 'log', label: '日志' },
]

export function cephHref(view: View | 'install', sub?: string): string {
  if (view === 'status') return CEPH_BASE
  return `${CEPH_BASE}/${view}${sub ? `/${encodeURIComponent(sub)}` : ''}`
}

export default function CephPage() {
  const [first, second] = (useParams()['*'] ?? '').split('/').filter(Boolean)
  const [search] = useSearchParams()

  if (first === 'install') {
    const node = second ? decodeURIComponent(second) : (search.get('node') ?? undefined)
    return <InstallWizard key={node ?? ''} initialNode={node} base={CEPH_BASE} />
  }
  const view: View = VIEWS.some((v) => v.id === first) ? (first as View) : 'status'
  return <CephSection view={view} />
}

function CephSection({ view }: { view: View }) {
  const status = useCephStatus()
  const metadata = useCephMetadata('all', !!status.data)
  const nodes = useCephNodes()
  const access = useCephAccess()
  const setup = status.error ? cephErrorState(status.error) : null
  const apiNode = nodes.apiNode

  if (status.isPending && !status.error) return <LoadingCards count={3} />

  if (setup === 'not-installed' || setup === 'not-initialized') {
    return (
      <EmptyState
        icon={Database}
        title={setup === 'not-installed' ? 'Ceph 尚未安装' : 'Ceph 尚未配置'}
        description={
          setup === 'not-installed'
            ? '在这个集群的节点上安装 Ceph，用节点上的磁盘组成高可用的分布式存储。'
            : 'Ceph 软件包已安装，还需要创建初始配置和第一个监视器。'
        }
        action={
          access.isRoot ? (
            <Button asChild data-testid="ceph-install">
              <Link to={cephHref('install')}>
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

  return (
    <div className="grid min-w-0 gap-(--section-gap)">
      <CephNav view={view} />
      {setup === 'unreachable' && (
        <Notice tone="err">
          <span className="font-medium">无法连接 Ceph 集群：</span>
          {errorMessage(status.error)}
          <span className="mt-1 block text-foreground/80">监视器可能都已停止。可以在“监视器”里启动它们，或查看日志。</span>
        </Notice>
      )}
      {!apiNode ? (
        <EmptyState icon={TriangleAlert} title="没有在线节点" />
      ) : (
        <ViewBody view={view} apiNode={apiNode}>
          {status.data ? <StatusView status={status.data} metadata={metadata.data} base={CEPH_BASE} /> : null}
        </ViewBody>
      )}
    </div>
  )
}

function ViewBody({ view, apiNode, children }: { view: View; apiNode: string; children: ReactNode }) {
  switch (view) {
    case 'services':
      return <ServicesView apiNode={apiNode} />
    case 'osd':
      return <OsdView apiNode={apiNode} />
    case 'pools':
      return <PoolsView apiNode={apiNode} />
    case 'cephfs':
      return <CephFsView apiNode={apiNode} />
    case 'config':
      return <ConfigView apiNode={apiNode} />
    case 'log':
      return <LogView defaultNode={apiNode} />
    default:
      return <>{children}</>
  }
}

function CephNav({ view }: { view: View }) {
  const ref = useRef<HTMLElement>(null)
  // Phones: keep the current view's tab visible in the scrolling bar.
  useEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [view])
  return (
    <nav ref={ref} aria-label="Ceph" className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
      <ul className="flex w-max gap-1 rounded-xl bg-secondary/60 p-1 paper:bg-secondary">
        {VIEWS.map((v) => (
          <li key={v.id}>
            <Link
              to={cephHref(v.id)}
              aria-current={v.id === view ? 'page' : undefined}
              className={cn(
                'inline-flex h-9 items-center rounded-lg px-3.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-10',
                v.id === view && 'bg-background font-medium text-foreground shadow-sm paper:bg-card',
              )}
            >
              {v.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
