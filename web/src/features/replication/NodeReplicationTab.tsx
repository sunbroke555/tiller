import type { NodeTabProps } from '@/features/node/types'

import { ReplicationView } from './ReplicationView'

/** Node "复制" tab: jobs whose guest lives on this node, with live state. */
export default function NodeReplicationTab({ node }: NodeTabProps) {
  return <ReplicationView scope={{ kind: 'node', node }} />
}
