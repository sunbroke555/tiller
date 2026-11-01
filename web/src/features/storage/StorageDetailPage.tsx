import { useMemo } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { SearchX } from 'lucide-react'

import { usePermissions } from '@/api/permissions'
import { useClusterResources } from '@/api/queries'
import { isStorage } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { DockPortal } from '@/components/layout/BottomDock'
import { PageHeader } from '@/components/PageHeader'
import { ActionBar, useActionRunner } from '@/components/page/ActionBar'
import { TabBar, TabPanel, TabSkeleton } from '@/components/page/RegistryTabs'
import { sortByOrder, visibleActions } from '@/components/page/registry'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatUsage } from '@/lib/format'
import { allowedFor } from '@/lib/permissions'
import { nodePath, statusLabel, storagePath } from '@/lib/resources'

import { storageActions, storageTabs } from './registry'
import type { StorageActionContext, StorageTabProps } from './types'

/** /storage/:node/:storage/:tab? — storage detail shell. */
export default function StorageDetailPage() {
  const { node = '', storage = '', tab } = useParams()
  const navigate = useNavigate()
  const { data: resource, isPending, isError } = useClusterResources({
    select: (all) => all.filter(isStorage).find((s) => s.node === node && s.storage === storage),
  })
  const ctx = useMemo<StorageActionContext | null>(
    () => (resource ? { node, storage, resource, navigate } : null),
    [node, storage, resource, navigate],
  )

  if (!ctx) {
    if (isPending) {
      return (
        <div aria-busy="true" aria-label="加载中">
          <div className="mb-(--section-gap) grid gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-44" />
          </div>
          <TabSkeleton />
        </div>
      )
    }
    return (
      <>
        <PageHeader backTo="/storage" eyebrow={`存储 · ${node}`} title={storage} />
        <GlassCard>
          <EmptyState
            icon={SearchX}
            title={isError ? '无法加载资源' : '找不到这个存储'}
            action={
              <Button asChild variant="outline">
                <Link to="/storage">回到存储列表</Link>
              </Button>
            }
          />
        </GlassCard>
      </>
    )
  }
  return <StorageDetailBody ctx={ctx} tabParam={tab} />
}

function StorageDetailBody({ ctx, tabParam }: { ctx: StorageActionContext; tabParam: string | undefined }) {
  const { node, storage, resource } = ctx
  const baseProps: StorageTabProps = { node, storage, resource }
  const tabs = sortByOrder(storageTabs.filter((t) => t.visible?.(baseProps) ?? true))
  const perms = usePermissions()
  const actions = visibleActions(storageActions, ctx, (a) =>
    allowedFor(perms, a, ctx, { kind: 'storage', storage: ctx.storage, pool: ctx.resource.pool }),
  )
  const { trigger, host } = useActionRunner(ctx)
  const active = tabs.find((t) => t.id === tabParam) ?? (tabParam ? undefined : tabs[0])
  if (!active) return <Navigate replace to={storagePath(node, storage)} />
  const props: StorageTabProps = active.content ? { ...baseProps, content: active.content } : baseProps

  return (
    <>
      <PageHeader
        backTo="/storage"
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <ResourceIcon type="storage" className="size-3.5" />
            存储 ·
            <Link to={nodePath(node)} className="underline-offset-2 hover:text-foreground hover:underline">
              {node}
            </Link>
          </span>
        }
        title={storage}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5">
              <StatusDot status={resource.status} decorative /> {statusLabel(resource.status)}
            </span>
            {resource.plugintype && <Badge variant="secondary">{resource.plugintype}</Badge>}
            {resource.shared === 1 && <Badge variant="outline">共享</Badge>}
            <span className="tabular">{formatUsage(resource.disk, resource.maxdisk)}</span>
          </span>
        }
        actions={<ActionBar variant="toolbar" actions={actions} ctx={ctx} trigger={trigger} className="hidden lg:flex" />}
      />
      <TabBar
        tabs={tabs}
        active={active.id}
        hrefFor={(id) => storagePath(node, storage, id === tabs[0]?.id ? undefined : id)}
      />
      <TabPanel tab={active} props={props} />
      <DockPortal>
        <ActionBar variant="dock" actions={actions} ctx={ctx} trigger={trigger} />
      </DockPortal>
      {host}
    </>
  )
}
