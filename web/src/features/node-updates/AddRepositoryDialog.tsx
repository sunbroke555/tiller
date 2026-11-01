import { useEffect, useId, useState } from 'react'

import { addStandardRepository, updateKeys, type AptRepositories } from '@/api/node-updates'
import { FormDialog } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'

import { STANDARD_REPO_STATUS_LABEL, standardRepoDescription, standardRepoStatus } from './updates'

/**
 * Add a standard repository (PUT apt/repositories handle). One that is
 * configured but disabled gets enabled in place; enabled ones cannot be picked
 * (Proxmox.window.APTRepositoryAdd: "… is already configured").
 */
export function AddRepositoryDialog({
  node,
  data,
  open,
  onOpenChange,
}: {
  node: string
  data: AptRepositories
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const repos = data['standard-repos'] ?? []
  const firstFree = repos.find((r) => standardRepoStatus(r) !== 'enabled')?.handle
  const [handle, setHandle] = useState<string | undefined>(firstFree)
  const baseId = useId()

  useEffect(() => {
    // Reset on open only; firstFree changes after a refetch while open.
    if (open) setHandle(firstFree)
  }, [open])

  const picked = repos.find((r) => r.handle === handle)
  const pickedStatus = picked ? standardRepoStatus(picked) : null

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="添加软件源"
      description={`为节点 ${node} 添加 Proxmox 标准软件源。`}
      size="lg"
      submitLabel={pickedStatus === 'disabled' ? '启用' : '添加'}
      submitDisabled={!picked || pickedStatus === 'enabled'}
      dirty={false}
      onSubmit={() =>
        runTask(addStandardRepository(node, picked!.handle, data.digest), {
          title: `添加软件源 ${picked!.name}`,
          syncSuccessMessage: pickedStatus === 'disabled' ? `已启用软件源 ${picked!.name}` : `已添加软件源 ${picked!.name}`,
          invalidate: [updateKeys.repositories(node)],
        })
      }
    >
      <RadioGroup value={handle ?? ''} onValueChange={setHandle} aria-label="软件源" className="gap-2">
        {repos.map((r) => {
          const status = standardRepoStatus(r)
          const id = `${baseId}-${r.handle}`
          const taken = status === 'enabled'
          return (
            <label
              key={r.handle}
              htmlFor={id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 ring-1 ring-border/70 transition-colors ring-inset',
                'has-[[data-state=checked]]:bg-brand/8 has-[[data-state=checked]]:ring-brand/40 paper:has-[[data-state=checked]]:bg-secondary',
                taken && 'cursor-not-allowed opacity-60',
              )}
            >
              <RadioGroupItem
                id={id}
                value={r.handle}
                disabled={taken}
                aria-label={r.name}
                aria-describedby={`${id}-desc`}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1" id={`${id}-desc`}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">{r.name}</span>
                  <span
                    className={cn(
                      'text-[11px]',
                      status === 'enabled' ? 'text-success-strong' : status === 'disabled' ? 'text-warning-strong' : 'text-muted-foreground',
                    )}
                  >
                    {STANDARD_REPO_STATUS_LABEL[status]}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{standardRepoDescription(r)}</p>
                {handle === r.handle && status === 'disabled' && (
                  <p className="mt-1 text-xs text-warning-strong">这个软件源已经配置但被禁用，确认后会直接启用它。</p>
                )}
              </div>
            </label>
          )
        })}
      </RadioGroup>
    </FormDialog>
  )
}
