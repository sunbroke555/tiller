import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { GuestTabProps } from '@/features/guest/types'

/** Placeholder owned by area `lxc-config`: replace with the real tab. */
export default function ResourcesTab(_props: GuestTabProps) {
  return <AreaPlaceholder area="lxc-config">内存、交换、CPU、根磁盘和挂载点。</AreaPlaceholder>
}
