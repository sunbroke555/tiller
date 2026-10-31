import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { GuestTabProps } from '@/features/guest/types'

/** Placeholder owned by area `qemu-config`: replace with the real tab. */
export default function MonitorTab(_props: GuestTabProps) {
  return <AreaPlaceholder area="qemu-config">QEMU Monitor 命令行。</AreaPlaceholder>
}
