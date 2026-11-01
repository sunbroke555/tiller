import { useEffect, useRef } from 'react'
import { WifiOff } from 'lucide-react'
import { toast } from 'sonner'

import { useOnline } from '@/hooks/usePwa'

/**
 * A pill at the top while the device is offline: the app shell still works
 * (service worker), lists show the last data they had, and queries refetch
 * by themselves when the connection is back.
 */
export function OfflineBanner() {
  const online = useOnline()
  const wasOffline = useRef(false)

  useEffect(() => {
    if (!online) wasOffline.current = true
    else if (wasOffline.current) {
      wasOffline.current = false
      toast.success('网络已恢复', { id: 'network', duration: 2500 })
    }
  }, [online])

  if (online) return null
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-50 flex justify-center px-4"
    >
      <div className="surface-strong pointer-events-auto flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-warning-strong">
        <WifiOff className="size-3.5" aria-hidden />
        <span>网络已断开 · 显示的是最后一次获取的数据</span>
      </div>
    </div>
  )
}
