// OSD dialogs: create (disk, DB/WAL, encryption, device class), global flags,
// details (metadata, LVs), stop (cmd-safety) and destroy (cleanup).

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownToLine, ArrowUpFromLine, Play, RotateCw, Square } from 'lucide-react'

import {
  cephKeys,
  cephServiceCommand,
  createOsd,
  destroyOsd,
  fetchCephStatus,
  fetchCmdSafety,
  setCephFlags,
  useCephCrush,
  useCephFlags,
  useOsdDetails,
  useOsdDisks,
  useOsdLvInfo,
} from '@/api/ceph'
import type { DiskEntry } from '@/api/node-disks'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { CheckboxField, FormDialog, FormField, FormRow, NodeSelect, NumberInput, SelectField, SwitchField } from '@/components/form'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DASH, formatBytes, formatPercent } from '@/lib/format'

import {
  FLAG_LABEL,
  HEALING_FLAGS,
  crushDeviceClasses,
  flagChanges,
  flagIsSet,
  osdCreateError,
  osdCreateParams,
  osdStateLabel,
  type OsdCreateForm,
  type OsdRow,
} from './model'
import type { OsdActions } from './OsdView'
import { Fact, Notice } from './ui'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function diskLabel(d: DiskEntry): string {
  return [formatBytes(d.size), d.model?.trim() || d.serial, d.type && d.type !== 'unknown' ? d.type : null].filter(Boolean).join(' · ')
}

const EMPTY_FORM: OsdCreateForm = { dev: '', dbDev: '', dbSize: null, walDev: '', walSize: null, encrypted: false, deviceClass: '', osdsPerDevice: null }

// ------------------------------------------------------------------ create

