import { useEffect } from 'react'
import { Navigate } from 'react-router'

import { instanceUrl, preferredInstance, useInstances } from '@/api/instances'
import { Button } from '@/components/ui/button'

/** The global home resumes an instance; resources live in the app's sidebar. */
export default function InstanceHome() {
  const catalog = useInstances()
  const target = preferredInstance(catalog.data?.instances ?? [])
  const url = target && instanceUrl(target)
  useEffect(() => {
    if (url) window.location.replace(url)
  }, [url])

  if (catalog.isError && !catalog.data) {
    return <main className="grid min-h-dvh place-content-center justify-items-center gap-4">
      <p role="alert">无法读取实例列表</p>
      <Button variant="outline" onClick={() => void catalog.refetch()}>重试</Button>
    </main>
  }
  if (catalog.data && !target) return <Navigate to="/instances" replace />
  return <main className="grid min-h-dvh place-items-center text-sm text-muted-foreground" role="status">正在打开实例…</main>
}
