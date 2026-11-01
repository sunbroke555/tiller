import { useState } from 'react'
import { Copy, Download, QrCode as QrIcon } from 'lucide-react'

import { QrCode } from '@/components/QrCode'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { copyText } from '@/features/node-summary/clipboard'

import { Notice } from './fields'

/**
 * Shows a PBS encryption key PVE just generated (official PBSKeyShow): copy,
 * download, or a QR code for a paper backup. Only an explicit button closes it.
 */
export function PbsKeyDialog({
  storage,
  keyText,
  open,
  onOpenChange,
}: {
  storage: string
  keyText: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [qr, setQr] = useState(false)
  const pretty = prettyKey(keyText)

  function download() {
    const blob = new Blob([keyText], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pve-${window.location.hostname}-storage-${storage}.enc`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      dismissible={false}
      size="lg"
      title="请保存加密密钥"
      description={`存储 ${storage} 的客户端加密密钥`}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => void copyText(keyText, '已复制密钥')}>
            <Copy />
            复制
          </Button>
          <Button type="button" variant="outline" onClick={download}>
            <Download />
            下载
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            我已保存
          </Button>
        </>
      }
    >
      <div className="grid gap-4 pb-2">
        <Notice tone="warning">丢失这个密钥后，用它加密的备份将无法恢复。请存进密码管理器，并离线保存一份（U 盘或打印）。</Notice>
        <Textarea readOnly value={pretty} aria-label="加密密钥" className="min-h-40 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        {qr ? (
          <QrCode value={keyText} label="加密密钥二维码" className="mx-auto w-full max-w-72" />
        ) : (
          <Button type="button" variant="ghost" className="justify-self-start" onClick={() => setQr(true)}>
            <QrIcon />
            显示二维码（纸质备份）
          </Button>
        )}
      </div>
    </ResponsiveDialog>
  )
}

function prettyKey(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
