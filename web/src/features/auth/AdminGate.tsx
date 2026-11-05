import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authKey, fetchLocalSession } from '@/api/local-auth'
import { useSession } from '@/api/useSession'
import { Button } from '@/components/ui/button'
import { LocalLoginPage } from './LocalLoginPage'

export function AdminGate({ children }: { children: ReactNode }) {
  const auth = useQuery({ queryKey: authKey, queryFn: fetchLocalSession, refetchInterval: 60_000, retry: 1 })
  const session = useSession()
  const client = useQueryClient()
  if (auth.isPending) return <main className="grid min-h-dvh place-items-center text-sm text-muted-foreground" role="status">正在连接 Tiller…</main>
  if (auth.isError && !auth.data) return <main className="grid min-h-dvh place-content-center justify-items-center gap-4"><p role="alert">无法连接 Tiller</p><Button onClick={() => void auth.refetch()}>重试</Button></main>
  if (!session || auth.data?.setupRequired) return <LocalLoginPage setup={auth.data?.setupRequired ?? false} onSuccess={(state) => {
    // Keep observed queries alive: setting the session can already mount the
    // app. SessionEffects clears private data when the previous session ends.
    client.setQueryData(authKey, state)
  }} />
  return children
}
