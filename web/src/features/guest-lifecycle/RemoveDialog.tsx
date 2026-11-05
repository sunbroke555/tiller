import { useEffect, useId, useState } from 'react'
import { ShieldOff } from 'lucide-react'

import { useGuestConfig } from '@/api/guest-core'
import { destroyGuest, setGuestConfig } from '@/api/guest-lifecycle'
import { appPathname } from '@/api/instance-scope'
import { CheckboxField, FormDialog, FormField } from '@/components/form'
import type { ActionDialogProps } from '@/components/page/registry'
import { fireTask, runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { GuestActionContext } from '@/features/guest/types'
import { isGuestPathname } from '@/lib/resources'

import { Notice } from './notes'
import { destroyParams } from './params'

/**
 * Delete a guest (official SafeDestroyGuest): type the VMID to confirm, purge
 * from jobs, destroy unreferenced disks; CTs can be force-deleted while
 * running. A protected guest offers to lift the protection first.
 */
export default function RemoveDialog({ ctx, open, onOpenChange }: ActionDialogProps<GuestActionContext>) {
  const { node, type, vmid, guest, name, navigate } = ctx
  const qemu = type === 'qemu'
  const kind = qemu ? '虚拟机' : '容器'
  const inputId = useId()
  const [typed, setTyped] = useState('')
  const [purge, setPurge] = useState(false)
  const [destroyUnreferenced, setDestroyUnreferenced] = useState(false)
  const [force, setForce] = useState(false)
  const config = useGuestConfig(node, type, vmid, { enabled: open })
  const protectedGuest = config.data?.protection === 1

  useEffect(() => {
    if (open) {
      setTyped('')
      setPurge(false)
      setDestroyUnreferenced(false)
      setForce(false)
    }
  }, [open])

  const running = guest.status !== 'stopped'
  const blockedByRunning = running && (qemu || !force)
  const confirmed = typed.trim() === String(vmid)
  const canSubmit = confirmed && !protectedGuest && !blockedByRunning && !config.isPending

  const submit = () =>
    runTask(destroyGuest(node, type, vmid, destroyParams(type, { purge, destroyUnreferenced, force })), {
      title: `删除 ${name}`,
      onSuccess: () => {
        // Leave the page of the guest that no longer exists.
        if (isGuestPathname(appPathname(window.location.pathname), guest)) navigate('/', { replace: true })
      },
    })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`删除 ${name}？`}
      description={`${kind} ${vmid} 的配置和它引用的所有磁盘都会被永久删除，无法恢复。`}
      size="sm"
      submitLabel="删除"
      destructive
      submitDisabled={!canSubmit}
      onSubmit={submit}
    >
      {protectedGuest && (
        <Notice tone="warn" title="已启用删除保护">
          <span className="mb-2 block">取消保护后才能删除。</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="pointer-coarse:h-10"
            onClick={() =>
              fireTask(setGuestConfig(node, type, vmid, { delete: 'protection', digest: config.data?.digest }), {
                title: `取消 ${name} 的删除保护`,
                syncSuccessMessage: '已取消删除保护',
              })
            }
          >
            <ShieldOff /> 取消保护
          </Button>
        </Notice>
      )}
      {running && qemu && (
        <Notice tone="warn" title="虚拟机还在运行">
          请先关机或强制停止后再删除。
        </Notice>
      )}
      {running && !qemu && (
        <CheckboxField
          label="强制删除"
          description="容器正在运行，勾选后会先停止再删除。"
          checked={force}
          onCheckedChange={setForce}
        />
      )}

      <div className="grid gap-1">
        <CheckboxField
          label="从任务配置中移除"
          description="同时从备份任务、存储复制和 HA 配置中删除这台客户机。"
          checked={purge}
          onCheckedChange={setPurge}
        />
        <CheckboxField
          label="删除未引用的磁盘"
          description="扫描所有已启用的存储，删除属于它但不在配置中的磁盘。"
          checked={destroyUnreferenced}
          onCheckedChange={setDestroyUnreferenced}
        />
      </div>

      <FormField id={inputId} label={<span className="font-normal text-muted-foreground">请输入 <span className="font-medium text-foreground tabular">{vmid}</span> 以确认</span>}>
        <Input
          id={inputId}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={typed !== '' && !confirmed ? true : undefined}
        />
      </FormField>
    </FormDialog>
  )
}
