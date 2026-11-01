// Node page → 证书: certificates of the node, its ACME domains and
// certificate ordering, and the cluster's ACME accounts and DNS plugins.

import { usePermissions } from '@/api/permissions'
import { useNodeAcmeConfig } from '@/api/certificates-acme'
import { useSession } from '@/api/useSession'
import type { NodeTabProps } from '@/features/node/types'

import { AcmeClusterSection } from './AcmeClusterSection'
import { AcmeSection } from './AcmeSection'
import { CertificatesSection } from './CertificatesSection'
import { nodeAcmeAccount } from './model'
import { useLocalNode } from './shared'

export default function CertificatesTab({ node }: NodeTabProps) {
  const perms = usePermissions()
  const session = useSession()
  const localNode = useLocalNode()
  const config = useNodeAcmeConfig(node)

  const canModify = perms.can({ privs: 'Sys.Modify' }, { kind: 'node', node })
  const canModifyRoot = perms.can({ privs: 'Sys.Modify', path: '/' })
  const isRoot = session?.username === 'root@pam'
  const isLocal = localNode === node

  return (
    <div className="grid gap-(--section-gap)">
      <CertificatesSection node={node} canModify={canModify} isLocal={isLocal} />
      <AcmeSection node={node} canModify={canModify} canSeePlugins={canModifyRoot} isRoot={isRoot} isLocal={isLocal} />
      <AcmeClusterSection isRoot={isRoot} canModifyRoot={canModifyRoot} nodeAccount={config.data ? nodeAcmeAccount(config.data) : undefined} />
    </div>
  )
}
