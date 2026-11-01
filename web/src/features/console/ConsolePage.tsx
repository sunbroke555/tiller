import { useMemo } from 'react'
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router'

import type { ConsoleTarget, NodeShellCmd } from '@/api/console'
import { targetKey } from '@/api/console'
import { useClusterResources } from '@/api/queries'
import { isGuest, type GuestType } from '@/api/types'
import { consolePath, guestName, guestPath, nodePath } from '@/lib/resources'

import { ConsoleScreen } from './ConsoleScreen'

/**
 * Full-screen console outside the app frame:
 *   /console/:node/:type/:vmid   VM (noVNC / serial xterm.js) or CT (xterm.js / noVNC)
 *   /console/:node/shell         node shell (?cmd=upgrade: run pveupgrade, root@pam only)
 * ?viewer=xterm|novnc picks the viewer.
 */
export default function ConsolePage() {
  const params = useParams()
  const location = useLocation()
  const [search, setSearch] = useSearchParams()
  const node = params.node ?? ''
  const isShell = !params.type
  const type: GuestType = params.type === 'lxc' ? 'lxc' : 'qemu'
  const vmid = Number(params.vmid)
  const cmd: NodeShellCmd | undefined = isShell && search.get('cmd') === 'upgrade' ? 'upgrade' : undefined

  const { data: guest } = useClusterResources({
    enabled: !isShell,
    select: (all) => all.filter(isGuest).find((g) => g.vmid === vmid),
  })

  const target = useMemo<ConsoleTarget>(
    () => (isShell ? { kind: 'node', node, cmd } : { kind: type, node, vmid }),
    [isShell, node, type, vmid, cmd],
  )

  if (!isShell && (params.type !== 'qemu' && params.type !== 'lxc')) return <Navigate replace to="/" />
  if (!isShell && guest && (guest.node !== node || guest.type !== type)) {
    // Migrated (or a stale link): follow the guest.
    return <Navigate replace to={consolePath(guest) + location.search} />
  }

  const title = isShell ? (cmd === 'upgrade' ? `${node} · 升级` : node) : guest ? guestName(guest) : `${type === 'lxc' ? 'CT' : 'VM'} ${params.vmid}`
  const backTo = isShell ? nodePath(node, cmd === 'upgrade' ? 'updates' : undefined) : guestPath({ node, type, vmid })

  return (
    <ConsoleScreen
      key={targetKey(target)}
      target={target}
      variant="page"
      title={title}
      backTo={backTo}
      requestedViewer={search.get('viewer')}
      onViewerChange={(viewer) => setSearch(cmd ? { viewer, cmd } : { viewer }, { replace: true })}
    />
  )
}
