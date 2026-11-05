import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, LoaderCircle, RotateCcw, Zap } from 'lucide-react'
import { toast } from 'sonner'

import { get, p } from '@/api/client'
import { useGuestStatus, type GuestStatusCurrent } from '@/api/guest-core'
import { fetchQemuPending, retryQemuPending } from '@/api/qemu-config'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'
import { guestInvalidation, useQemuConfig } from './context'
import { classifyOnlineChange, onlineApplyParams, verifiedOnlineKeys } from './hotplug'
import { splitPending } from './model'

export function PendingChangesBanner({ rows, onRevertAll }: {
  rows: readonly { key: string; title: string; keys?: readonly string[] }[]
  onRevertAll: () => void
}) {
  const { node, vmid, state, running, can } = useQemuConfig()
  const status = useGuestStatus(node, 'qemu', vmid)
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const keys = [...new Set(rows.flatMap((r) => r.keys ?? [r.key]))].filter((k) => state.pending.has(k))
  const changes = keys.map((k) => classifyOnlineChange(state, k, status.data?.['running-machine']))
  const params = onlineApplyParams(state, changes, can)
  const eligible = changes.filter((c) => c.mode === 'online')

  const apply = async () => {
    if (!params || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    let failure: string | undefined
    let submitted = false
    try {
      const live = await get<GuestStatusCurrent>(p`/nodes/${node}/qemu/${vmid}/status/current`)
      if (live.status !== 'running' || live.qmpstatus && live.qmpstatus !== 'running') throw new Error('虚拟机当前未正常运行，请刷新后重试')
      // The digest guards the exact snapshot shown by this banner. PVE rejects
      // stale changes; never silently rebuild the payload from a newer config.
      submitted = true
      try {
        const task = await runTask(retryQemuPending(node, vmid, params), {
          title: '尝试在线应用配置', invalidate: guestInvalidation(node, vmid), syncSuccessMessage: false,
        })
        const outcome = await task.done
        if (outcome.state !== 'ok') failure = outcome.exitstatus ?? '在线应用任务未成功'
      } catch (error) {
        failure = errorMessage(error)
      }
      // PVE can apply some fields and fail others. Even an OK task can leave
      // unsupported changes pending, so report only read-back verified values.
      const fresh = splitPending(await fetchQemuPending(node, vmid))
      const applied = verifiedOnlineKeys(params, fresh).length
      const total = Object.keys(params).length - 1
      if (applied === total && !failure) toast.success(`${applied} 项参数已在线应用`)
      else toast.warning(`已确认 ${applied}/${total} 项参数生效`, {
        description: failure ?? '其余参数仍未确认生效，请查看待生效列表；必要时关机后重新启动。',
        duration: 10_000,
      })
    } catch (error) {
      toast.error(submitted ? '暂时无法确认应用结果，请刷新查看' : '未提交在线应用', { description: errorMessage(error) })
    } finally {
      for (const queryKey of guestInvalidation(node, vmid)) void queryClient.invalidateQueries({ queryKey })
      inFlight.current = false
      setBusy(false)
    }
  }

  if (rows.length === 0) return null
  return (
    <div data-testid="pending-changes" className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <CircleAlert className="size-4 shrink-0 text-warning-strong" aria-hidden />
        <p role="status" className="min-w-0 flex-1 basis-56">
          <span className="font-medium">{rows.length} 项更改尚未生效</span>
          <span className="text-muted-foreground">
            {!running ? '，下次启动时应用。' : eligible.length
              ? `，其中 ${eligible.length} 项参数可尝试在线应用。`
              : '，可在关机后重新启动时应用。'}
          </span>
        </p>
        {running && params && (
          <Button size="sm" disabled={busy || status.isError || !status.data} onClick={() => void apply()}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Zap />}
            {busy ? '正在应用…' : '尝试在线应用'}
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={busy} onClick={onRevertAll}><RotateCcw />全部撤销</Button>
      </div>
      {running && <details className="mt-2 text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer py-1">查看应用方式</summary>
        <ul className="mt-2 grid gap-2">
          {changes.map((c) => <li key={c.key} className="flex flex-wrap gap-x-2 gap-y-1">
            <span className="text-foreground">{rows.find((r) => (r.keys ?? [r.key]).includes(c.key))?.title} · {c.key}</span>
            <span>{c.mode === 'online' ? '可尝试在线应用' : c.mode === 'restart' ? '需要关机后启动' : '需单独确认'}：{c.reason}{c.privilege && !can(c.privilege) ? '（当前账号无修改权限）' : ''}</span>
          </li>)}
        </ul>
        <p className="mt-2">保存时 PVE 已尝试在线应用。重试后会核对实际结果；客户机系统仍需支持相应设备热插拔。</p>
        {state.current.lock && <p className="mt-1">虚拟机已锁定，暂不能在线应用。</p>}
      </details>}
    </div>
  )
}
