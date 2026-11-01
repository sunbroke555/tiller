// Monitors, managers and metadata servers: list, create, destroy,
// start / stop / restart (official PVE.node.CephMonMgrList,
// PVE.node.CephServiceController, PVE.CephCreateService).

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ellipsis, Play, Plus, RotateCw, Square, Trash2 } from 'lucide-react'

import {
  cephKeys,
  cephServiceCommand,
  createCephService,
  destroyCephService,
  fetchCmdSafety,
  useCephMds,
  useCephMgrs,
  useCephMons,
  type CephMds,
  type CephMgr,
  type CephMon,
} from '@/api/ceph'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FieldInput, FormDialog, FormField, NodeSelect, SwitchField } from '@/components/form'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { parseCephVersion, SERVICE_ID_RE, SERVICE_LABEL, type ServiceType } from './model'
import { Chip, RefreshButton, Section, useCephAccess, type Tone } from './ui'

type AnyService = (CephMon | CephMgr | CephMds) & { quorum?: number; rank?: number }

interface Row {
  type: ServiceType
  name: string
  host: string
  addr?: string | undefined
  version?: string | undefined
  state: string
  tone: Tone
  /** systemd unit exists */
  service: boolean
}

function stateOf(type: ServiceType, s: AnyService): { label: string; tone: Tone } {
  const st = s.state ?? 'unknown'
  if (type === 'mon') {
    if (st === 'running') return s.quorum ? { label: '运行中 · 法定人数', tone: 'ok' } : { label: '运行中 · 不在法定人数中', tone: 'warn' }
  }
  if (type === 'mgr') {
    if (st === 'active') return { label: '活动', tone: 'ok' }
    if (st === 'standby') return { label: '备用', tone: 'ok' }
  }
  if (type === 'mds') {
    if (st === 'up:active') return { label: '活动', tone: 'ok' }
    if (st.startsWith('up:standby')) return { label: st === 'up:standby-replay' ? '热备' : '备用', tone: 'ok' }
    if (st.startsWith('up:')) return { label: st.slice(3), tone: 'info' }
  }
  if (st === 'stopped') return { label: '已停止', tone: 'err' }
  if (st === 'running') return { label: '运行中', tone: 'ok' }
  return { label: st === 'unknown' ? '未知' : st, tone: 'unknown' }
}

function toRows(type: ServiceType, list: AnyService[] | undefined): Row[] {
  return (list ?? [])
    .map((s) => {
      const st = stateOf(type, s)
      return {
        type,
        name: s.name,
        host: s.host ?? '',
        addr: s.addr,
        version: parseCephVersion(s),
        state: st.label,
        tone: st.tone,
        service: s.service === true || s.service === 1,
      }
    })
    .sort((a, b) => a.host.localeCompare(b.host) || a.name.localeCompare(b.name))
}

type Dialog = { kind: 'create'; type: ServiceType } | { kind: 'stop' | 'destroy'; row: Row } | null

