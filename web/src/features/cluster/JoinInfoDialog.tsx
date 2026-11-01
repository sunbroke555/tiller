// Join information (PVE.ClusterInfoWindow): address and fingerprint of a
// cluster node plus the encoded string the joining node pastes — copyable,
// and as a QR code to carry it to a phone or another screen.

import { useMemo, useState } from 'react'
import { Copy, QrCode as QrIcon } from 'lucide-react'

import { useClusterJoinInfo } from '@/api/cluster'
import { SelectField } from '@/components/form'
import { QrCode } from '@/components/QrCode'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { copyText } from '@/features/node-summary/clipboard'
import { errorMessage } from '@/lib/errors'

import { buildJoinInfo, encodeJoinInfo } from './logic'
import { CopyValue, Notice } from './ui'

export interface JoinInfoDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Cluster nodes the information can be read for. */
  nodes: readonly { name: string; online: boolean | undefined }[]
  /** Initially selected node (the one this UI talks to). */
  defaultNode: string | undefined
}

export function JoinInfoDialog({ open, onOpenChange, nodes, defaultNode }: JoinInfoDialogProps) {
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const node = picked ?? defaultNode
  const join = useClusterJoinInfo(node, open)
  const [qr, setQr] = useState(false)

  const info = useMemo(() => (join.data ? buildJoinInfo(join.data) : null), [join.data])
  const encoded = useMemo(() => (info ? encodeJoinInfo(info) : ''), [info])

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="加入信息"
      description="在要加入的节点上打开“加入集群”，粘贴这段加入信息并输入这里节点的 root 密码。"
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button type="button" disabled={!encoded} onClick={() => void copyText(encoded, '已复制加入信息')}>
            <Copy />
            复制加入信息
          </Button>
        </>
      }
    >
      <div className="grid gap-4 pt-1 pb-2">
        {nodes.length > 1 && (
          <div className="grid gap-2">
            <span className="text-sm font-medium" id="join-info-node">
              通过节点
            </span>
            <SelectField
              aria-label="通过节点"
              value={node}
              onValueChange={(v) => v && setPicked(v)}
              options={nodes.map((n) => ({
                value: n.name,
                label: n.name,
                description: n.online === false ? '离线' : undefined,
                disabled: n.online === false,
              }))}
            />
            <p className="text-xs text-muted-foreground">新节点会连接这个节点的地址完成加入。</p>
          </div>
        )}

        {join.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        ) : join.isError ? (
          <Notice tone="error">无法读取加入信息：{errorMessage(join.error)}</Notice>
        ) : !info ? (
          <Notice tone="error">加入信息里没有节点 {join.data?.preferred_node} 的条目。</Notice>
        ) : (
          <>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">IP 地址</span>
              <CopyValue label="IP 地址" value={info.ipAddress} />
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">证书指纹（SHA-256）</span>
              <CopyValue label="指纹" value={info.fingerprint} wrap />
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="join-info-text" className="text-sm font-medium">
                  加入信息
                </label>
                <Button type="button" variant="ghost" size="sm" onClick={() => setQr((q) => !q)} aria-pressed={qr}>
                  <QrIcon />
                  {qr ? '显示文本' : '二维码'}
                </Button>
              </div>
              {qr ? (
                <div className="grid justify-items-center gap-2 py-1">
                  <QrCode value={encoded} label="加入信息二维码" className="w-full max-w-[22rem]" />
                  <p className="text-xs text-muted-foreground">用手机扫描后，把文本粘贴到新节点的“加入集群”里。</p>
                </div>
              ) : (
                <Textarea
                  id="join-info-text"
                  readOnly
                  value={encoded}
                  rows={6}
                  spellCheck={false}
                  onFocus={(e) => e.currentTarget.select()}
                  className="max-h-48 min-h-32 resize-none overflow-y-auto font-mono text-[12px] leading-relaxed break-all"
                  data-testid="join-info-text"
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              集群 <span className="font-medium text-foreground/80">{info.totem.cluster_name}</span> · 配置版本 {String(info.totem.config_version ?? '—')}
            </p>
          </>
        )}
      </div>
    </ResponsiveDialog>
  )
}