export function CreateOsdDialog({ apiNode, defaultNode, open, onOpenChange }: DialogProps & { apiNode: string; defaultNode?: string | undefined }) {
  const [node, setNode] = useState<string | undefined>(defaultNode)
  const [form, setForm] = useState<OsdCreateForm>(EMPTY_FORM)
  const unused = useOsdDisks(node, 'unused', open)
  const journal = useOsdDisks(node, 'journal_disks', open)
  const crush = useCephCrush(open ? apiNode : null)

  useEffect(() => {
    if (open) {
      setNode(defaultNode)
      setForm(EMPTY_FORM)
    }
  }, [open, defaultNode])
  // Another node: its disks differ.
  useEffect(() => setForm((f) => ({ ...f, dev: '', dbDev: '', walDev: '' })), [node])

  const set = <K extends keyof OsdCreateForm>(k: K, v: OsdCreateForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const classes = useMemo(() => ['hdd', 'ssd', 'nvme', ...crushDeviceClasses(crush.data)], [crush.data])
  const error = osdCreateError(form)
  const disks = unused.data ?? []
  const journalDisks = (journal.data ?? []).filter((d) => d.devpath !== form.dev)

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="创建 OSD"
      description="用一块未使用的磁盘创建 Bluestore OSD。磁盘上的数据会被清除。"
      size="lg"
      submitLabel="创建"
      submitDisabled={!node || !!error}
      onSubmit={() => runTask(createOsd(node!, osdCreateParams(form)), { title: `在 ${node} 上创建 OSD（${form.dev}）`, node: node!, invalidate: [cephKeys.all()] })}
    >
      <FormRow>
        <FormField label="节点" required>
          <NodeSelect value={node} onValueChange={setNode} />
        </FormField>
        <FormField label="磁盘" name="dev" required>
          {unused.isPending && node ? (
            <Skeleton className="h-10 rounded-lg" />
          ) : (
            <SelectField
              value={form.dev || undefined}
              onValueChange={(v) => set('dev', v ?? '')}
              options={disks.map((d) => ({ value: d.devpath, label: d.devpath, description: diskLabel(d) }))}
              placeholder={!node ? '先选择节点' : disks.length ? '选择未使用的磁盘' : '没有未使用的磁盘'}
              disabled={!node || disks.length === 0}
              aria-label="磁盘"
            />
          )}
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="DB 磁盘" name="db_dev" hint="把 block.db 放到更快的磁盘上">
          <SelectField
            value={form.dbDev || undefined}
            onValueChange={(v) => set('dbDev', v ?? '')}
            emptyOption="使用 OSD 磁盘"
            options={journalDisks.map((d) => ({ value: d.devpath, label: d.devpath, description: diskLabel(d) }))}
            disabled={!node || (form.osdsPerDevice ?? 1) > 1}
            aria-label="DB 磁盘"
          />
        </FormField>
        <FormField label="DB 大小" name="db_dev_size" hint="留空自动（磁盘的 10%）">
          <NumberInput value={form.dbSize} onChange={(v) => set('dbSize', v ?? null)} min={1} unit="GiB" decimal placeholder="自动" disabled={!form.dbDev} />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="WAL 磁盘" name="wal_dev">
          <SelectField
            value={form.walDev || undefined}
            onValueChange={(v) => set('walDev', v ?? '')}
            emptyOption="使用 OSD / DB 磁盘"
            options={journalDisks.map((d) => ({ value: d.devpath, label: d.devpath, description: diskLabel(d) }))}
            disabled={!node || (form.osdsPerDevice ?? 1) > 1}
            aria-label="WAL 磁盘"
          />
        </FormField>
        <FormField label="WAL 大小" name="wal_dev_size" hint="留空自动（磁盘的 1%）">
          <NumberInput value={form.walSize} onChange={(v) => set('walSize', v ?? null)} min={0.5} step={0.5} unit="GiB" decimal placeholder="自动" disabled={!form.walDev} />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="设备类" name="crush-device-class">
          <SelectField
            value={form.deviceClass || undefined}
            onValueChange={(v) => set('deviceClass', v ?? '')}
            emptyOption="自动检测"
            options={classes.map((c) => ({ value: c, label: c }))}
            aria-label="设备类"
          />
        </FormField>
        <FormField label="每盘 OSD 数" name="osds-per-device" hint="只对很快的 NVMe 有意义">
          <NumberInput value={form.osdsPerDevice} onChange={(v) => set('osdsPerDevice', v ?? null)} min={1} max={8} placeholder="1" />
        </FormField>
      </FormRow>
      <SwitchField label="加密 OSD" description="用 dm-crypt 加密磁盘上的数据（密钥存在监视器中）。" checked={form.encrypted} onCheckedChange={(v) => set('encrypted', v)} />
      {error && form.dev && <p className="text-sm text-destructive">{error}</p>}
    </FormDialog>
  )
}

// ------------------------------------------------------------------- flags

export function FlagsDialog({ open, onOpenChange }: DialogProps) {
  const flags = useCephFlags(open)
  const [values, setValues] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (open && flags.data) setValues(Object.fromEntries(flags.data.map((f) => [f.name, flagIsSet(f)])))
    // Only when the dialog opens or the first data arrives, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, !!flags.data])
  const changes = flags.data ? flagChanges(flags.data, values) : null

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="全局 OSD 标志"
      description="维护期间暂停 Ceph 的自愈行为，例如重启节点前设置 noout。"
      size="lg"
      submitLabel="应用"
      submitDisabled={!changes}
      onSubmit={() => runTask(setCephFlags(changes!), { title: '设置 Ceph 全局标志', invalidate: [cephKeys.all()] })}
    >
      {flags.isPending ? (
        <LoadingRows rows={6} />
      ) : flags.error ? (
        <ErrorState error={flags.error} onRetry={() => void flags.refetch()} compact />
      ) : (
        <div className="grid gap-1 sm:grid-cols-2">
          {flags.data.map((f) => (
            <CheckboxField
              key={f.name}
              label={
                <span>
                  <span className="font-mono text-[13px]">{f.name}</span>
                  {FLAG_LABEL[f.name] && <span className="ml-1.5 text-muted-foreground">{FLAG_LABEL[f.name]}</span>}
                </span>
              }
              description={f.description}
              checked={values[f.name] ?? false}
              onCheckedChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))}
            />
          ))}
        </div>
      )}
    </FormDialog>
  )
}

