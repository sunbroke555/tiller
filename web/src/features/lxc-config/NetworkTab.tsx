import type { ReactNode } from 'react'
import { Clock, EthernetPort, Link2, Link2Off, Network, Pencil, Plus, Shield, Trash2, Undo2 } from 'lucide-react'

import { useLxcInterfaces } from '@/api/lxc-config'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { SectionHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import type { GuestTabProps } from '@/features/guest/types'
import { updatePropertyString } from '@/lib/propstring'
import { cn } from '@/lib/utils'

import { useDialog } from './hooks'
import { describeIp, keysWithPrefix, LXC_MAX, liveAddresses, parseLxcNet, pendingOf, type PendingChange } from './model'
import { NetworkDialog } from './NetworkDialog'
import { PendingBanner, RowMenu, TabBody, useLxcConfig, type LxcConfigApi, type RowAction } from './shared'

/** Network tab of a container: its veth NICs. */
export default function NetworkTab(props: GuestTabProps) {
  const api = useLxcConfig(props)
  return (
    <TabBody api={api}>
      <NetworkBody api={api} />
    </TabBody>
  )
}

function NetworkBody({ api }: { api: LxcConfigApi }) {
  const { cfg, config } = api
  const edit = useDialog<string | undefined>()
  const remove = useDialog<{ key: string; name: string }>()
  const interfaces = useLxcInterfaces(api.node, api.vmid, api.running)
  const all = { ...(config?.current ?? {}), ...cfg }
  const keys = keysWithPrefix(all, 'net')
  const full = keys.length >= LXC_MAX.net

  return (
    <>
      <PendingBanner api={api} tab="network" />
      <section aria-labelledby="lxc-nics-heading" className="min-w-0">
        <SectionHeader title={<span id="lxc-nics-heading">网卡</span>} className="mb-2.5 min-h-9">
          {!api.readOnly && (
            <Button
              variant="outline"
              size="sm"
              className="pointer-coarse:h-10"
              disabled={full}
              title={full ? `最多 ${LXC_MAX.net} 块网卡` : undefined}
              onClick={() => edit.show(undefined)}
            >
              <Plus /> 添加网卡
            </Button>
          )}
        </SectionHeader>
        {keys.length === 0 ? (
          <GlassCard>
            <EmptyState
              icon={Network}
              title="没有网卡"
              description="容器目前没有网络连接。添加一块网卡并连接到网桥。"
              action={
                api.readOnly ? undefined : (
                  <Button onClick={() => edit.show(undefined)}>
                    <Plus /> 添加网卡
                  </Button>
                )
              }
            />
          </GlassCard>
        ) : (
          <div className="grid gap-(--row-gap) lg:grid-cols-2">
            {keys.map((key) => (
              <NicCard
                key={key}
                netKey={key}
                value={cfg[key] ?? config?.current[key] ?? ''}
                pending={pendingOf(config, key)}
                api={api}
                interfaces={interfaces.data}
                onEdit={() => edit.show(key)}
                onRemove={(name) => remove.show({ key, name })}
              />
            ))}
          </div>
        )}
      </section>

      <NetworkDialog {...edit.props} api={api} netKey={edit.data} />
      <ConfirmDialog
        {...remove.props}
        title={`删除网卡 ${remove.data?.name ?? ''}？`}
        description={`${remove.data?.key ?? ''} 将从容器中移除${api.running ? '，运行中的容器会立即断开这块网卡' : ''}。`}
        confirmLabel="删除"
        destructive
        onConfirm={() => remove.data && api.send({ delete: remove.data.key }, `删除网卡 ${remove.data.name}`)}
      />
    </>
  )
}

function NicCard({
  netKey: key,
  value,
  pending,
  api,
  interfaces,
  onEdit,
  onRemove,
}: {
  netKey: string
  value: string
  pending: PendingChange | undefined
  api: LxcConfigApi
  interfaces: Parameters<typeof liveAddresses>[1]
  onEdit: () => void
  onRemove: (name: string) => void
}) {
  const net = parseLxcNet(value)
  const live = api.running ? liveAddresses(net, interfaces) : null
  const deleting = !!pending?.delete
  const name = net.name || key

  const locked = deleting || api.readOnly
  const actions: RowAction[] = locked
    ? []
    : [
        { id: 'edit', label: '编辑', icon: Pencil, onSelect: onEdit },
        {
          id: 'link',
          label: net.linkDown ? '连接链路' : '断开链路',
          icon: net.linkDown ? Link2 : Link2Off,
          onSelect: () =>
            void api
              .save({ [key]: updatePropertyString(value, { link_down: net.linkDown ? null : 1 }) }, `${net.linkDown ? '连接' : '断开'}网卡 ${name}`)
              .catch(() => undefined),
        },
        { id: 'remove', label: '删除', icon: Trash2, destructive: true, separated: true, onSelect: () => onRemove(name) },
      ]
  if (pending && !api.readOnly) {
    actions.push({ id: 'revert', label: '撤销待生效的更改', icon: Undo2, separated: true, onSelect: () => void api.revert([key]).catch(() => undefined) })
  }

  return (
    <GlassCard flush className={cn('overflow-hidden', deleting && 'opacity-70')}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={locked ? undefined : onEdit}
          disabled={locked}
          className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-(--card-p) pt-(--card-p) pb-2 text-left outline-none hover:bg-foreground/[0.02] focus-visible:bg-foreground/[0.05] disabled:cursor-default"
          aria-label={api.readOnly ? `网卡 ${name}` : `编辑网卡 ${name}`}
        >
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/15 ring-inset paper:bg-secondary paper:text-foreground/70 paper:ring-border"
          >
            <EthernetPort className="size-5" />
          </span>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className={cn('truncate text-base font-medium', deleting && 'line-through')}>{name}</span>
              <span className="text-xs text-muted-foreground tabular">{key}</span>
              {net.firewall && <Tag icon={<Shield className="size-3" />}>防火墙</Tag>}
              {net.linkDown && <Tag tone="warning">已断开</Tag>}
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {net.bridge || '未连接网桥'}
              {net.tag && ` · VLAN ${net.tag}`}
            </span>
          </span>
        </button>
        {actions.length > 0 && <RowMenu label={`网卡 ${name}`} actions={actions} />}
      </div>

      <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2 px-(--card-p) pt-1 pb-(--card-p) text-sm">
        <Field label="IPv4">
          {describeIp(net.ip)}
          {net.gw && <span className="text-muted-foreground"> · 网关 {net.gw}</span>}
        </Field>
        <Field label="IPv6">
          {describeIp(net.ip6, true)}
          {net.gw6 && <span className="text-muted-foreground"> · 网关 {net.gw6}</span>}
        </Field>
        <Field label="MAC">{net.hwaddr || <span className="text-muted-foreground">保存后生成</span>}</Field>
        {(net.mtu || net.rate || net.trunks.length > 0 || net.hostManaged) && (
          <Field label="其他">
            {[
              net.mtu && `MTU ${net.mtu}`,
              net.rate && `限速 ${net.rate} MB/s`,
              net.trunks.length > 0 && `Trunks ${net.trunks.join(';')}`,
              net.hostManaged && '由主机管理',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Field>
        )}
        {api.running && (
          <Field label="当前地址">
            {live === null ? (
              <span className="text-muted-foreground">无法获取</span>
            ) : live.filter((a) => !a.linkLocal).length === 0 ? (
              <span className="text-muted-foreground">没有地址</span>
            ) : (
              <span className="flex flex-wrap gap-1.5">
                {live
                  .filter((a) => !a.linkLocal)
                  .map((a) => (
                    <span
                      key={a.address}
                      className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-xs break-all"
                      title={a.static ? '静态地址' : '动态地址（DHCP / SLAAC 或容器内配置）'}
                    >
                      <span className="tabular">{a.address}</span>
                      <span className="shrink-0 text-muted-foreground">{a.static ? '静态' : '动态'}</span>
                    </span>
                  ))}
              </span>
            )}
          </Field>
        )}
      </dl>
      {pending && (
        <p className="flex items-start gap-1.5 border-t border-border/60 px-(--card-p) py-2.5 text-xs text-warning">
          <Clock className="mt-px size-3.5 shrink-0" aria-hidden />
          {pending.delete ? '重启后删除这块网卡' : pending.current === undefined ? '新增，重启后生效' : '有更改将在重启后生效'}
        </p>
      )}
    </GlassCard>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words tabular">{children}</dd>
    </>
  )
}

function Tag({ children, icon, tone }: { children: ReactNode; icon?: ReactNode; tone?: 'warning' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground',
        tone === 'warning' && 'bg-warning/12 text-warning',
      )}
    >
      {icon}
      {children}
    </span>
  )
}
