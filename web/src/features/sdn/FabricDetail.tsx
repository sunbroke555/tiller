// One fabric: settings, pending changes, member nodes (router IPs and
// interfaces) and the per-node runtime view from FRR (routes, neighbors,
// interfaces) — /nodes/{node}/sdn/fabrics/{fabric}/*.

import { useMemo, useState } from 'react'
import { Pencil, Plus, Server, Trash2, Waypoints } from 'lucide-react'

import { p } from '@/api/client'
import { deleteFabric, deleteFabricNode, useNodeSdn, useSdnFabrics, type FabricInterface, type FabricNeighbor, type FabricRoute, type SdnFabricNode } from '@/api/sdn'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { tryParsePropertyString } from '@/lib/propstring'

import { FabricDialog, FabricNodeDialog } from './FabricDialogs'
import { nodeInterfaces, parseRedistribute, protocolLabel } from './model'
import { sdnHref } from './nav'
import { byState, effective } from './pending'
import { Chip, DeleteDialog, Fact, FactGrid, ListBody, Mono, ObjectRow, PendingChanges, PendingChip, SdnCard, useDialog, useSdnCanEdit } from './ui'
import { BackLink, NodePicker, useOnlineNodes } from './ZoneDetail'

type Dialog = { kind: 'edit' | 'delete' | 'add-node' } | { kind: 'edit-node' | 'delete-node'; node: SdnFabricNode }

