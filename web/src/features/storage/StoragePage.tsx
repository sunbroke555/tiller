import { useMemo } from 'react'
import { Link } from 'react-router'
import { ChevronRight, Database } from 'lucide-react'

import { useClusterResources } from '@/api/queries'
import { isStorage, type StorageResource } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { UsageBar } from '@/components/UsageBar'
import { Skeleton } from '@/components/ui/skeleton'
import { formatUsage, ratio } from '@/lib/format'
import { storagePath } from '@/lib/resources'

import { STORAGE_CONTENT_LABEL, storageContents } from './types'

/** /storage — every storage of every node, grouped by node. */
export function StoragePage() {
  const { data, isPending } = useClusterResources({ select: (all) => all.filter(isStorage) })
  const groups = useMemo(() => {
    const byNode = new Map<string, StorageResource[]>()
    for (const s of data ?? []) byNode.set(s.node, [...(byNode.get(s.node) ?? []), s])
    return [...byNode.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([node, list]) => ({ node, list: list.sort((a, b) => a.storage.localeCompare(b.storage)) }))
  }, [data])

  return (
    <>
      <PageHeader title="存储" description="存储用量、内容、ISO 与备份" />
      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <GlassCard>
          <EmptyState icon={Database} title="没有存储" description="当前账号看不到任何存储。" />
        </GlassCard>
      ) : (
        <div className="grid gap-(--section-gap)">
          {groups.map((g) => (
            <section key={g.node}>
              {groups.length > 1 && <SectionHeader title={g.node} />}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.list.map((s) => (
                  <StorageCard key={s.id} storage={s} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

function StorageCard({ storage: s }: { storage: StorageResource }) {
  const contents = storageContents(s.content)
  return (
    <GlassCard asChild interactive>
      <Link to={storagePath(s.node, s.storage)} className="grid gap-3">
        <div className="flex items-center gap-3">
          <ResourceIcon type="storage" variant="tile" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-foreground">{s.storage}</span>
              <StatusDot status={s.status} size="sm" pulse={false} />
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {[s.plugintype, s.shared === 1 ? '共享' : null].filter(Boolean).join(' · ')}
            </div>
          </div>
          <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
        </div>
        <UsageBar value={ratio(s.disk, s.maxdisk)} detail={formatUsage(s.disk, s.maxdisk)} size="sm" />
        {contents.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {contents.map((c) => (
              <span key={c} className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                {STORAGE_CONTENT_LABEL[c]}
              </span>
            ))}
          </div>
        )}
      </Link>
    </GlassCard>
  )
}
