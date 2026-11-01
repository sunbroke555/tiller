import type { GuestTabProps } from '@/features/guest/types'

import { AclView } from './AclView'

/** Guest page "权限": ACL entries on /vms/<vmid> (PVE.qemu.Config / PVE.lxc.Config). */
export default function GuestPermissionsTab({ vmid, guest }: GuestTabProps) {
  return <AclView path={`/vms/${vmid}`} pool={guest.pool} />
}
