import { useMemo } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { SearchX } from 'lucide-react'

import { useClusterResources } from '@/api/queries'
import { isNode } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { DockPortal } from '@/components/layout/BottomDock'
import { PageHeader } from '@/components/PageHeader'
import { ActionBar, useActionRunner } from '@/components/page/ActionBar'
import { TabBar, TabPanel, TabSkeleton } from '@/components/page/RegistryTabs'
import { sortByOrder, visibleActions } from '@/components/page/registry'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatUptime } from '@/lib/format'
import { nodePath, statusLabel } from '@/lib/resources'

import { nodeActions, nodeTabs } from './registry'
import type { NodeActionContext, NodeTabProps } from './types'

/** /node/:node/:tab? — node detail shell with tabs and actions from registry.ts. */
export function NodePage() {
  const { node = '', tab } = useParams()
  const navigate = useNavigate()
  const { data: resource, isPending, isError } = useClusterResources({
    select: (all) => all.filter(isNode).find((n) => n.node === node),
  })
  const ctx = useMemo<NodeActionContext | null>(
    () => (resource ? { node, resource, navigate } : null),
    [node, resource, navigate],
  )

  if (!ctx) {
    if (isPending) {
      return (
        <div aria-busy="true" aria-label="加载中">
          <div className="mb-(--section-gap) grid gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-40" />
          </div>
          <TabSkeleton />
        </div>
      )
    }
    return (
      <>
        <PageHeader backTo="/" eyebrow="节点" title={node} />
        <GlassCard>
          <EmptyState
            icon={SearchX}
            title={isError ? '无法加载资源' : '找不到这个节点'}
            action={
              <Button asChild variant="outline">
                <Link to="/">回到概览</Link>
              </Button>
            }
          />
        </GlassCard>
      </>
    )
  }
  return <NodePageBody ctx={ctx} tabParam={tab} />
}

function NodePageBody({ ctx, tabParam }: { ctx: NodeActionContext; tabParam: string | undefined }) {
  const { node, resource } = ctx
  const tabProps: NodeTabProps = { node, resource }
  const tabs = sortByOrder(nodeTabs.filter((t) => t.visible?.(tabProps) ?? true))
  const actions = visibleActions(nodeActions, ctx)
  const { trigger, host } = useActionRunner(ctx)
  const active = tabs.find((t) => t.id === tabParam) ?? (tabParam ? undefined : tabs[0])
  if (!active) return <Navigate replace to={nodePath(node)} />

  return (
    <>
      <PageHeader
        backTo="/"
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <ResourceIcon type="node" className="size-3.5" /> 节点
          </span>
        }
        title={node}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <StatusDot status={resource.status} decorative /> {statusLabel(resource.status)}
            </span>
            {resource.status === 'online' && <span className="tabular">运行 {formatUptime(resource.uptime)}</span>}
          </span>
        }
        actions={<ActionBar variant="toolbar" actions={actions} ctx={ctx} trigger={trigger} className="hidden lg:flex" />}
      />
      <TabBar tabs={tabs} active={active.id} hrefFor={(id) => nodePath(node, id === tabs[0]?.id ? undefined : id)} />
      <TabPanel tab={active} props={tabProps} />
      <DockPortal>
        <ActionBar variant="dock" actions={actions} ctx={ctx} trigger={trigger} />
      </DockPortal>
      {host}
    </>
  )
}