export function FabricDetail({ id }: { id: string }) {
  const fabrics = useSdnFabrics()
  const canEdit = useSdnCanEdit()
  const dialog = useDialog<Dialog>()
  const raw = fabrics.data?.fabrics.find((f) => effective(f).id === id)
  const fabric = raw && effective(raw)
  const nodes = useMemo(
    () =>
      (fabrics.data?.nodes ?? [])
        .map((n) => ({ raw: n, eff: effective(n) }))
        .filter((n) => n.eff.fabric_id === id)
        .sort((a, b) => byState<SdnFabricNode>((n) => n.node_id)(a.eff, b.eff)),
    [fabrics.data, id],
  )

  if (fabrics.isPending) return <LoadingRows rows={4} />
  if (fabrics.error) return <ErrorState error={fabrics.error} onRetry={() => void fabrics.refetch()} />
  if (!raw || !fabric) {
    return (
      <div className="grid gap-3">
        <BackLink to={sdnHref('fabrics')} label="Fabrics" />
        <EmptyState icon={Waypoints} title={`没有 Fabric ${id}`} description="它可能已被删除。" />
      </div>
    )
  }
  const alive = raw.state !== 'deleted'
  const members = nodes.filter((n) => n.raw.state !== 'deleted').map((n) => n.eff.node_id)
  const redistribute = parseRedistribute(fabric.redistribute)

  return (
    <div className="grid gap-(--section-gap)" data-testid="sdn-fabric-detail">
      <BackLink to={sdnHref('fabrics')} label="Fabrics" />
      <SdnCard
        title={
          <span className="flex flex-wrap items-center gap-2">
            {fabric.id}
            <Chip>{protocolLabel(fabric.protocol)}</Chip>
            <PendingChip obj={raw} />
          </span>
        }
        summary="Fabric 设置"
        actions={
          canEdit &&
          alive && (
            <>
              <Button variant="outline" onClick={() => dialog.open({ kind: 'edit' })}>
                <Pencil />
                编辑
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="删除 Fabric"
                title={members.length ? '先移除节点' : '删除'}
                disabled={members.length > 0}
                onClick={() => dialog.open({ kind: 'delete' })}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 />
              </Button>
            </>
          )
        }
      >
        {raw.state && (
          <div className="px-(--card-p) pt-3">
            <PendingChanges obj={raw} />
          </div>
        )}
        <FactGrid>
          <Fact label="协议">{protocolLabel(fabric.protocol)}</Fact>
          <Fact label="IPv4 前缀">{fabric.ip_prefix}</Fact>
          {fabric.protocol !== 'ospf' && <Fact label="IPv6 前缀">{fabric.ip6_prefix}</Fact>}
          {fabric.protocol === 'openfabric' && <Fact label="Hello / CSNP 间隔">{`${fabric.hello_interval ?? 3} / ${fabric.csnp_interval ?? 10} 秒`}</Fact>}
          {fabric.protocol === 'ospf' && <Fact label="区域">{fabric.area}</Fact>}
          {(fabric.protocol === 'openfabric' || fabric.protocol === 'ospf') && <Fact label="路由过滤">{fabric.route_filter ?? '不过滤'}</Fact>}
          {fabric.protocol === 'wireguard' && <Fact label="持久 Keepalive">{fabric.persistent_keepalive ? `${fabric.persistent_keepalive} 秒` : '关闭'}</Fact>}
          {redistribute.length > 0 && (
            <Fact label="重分发">{redistribute.map((r) => (r['route-map'] ? `${r.source}（${r['route-map']}）` : r.source)).join('、')}</Fact>
          )}
        </FactGrid>
      </SdnCard>

      <SdnCard
        title="节点"
        testId="sdn-fabric-nodes"
        summary={`${members.length} 个节点`}
        actions={
          canEdit &&
          alive && (
            <Button variant="outline" onClick={() => dialog.open({ kind: 'add-node' })}>
              <Plus />
              添加节点
            </Button>
          )
        }
      >
        <ListBody
          query={fabrics}
          items={nodes}
          label="Fabric 节点"
          empty={{ icon: Server, title: '还没有节点', description: '把节点加入 Fabric，设置它的路由器 IP 和参与的网卡。' }}
        >
          {({ raw: n, eff }) => {
            const ifaces = nodeInterfaces(eff).map((s) => tryParsePropertyString(s))
            return (
              <ObjectRow
                key={eff.node_id}
                testId="sdn-fabric-node-row"
                rowKey={eff.node_id}
                icon={Server}
                title={eff.node_id}
                badge={eff.role === 'external' ? <Chip>外部</Chip> : undefined}
                obj={n}
                detail={
                  <>
                    {eff.ip && <Mono>{eff.ip}</Mono>}
                    {eff.ip6 && <Mono>{eff.ip6}</Mono>}
                    {eff.endpoint && <span>Endpoint {eff.endpoint}</span>}
                    {ifaces.length > 0 && (
                      <span>
                        · 接口 {ifaces.map((i) => (i.ip ? `${i.name}（${i.ip}）` : i.name)).join('、')}
                      </span>
                    )}
                  </>
                }
                actions={
                  canEdit && n.state !== 'deleted'
                    ? [
                        { label: '编辑', icon: Pencil, onSelect: () => dialog.open({ kind: 'edit-node', node: eff }) },
                        { label: '移除', icon: Trash2, destructive: true, onSelect: () => dialog.open({ kind: 'delete-node', node: eff }) },
                      ]
                    : undefined
                }
              />
            )
          }}
        </ListBody>
      </SdnCard>

      {raw.state !== 'new' && members.length > 0 && <FabricRuntime fabric={fabric.id} members={members} />}

      {dialog.shown?.kind === 'edit' && <FabricDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} protocol={fabric.protocol} fabric={fabric} />}
      {dialog.shown?.kind === 'delete' && (
        <DeleteDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} what=" Fabric" name={fabric.id} isNew={false} run={() => deleteFabric(fabric.id)} />
      )}
      {dialog.shown?.kind === 'add-node' && (
        <FabricNodeDialog open={dialog.isOpen} onOpenChange={dialog.onOpenChange} fabric={fabric} members={members} siblings={nodes.map((n) => n.eff)} />
      )}
      {dialog.shown?.kind === 'edit-node' && (
        <FabricNodeDialog
          open={dialog.isOpen}
          onOpenChange={dialog.onOpenChange}
          fabric={fabric}
          node={dialog.shown.node}
          members={members}
          siblings={nodes.map((n) => n.eff)}
        />
      )}
      {dialog.shown?.kind === 'delete-node' && (
        <DeleteDialog
          open={dialog.isOpen}
          onOpenChange={dialog.onOpenChange}
          what="节点"
          name={`${dialog.shown.node.node_id}（${fabric.id}）`}
          isNew={false}
          run={() => deleteFabricNode(fabric.id, (dialog.shown as { node: SdnFabricNode }).node.node_id)}
        />
      )}
    </div>
  )
}

