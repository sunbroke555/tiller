import { ComingSoon } from '@/components/ComingSoon'
import { PageHeader } from '@/components/PageHeader'

export function ShellPage() {
  return (
    <>
      <PageHeader title="Shell" description="节点终端" />
      <ComingSoon>选择节点后在这里打开 Shell（termproxy + xterm.js）。</ComingSoon>
    </>
  )
}
