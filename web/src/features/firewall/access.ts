// Who may change what, per scope (the API's own checks, see
// PVE::Firewall::rules_modify_permissions and the log endpoints):
//
//   datacenter / security groups   Sys.Modify on /           (read: Sys.Audit)
//   node                           Sys.Modify on /nodes/<n>  (log: Sys.Syslog)
//   guest                          VM.Config.Network on the guest (log: VM.Console)
//   vnet                           SDN.Allocate on the SDN tree

import { usePermissions } from '@/api/permissions'
import type { FirewallScope } from '@/api/firewall'
import type { PermissionCheck, PermissionTarget } from '@/lib/permissions'

export interface FirewallAccess {
  canEdit: boolean
  canLog: boolean
  /** May read the datacenter options (to warn when the cluster firewall is off). */
  canAuditDc: boolean
}

function target(scope: FirewallScope, pool?: string): PermissionTarget {
  switch (scope.kind) {
    case 'node':
      return { kind: 'node', node: scope.node }
    case 'guest':
      return { kind: 'guest', vmid: scope.vmid, pool }
    default:
      return { kind: 'global' }
  }
}

export function editPermission(scope: FirewallScope): PermissionCheck {
  switch (scope.kind) {
    case 'guest':
      return { privs: 'VM.Config.Network' }
    case 'vnet':
      return { privs: 'SDN.Allocate', path: '/sdn', anywhere: true }
    default:
      return { privs: 'Sys.Modify' }
  }
}

export function logPermission(scope: FirewallScope): PermissionCheck | null {
  if (scope.kind === 'node') return { privs: 'Sys.Syslog' }
  if (scope.kind === 'guest') return { privs: 'VM.Console' }
  return null
}

export function useFirewallAccess(scope: FirewallScope, pool?: string): FirewallAccess {
  const perms = usePermissions()
  const t = target(scope, pool)
  const log = logPermission(scope)
  return {
    canEdit: perms.can(editPermission(scope), t),
    canLog: !!log && perms.can(log, t),
    canAuditDc: perms.can({ privs: 'Sys.Audit', path: '/' }),
  }
}
