import type { ReactNode } from 'react'

import { getInstanceScope } from '@/api/instance-scope'
import { useInstances } from '@/api/instances'
import { Button } from '@/components/ui/button'

/** Refuse stale/deleted scopes before mounting any PVE queries or actions. */
export function InstanceBoundary({ children }: { children: ReactNode }) {
  const scope = getInstanceScope()
  if (!scope) return children
  return <ScopedBoundary>{children}</ScopedBoundary>
}

function ScopedBoundary({ children }: { children: ReactNode }) {
  const scope = getInstanceScope()!
  const catalog = useInstances()
  const valid = catalog.data?.instances.some((i) => i.id === scope.id && i.version === scope.version)
  if (valid) return children
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-sans text-xl font-semibold">{catalog.isPending ? '正在连接实例…' : catalog.isError ? '无法读取实例列表' : '实例连接已变更'}</h1>
      {!catalog.isPending && <p className="max-w-md text-sm text-muted-foreground">{catalog.isError ? '请检查网络后重试。' : '这个连接已被修改或删除，请重新选择要管理的 PVE。'}</p>}
      {catalog.isError && <Button onClick={() => void catalog.refetch()}>重试</Button>}
      {!catalog.isPending && <Button variant="outline" asChild><a href="/instances">选择实例</a></Button>}
    </main>
  )
}
