import { useMemo, useState } from 'react'
import { Search, ShieldCheck } from 'lucide-react'

import { useOwnPermissions } from '@/api/permissions'
import { usePveIdentity } from '@/api/instances'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { PageHeader } from '@/components/PageHeader'
import { ErrorCard, LoadingRows } from '@/components/QueryState'
import { Input } from '@/components/ui/input'
import { aclAncestors, normalizeAclPath } from '@/lib/permissions'
import { cn } from '@/lib/utils'

/** Group privilege names by their prefix ("VM", "Sys", "Datastore" …). */
function groupPrivs(privs: string[]): [string, string[]][] {
  const groups = new Map<string, string[]>()
  for (const p of privs.sort()) {
    const g = p.split('.')[0] ?? p
    groups.set(g, [...(groups.get(g) ?? []), p])
  }
  return [...groups.entries()]
}

const PATH_HINT: Record<string, string> = {
  '/': '整个数据中心',
  '/vms': '所有虚拟机和容器',
  '/nodes': '所有节点',
  '/storage': '所有存储',
  '/pool': '所有资源池',
  '/access': '用户与权限管理',
  '/access/groups': '用户组',
  '/sdn': '软件定义网络',
  '/mapping': '资源映射',
}

/** /account/permissions — GET /access/permissions as a searchable list. */
export default function PermissionsPage() {
  const pveUser = usePveIdentity()
  const perms = useOwnPermissions()
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const map = perms.data ?? {}
    return Object.entries(map)
      .map(([path, privs]) => {
        const p = normalizeAclPath(path)
        // Same privileges as the nearest listed parent gets through inheritance: say so instead of repeating 40 chips.
        const parent = aclAncestors(p).slice(1).find((a) => a in map)
        const own = Object.keys(privs).sort().join(',')
        const fromParent = parent === undefined ? null : Object.entries(map[parent] ?? {}).filter(([, v]) => v === 1).map(([k]) => k).sort().join(',')
        const inherited = fromParent === own
        return { path: p, privs: Object.entries(privs), sameAs: inherited ? parent : undefined }
      })
      .filter(({ path, privs }) => {
        if (!words.length) return true
        const hay = `${path} ${privs.map(([k]) => k).join(' ')}`.toLowerCase()
        return words.every((w) => hay.includes(w))
      })
      .sort((a, b) => a.path.localeCompare(b.path))
  }, [perms.data, q])

  return (
    <>
      <PageHeader title="我的权限" description={pveUser} backTo="/account" eyebrow="账户与安全" />
      <div className="mb-3 relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="按路径或权限名过滤，如 /vms 或 PowerMgmt" className="pl-9" aria-label="过滤权限" />
      </div>
      <p className="mb-(--section-gap) text-xs text-muted-foreground">
        列出有权限设置的路径及你在上面的有效权限。<span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-brand" aria-hidden />表示会传递给子路径。</span>
      </p>
      {perms.isPending ? (
        <GlassCard flush>
          <LoadingRows rows={4} />
        </GlassCard>
      ) : perms.isError ? (
        <ErrorCard error={perms.error} onRetry={() => void perms.refetch()} />
      ) : rows.length === 0 ? (
        <GlassCard>
          <EmptyState icon={ShieldCheck} title={q ? '没有匹配的权限' : '没有任何权限'} />
        </GlassCard>
      ) : (
        <div className="grid gap-(--row-gap)">
          {rows.map(({ path, privs, sameAs }) => (
            <GlassCard key={path} aria-label={path}>
              <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2">
                <code className="font-mono text-sm font-medium">{path}</code>
                {PATH_HINT[path] && <span className="text-xs text-muted-foreground">{PATH_HINT[path]}</span>}
                <span className="ml-auto text-xs text-muted-foreground tabular">{privs.length} 项</span>
              </div>
              {privs.length === 0 ? (
                <p className="text-sm text-muted-foreground">没有权限（NoAccess）</p>
              ) : sameAs && !q.trim() ? (
                <p className="text-sm text-muted-foreground">
                  与 <code className="font-mono text-foreground">{sameAs}</code> 相同（继承）
                </p>
              ) : (
                <div className="grid gap-2">
                  {groupPrivs(privs.map(([k]) => k)).map(([group, list]) => (
                    // Phones: group name above its chips; wider: a label column, chips wrap beside it.
                    <div key={group} className="grid gap-1 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-2">
                      <span className="text-xs text-muted-foreground sm:pt-1">{group}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {list.map((p) => {
                          const propagate = privs.find(([k]) => k === p)?.[1] === 1
                          return (
                            <span
                              key={p}
                              title={propagate ? '传递给子路径' : '只对这个路径生效'}
                              className={cn(
                                'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-inset',
                                'bg-foreground/[0.04] ring-border paper:bg-secondary',
                              )}
                            >
                              {propagate && <span className="size-1.5 rounded-full bg-brand" aria-hidden />}
                              {p.slice(group.length + 1) || p}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          ))}
        </div>
      )}
    </>
  )
}
