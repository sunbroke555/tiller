// Shared state of the qemu-config tabs: the guest, its config (pending
// applied) with the digest, and helpers that write config changes as tasks.

import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react'

import type { Params } from '@/api/client'
import { revertQemuPending, writeQemuConfig } from '@/api/qemu-config'
import { usePermissions } from '@/api/permissions'
import { queryKeys } from '@/api/queries'
import { useSession } from '@/api/useSession'
import { runTask } from '@/components/tasks/tracker'
import type { GuestResource } from '@/api/types'

import type { Arch } from './constants'
import { guestArch, type Config, type PendingState } from './model'

export interface QemuConfigContextValue {
  node: string
  vmid: number
  guest: GuestResource
  /** Config after pending changes (what the editors start from). */
  cfg: Config
  digest: string | undefined
  state: PendingState
  arch: Arch
  running: boolean
  isRoot: boolean
  /**
   * Permission check: on this VM (vms), this node (nodes), or anywhere under
   * /mapping or /storage. Uses the user's permission map, the ticket caps
   * until it has loaded (true when unknown; PVE checks anyway).
   */
  can: (priv: string, scope?: 'vms' | 'nodes' | 'mapping' | 'storage') => boolean
}

const Ctx = createContext<QemuConfigContextValue | null>(null)

export function QemuConfigProvider({ value, children }: { value: QemuConfigContextValue; children: ReactNode }) {
  return <Ctx value={value}>{children}</Ctx>
}

export function useQemuConfig(): QemuConfigContextValue {
  const v = use(Ctx)
  if (!v) throw new Error('useQemuConfig outside QemuConfigProvider')
  return v
}

/** Builds the context value from the pending state. */
export function useQemuConfigValue(
  node: string,
  vmid: number,
  guest: GuestResource,
  state: PendingState,
): QemuConfigContextValue {
  const session = useSession()
  const perms = usePermissions()
  return useMemo(() => {
    return {
      node,
      vmid,
      guest,
      cfg: state.next,
      digest: state.digest,
      state,
      arch: guestArch(state.next),
      running: guest.status === 'running',
      isRoot: session?.username === 'root@pam',
      can: (priv, scope = 'vms') => {
        switch (scope) {
          case 'vms':
            return perms.can({ privs: priv }, { kind: 'guest', vmid, pool: guest.pool })
          case 'nodes':
            return perms.can({ privs: priv }, { kind: 'node', node })
          default:
            return perms.can({ privs: priv, path: `/${scope}`, anywhere: true })
        }
      },
    }
  }, [node, vmid, guest, state, session, perms])
}

export function guestInvalidation(node: string, vmid: number) {
  return [queryKeys.guest(node, 'qemu', vmid), queryKeys.resources()]
}

/**
 * Save config params as a task. Resolves when the API call succeeded (the
 * dialog can close), rejects with the API error (FormDialog shows it).
 * `null` params (nothing changed) resolve immediately.
 */
export function useSaveConfig() {
  const { node, vmid } = useQemuConfig()
  return useCallback(
    (params: Params | null, opts: { title: string; async?: boolean; message?: string }) => {
      if (!params) return Promise.resolve(null)
      return runTask(writeQemuConfig(node, vmid, params, { async: opts.async }), {
        title: opts.title,
        invalidate: guestInvalidation(node, vmid),
        syncSuccessMessage: opts.message ?? `${opts.title}：已保存`,
      })
    },
    [node, vmid],
  )
}

export function useRevert() {
  const { node, vmid } = useQemuConfig()
  return useCallback(
    (keys: readonly string[], title: string) =>
      runTask(revertQemuPending(node, vmid, keys), {
        title,
        invalidate: guestInvalidation(node, vmid),
        syncSuccessMessage: '已撤销未生效的更改',
      }),
    [node, vmid],
  )
}

// ------------------------------------------------------------ dialog host

export interface DialogRenderProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Render = (props: DialogRenderProps) => ReactNode

/**
 * One dialog at a time, mounted when opened (so it starts from the current
 * config) and unmounted after its close animation.
 */
export function useDialogHost() {
  const [entry, setEntry] = useState<{ id: number; render: Render; open: boolean } | null>(null)
  const show = useCallback((render: Render) => setEntry({ id: Date.now(), render, open: true }), [])
  const onOpenChange = useCallback((open: boolean) => {
    if (open) return
    setEntry((e) => (e ? { ...e, open: false } : e))
    window.setTimeout(() => setEntry((e) => (e && !e.open ? null : e)), 350)
  }, [])
  const host = entry ? <DialogSlot key={entry.id} render={entry.render} open={entry.open} onOpenChange={onOpenChange} /> : null
  return { show, host }
}

function DialogSlot({ render, open, onOpenChange }: { render: Render; open: boolean; onOpenChange: (o: boolean) => void }) {
  return <>{render({ open, onOpenChange })}</>
}
