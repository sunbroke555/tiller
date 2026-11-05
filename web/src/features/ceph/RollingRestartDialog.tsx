// Rolling restart (pve-manager ≥ 9.2.5): every MON / MGR / MDS of the cluster
// (POST /cluster/ceph/restart-bulk) or every OSD of one node
// (POST /nodes/{node}/ceph/restart-bulk). PVE restarts one daemon at a time and
// waits for Ceph to report it back before the next; the task log shows progress.

import { useEffect, useState } from 'react'

import { cephKeys, restartCephBulk, restartNodeOsds } from '@/api/ceph'
import { FormDialog, SwitchField } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'

import { DEFAULT_RESTART_FORM, nodeOsdRestartParams, restartBulkParams, SERVICE_LABEL, type RestartBulkForm, type ServiceType } from './model'
import { Notice } from './ui'

export type RollingRestartTarget = { kind: 'cluster'; type: ServiceType } | { kind: 'node'; node: string }

export function RollingRestartDialog({
  target,
  open,
  onOpenChange,
}: {
  target: RollingRestartTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [form, setForm] = useState<RestartBulkForm>(DEFAULT_RESTART_FORM)
  useEffect(() => {
    if (open) setForm(DEFAULT_RESTART_FORM)
  }, [open])
  if (!target) return null
  const set = <K extends keyof RestartBulkForm>(k: K, v: RestartBulkForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  const t = target
  const isNode = t.kind === 'node'
  const what = t.kind === 'node' ? `${t.node} 上的所有 OSD` : `所有${SERVICE_LABEL[t.type]}`
  const verb = isNode ? '重启' : '滚动重启'
  const title = `${verb}${what}${form.dryRun ? '（演练）' : ''}`
  const start =
    t.kind === 'node'
      ? () => restartNodeOsds(t.node, nodeOsdRestartParams(form))
      : () => restartCephBulk(restartBulkParams(t.type, form))

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${verb}${what}？`}
      description={
        t.kind === 'node'
          ? `逐个重启 ${t.node} 上的 OSD：每次只重启一个，等 Ceph 报告它重新 up、下一个可以安全停止后再继续。`
          : `在整个集群中逐个重启${SERVICE_LABEL[t.type]}：每次只重启一个，等 Ceph 报告它恢复运行、下一个可以安全停止后再继续。`
      }
      submitLabel={form.dryRun ? '演练' : '开始重启'}
      onSubmit={() =>
        runTask(start, {
          title,
          ...(t.kind === 'node' ? { node: t.node } : {}),
          invalidate: [cephKeys.all()],
        })
      }
    >
      <Notice tone="info">
        集群应处于 HEALTH_OK。出现会影响重启的警告（如 PG 降级、慢请求、监视器离线）时任务会停下；HEALTH_ERR 总会停止。已静默的检查不会阻止重启。进度在任务日志里查看。
      </Notice>
      {isNode && (
        <>
          <SwitchField
            label="只重启版本过旧的 OSD"
            description="跳过已经运行本机已安装版本的 OSD，适合升级后使用。"
            checked={form.onlyOutdated && !form.resume}
            disabled={form.resume}
            onCheckedChange={(v) => set('onlyOutdated', v)}
          />
          <SwitchField
            label="重启期间设置 noout"
            description="只对本次重启的 OSD 设置，完成后自动取消；其他节点的 OSD 出故障时仍会正常标记为 out。"
            checked={form.setNoout || form.resume}
            disabled={form.resume}
            onCheckedChange={(v) => set('setNoout', v)}
          />
          <SwitchField
            label="继续上次中断的重启"
            description="按上次保存的计划继续。有未完成的记录时，不勾选会被拒绝。"
            checked={form.resume}
            onCheckedChange={(v) => set('resume', v)}
          />
        </>
      )}
      <SwitchField
        label="强制"
        description="遇到 PG 降级、慢请求等警告时也继续。请先确认集群足够稳定。"
        checked={form.force}
        onCheckedChange={(v) => set('force', v)}
      />
      <SwitchField label="仅演练" description="只在任务日志里列出将按什么顺序重启哪些服务，不实际重启。" checked={form.dryRun} onCheckedChange={(v) => set('dryRun', v)} />
    </FormDialog>
  )
}
