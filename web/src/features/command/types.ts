// Command palette actions (Ctrl/⌘K). Areas add commands in their own
// features/<area>/commands.ts; features/command/registry.ts collects them.

import type { LucideIcon } from 'lucide-react'
import type { NavigateFunction } from 'react-router'

import type { ClusterResource, GuestResource, GuestType, NodeResource } from '@/api/types'
import type { ConfirmSpec } from '@/components/page/registry'
import type { PermissionCheck } from '@/lib/permissions'

export interface CommandContext {
  navigate: NavigateFunction
  /** Latest /cluster/resources. */
  resources: ClusterResource[]
}

interface CommandBase {
  /** Unique across all commands. */
  id: string
  icon?: LucideIcon
  /** Extra search words (English verbs help: "start", "reboot"). */
  keywords?: readonly string[]
  order: number
  destructive?: boolean
  /**
   * Privileges needed (hidden without them). Path defaults to the guest /
   * node the command applies to ("/" for global commands). Omitted: default
   * by id from lib/permissions.ts; null: never checked.
   */
  permission?: PermissionCheck | null
}

/** Always listed, e.g. "创建虚拟机". */
export interface GlobalCommand extends CommandBase {
  scope: 'global'
  label: string
  /** Group heading; default "操作". */
  group?: string
  visible?: (ctx: CommandContext) => boolean
  confirm?: (ctx: CommandContext) => ConfirmSpec
  run: (ctx: CommandContext) => unknown
}

/**
 * Applies to one guest: listed for the guest page being viewed, and for every
 * matching guest while the user types a search ("启动 web-01").
 */
export interface GuestCommand extends CommandBase {
  scope: 'guest'
  /** Verb; the palette shows "<label> <guest name>". */
  label: string
  types?: readonly GuestType[]
  visible?: (guest: GuestResource, ctx: CommandContext) => boolean
  confirm?: (guest: GuestResource, ctx: CommandContext) => ConfirmSpec
  /** Return runTask(...) so failures to start are reported. */
  run: (guest: GuestResource, ctx: CommandContext) => unknown
}

/** Applies to one node, like GuestCommand. */
export interface NodeCommand extends CommandBase {
  scope: 'node'
  label: string
  visible?: (node: NodeResource, ctx: CommandContext) => boolean
  confirm?: (node: NodeResource, ctx: CommandContext) => ConfirmSpec
  run: (node: NodeResource, ctx: CommandContext) => unknown
}

export type CommandDef = GlobalCommand | GuestCommand | NodeCommand
