import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { GuestTabProps } from '@/features/guest/types'

/** Placeholder owned by area `lxc-config`: replace with the real tab. */
export default function DnsTab(_props: GuestTabProps) {
  return <AreaPlaceholder area="lxc-config">DNS 域和 DNS 服务器。</AreaPlaceholder>
}
