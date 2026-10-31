import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { StorageTabProps } from '@/features/storage/types'

/** Placeholder owned by area `storage-browser`: replace with the real tab. */
export default function ContentTab(_props: StorageTabProps) {
  return <AreaPlaceholder area="storage-browser">按内容类型浏览：上传、URL 下载、模板、删除和备注。</AreaPlaceholder>
}
