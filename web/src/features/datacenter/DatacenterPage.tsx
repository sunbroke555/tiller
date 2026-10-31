import { ComingSoon } from '@/components/ComingSoon'
import { PageHeader } from '@/components/PageHeader'

export function DatacenterPage() {
  return (
    <>
      <PageHeader title="数据中心" description="集群、用户与权限、备份计划、HA、防火墙" />
      <ComingSoon>数据中心级别的配置会在这里。</ComingSoon>
    </>
  )
}
