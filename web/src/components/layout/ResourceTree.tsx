import { useMemo, useState } from 'react'
import { NavLink } from 'react-router'
import { ChevronRight } from 'lucide-react'

import { useClusterResources } from '@/api/queries'
import { isGuest, isNode, type ClusterResource, type GuestResource, type NodeResource } from '@/api/types'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { Skeleton } from '@/components/ui/skeleton'
import { byVmid, guestName, guestPath, nodePath } from '@/lib/resources'
import { cn } from '@/lib/utils'

interface NodeBranch {
  node: NodeResource
  guests: GuestResource[]
}

function buildTree(resources: ClusterResource[]): NodeBranch[] {
  const guests = resources.filter(isGuest)
  return resources
    .filter(isNode)
    .sort((a, b) => a.node.localeCompare(b.node))
    .map((node) => ({ node, guests: guests.filter((g) => g.node === node.node).sort(byVmid) }))
}

const rowClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-[13px] transition-colors',
    isActive ? 'bg-sidebar-accent text-foreground' : 'text-foreground/80 hover:bg-sidebar-accent/70 hover:text-foreground',
  )

/** Desktop sidebar tree: nodes with their guests. */
export function ResourceTree() {
  const { data, isPending } = useClusterResources()
  const tree = useMemo(() => buildTree(data ?? []), [data])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  if (isPending) {
    return (
      <div className="space-y-2 px-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-6" />
        ))}
      </div>
    )
  }

  return (
    <ul className="space-y-0.5" role="tree" aria-label="资源树">
      {tree.map(({ node, guests }) => {
        const open = !collapsed[node.node]
        return (
          <li key={node.id} role="treeitem" aria-expanded={open}>
            <div className="flex items-center">
              <button
                type="button"
                aria-label={open ? '折叠' : '展开'}
                onClick={() => setCollapsed((c) => ({ ...c, [node.node]: open }))}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
              </button>
              <NavLink to={nodePath(node.node)} className={(s) => cn(rowClass(s), 'flex-1 font-medium')}>
                <ResourceIcon type="node" className="size-3.5" />
                <span className="truncate">{node.node}</span>
                <StatusDot status={node.status} size="sm" pulse={false} className="ml-auto" />
              </NavLink>
            </div>
            {open && (
              <ul role="group" className="mt-0.5 ml-[11px] space-y-0.5 border-l border-sidebar-border pl-2.5">
                {guests.map((g) => (
                  <li key={g.id} role="treeitem">
                    <NavLink to={guestPath(g)} className={rowClass}>
                      <StatusDot status={g.status} size="sm" pulse={false} />
                      <span className="w-8 shrink-0 text-[11px] text-muted-foreground tabular">{g.vmid}</span>
                      <span className={cn('truncate', g.status !== 'running' && 'text-muted-foreground')}>{guestName(g)}</span>
                      {g.template === 1 && <ResourceIcon type={g.type} template className="ml-auto size-3" />}
                    </NavLink>
                  </li>
                ))}
                {guests.length === 0 && <li className="px-2 py-1 text-xs text-muted-foreground">没有客户机</li>}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
