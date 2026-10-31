import { useParams } from 'react-router'

import { useClusterResources } from '@/api/queries'
import { isGuest, type GuestType } from '@/api/types'
import { ComingSoon } from '@/components/ComingSoon'
import { PageHeader } from '@/components/PageHeader'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import { GUEST_TYPE_LABEL, guestName, statusLabel } from '@/lib/resources'

/** /guest/:node/:type/:vmid — placeholder until the guest detail feature lands. */
export function GuestPage() {
  const { node = '', type = 'qemu', vmid = '' } = useParams()
  const guestType: GuestType = type === 'lxc' ? 'lxc' : 'qemu'
  const { data: guest } = useClusterResources({
    select: (all) => all.filter(isGuest).find((g) => g.type === guestType && String(g.vmid) === vmid),
  })

  return (
    <>
      <PageHeader
        backTo="/"
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <ResourceIcon type={guestType} className="size-3.5" />
            {GUEST_TYPE_LABEL[guestType]} <span className="tabular">{vmid}</span> · {node}
          </span>
        }
        title={guest ? guestName(guest) : `${guestType === 'lxc' ? 'CT' : 'VM'} ${vmid}`}
        description={
          guest && (
            <span className="inline-flex items-center gap-2">
              <StatusDot status={guest.status} decorative /> {statusLabel(guest.status)}
            </span>
          )
        }
      />
      <ComingSoon>概要、控制台、硬件、快照、备份和电源操作会在这里。</ComingSoon>
    </>
  )
}
