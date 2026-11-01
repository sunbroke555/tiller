import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

import { get, isPveApiError } from '@/api/client'
import { queryKeys } from '@/api/queries'
import type { ClusterResource, GuestType } from '@/api/types'
import { runTask } from '@/components/tasks/tracker'
import { errorMessage } from '@/lib/errors'
import { guestPath } from '@/lib/resources'

import type { CreateState } from './Review'

export interface SubmitError {
  message: string
  /** Per-parameter errors from PVE ({ vmid: "…already exists" }). */
  fields: Record<string, string>
}

/**
 * /cluster/resources lags a few seconds behind a new guest; the guest page
 * shows "not found" until it is listed, so wait for it (max ~20 s).
 */
export async function waitForGuestListed(qc: QueryClient, vmid: number, tries = 20, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      const list = await qc.fetchQuery({
        queryKey: queryKeys.resources(),
        queryFn: ({ signal }) => get<ClusterResource[]>('/cluster/resources', undefined, { signal }),
        staleTime: 0,
      })
      if (list.some((r) => (r.type === 'qemu' || r.type === 'lxc') && r.vmid === vmid)) return true
    } catch {
      // keep trying
    }
    await new Promise((r) => setTimeout(r, delayMs))
  }
  return false
}

/**
 * Submit a create call through runTask, follow the task and open the new
 * guest when it is done. Validation errors of the call itself come back as
 * `error` (with per-field messages); a failed task leaves state "failed".
 */
export function useCreateFlow(type: GuestType) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [state, setState] = useState<CreateState>({ phase: 'idle' })
  const [error, setError] = useState<SubmitError | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const submit = async (node: string, vmid: number, call: () => Promise<string>, title: string) => {
    setError(null)
    setState({ phase: 'running', upid: null, node })
    let handle
    try {
      handle = await runTask(call(), { title })
    } catch (e) {
      if (!mounted.current) return
      setState({ phase: 'idle' })
      setError({
        message: isPveApiError(e) ? e.message : errorMessage(e),
        fields: isPveApiError(e) ? Object.fromEntries(Object.entries(e.errors ?? {}).map(([k, v]) => [k, v.trim()])) : {},
      })
      return
    }
    if (!mounted.current) return
    setState({ phase: 'running', upid: handle.upid, node })
    const outcome = await handle.done
    if (!mounted.current) return
    if (outcome.state === 'error') {
      setState({ phase: 'failed', upid: handle.upid, node, exitstatus: outcome.exitstatus })
      return
    }
    setState({ phase: 'opening', upid: handle.upid, node })
    await waitForGuestListed(qc, vmid)
    if (mounted.current) navigate(guestPath({ node, type, vmid }), { replace: true })
  }

  const busy = state.phase === 'running' || state.phase === 'opening'
  return { state, error, busy, submit, clearError: () => setError(null) }
}
