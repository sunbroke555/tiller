import { useState } from 'react'
import { Link } from 'react-router'
import { ChevronRight, Search, ShieldCheck } from 'lucide-react'

import type { UncoveredGuest } from '@/api/backup-jobs'
import { useClusterResources } from '@/api/queries'
import { isGuest } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { ResourceIcon } from '@/components/ResourceIcon'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { guestPath } from '@/lib/resources'

import { matchGuest } from './GuestPicker'

/** "没有备份计划的客户机" (PVE.dc.BackedGuests over /cluster/backup-info/not-backed-up). */
export function UncoveredGuestsDialog({
  open,
  onOpenChange,
  guests,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  guests: readonly UncoveredGuest[]
}) {
  const [query, setQuery] = useState('')
  // For links and the node: the endpoint lists vmid, name and type only.
  const { data: resources } = useClusterResources({ select: (all) => all.filter(isGuest) })
  const nodeOf = new Map((resources ?? []).map((g) => [g.vmid, g.node]))
  const shown = [...guests]
    .sort((a, b) => a.vmid - b.vmid)
    .filter((g) => matchGuest({ ...g, node: nodeOf.get(g.vmid) ?? '' }, query))

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="没有备份计划的客户机"
      description="这些客户机不在任何备份计划里，不会被自动备份。"
      size="md"
      footer={
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          关闭
        </Button>
      }
    >
      <div className="grid gap-3 pt-1 pb-2">
        {guests.length > 5 && (
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名称、VMID、类型" aria-label="搜索客户机" className="pl-8" />
          </div>
        )}
        {guests.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="全部客户机都有备份计划" className="py-6" />
        ) : (
          <ul aria-label="没有备份计划的客户机" className="divide-y divide-border/60 rounded-xl border border-border/60">
            {shown.map((g) => {
              const node = nodeOf.get(g.vmid)
              const body = (
                <>
                  <ResourceIcon type={g.type} variant="tile" />
                  <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground tabular">{g.vmid}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground">{g.name ?? '—'}</span>
                  {node && <span className="shrink-0 text-xs text-muted-foreground">{node}</span>}
                </>
              )
              return (
                <li key={g.vmid} data-vmid={g.vmid}>
                  {node ? (
                    <Link
                      to={guestPath({ node, type: g.type, vmid: g.vmid }, 'backup')}
                      onClick={() => onOpenChange(false)}
                      className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-accent/50"
                    >
                      {body}
                      <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
                    </Link>
                  ) : (
                    <div className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm">{body}</div>
                  )}
                </li>
              )
            })}
            {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">没有匹配的客户机</li>}
          </ul>
        )}
      </div>
    </ResponsiveDialog>
  )
}
