// The PVE IPAM: addresses allocated per zone / VNet / subnet (gateways and
// guest NICs with MAC and VMID), with manual mappings (DHCP static leases):
// add, change the IP, delete. Like the official PVE.sdn.DhcpTree.

import { useMemo, useState } from 'react'
import { Cable, Pencil, Plus, Trash2 } from 'lucide-react'

import { createIpMapping, deleteIpMapping, updateIpMapping, useIpamStatus, type IpamEntry } from '@/api/sdn'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { FieldInput, FormDialog, FormField } from '@/components/form'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { MAC_RE, groupIpam, isIp } from './model'
import { Chip, Mono, RowMenu, SdnCard, sdnWrite, useDialog, useSdnCanEdit } from './ui'

type Dialog = { kind: 'add'; zone: string; vnet: string } | { kind: 'edit' | 'delete'; entry: IpamEntry }

export function IpamView() {
  const status = useIpamStatus('pve')
  const canEdit = useSdnCanEdit()
  const dialog = useDialog<Dialog>()
  const [filter, setFilter] = useState('')
  const entries = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const all = status.data ?? []
    if (!q) return all
    return all.filter((e) => [e.ip, e.mac, e.hostname, e.vmid, e.vnet, e.zone].some((v) => v !== undefined && String(v).toLowerCase().includes(q)))
  }, [status.data, filter])
  const tree = useMemo(() => groupIpam(entries), [entries])
  const total = status.data?.length ?? 0

  return (
    <SdnCard
      title="PVE IPAM"
      testId="sdn-ipam"
      summary={status.isPending ? '正在读取…' : `${total} 个地址 · 开启自动 DHCP 的 Zone 的网关和客户机地址`}
      onRefresh={() => void status.refetch()}
      refreshing={status.isFetching}
    >
      {total > 8 && (
        <div className="border-b border-border/60 px-(--card-p) py-2.5">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="按 IP、MAC、VMID 或主机名筛选" aria-label="筛选" className="max-w-sm" />
        </div>
      )}
      {status.isPending ? (
        <LoadingRows rows={3} className="p-(--card-p)" />
      ) : status.error ? (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} compact />
      ) : tree.length === 0 ? (
        <EmptyState icon={Cable} title={filter ? '没有匹配的地址' : 'IPAM 里还没有地址'} description={filter ? undefined : '这里列出使用 PVE IPAM 且开启了自动 DHCP 的 Zone 里分配的地址（网关和客户机网卡）。'} />
      ) : (
        <div className="divide-y divide-border/60">
          {tree.map((z) =>
            z.vnets.map((v) => (
              <section key={`${z.zone}/${v.vnet}`} className="grid" data-testid="sdn-ipam-vnet" data-vnet={v.vnet}>
                <div className="flex flex-wrap items-center gap-2 bg-foreground/[0.02] px-(--card-p) py-2 paper:bg-secondary/40">
                  <span className="font-medium">{v.vnet}</span>
                  <span className="text-xs text-muted-foreground">Zone {z.zone}</span>
                  <span className="flex-1" />
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={() => dialog.open({ kind: 'add', zone: z.zone, vnet: v.vnet })}>
                      <Plus />
                      添加映射
                    </Button>
                  )}
                </div>
                {v.subnets.map((s) => (
                  <div key={s.subnet}>
                    <div className="px-(--card-p) pt-2 pb-1 text-xs text-muted-foreground">
                      子网 <Mono>{s.subnet}</Mono>
                    </div>
                    <ul aria-label={`${v.vnet} ${s.subnet} 的地址`}>
                      {s.entries.map((e) => (
                        <li key={`${e.ip}-${e.mac ?? ''}`} data-testid="sdn-ipam-entry" data-ip={e.ip} className="flex min-h-11 items-center gap-3 px-(--card-p) py-1.5 text-sm">
                          <Mono>{e.ip}</Mono>
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                            {e.gateway ? (
                              <Chip>网关</Chip>
                            ) : (
                              <>
                                <Mono>{e.mac ?? '—'}</Mono>
                                {e.vmid !== undefined && <span> · {e.vmid}</span>}
                                {e.hostname && <span> · {e.hostname}</span>}
                              </>
                            )}
                          </span>
                          {canEdit && !e.gateway && (
                            <RowMenu
                              label={e.ip}
                              actions={[
                                { label: '修改 IP', icon: Pencil, onSelect: () => dialog.open({ kind: 'edit', entry: e }), disabled: !e.mac && '没有 MAC 的条目不能修改' },
                                { label: '删除', icon: Trash2, destructive: true, onSelect: () => dialog.open({ kind: 'delete', entry: e }) },
                              ]}
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            )),
          )}
        </div>
      )}

      {dialog.shown?.kind === 'add' && (
        <MappingDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} zone={dialog.shown.zone} vnet={dialog.shown.vnet} />
      )}
      {dialog.shown?.kind === 'edit' && (
        <MappingDialog
          open={dialog.isOpen}
          onOpenChange={dialog.onOpenChange}
          zone={dialog.shown.entry.zone}
          vnet={dialog.shown.entry.vnet}
          entry={dialog.shown.entry}
        />
      )}
      {dialog.shown?.kind === 'delete' && (
        <ConfirmDialog
          open={dialog.isOpen}
          onOpenChange={dialog.onOpenChange}
          destructive
          title={`删除映射 ${dialog.shown.entry.ip}？`}
          description={`${dialog.shown.entry.mac ?? ''} 在 ${dialog.shown.entry.vnet} 上的地址登记会被移除（立即生效）。`}
          confirmLabel="删除"
          onConfirm={() => {
            const e = (dialog.shown as { entry: IpamEntry }).entry
            return sdnWrite(
              deleteIpMapping(e.vnet, { zone: e.zone, ip: e.ip, ...(e.mac ? { mac: e.mac } : {}) }),
              `删除映射 ${e.ip}`,
              `已删除映射 ${e.ip}`,
            )
          }}
        />
      )}
    </SdnCard>
  )
}

function MappingDialog({
  open,
  onOpenChange,
  zone,
  vnet,
  entry,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  zone: string
  vnet: string
  entry?: IpamEntry
}) {
  const create = !entry
  const [mac, setMac] = useState(entry?.mac ?? '')
  const [ip, setIp] = useState(entry?.ip ?? '')
  const [touched, setTouched] = useState(false)
  const errors: Record<string, string> = {}
  if (!MAC_RE.test(mac.trim())) errors.mac = 'MAC 地址格式：XX:XX:XX:XX:XX:XX'
  if (!isIp(ip.trim())) errors.ip = 'IP 地址'
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={create ? `添加 DHCP 映射（${vnet}）` : `修改 ${entry.mac} 的 IP`}
      description="给 MAC 地址固定一个 IP（DHCP 静态租约）。"
      submitLabel={create ? '添加' : '保存'}
      onSubmit={async () => {
        setTouched(true)
        if (Object.keys(errors).length) throw new Error('请检查标红的字段')
        const params = { zone, ip: ip.trim(), mac: mac.trim() }
        if (create) await sdnWrite(createIpMapping(vnet, params), `添加映射 ${params.ip}`, `已添加映射 ${params.ip}`)
        else await sdnWrite(updateIpMapping(vnet, { ...params, ...(entry.vmid ? { vmid: entry.vmid } : {}) }), `修改映射 ${params.ip}`, `已修改映射 ${params.ip}`)
      }}
    >
      {entry?.vmid !== undefined && (
        <FormField label="VMID">
          <FieldInput value={String(entry.vmid)} disabled />
        </FormField>
      )}
      <FormField label="MAC" name="mac" required error={touched ? errors.mac : undefined}>
        <FieldInput value={mac} onChange={(e) => setMac(e.target.value)} disabled={!create} placeholder="BC:24:11:00:00:01" autoComplete="off" />
      </FormField>
      <FormField label="IP 地址" name="ip" required error={touched ? errors.ip : undefined}>
        <FieldInput value={ip} onChange={(e) => setIp(e.target.value)} placeholder="10.0.0.20" autoComplete="off" />
      </FormField>
    </FormDialog>
  )
}
