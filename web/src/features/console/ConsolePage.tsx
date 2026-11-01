import { useCallback, useMemo } from 'react'
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router'

import type { ConsoleTarget } from '@/api/console'
import { targetKey } from '@/api/console'
import { useClusterResources } from '@/api/queries'
import { isGuest, type ClusterResource, type GuestResource, type GuestType } from '@/api/types'
import { consolePath, guestName, guestPath, isVmidParam, nodePath } from '@/lib/resources'

import { ConsoleScreen } from './ConsoleScreen'

/**
 * Full-screen console outside the app frame:
 *   /console/:node/:type/:vmid   VM (noVNC / serial xterm.js) or CT (xterm.js / noVNC)
 *   /console/:node/shell         node shell
 * ?viewer=xterm|novnc picks the viewer.
 */
export default function ConsolePage() {
  const params = useParams()
  const location = useLocation()
  const [search, setSearch] = useSearchParams()
  const node = params.node ?? ''
  const isShell = !params.type
  const type: GuestType = params.type === 'lxc' ? 'lxc' : 'qemu'
  const validTarget = isShell || ((params.type === 'qemu' || params.type === 'lxc') && isVmidParam(params.vmid))
  const vmid = isVmidParam(params.vmid) ? Number(params.vmid) : NaN

  const { data: guest } = useClusterResources({
    enabled: !isShell && validTarget,
    select: useCallback((all: ClusterResource[]) => all.find((r): r is GuestResource => isGuest(r) && r.vmid === vmid), [vmid]),
  })

  const target = useMemo<ConsoleTarget>(
    () => (isShell ? { kind: 'node', node } : { kind: type, node, vmid }),
    [isShell, node, type, vmid],
  )

  // Unknown type or a VMID that is no number: never open a console (no
  // status/vncproxy calls for "NaN").
  if (!validTarget) return <Navigate replace to="/" />
  if (!isShell && guest && (guest.node !== node || guest.type !== type)) {
    // Migrated (or a stale link): follow the guest.
    return <Navigate replace to={consolePath(guest) + location.search} />
  }

  const title = isShell ? node : guest ? guestName(guest) : `${type === 'lxc' ? 'CT' : 'VM'} ${params.vmid}`
  const backTo = isShell ? nodePath(node) : guestPath({ node, type, vmid })

  return (
    <ConsoleScreen
      key={targetKey(target)}
      target={target}
      variant="page"
      title={title}
      backTo={backTo}
      requestedViewer={search.get('viewer')}
      onViewerChange={(viewer) => setSearch({ viewer }, { replace: true })}
    />
  )
}
