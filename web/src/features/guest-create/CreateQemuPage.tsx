import { PageHeader } from '@/components/PageHeader'
import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'

/** Placeholder owned by area `guest-create`: replace with the wizard. */
export default function CreateQemuPage() {
  return (
    <>
      <PageHeader backTo="/" title="创建虚拟机" />
      <AreaPlaceholder area="guest-create">新建虚拟机向导：常规、系统、磁盘、CPU、内存、网络。</AreaPlaceholder>
    </>
  )
}
