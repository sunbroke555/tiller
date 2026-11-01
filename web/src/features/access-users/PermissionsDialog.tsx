import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'

import { usePermissionsOf } from '@/api/access-users'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'

import { permissionRows } from './model'
import { SearchBox } from './ui'

/** Effective privileges of a user or an API token (PVE.dc.PermissionView). */
export function PermissionsDialog({ userid, open, onOpenChange }: { userid: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const perms = usePermissionsOf(open && userid ? userid : undefined)
  const [q, setQ] = useState('')
  const rows = permissionRows(perms.data ?? {}, q)
  const isToken = !!userid?.includes('!')

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setQ('')
        onOpenChange(o)
      }}
      title={isToken ? '令牌权限' : '用户权限'}
      description={userid}
      size="lg"
      footer={
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          关闭
        </Button>
      }
    >
      <div className="grid gap-3 pb-2">
        <SearchBox value={q} onChange={setQ} placeholder="按路径或权限名过滤" label="过滤权限" />
        <p className="text-xs text-muted-foreground">
          {isToken ? '令牌开启权限分离时，只拥有单独授予它的权限（不超过所属用户）。' : '有效权限：用户自身、所在组及继承的权限。'}
          <span className="ml-1 inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-brand" aria-hidden />
            传递给子路径
          </span>
        </p>
        {perms.isPending ? (
          <LoadingRows rows={3} />
        ) : perms.isError ? (
          <ErrorState compact error={perms.error} onRetry={() => void perms.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={ShieldCheck} title={q ? '没有匹配的权限' : '没有任何权限'} />
        ) : (
          <ul className="grid gap-2" aria-label="权限列表">
            {rows.map((r) => (
              <li key={r.path} className="rounded-xl bg-foreground/[0.03] px-3 py-2.5 ring-1 ring-border/70 ring-inset paper:bg-secondary/50">
                <div className="mb-1.5 flex items-baseline gap-2">
                  <code className="min-w-0 truncate font-mono text-sm font-medium">{r.path}</code>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular">{r.privs.length} 项</span>
                </div>
                {r.privs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">没有权限（NoAccess）</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {r.privs.map((x) => (
                      <span
                        key={x.name}
                        title={x.propagate ? '传递给子路径' : '只对这个路径生效'}
                        className="inline-flex items-center gap-1 rounded-md bg-background/60 px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-border ring-inset paper:bg-card"
                      >
                        {x.propagate && <span className="size-1.5 rounded-full bg-brand" aria-hidden />}
                        {x.name}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </ResponsiveDialog>
  )
}
