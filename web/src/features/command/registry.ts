// All command palette commands. Areas append to their own commands.ts;
// add a new area's list here once.

import { consoleCommands } from '@/features/console/commands'
import { guestBackupCommands } from '@/features/guest-backup/commands'
import { guestCoreCommands } from '@/features/guest-core/commands'
import { guestCreateCommands } from '@/features/guest-create/commands'
import { guestLifecycleCommands } from '@/features/guest-lifecycle/commands'
import { nodeSummaryCommands } from '@/features/node-summary/commands'
import { tasksCommands } from '@/features/tasks/commands'

import type { CommandDef, GlobalCommand, GuestCommand, NodeCommand } from './types'

export const commands: CommandDef[] = [
  ...guestCoreCommands,
  ...consoleCommands,
  ...guestBackupCommands,
  ...guestLifecycleCommands,
  ...guestCreateCommands,
  ...nodeSummaryCommands,
  ...tasksCommands,
]

export const globalCommands = (): GlobalCommand[] =>
  commands.filter((c): c is GlobalCommand => c.scope === 'global').sort((a, b) => a.order - b.order)
export const guestCommands = (): GuestCommand[] =>
  commands.filter((c): c is GuestCommand => c.scope === 'guest').sort((a, b) => a.order - b.order)
export const nodeCommands = (): NodeCommand[] =>
  commands.filter((c): c is NodeCommand => c.scope === 'node').sort((a, b) => a.order - b.order)
