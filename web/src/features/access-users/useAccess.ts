import { usePermissions } from '@/api/permissions'
import { needsPasswordConfirmation } from '@/api/shell'
import { useSession } from '@/api/useSession'

/**
 * What the logged-in user may do here. The official UI checks the ticket's
 * caps.access['User.Modify'] ("somewhere under /access"); the API checks
 * User.Modify on the user's groups, Group.Allocate on /access/groups.
 */
export function useAccess() {
  const perms = usePermissions()
  const self = useSession()?.username ?? ''
  return {
    self,
    userModify: perms.can({ privs: 'User.Modify', path: '/access', anywhere: true }),
    groupAllocate: perms.can({ privs: 'Group.Allocate', path: '/access/groups', anywhere: true }),
    /** Everyone but root@pam confirms password and TFA changes with their own password. */
    confirmPassword: needsPasswordConfirmation(self),
  }
}
