import { useEffect, useState } from 'react'
import { MonitorDown } from 'lucide-react'

import { downloadSpiceFile, targetLabel, type ConsoleTarget } from '@/api/console'
import { FieldInput, FormDialog, FormField } from '@/components/form'
import type { ActionDialogProps } from '@/components/page/registry'
import type { GuestActionContext } from '@/features/guest/types'
import type { NodeActionContext } from '@/features/node/types'

import { storeSpiceProxy, storedSpiceProxy } from './viewers'

interface SpiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: ConsoleTarget
  name?: string
}

/**
 * SPICE: fetch a one-time ticket (spiceproxy / spiceshell) and download it as
 * a .vv file for remote-viewer (virt-viewer). The proxy is the PVE host the
 * client connects to on port 3128; empty lets PVE choose the node.
 */
export function SpiceDialog({ open, onOpenChange, target, name }: SpiceDialogProps) {
  const [proxy, setProxy] = useState('')
  useEffect(() => {
    if (open) setProxy(storedSpiceProxy())
  }, [open])

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="SPICE 远程查看"
      description={`为 ${name ?? targetLabel(target)} 下载 .vv 连接文件，用 remote-viewer（virt-viewer）打开。文件里的票据只在几十秒内有效，下载后请立即打开。`}
      submitLabel="下载 .vv 文件"
      onSubmit={async () => {
        storeSpiceProxy(proxy)
        await downloadSpiceFile(target, proxy)
      }}
    >
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-border bg-(--field) p-3 text-sm text-muted-foreground">
        <MonitorDown className="mt-0.5 size-5 shrink-0 text-brand paper:text-foreground/70" aria-hidden />
        <p>
          SPICE 支持剪贴板共享、USB 重定向和多显示器，适合桌面电脑。手机上建议直接使用网页控制台。
        </p>
      </div>
      <FormField
        label="SPICE 代理"
        name="proxy"
        hint="可选。远程查看器连接的 PVE 主机名或 IP（端口 3128）；留空由 PVE 使用客户机所在节点。"
      >
        <FieldInput
          value={proxy}
          onChange={(e) => setProxy(e.target.value)}
          placeholder="例如 192.168.1.10"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
        />
      </FormField>
    </FormDialog>
  )
}

/** Guest action dialog. */
export function GuestSpiceDialog({ ctx, open, onOpenChange }: ActionDialogProps<GuestActionContext>) {
  return (
    <SpiceDialog
      open={open}
      onOpenChange={onOpenChange}
      target={{ kind: ctx.type, node: ctx.node, vmid: ctx.vmid }}
      name={ctx.name}
    />
  )
}

/** Node action dialog (spiceshell). */
export function NodeSpiceDialog({ ctx, open, onOpenChange }: ActionDialogProps<NodeActionContext>) {
  return <SpiceDialog open={open} onOpenChange={onOpenChange} target={{ kind: 'node', node: ctx.node }} name={`节点 ${ctx.node}`} />
}
