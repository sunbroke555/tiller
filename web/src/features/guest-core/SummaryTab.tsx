import { useEffect } from 'react'
import { useSearchParams } from 'react-router'

import {
  useAgentHostname,
  useAgentOsInfo,
  useGuestConfig,
  useGuestInterfaces,
  useGuestRrd,
  useGuestStatus,
} from '@/api/guest-core'
import { useActionRunner } from '@/components/page/ActionBar'
import { visibleActions } from '@/components/page/registry'
import { guestActions } from '@/features/guest/registry'
import { useGuestContext, type GuestTabProps } from '@/features/guest/types'

import { GuestCharts } from './GuestCharts'
import { NetworkCard } from './NetworkCard'
import { NotesCard } from './NotesCard'
import { StatTiles } from './StatTiles'
import { StatusCard } from './StatusCard'
import { TagsCard } from './TagsCard'
import { ConfigSummary, TemplateHero } from './TemplateSummary'

/**
 * Guest summary (area guest-summary-power): live tiles, status details, IP
 * addresses, tags, notes and RRD charts. Templates get their config and a
 * clone entry instead of live data.
 *
 * `?action=<id>` opens a registered guest action (the command palette uses it
 * for 迁移 / 克隆 / 删除, which need a dialog).
 */
export default function SummaryTab({ node, type, vmid, guest }: GuestTabProps) {
  const ctx = useGuestContext()
  const template = guest.template === 1
  const { trigger, host } = useActionRunner(ctx)
  const [params, setParams] = useSearchParams()
  const requested = params.get('action')
  const actions = visibleActions(
    guestActions.filter((a) => !a.types || a.types.includes(type)),
    ctx,
  )

  useEffect(() => {
    if (!requested) return
    const action = actions.find((a) => a.id === requested && !a.disabled?.(ctx))
    const next = new URLSearchParams(params)
    next.delete('action')
    setParams(next, { replace: true })
    if (action) trigger(action)
  }, [requested])

  const status = useGuestStatus(node, type, vmid)
  const config = useGuestConfig(node, type, vmid)
  const running = (status.data?.status ?? guest.status) === 'running'
  const rrd = useGuestRrd(node, type, vmid, 'hour', 'AVERAGE', { enabled: !template })
  const agentEnabled = type === 'lxc' || status.data?.agent === 1
  const ips = useGuestInterfaces(node, type, vmid, { enabled: !template && running && agentEnabled })
  const agentOk = type === 'qemu' && running && agentEnabled && ips.isSuccess
  const osInfo = useAgentOsInfo(node, vmid, { enabled: agentOk })
  const hostname = useAgentHostname(node, vmid, { enabled: agentOk })

  const clone = actions.find((a) => a.id === 'clone')
  const side = (
    <>
      <TagsCard node={node} type={type} vmid={vmid} name={ctx.name} tags={guest.tags} config={config.data} />
      <NotesCard node={node} type={type} vmid={vmid} name={ctx.name} config={config.data} loading={config.isPending} />
    </>
  )

  if (template) {
    return (
      <div className="grid gap-(--section-gap)">
        <TemplateHero type={type} onClone={clone ? () => trigger(clone) : undefined} />
        <div className="grid items-start gap-(--row-gap) lg:grid-cols-2">
          <ConfigSummary type={type} config={config.data} loading={config.isPending} />
          <div className="grid gap-(--row-gap)">{side}</div>
        </div>
        {host}
      </div>
    )
  }

  return (
    <div className="grid gap-(--section-gap)">
      <StatTiles guest={guest} status={status.data} rrd={rrd.data} />
      <div className="grid items-start gap-(--section-gap) lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid min-w-0 gap-(--row-gap) *:min-w-0 lg:order-2">
          <StatusCard
            guest={guest}
            status={status.data}
            config={config.data}
            agentResponds={type === 'qemu' && running && agentEnabled ? (ips.isSuccess ? true : ips.isError ? false : undefined) : undefined}
          />
          <NetworkCard
            type={type}
            running={running}
            agentEnabled={agentEnabled}
            data={ips.data}
            loading={ips.isPending}
            error={ips.isError}
            osInfo={osInfo.data}
            hostname={hostname.data}
          />
          {side}
        </div>
        <div className="min-w-0 lg:order-1">
          <GuestCharts node={node} type={type} vmid={vmid} />
        </div>
      </div>
      {host}
    </div>
  )
}
