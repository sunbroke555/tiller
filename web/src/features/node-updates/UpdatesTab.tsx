import { useSearchParams } from 'react-router'

import { useAptUpdates } from '@/api/node-updates'
import { usePermissions } from '@/api/permissions'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { NodeTabProps } from '@/features/node/types'

import { InstalledVersions } from './InstalledVersions'
import { PackageUpdates } from './PackageUpdates'
import { parseUpdatesView, UPDATES_VIEWS, type UpdatesView } from './paths'
import { Repositories } from './Repositories'

/**
 * Node "更新" tab: pending package updates (refresh, changelog, upgrade in a
 * shell), the APT repositories and the installed Proxmox package versions.
 * The view is in ?view= so it can be linked to.
 */
export default function UpdatesTab({ node }: NodeTabProps) {
  const [params, setParams] = useSearchParams()
  const canModify = usePermissions().can({ privs: 'Sys.Modify' }, { kind: 'node', node })
  const view = parseUpdatesView(params.get('view'), canModify)
  // Shared with the list below (same query), only for the count on the switch.
  const updates = useAptUpdates(node, { enabled: canModify })

  const setView = (v: UpdatesView) => {
    const next = new URLSearchParams(params)
    if (v === parseUpdatesView(null, canModify)) next.delete('view')
    else next.set('view', v)
    setParams(next, { replace: true })
  }

  return (
    <div className="grid gap-(--section-gap)">
      <ToggleGroup
        type="single"
        value={view}
        onValueChange={(v) => v && setView(v as UpdatesView)}
        variant="outline"
        aria-label="视图"
        className="w-full sm:w-auto"
      >
        {UPDATES_VIEWS.map((v) => (
          <ToggleGroupItem key={v.id} value={v.id} className="flex-1 px-4 text-[13px] sm:flex-none">
            {v.label}
            {v.id === 'updates' && updates.data && updates.data.length > 0 && (
              <span className="ml-1 rounded-full bg-brand/15 px-1.5 text-[11px] leading-4 font-medium text-brand-strong tabular paper:bg-secondary paper:text-foreground">
                {updates.data.length}
              </span>
            )}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {view === 'updates' && <PackageUpdates node={node} canModify={canModify} />}
      {view === 'repositories' && <Repositories node={node} canModify={canModify} />}
      {view === 'versions' && <InstalledVersions node={node} />}
    </div>
  )
}