/** All three lists; `host` limits them to one node (node page tab). */
export function ServicesView({ apiNode, host, types = ['mon', 'mgr', 'mds'] }: { apiNode: string; host?: string; types?: ServiceType[] }) {
  const mons = useCephMons(apiNode)
  const mgrs = useCephMgrs(apiNode)
  const mds = useCephMds(apiNode)
  const access = useCephAccess()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [shown, setShown] = useState<Dialog>(null)
  if (dialog && dialog !== shown) setShown(dialog)

  const queries = { mon: mons, mgr: mgrs, mds }
  const command = (row: Row, action: 'start' | 'restart') =>
    void runTask(cephServiceCommand(row.host, action, `${row.type}.${row.name}`), {
      title: `${action === 'start' ? '启动' : '重启'} ${row.type}.${row.name}`,
      invalidate: [cephKeys.all()],
    }).catch(() => undefined)

  return (
    <div className="grid min-w-0 gap-(--section-gap) xl:grid-cols-2">
      {types.map((type) => {
        const q = queries[type]
        const rows = toRows(type, q.data as AnyService[] | undefined).filter((r) => !host || r.host === host)
        return (
          <Section
            key={type}
            title={SERVICE_LABEL[type]}
            count={q.data ? rows.length : undefined}
            flush
            className={type === 'mds' ? 'xl:col-span-2' : undefined}
            data-testid={`ceph-${type}-list`}
            actions={
              <>
                <RefreshButton onClick={() => void q.refetch()} busy={q.isFetching} />
                {access.canModify && (
                  <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'create', type })} className="pointer-coarse:h-10">
                    <Plus /> 创建
                  </Button>
                )}
              </>
            }
          >
            {q.isPending ? (
              <LoadingRows rows={2} className="p-4" />
            ) : q.error ? (
              <ErrorState error={q.error} onRetry={() => void q.refetch()} compact className="p-4" />
            ) : rows.length === 0 ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">{type === 'mds' ? '没有元数据服务器。CephFS 需要至少一个。' : '无'}</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {rows.map((r) => (
                  <li key={`${r.host}/${r.name}`} className="flex min-h-14 items-center gap-3 px-4 py-2" data-service={`${type}.${r.name}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{r.name}</span>
                        <Chip tone={r.tone} data-testid="service-state">
                          {r.state}
                        </Chip>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[r.host !== r.name ? r.host : null, r.addr, r.version].filter(Boolean).join(' · ') || r.host}
                      </div>
                    </div>
                    {access.canModify && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`${type}.${r.name} 操作`} className="shrink-0 pointer-coarse:size-11">
                            <Ellipsis />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => command(r, 'start')}>
                            <Play /> 启动
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setDialog({ kind: 'stop', row: r })}>
                            <Square /> 停止
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => command(r, 'restart')}>
                            <RotateCw /> 重启
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: 'destroy', row: r })}>
                            <Trash2 /> 销毁
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )
      })}

      <CreateServiceDialog
        type={shown?.kind === 'create' ? shown.type : 'mon'}
        defaultNode={host}
        open={dialog?.kind === 'create'}
        onOpenChange={(o) => !o && setDialog(null)}
      />
      <ServiceConfirm
        action={shown?.kind === 'destroy' ? 'destroy' : 'stop'}
        row={shown && shown.kind !== 'create' ? shown.row : null}
        open={dialog?.kind === 'stop' || dialog?.kind === 'destroy'}
        onOpenChange={(o) => !o && setDialog(null)}
      />
    </div>
  )
}

/** Stop / destroy with the official cmd-safety check (mon and mds). */
function ServiceConfirm({ action, row, open, onOpenChange }: { action: 'stop' | 'destroy'; row: Row | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const checkable = !!row && row.type !== 'mgr'
  const safety = useQuery({
    queryKey: ['pve', 'ceph', 'cmd-safety', row?.host ?? '', row?.type ?? '', row?.name ?? '', action],
    queryFn: () => fetchCmdSafety(row!.host, row!.type as 'mon' | 'mds', row!.name, action),
    enabled: open && checkable,
    staleTime: 0,
    retry: false,
  })
  if (!row) return null
  const id = `${row.type}.${row.name}`
  const unsafe = safety.data && !(safety.data.safe === 1 || safety.data.safe === true)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      destructive
      title={action === 'stop' ? `停止 ${id}？` : `销毁 ${SERVICE_LABEL[row.type]} ${row.name}？`}
      description={
        <span className="grid gap-2">
          <span>
            {action === 'stop'
              ? `在节点 ${row.host} 上停止这个服务。`
              : `在节点 ${row.host} 上停止并删除这个服务及其数据目录。${row.type === 'mon' ? '最后一个监视器不能销毁。' : ''}`}
          </span>
          {checkable && safety.isPending && <span className="text-muted-foreground">正在检查是否安全…</span>}
          {unsafe && (
            <span className={cn('rounded-lg bg-warning/10 px-2 py-1.5 text-warning-strong')} role="alert">
              {safety.data?.status || '这样做可能影响集群可用性。'}
            </span>
          )}
        </span>
      }
      confirmLabel={action === 'stop' ? '停止' : '销毁'}
      typeToConfirm={action === 'destroy' ? row.name : undefined}
      onConfirm={() =>
        runTask(action === 'stop' ? cephServiceCommand(row.host, 'stop', id) : destroyCephService(row.host, row.type, row.name), {
          title: action === 'stop' ? `停止 ${id}` : `销毁 ${id}`,
          invalidate: [cephKeys.all()],
        })
      }
    />
  )
}

function CreateServiceDialog({ type, defaultNode, open, onOpenChange }: { type: ServiceType; defaultNode?: string | undefined; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [node, setNode] = useState<string | undefined>(defaultNode)
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [address, setAddress] = useState('')
  const [hotstandby, setHotstandby] = useState(false)

  useEffect(() => {
    if (open) {
      setNode(defaultNode)
      setId('')
      setIdTouched(false)
      setAddress('')
      setHotstandby(false)
    }
  }, [open, defaultNode])

  // MDS ID follows the node until edited (official CephCreateService).
  const mdsId = idTouched ? id : (node ?? '')
  const idError = type === 'mds' && mdsId && !SERVICE_ID_RE.test(mdsId) ? '只能包含字母、数字和连字符，以字母开头，不能以连字符结尾' : undefined
  const serviceId = type === 'mds' ? mdsId : (node ?? '')

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`创建${SERVICE_LABEL[type]}`}
      description={
        type === 'mon'
          ? '在所选节点上创建监视器。建议共 3 个（奇数）。'
          : type === 'mgr'
            ? '在所选节点上创建管理器。多个管理器时只有一个是活动的，其余备用。'
            : '在所选节点上创建元数据服务器（CephFS 需要）。'
      }
      submitLabel="创建"
      submitDisabled={!node || !serviceId || !!idError}
      onSubmit={() => {
        const params = type === 'mon' && address.trim() ? { 'mon-address': address.trim() } : type === 'mds' && hotstandby ? { hotstandby: 1 } : undefined
        return runTask(createCephService(node!, type, serviceId, params), {
          title: `创建${SERVICE_LABEL[type]} ${serviceId}`,
          invalidate: [cephKeys.all()],
        })
      }}
    >
      <FormField label="节点" required>
        <NodeSelect value={node} onValueChange={setNode} />
      </FormField>
      {type === 'mds' && (
        <>
          <FormField label="MDS ID" name="name" required error={idError} hint="不同的 ID 可以让一个节点运行多个 MDS，给多个 CephFS 提供冗余。">
            <FieldInput
              value={mdsId}
              onChange={(e) => {
                setIdTouched(true)
                setId(e.target.value)
              }}
              autoCapitalize="off"
              spellCheck={false}
            />
          </FormField>
          <SwitchField
            label="热备（hotstandby）"
            description="持续回放活动 MDS 的日志，切换更快，但占用更多资源。"
            checked={hotstandby}
            onCheckedChange={setHotstandby}
          />
        </>
      )}
      {type === 'mon' && (
        <FormField label="监视器地址" name="mon-address" hint="留空自动检测；必须在 Ceph 公共网络内。">
          <FieldInput value={address} onChange={(e) => setAddress(e.target.value)} placeholder="自动" autoCapitalize="off" spellCheck={false} />
        </FormField>
      )}
    </FormDialog>
  )
}
