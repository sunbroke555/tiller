import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { GuestTabProps } from '@/features/guest/types'

/** Placeholder owned by area `qemu-config`: replace with the real tab. */
export default function OptionsTab(_props: GuestTabProps) {
  return <AreaPlaceholder area="qemu-config">名称、开机自启、启动顺序、OS 类型、QEMU Agent 等选项。</AreaPlaceholder>
}
