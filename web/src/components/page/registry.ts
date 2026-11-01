// Shared shapes for the plug-in registries of the detail pages (guest, node,
// storage). An area adds a tab or an action by adding an object to a list;
// the page shells render them. See docs/CONTRIBUTING-AREAS.md.

import type { ComponentType, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import type { PermissionCheck } from '@/lib/permissions'

// ------------------------------------------------------------------- tabs

export interface TabDef<P> {
  /** URL segment: /guest/pve/qemu/100/<id>. Unique per page (and guest type). */
  id: string
  title: string
  icon?: LucideIcon
  /** Sort key; gaps of 10 leave room for later tabs. */
  order: number
  /** Usually `lazy(() => import('@/features/<area>/XTab'))` so each area is its own chunk. */
  component: ComponentType<P>
  /** Hide the tab in some contexts (e.g. no backup tab for templates). */
  visible?: (props: P) => boolean
}

export function sortByOrder<T extends { order: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order)
}

// ---------------------------------------------------------------- actions

export interface ConfirmSpec {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  destructive?: boolean
  /** Require typing this text (name or ID) — for irreversible actions. */
  typeToConfirm?: string
}

export interface ActionDialogProps<Ctx> {
  ctx: Ctx
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * A page action (start, shutdown, migrate, backup now…). Exactly one of
 * `run` (optionally behind `confirm`) or `dialog` should be set.
 *
 * `run` should return the promise of runTask(...) so a confirm dialog stays
 * busy until the task started, and shows the error if it could not start.
 */
export interface ActionDef<Ctx> {
  id: string
  label: string | ((ctx: Ctx) => string)
  icon?: LucideIcon
  order: number
  /**
   * 'primary': a button in the action bar (desktop top bar, mobile bottom
   * bar; keep to ≤3 visible at a time). 'menu' (default): in the "更多" menu.
   */
  placement?: 'primary' | 'menu'
  /** Menu section heading, e.g. "电源", "管理". */
  section?: string
  destructive?: boolean
  /** Hide in some states (e.g. "启动" only when stopped). */
  visible?: (ctx: Ctx) => boolean
  /** Return a reason string to show the action disabled with that hint. */
  disabled?: (ctx: Ctx) => string | false | null | undefined
  run?: (ctx: Ctx) => unknown
  /** Ask before `run`. */
  confirm?: (ctx: Ctx) => ConfirmSpec
  /** Open this dialog instead (usually a FormDialog), lazily imported is fine. */
  dialog?: ComponentType<ActionDialogProps<Ctx>>
  /**
   * Privileges the action needs; it is hidden when the user lacks them.
   * `path` defaults to the page's object (guest: /vms/<vmid> + its pool,
   * node: /nodes/<node>, storage: /storage/<id>). Omitted: a default by `id`
   * from lib/permissions.ts (start → VM.PowerMgmt …); null: never checked.
   */
  permission?: PermissionCheck | ((ctx: Ctx) => PermissionCheck | null | undefined) | null
}

export function actionLabel<Ctx>(action: ActionDef<Ctx>, ctx: Ctx): string {
  return typeof action.label === 'function' ? action.label(ctx) : action.label
}

/**
 * Visible actions in order. `allowed` (from usePermissions + allowedFor)
 * drops the actions the user has no privileges for.
 */
export function visibleActions<Ctx>(
  actions: readonly ActionDef<Ctx>[],
  ctx: Ctx,
  allowed?: (action: ActionDef<Ctx>) => boolean,
): ActionDef<Ctx>[] {
  return sortByOrder(actions.filter((a) => (a.visible?.(ctx) ?? true) && (allowed?.(a) ?? true)))
}