// ----------------------------------------------------------------- details

export function OsdDetailsDialog({
  osd,
  actions,
  canModify,
  open,
  onOpenChange,
}: DialogProps & { osd: OsdRow | null; actions: OsdActions; canModify: boolean }) {
  const details = useOsdDetails(open ? osd?.host : null, osd?.id)
  const devices = details.data?.devices ?? []
  const hasDb = devices.some((d) => d.device === 'db')
  const hasWal = devices.some((d) => d.device === 'wal')
  const lvBlock = useOsdLvInfo(open ? osd?.host : null, osd?.id, 'block', open)
  const lvDb = useOsdLvInfo(open ? osd?.host : null, osd?.id, 'db', open && hasDb)
  const lvWal = useOsdLvInfo(open ? osd?.host : null, osd?.id, 'wal', open && hasWal)
  if (!osd) return null
  const o = details.data?.osd
  const run = (fn: () => void) => () => {
    onOpenChange(false)
    fn()
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${osd.name}`}
      description={`${osd.host} · ${osdStateLabel(osd)}`}
      size="lg"
      footer={
        canModify ? (
          <div className="flex w-full flex-wrap justify-end gap-2">
            {osd.up ? (
              <Button variant="outline" onClick={run(() => actions.open('stop', osd))}>
                <Square /> 停止
              </Button>
            ) : (
              <Button variant="outline" onClick={run(() => actions.start(osd))}>
                <Play /> 启动
              </Button>
            )}
            <Button variant="outline" onClick={run(() => actions.restart(osd))}>
              <RotateCw /> 重启
            </Button>
            {osd.in ? (
              <Button variant="outline" onClick={run(() => actions.inOut(osd, 'out'))}>
                <ArrowUpFromLine /> Out
              </Button>
            ) : (
              <Button variant="outline" onClick={run(() => actions.inOut(osd, 'in'))}>
                <ArrowDownToLine /> In
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Fact label="状态">{osdStateLabel(osd)}</Fact>
          <Fact label="使用率">
            {formatPercent(osd.usage)} / {formatBytes(osd.total)}
          </Fact>
          <Fact label="PG">{osd.pgs ?? DASH}</Fact>
          <Fact label="设备类">{osd.deviceClass ?? DASH}</Fact>
          <Fact label="CRUSH 权重">{osd.crushWeight != null ? osd.crushWeight.toFixed(4) : DASH}</Fact>
          <Fact label="Reweight">{osd.reweight ?? DASH}</Fact>
          <Fact label="延迟 apply/commit">
            {osd.applyLatency ?? DASH} / {osd.commitLatency ?? DASH} ms
          </Fact>
          <Fact label="版本">{osd.version ?? DASH}</Fact>
          <Fact label="类型">{osd.osdType ?? DASH}</Fact>
        </div>
        {details.isPending ? (
          <LoadingRows rows={3} />
        ) : details.error ? (
          <ErrorState error={details.error} onRetry={() => void details.refetch()} compact title="无法读取 OSD 详情" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Fact label="进程 PID">{o?.pid ?? DASH}</Fact>
              <Fact label="内存">{formatBytes(o?.mem_usage)}</Fact>
              <Fact label="加密">{o?.encrypted ? '是' : '否'}</Fact>
              <Fact label="数据目录" mono className="col-span-2 sm:col-span-3">
                {o?.osd_data ?? DASH}
              </Fact>
              <Fact label="前端地址" mono className="col-span-2 sm:col-span-3">
                {o?.front_addr ?? DASH}
              </Fact>
              <Fact label="后端地址" mono className="col-span-2 sm:col-span-3">
                {o?.back_addr ?? DASH}
              </Fact>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">设备</h3>
              <ul className="grid gap-2">
                {devices.map((d) => {
                  const lv = d.device === 'block' ? lvBlock.data : d.device === 'db' ? lvDb.data : d.device === 'wal' ? lvWal.data : undefined
                  return (
                    <li key={d.device} className="rounded-xl bg-foreground/[0.03] px-3 py-2 text-sm ring-1 ring-border/60 ring-inset paper:bg-secondary/40" data-device={d.device}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium">{d.device}</span>
                        <span className="font-mono text-xs">{d.physical_device ? `/dev/${d.physical_device}` : d.dev_node}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatBytes(d.size)} · {d.type}
                          {d.support_discard ? ' · discard' : ''}
                        </span>
                      </div>
                      {lv?.lv_path && (
                        <div className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
                          {lv.lv_path}
                          {lv.creation_time && ` · ${lv.creation_time}`}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        )}
      </div>
    </ResponsiveDialog>
  )
}

// -------------------------------------------------------------------- stop

export function StopOsdDialog({ osd, open, onOpenChange }: DialogProps & { osd: OsdRow | null }) {
  const safety = useQuery({
    queryKey: ['pve', 'ceph', 'cmd-safety', osd?.host ?? '', 'osd', osd?.id ?? -1, 'stop'],
    queryFn: () => fetchCmdSafety(osd!.host, 'osd', String(osd!.id), 'stop'),
    enabled: open && !!osd,
    staleTime: 0,
    retry: false,
  })
  if (!osd) return null
  const unsafe = safety.data && !(safety.data.safe === 1 || safety.data.safe === true)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      destructive
      title={`停止 osd.${osd.id}？`}
      description={
        <span className="grid gap-2">
          <span>在节点 {osd.host} 上停止这个 OSD。没有设置 noout 时，Ceph 会在一段时间后把它标记为 out 并开始迁移数据。</span>
          {safety.isPending && <span className="text-muted-foreground">正在检查是否安全…</span>}
          {unsafe && (
            <span className="rounded-lg bg-warning/10 px-2 py-1.5 text-warning-strong" role="alert">
              {safety.data?.status || '停止后可能有 PG 不可用。'}
            </span>
          )}
        </span>
      }
      confirmLabel="停止"
      onConfirm={() => runTask(cephServiceCommand(osd.host, 'stop', `osd.${osd.id}`), { title: `停止 osd.${osd.id}`, invalidate: [cephKeys.all()] })}
    />
  )
}

// ----------------------------------------------------------------- destroy

export function DestroyOsdDialog({ osd, open, onOpenChange }: DialogProps & { osd: OsdRow | null }) {
  const [cleanup, setCleanup] = useState(true)
  useEffect(() => {
    if (open) setCleanup(true)
  }, [open])
  const flags = useCephFlags(open)
  const status = useQuery({ queryKey: [...cephKeys.status(), 'destroy-check'], queryFn: ({ signal }) => fetchCephStatus(signal), enabled: open, staleTime: 0 })
  if (!osd) return null
  const healingOff = (flags.data ?? []).filter((f) => flagIsSet(f) && HEALING_FLAGS.includes(f.name)).map((f) => f.name)
  const degraded = !!status.data?.pgmap && 'degraded_objects' in status.data.pgmap

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`销毁 osd.${osd.id}`}
      description={`从集群中删除 ${osd.host} 上的这个 OSD。`}
      destructive
      submitLabel="销毁"
      onSubmit={() => runTask(destroyOsd(osd.host, osd.id, cleanup), { title: `销毁 osd.${osd.id}`, node: osd.host, invalidate: [cephKeys.all()] })}
    >
      <CheckboxField
        label="清理磁盘"
        description="同时删除 OSD 的逻辑卷（ceph-volume lvm zap --destroy），让磁盘可以重新使用。"
        checked={cleanup}
        onCheckedChange={setCleanup}
      />
      {healingOff.length > 0 && <Notice tone="warn">限制自愈的全局标志已开启：{healingOff.join('、')}。</Notice>}
      {degraded && <Notice tone="warn">有降级的对象。建议等集群恢复健康后再销毁。</Notice>}
    </FormDialog>
  )
}

