// Removing a node has no button in the official UI: it is `pvecm delnode` on
// a remaining node, after the node is emptied and powered off for good. This
// dialog walks through the official procedure (pvecm chapter, "Remove a
// Cluster Node") with the node's name filled in.

import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { SquareTerminal } from 'lucide-react'

import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { nodeShellPath } from '@/lib/resources'

import { CopyValue, Notice } from './ui'

export interface RemoveNodeDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  node: string
  /** Guests still on the node. */
  guestCount: number
  /** An online node other than `node` to run the commands on. */
  runOn: string | undefined
  /** A QDevice is configured (must be removed first). */
  qdevice: boolean
}

export function RemoveNodeDialog({ open, onOpenChange, node, guestCount, runOn, qdevice }: RemoveNodeDialogProps) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`移除节点 ${node}`}
      description="官方界面不提供移除节点，需要在命令行用 pvecm delnode 完成。"
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          {runOn && (
            <Button asChild>
              <Link to={nodeShellPath(runOn)}>
                <SquareTerminal />
                打开 {runOn} 的 Shell
              </Link>
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 pt-1 pb-2 text-sm leading-relaxed">
        <Notice tone="warning">
          移除后这台节点不能再以当前系统重新连回集群网络，否则会破坏集群。要再次加入，需要重装系统（或按官方文档把节点从集群中分离）。
        </Notice>
        <ol className="grid list-none gap-4 [counter-reset:step]">
          <Step title="清空节点">
            把 {node} 上的客户机迁移到其他节点，或备份后删除
            {guestCount > 0 ? <span className="font-medium text-warning-strong">（目前还有 {guestCount} 台）</span> : '（目前没有客户机）'}
            ；从存储复制、HA 和备份计划中去掉它，并备份节点上需要保留的本地数据。
            {qdevice && <span className="mt-1 block font-medium text-warning-strong">集群配置了 QDevice，先移除 QDevice（pvecm qdevice remove）。</span>}
          </Step>
          <Step title="确认节点名">
            在剩下的任一节点{runOn ? `（如 ${runOn}）` : ''}上查看节点列表：
            <CopyValue label="命令" value="pvecm nodes" className="mt-2" />
          </Step>
          <Step title="永久关闭节点">关闭 {node}，并确保它不会以当前配置再次开机连入集群网络。</Step>
          <Step title="从集群中删除">
            在剩下的节点上执行：
            <CopyValue label="命令" value={`pvecm delnode ${node}`} className="mt-2" />
            <span className="mt-1 block text-xs text-muted-foreground">提示 “Could not kill node (error = CS_ERR_NOT_EXIST)” 是正常的：节点已离线。</span>
          </Step>
          <Step title="检查与清理">
            用 <code className="font-mono text-[12.5px]">pvecm status</code> 确认节点数和法定人数正确。节点的配置目录还会保留，确认不再需要后可以删除：
            <CopyValue label="命令" value={`rm -r /etc/pve/nodes/${node}`} className="mt-2" />
          </Step>
        </ol>
      </div>
    </ResponsiveDialog>
  )
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="relative pl-9 [counter-increment:step] before:absolute before:top-0 before:left-0 before:grid before:size-6 before:place-items-center before:rounded-full before:bg-secondary before:text-xs before:font-medium before:text-secondary-foreground before:content-[counter(step)]">
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-0.5 text-foreground/80">{children}</div>
    </li>
  )
}
