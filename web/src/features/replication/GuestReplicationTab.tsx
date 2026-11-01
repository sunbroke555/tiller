import type { GuestTabProps } from '@/features/guest/types'

import { ReplicationView } from './ReplicationView'

/** Guest "复制" tab: this guest's replication jobs. */
export default function GuestReplicationTab({ node, vmid, guest }: GuestTabProps) {
  return <ReplicationView scope={{ kind: 'guest', node, vmid, pool: guest.pool }} />
}
