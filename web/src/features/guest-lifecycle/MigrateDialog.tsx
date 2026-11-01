import { useEffect, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'

import { migrateGuest, useMigratePrecondition } from '@/api/guest-lifecycle'
import { useClusterResources } from '@/api/queries'
import { isNode } from '@/api/types'
import {
  CheckboxField,
  FormDialog,
  FormField,
  FormSection,
  NodeSelect,
  NumberInput,
  StorageSelect,
  SwitchField,
} from '@/components/form'
import type { ActionDialogProps } from '@/components/page/registry'
import { runTask } from '@/components/tasks/tracker'
import type { GuestActionContext } from '@/features/guest/types'
import { errorMessage } from '@/lib/errors'
import { formatBytes } from '@/lib/format'

import { Notice } from './notes'
import { blockingResources, migrateParams, movableLocalDisks, targetProblems } from './params'

/** Migrate a VM (online/offline) or CT (restart mode) to another node, with the precondition checks. */
export default function MigrateDialog({ ctx, open, onOpenChange }: ActionDialogProps<GuestActionContext>) {
  const { node, type, vmid, guest, name } = ctx
  const qemu = type === 'qemu'
  const [target, setTarget] = useState<string | undefined>()
  const [online, setOnline] = useState(true)
  const [targetStorage, setTargetStorage] = useState<string | undefined>()
  const [force, setForce] = useState(false)
  const [conntrack, setConntrack] = useState(true)
  const [timeout, setTimeoutValue] = useState<number | undefined>()
  const [bwlimit, setBwlimit] = useState<number | undefined>()

  useEffect(() => {
    if (open) {
      setTarget(undefined)
      setTargetStorage(undefined)
      setForce(false)
      setTimeoutValue(undefined)
      setBwlimit(undefined)
    }
  }, [open])

  const { data: otherNodes } = useClusterResources({
    enabled: open,
    select: (all) => all.filter(isNode).filter((n) => n.node !== node && n.status === 'online').map((n) => n.node),
  })
  const pre = useMigratePrecondition(node, type, vmid, target, { enabled: open })
  const running = !!pre.data?.running || guest.status === 'running'
  useEffect(() => {
    setOnline(running)
  }, [running])

  const disks = movableLocalDisks(pre.data)
  const blocking = blockingResources(pre.data)
  const problems = targetProblems(pre.data, target)
  const dependentHa = pre.data?.['dependent-ha-resources'] ?? []
  const noTarget = otherNodes !== undefined && otherNodes.length === 0
  const blockedByResources = qemu && blocking.length > 0 && (running || !force)
  const canSubmit = !!target && !noTarget && !pre.isFetching && !pre.isError && problems.length === 0 && !blockedByResources

  const submit = () =>
    runTask(
      migrateGuest(
        node,
        type,
        vmid,
        migrateParams(type, { target: target!, online: running && online, targetStorage, force, conntrack, timeout, bwlimit }, pre.data),
      ),
      { title: `迁移 ${name} 到 ${target}` },
    )

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`迁移 ${name}`}
      description={
        qemu
          ? running
            ? '虚拟机正在运行，会在线迁移（不中断运行）。'
            : '虚拟机已停止，会离线迁移。'
          : running
            ? '容器正在运行，会以重启模式迁移：先关机，迁移后再启动。'
            : '容器已停止，会离线迁移。'
      }
      size="md"
      submitLabel="迁移"
      submitDisabled={!canSubmit}
      onSubmit={submit}
    >
      {noTarget ? (
        <Notice tone="warn" title="没有可以迁移到的节点">
          集群中没有其他在线节点。加入集群或启动其他节点后才能迁移。
        </Notice>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
          <FormField label="源节点">
            <div className="flex h-9 items-center rounded-lg border border-input bg-foreground/[0.03] px-3 text-sm text-muted-foreground pointer-coarse:h-11">
              {node}
            </div>
          </FormField>
          <ArrowRight className="mx-auto hidden size-4 text-muted-foreground sm:mb-3 sm:block" aria-hidden />
          <FormField label="目标节点" name="target" required>
            <NodeSelect value={target} onValueChange={setTarget} exclude={[node]} />
          </FormField>
        </div>
      )}

      {pre.isFetching && !pre.data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> 正在检查迁移条件…
        </p>
      ) : pre.isError ? (
        <Notice tone="error" title="无法检查迁移条件">
          {errorMessage(pre.error)}
        </Notice>
      ) : (
        <div className="grid gap-2">
          {problems.map((p) => (
            <Notice key={p} tone="error" title={p} />
          ))}
          {blocking.length > 0 && (
            <Notice tone={blockedByResources ? 'error' : 'warn'} title="使用了本地资源">
              {blocking.join(', ')}。
              {running ? '运行中的虚拟机不能带本地资源迁移，请先关机。' : '勾选“强制迁移”后可以离线迁移，但目标节点需要有相同的设备。'}
            </Notice>
          )}
          {disks.length > 0 && (
            <Notice tone="info" title={`${disks.length} 块本地磁盘会一起迁移`}>
              {disks.map((d) => `${d.volid}${d.size ? `（${formatBytes(d.size)}）` : ''}`).join('、')}
            </Notice>
          )}
          {dependentHa.length > 0 && (
            <Notice tone="info" title="HA 亲和规则会一起迁移这些资源">
              {dependentHa.join(', ')}
            </Notice>
          )}
          {target && !pre.isFetching && problems.length === 0 && !blockedByResources && disks.length === 0 && blocking.length === 0 && (
            <Notice tone="ok" title="可以迁移" />
          )}
        </div>
      )}

      {!noTarget && (
        <>
          {qemu && blocking.length > 0 && !running && (
            <CheckboxField
              label="强制迁移"
              description="忽略本地资源检查（官方“Force”）。"
              checked={force}
              onCheckedChange={setForce}
            />
          )}
          {!qemu && running && (
            <FormField label="关机超时" hint="重启模式下等待容器关机的时间，超时后强制停止。">
              <NumberInput value={timeout} onChange={setTimeoutValue} min={0} unit="秒" placeholder="180" />
            </FormField>
          )}
          {(disks.length > 0 || (!qemu && !running)) && (
            <FormField label="目标存储" hint="本地磁盘迁移到目标节点上的这个存储。">
              <StorageSelect
                node={target}
                content={qemu ? 'images' : 'rootdir'}
                value={targetStorage}
                onValueChange={setTargetStorage}
                emptyOption="与源存储相同"
              />
            </FormField>
          )}
          {qemu && running && pre.data?.['has-dbus-vmstate'] === 1 && (
            <SwitchField
              label="保留连接跟踪状态"
              description="迁移 conntrack 表，已有网络连接不会断开。"
              checked={conntrack}
              onCheckedChange={setConntrack}
            />
          )}
          <FormSection collapsible title="高级选项">
            <FormField label="带宽限制" hint="留空使用数据中心或存储的默认限制。" name="bwlimit">
              <NumberInput value={bwlimit} onChange={setBwlimit} min={0} unit="KiB/s" placeholder="默认" />
            </FormField>
          </FormSection>
        </>
      )}
    </FormDialog>
  )
}
