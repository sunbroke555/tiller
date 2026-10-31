import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { GuestTabProps } from '@/features/guest/types'

/** Placeholder owned by area `qemu-config`: replace with the real tab. */
export default function HardwareTab(_props: GuestTabProps) {
  return <AreaPlaceholder area="qemu-config">内存、处理器、磁盘、网卡等硬件的查看、添加和编辑。</AreaPlaceholder>
}
