import { ReplicationView } from './ReplicationView'

/** /datacenter/replication: every replication job of the cluster with its live state. */
export default function ReplicationPage() {
  return <ReplicationView scope={{ kind: 'dc' }} />
}
