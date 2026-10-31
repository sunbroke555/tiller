import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { GuestTabProps } from '@/features/guest/types'

/** Placeholder owned by area `guest-summary-power`: replace with the real tab. */
export default function SummaryTab(_props: GuestTabProps) {
  return <AreaPlaceholder area="guest-summary-power">状态、资源用量图表、IP 地址、备注和标签。</AreaPlaceholder>
}
