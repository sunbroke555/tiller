import { useMemo } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { Lock, SearchX } from 'lucide-react'

import { usePermissions } from '@/api/permissions'
import { useClusterResources } from '@/api/queries'
import { isGuest, type GuestType } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { DockPortal } from '@/components/layout/BottomDock'
import { PageHeader } from '@/components/PageHeader'
import { ActionBar, useActionRunner } from '@/components/page/ActionBar'
import { TabBar, TabPanel, TabSkeleton } from '@/components/page/RegistryTabs'
import { sortByOrder, visibleActions } from '@/components/page/registry'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { TagList } from '@/components/TagChip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { allowedFor } from '@/lib/permissions'
import { GUEST_TYPE_LABEL, guestName, guestPath, nodePath, statusLabel } from '@/lib/resources'

import { guestActions, guestTabs } from './registry'
import { GuestContextProvider, type GuestActionContext, type GuestTabProps } from './types'

/**
 * /guest/:node/:type/:vmid/:tab? — the VM / CT detail page shell: header,
 * action bar and tabs, all from features/guest/registry.ts.
 */
export function GuestPage() {
  const params = useParams()
  const navigate = useNavigate()
  const type: GuestType = params.type === 'lxc' ? 'lxc' : 'qemu'
  const vmid = Number(params.vmid)
  const node = params.node ?? ''
  const tabParam = params.tab

  const { data: guest, isPending, isError } = useClusterResources({
    select: (all) => all.filter(isGuest).find((g) => g.vmid === vmid),
  })

  const ctx = useMemo<GuestActionContext | null>(
    () => (guest ? { node: guest.node, type: guest.type, vmid, guest, name: guestName(guest), navigate } : null),
    [guest, vmid, navigate],
  )

  if (guest && (guest.node !== node || guest.type !== type)) {
    // Migrated to another node (or a stale link): follow it.
    return <Navigate replace to={guestPath(guest, tabParam)} />
  }

  if (!ctx) {
    if (isPending) return <GuestPageSkeleton />
    return (
      <>
        <PageHeader backTo="/" eyebrow={`${GUEST_TYPE_LABEL[type]} · ${node}`} title={`${type === 'lxc' ? 'CT' : 'VM'} ${params.vmid}`} />
        <GlassCard>
          <EmptyState
            icon={SearchX}
            title={isError ? '无法加载资源' : '找不到这台客户机'}
            description={isError ? '请检查网络连接后重试。' : '它可能已被删除，或者你没有查看它的权限。'}
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

  return <GuestPageBody ctx={ctx} tabParam={tabParam} />
}

function GuestPageBody({ ctx, tabParam }: { ctx: GuestActionContext; tabParam: string | undefined }) {
  const { guest, type, vmid, node } = ctx
  const tabProps: GuestTabProps = { node, type, vmid, guest }
  const tabs = sortByOrder(guestTabs.filter((t) => t.types.includes(type) && (t.visible?.(tabProps) ?? true)))
  const perms = usePermissions()
  const actions = visibleActions(
    guestActions.filter((a) => !a.types || a.types.includes(type)),
    ctx,
    (a) => allowedFor(perms, a, ctx, { kind: 'guest', vmid, pool: guest.pool }),
  )
  const { trigger, host } = useActionRunner(ctx)

  const active = tabs.find((t) => t.id === tabParam) ?? (tabParam ? undefined : tabs[0])
  if (!active) return <Navigate replace to={guestPath(guest)} />

  return (
    <GuestContextProvider value={ctx}>
      <PageHeader
        backTo="/"
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <ResourceIcon type={type} template={guest.template === 1} className="size-3.5" />
            <span>{GUEST_TYPE_LABEL[type]}</span>
            <span className="tabular">{vmid}</span>
            <span aria-hidden>·</span>
            <Link to={nodePath(node)} className="underline-offset-2 hover:text-foreground hover:underline">
              {node}
            </Link>
          </span>
        }
        title={ctx.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5">
              <StatusDot status={guest.status} decorative />
              {guest.template === 1 ? '模板' : statusLabel(guest.status)}
            </span>
            {guest.lock && (
              <Badge variant="outline" className="gap-1 border-warning/40 text-warning">
                <Lock /> 已锁定：{guest.lock}
              </Badge>
            )}
            {guest.hastate && <Badge variant="outline">HA：{guest.hastate}</Badge>}
            <TagList tags={guest.tags} size="md" />
          </span>
        }
        actions={<ActionBar variant="toolbar" actions={actions} ctx={ctx} trigger={trigger} className="hidden lg:flex" />}
      />

      <TabBar tabs={tabs} active={active.id} hrefFor={(id) => guestPath(guest, id === tabs[0]?.id ? undefined : id)} />
      <TabPanel tab={active} props={tabProps} />

      <DockPortal>
        <ActionBar variant="dock" actions={actions} ctx={ctx} trigger={trigger} />
      </DockPortal>
      {host}
    </GuestContextProvider>
  )
}

function GuestPageSkeleton() {
  return (
    <div aria-busy="true" aria-label="加载中">
      <div className="mb-(--section-gap) grid gap-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="mb-(--section-gap) h-10 w-full max-w-xl" />
      <TabSkeleton />
    </div>
  )
}
