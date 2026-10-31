import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { GuestTabProps } from '@/features/guest/types'

/** Placeholder owned by area `console`: replace with the real tab. */
export default function GuestConsoleTab(_props: GuestTabProps) {
  return <AreaPlaceholder area="console">内嵌 noVNC / xterm.js 控制台。</AreaPlaceholder>
}
