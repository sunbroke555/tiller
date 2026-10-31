// Contracts for the guest (VM / CT) detail page. Areas implement tabs and
// actions against these types; see registry.ts and docs/CONTRIBUTING-AREAS.md.

import { createContext, use } from 'react'
import type { NavigateFunction } from 'react-router'

import type { GuestResource, GuestType } from '@/api/types'
import type { ActionDef, TabDef } from '@/components/page/registry'

/** Props every guest tab component receives. */
export interface GuestTabProps {
  node: string
  type: GuestType
  vmid: number
  /** Live entry from /cluster/resources (status, name, tags, lock, template, usage). */
  guest: GuestResource
}

/** What guest actions get: the tab props plus a display name and navigation. */
export interface GuestActionContext extends GuestTabProps {
  /** guest.name or "VM 100" / "CT 100". */
  name: string
  navigate: NavigateFunction
}

export interface GuestTabDef extends TabDef<GuestTabProps> {
  /** Guest types that have this tab. */
  types: readonly GuestType[]
}

export interface GuestActionDef extends ActionDef<GuestActionContext> {
  /** Guest types the action applies to (default both). */
  types?: readonly GuestType[]
}

export const BOTH: readonly GuestType[] = ['qemu', 'lxc']
export const QEMU: readonly GuestType[] = ['qemu']
export const LXC: readonly GuestType[] = ['lxc']

const GuestContext = createContext<GuestActionContext | null>(null)
export const GuestContextProvider = GuestContext.Provider

/** The current guest, for components deep inside a guest tab. */
export function useGuestContext(): GuestActionContext {
  const ctx = use(GuestContext)
  if (!ctx) throw new Error('useGuestContext must be used inside the guest page')
  return ctx
}
