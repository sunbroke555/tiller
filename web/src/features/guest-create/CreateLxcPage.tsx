import { PageHeader } from '@/components/PageHeader'
import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'

/** Placeholder owned by area `guest-create`: replace with the wizard. */
export default function CreateLxcPage() {
  return (
    <>
      <PageHeader backTo="/" title="创建容器" />
      <AreaPlaceholder area="guest-create">新建容器向导：常规、模板、磁盘、CPU、内存、网络、DNS。</AreaPlaceholder>
    </>
  )
}