type RuntimeTab = 'routes' | 'neighbors' | 'interfaces'

function FabricRuntime({ fabric, members }: { fabric: string; members: string[] }) {
  const online = useOnlineNodes()
  const nodes = online.filter((n) => members.includes(n))
  const [picked, setPicked] = useState<string>()
  const node = picked && nodes.includes(picked) ? picked : nodes[0]
  const [tab, setTab] = useState<RuntimeTab>('routes')
  const routes = useNodeSdn<FabricRoute[]>(node, p`/nodes/${node ?? ''}/sdn/fabrics/${fabric}/routes`, ['fabrics', fabric, 'routes'], tab === 'routes')
  const neighbors = useNodeSdn<FabricNeighbor[]>(node, p`/nodes/${node ?? ''}/sdn/fabrics/${fabric}/neighbors`, ['fabrics', fabric, 'neighbors'], tab === 'neighbors')
  const ifaces = useNodeSdn<FabricInterface[]>(node, p`/nodes/${node ?? ''}/sdn/fabrics/${fabric}/interfaces`, ['fabrics', fabric, 'interfaces'], tab === 'interfaces')
  const q = tab === 'routes' ? routes : tab === 'neighbors' ? neighbors : ifaces

  return (
    <SdnCard title="节点上的运行状态" summary="FRR 报告的路由、邻居和接口" testId="sdn-fabric-runtime">
      <div className="grid gap-3 px-(--card-p) py-3">
        <NodePicker nodes={nodes} value={node} onChange={setPicked} />
        <ToggleGroup type="single" variant="outline" size="sm" value={tab} onValueChange={(v) => v && setTab(v as RuntimeTab)} aria-label="视图" className="w-max">
          <ToggleGroupItem value="routes" className="px-3 text-xs pointer-coarse:h-9">
            路由
          </ToggleGroupItem>
          <ToggleGroupItem value="neighbors" className="px-3 text-xs pointer-coarse:h-9">
            邻居
          </ToggleGroupItem>
          <ToggleGroupItem value="interfaces" className="px-3 text-xs pointer-coarse:h-9">
            接口
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {!node ? (
        <p className="px-(--card-p) pb-4 text-sm text-muted-foreground">Fabric 的节点都不在线。</p>
      ) : q.isPending ? (
        <LoadingRows rows={2} className="px-(--card-p) pb-3" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
      ) : !q.data?.length ? (
        <p className="px-(--card-p) pb-4 text-sm text-muted-foreground">没有数据（应用配置后 FRR 建立邻居需要几秒）。</p>
      ) : (
        <ul className="divide-y divide-border/60 border-t border-border/60" aria-label="运行状态">
          {tab === 'routes' &&
            routes.data?.map((r) => (
              <li key={r.route} className="flex flex-wrap gap-x-3 px-(--card-p) py-2 text-sm">
                <Mono>{r.route}</Mono>
                <span className="text-xs text-muted-foreground">经 {(r.via ?? []).join(', ') || '—'}</span>
              </li>
            ))}
          {tab === 'neighbors' &&
            neighbors.data?.map((n) => (
              <li key={n.neighbor} className="flex flex-wrap gap-x-3 px-(--card-p) py-2 text-sm">
                <Mono>{n.neighbor}</Mono>
                <span className="text-xs">{n.status}</span>
                {n.uptime && <span className="text-xs text-muted-foreground">已连接 {n.uptime}</span>}
              </li>
            ))}
          {tab === 'interfaces' &&
            ifaces.data?.map((i) => (
              <li key={i.name} className="flex flex-wrap gap-x-3 px-(--card-p) py-2 text-sm">
                <Mono>{i.name}</Mono>
                <span className="text-xs">{i.state}</span>
                {i.type && <span className="text-xs text-muted-foreground">{i.type}</span>}
              </li>
            ))}
        </ul>
      )}
    </SdnCard>
  )
}
