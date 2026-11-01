// /datacenter/ha/groups: legacy HA groups, read-only (PVE 9 migrates them to
// node affinity rules once every node runs PVE 9; no new groups are created).

import { Link } from 'react-router'
import { Users } from 'lucide-react'
import type { UseQueryResult } from '@tanstack/react-query'

import type { HaGroup } from '@/api/ha'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/errors'

import { parseRuleNodes } from './logic'
import { CardHeader, Chip, Notice } from './ui'

export function GroupsView({ query }: { query: UseQueryResult<{ migrated: boolean; groups: HaGroup[] }> }) {
  const groups = query.data?.groups ?? []
  return (
    <div className="grid gap-(--section-gap)">
      <Notice title="HA 组已被亲和规则取代">
        集群所有节点升级到 PVE 9 后，HA 管理器会自动把旧组转换为
        <Link to="/datacenter/ha/rules" className="mx-1 underline underline-offset-2">
          节点亲和规则
        </Link>
        （受限组 → 严格规则，不回迁 → 资源的「自动回迁」关闭）。这里只读展示，不能新建或修改。
      </Notice>
      <GlassCard flush className="overflow-hidden">
        <CardHeader title="旧 HA 组" summary={query.isPending ? '正在读取…' : `${groups.length} 个组`} />
        {query.isPending ? (
          <div className="p-(--card-p)">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : query.error ? (
          <div className="p-(--card-p)">
            <Notice tone="error">无法读取 HA 组：{errorMessage(query.error)}</Notice>
          </div>
        ) : groups.length === 0 ? (
          <EmptyState icon={Users} title={query.data?.migrated ? '旧组已全部迁移为规则' : '没有旧 HA 组'} className="py-8" />
        ) : (
          <ul className="divide-y divide-border/60" aria-label="旧 HA 组">
            {groups.map((g) => (
              <li key={g.group} className="grid gap-1 px-(--card-p) py-(--row-py)" data-testid="ha-group">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{g.group}</span>
                  {g.restricted ? <Chip tone="warning">受限</Chip> : null}
                  {g.nofailback ? <Chip tone="muted">不回迁</Chip> : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {parseRuleNodes(g.nodes)
                    .map((n) => (n.priority ? `${n.node}（优先级 ${n.priority}）` : n.node))
                    .join('、')}
                </div>
                {g.comment && <p className="text-xs text-foreground/70">{g.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  )
}
