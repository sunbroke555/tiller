import { nodeShellPath } from '@/lib/resources'

/**
 * Full-screen node shell running `pveupgrade --shell` (termproxy cmd=upgrade),
 * what the official "Upgrade" button opens. Only root@pam may run it.
 */
export function nodeUpgradePath(node: string): string {
  return `${nodeShellPath(node)}?cmd=upgrade`
}

export const UPGRADE_USER = 'root@pam'

export type UpdatesView = 'updates' | 'repositories' | 'versions'

export const UPDATES_VIEWS: readonly { id: UpdatesView; label: string }[] = [
  { id: 'updates', label: '可更新' },
  { id: 'repositories', label: '软件源' },
  { id: 'versions', label: '软件包版本' },
]

/** ?view=… of the tab; without Sys.Modify the package list is not readable, so start on the repositories. */
export function parseUpdatesView(value: string | null, canModify: boolean): UpdatesView {
  if (value === 'repositories' || value === 'versions' || value === 'updates') return value
  return canModify ? 'updates' : 'repositories'
}
