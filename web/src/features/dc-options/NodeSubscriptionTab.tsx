import type { NodeTabProps } from '@/features/node/types'

import { NodeSubscriptionPanel } from './SubscriptionPanel'

/** /node/:node/subscription — the node's subscription (official Node → Subscription). */
export default function NodeSubscriptionTab({ node }: NodeTabProps) {
  return <NodeSubscriptionPanel node={node} />
}
