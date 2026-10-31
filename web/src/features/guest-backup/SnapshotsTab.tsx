import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { GuestTabProps } from '@/features/guest/types'

/** Placeholder owned by area `guest-snapshots-backup`: replace with the real tab. */
export default function SnapshotsTab(_props: GuestTabProps) {
  return <AreaPlaceholder area="guest-snapshots-backup">快照树：创建、回滚、删除和编辑描述。</AreaPlaceholder>
}
