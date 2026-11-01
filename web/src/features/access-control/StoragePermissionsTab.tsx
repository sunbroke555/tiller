import type { StorageTabProps } from '@/features/storage/types'

import { AclView } from './AclView'

/** Storage page "权限": ACL entries on /storage/<id> (PVE.storage.Browser). */
export default function StoragePermissionsTab({ storage, resource }: StorageTabProps) {
  return <AclView path={`/storage/${storage}`} pool={resource.pool} />
}
