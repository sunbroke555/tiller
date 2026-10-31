import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { GuestTabProps } from '@/features/guest/types'

/** Placeholder owned by area `lxc-config`: replace with the real tab. */
export default function OptionsTab(_props: GuestTabProps) {
  return <AreaPlaceholder area="lxc-config">开机自启、特性、控制台模式等容器选项。</AreaPlaceholder>
}
