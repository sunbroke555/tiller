import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { StorageTabProps } from '@/features/storage/types'

/** Placeholder owned by area `storage-browser`: replace with the real tab. */
export default function SummaryTab(_props: StorageTabProps) {
  return <AreaPlaceholder area="storage-browser">存储用量、类型、内容和用量图表。</AreaPlaceholder>
}
