import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { GuestTabProps } from '@/features/guest/types'

/** Placeholder owned by area `lxc-config`: replace with the real tab. */
export default function NetworkTab(_props: GuestTabProps) {
  return <AreaPlaceholder area="lxc-config">容器网卡的添加、编辑和删除。</AreaPlaceholder>
}
