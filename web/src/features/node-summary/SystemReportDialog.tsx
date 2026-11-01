import { Copy, Download, Loader2, RefreshCw } from 'lucide-react'

import { useNodeReport } from '@/api/node-summary'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'

import { copyText, downloadText, fileStamp } from './clipboard'

/** "系统报告": GET /nodes/{node}/report (plain text, generated on request). */
export function SystemReportDialog({ node, open, onOpenChange }: { node: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const report = useNodeReport(node, { enabled: open })
  const text = report.data ?? ''

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="系统报告"
      description="节点配置、存储、网络、客户机等信息的汇总，提交技术支持时使用。"
      size="xl"
      bodyClassName="px-0 pb-0 lg:px-0"
      headerExtra={
        <Button
          variant="ghost"
          size="icon"
          className="-my-1 shrink-0"
          aria-label="重新生成"
          disabled={report.isFetching}
          onClick={() => void report.refetch()}
        >
          <RefreshCw className={report.isFetching ? 'animate-spin' : undefined} />
        </Button>
      }
      footer={
        <>
          <Button variant="outline" disabled={!text} onClick={() => void copyText(text, '已复制系统报告')}>
            <Copy /> 复制
          </Button>
          <Button disabled={!text} onClick={() => downloadText(text, `${node}-report-${fileStamp()}.txt`)}>
            <Download /> 下载
          </Button>
        </>
      }
    >
      {report.isPending ? (
        <div className="flex items-center gap-2 px-5 py-10 text-sm text-muted-foreground lg:px-6">
          <Loader2 className="size-4 animate-spin" /> 正在生成系统报告，可能需要几秒钟…
        </div>
      ) : report.isError ? (
        <p className="px-5 py-10 text-sm text-destructive lg:px-6">{errorMessage(report.error)}</p>
      ) : (
        <pre
          aria-label="系统报告内容"
          className="max-h-[min(60dvh,40rem)] overflow-auto border-t border-border/60 bg-foreground/[0.03] px-5 py-3 font-mono text-[11px] leading-relaxed whitespace-pre lg:px-6 paper:bg-secondary/50"
        >
          {text}
        </pre>
      )}
    </ResponsiveDialog>
  )
}
