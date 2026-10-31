import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { GuestTabProps } from '@/features/guest/types'

/** Placeholder owned by area `guest-snapshots-backup`: replace with the real tab. */
export default function BackupTab(_props: GuestTabProps) {
  return <AreaPlaceholder area="guest-snapshots-backup">立即备份、备份列表和从备份恢复。</AreaPlaceholder>
}
