import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { NodeTabProps } from '@/features/node/types'

/** Placeholder owned by area `console`: replace with the real tab. */
export default function NodeShellTab(_props: NodeTabProps) {
  return <AreaPlaceholder area="console">节点 Shell（termproxy + xterm.js）。</AreaPlaceholder>
}
