import { useParams } from 'react-router'

import { ComingSoon } from '@/components/ComingSoon'
import { PageHeader } from '@/components/PageHeader'

export function NodePage() {
  const { node = '' } = useParams()
  return (
    <>
      <PageHeader backTo="/" eyebrow="节点" title={node} />
      <ComingSoon>节点概要、Shell、网络、磁盘、更新和系统日志会在这里。</ComingSoon>
    </>
  )
}
