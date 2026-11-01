// "发送测试通知": confirm, send, then show the outcome in the dialog — the
// server's error (connection refused, auth failed, unknown host…) stays
// visible with a retry button instead of disappearing in a toast.

import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, Loader2, Send } from 'lucide-react'

import { testTarget } from '@/api/notifications-metrics'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'ok' } | { kind: 'error'; message: string }

export function TestTargetDialog({ open, onOpenChange, name }: { open: boolean; onOpenChange: (o: boolean) => void; name: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  useEffect(() => {
    if (open) setState({ kind: 'idle' })
  }, [open, name])

  async function send() {
    setState({ kind: 'sending' })
    try {
      await testTarget(name)
      setState({ kind: 'ok' })
    } catch (e) {
      setState({ kind: 'error', message: errorMessage(e) })
    }
  }

  const busy = state.kind === 'sending'
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      dismissible={!busy}
      title="发送测试通知"
      description={`目标：${name}`}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {state.kind === 'ok' || state.kind === 'error' ? '完成' : '取消'}
          </Button>
          {state.kind !== 'ok' && (
            <Button type="button" disabled={busy} onClick={() => void send()}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
              {state.kind === 'error' ? '重试' : '发送'}
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-3 pt-1 pb-2" aria-live="polite">
        {state.kind === 'idle' && <p className="text-sm text-muted-foreground">向“{name}”发送一条测试通知，用来确认目标配置能正常投递。</p>}
        {state.kind === 'sending' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            正在发送…
          </p>
        )}
        {state.kind === 'ok' && (
          <p role="status" className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-foreground">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-strong" aria-hidden />
            <span>已发送测试通知到“{name}”。服务器已接受，请到接收端确认是否收到。</span>
          </p>
        )}
        {state.kind === 'error' && (
          <div role="alert" className="grid gap-1.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              测试失败
            </p>
            <p className="font-mono text-xs break-words whitespace-pre-wrap text-foreground/85">{state.message}</p>
          </div>
        )}
      </div>
    </ResponsiveDialog>
  )
}
