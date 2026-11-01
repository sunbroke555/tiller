import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'

import { backupJobKeys, deleteBackupJob, startVzdump, updateBackupJob, type BackupJob } from '@/api/backup-jobs'
import { usePermissions } from '@/api/permissions'
import { useClusterResources } from '@/api/queries'
import { isNode } from '@/api/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { runTask } from '@/components/tasks/tracker'

import { JobEditDialog } from './JobEditDialog'
import { describeSelection, isJobEnabled, runNowParams, runNowTargets } from './logic'

export interface JobActions {
  canModify: boolean
  create: () => void
  edit: (job: BackupJob) => void
  runNow: (job: BackupJob) => void
  remove: (job: BackupJob) => void
  toggle: (job: BackupJob) => Promise<unknown>
  /** Render once: the dialogs. */
  host: ReactNode
}

export function jobTitle(job: Pick<BackupJob, 'id' | 'comment'>): string {
  return job.comment?.trim() || job.id
}

/** Dialogs and handlers for job actions, shared by the list and the detail page. */
export function useJobActions(opts: { afterDelete?: string } = {}): JobActions {
  const perms = usePermissions()
  const canModify = perms.can({ privs: 'Sys.Modify' })
  const navigate = useNavigate()
  const nodes = useClusterResources({ select: (all) => all.filter(isNode) })
  const [editing, setEditing] = useState<{ open: boolean; id: string | null }>({ open: false, id: null })
  const [running, setRunning] = useState<BackupJob | null>(null)
  const [removing, setRemoving] = useState<BackupJob | null>(null)

  const targets = running ? runNowTargets(running, nodes.data ?? []) : { nodes: [], errors: [] }

  const host = (
    <>
      <JobEditDialog open={editing.open} onOpenChange={(open) => setEditing((s) => ({ ...s, open }))} jobId={editing.id} />
      <ConfirmDialog
        open={!!running}
        onOpenChange={(o) => !o && setRunning(null)}
        title="立即运行这个备份计划？"
        description={
          running && (
            <span className="grid gap-1">
              <span>
                {jobTitle(running)}：备份 {describeSelection(running)} 到 {running.storage}。
              </span>
              {targets.nodes.length > 0 && <span>在节点 {targets.nodes.join('、')} 上开始备份任务。</span>}
              {targets.errors.length > 0 && <span className="text-destructive">{targets.errors.join('；')}</span>}
            </span>
          )
        }
        confirmLabel="立即运行"
        onConfirm={async () => {
          const job = running!
          const t = runNowTargets(job, nodes.data ?? [])
          if (t.nodes.length === 0) throw new Error(t.errors.join('；') || '没有在线的节点')
          const params = runNowParams(job)
          const results = await Promise.allSettled(
            t.nodes.map((node) => runTask(startVzdump(node, params), { title: `备份计划 ${jobTitle(job)}（${node}）` })),
          )
          const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [`${t.nodes[i]}：${(r.reason as Error).message}`] : []))
          const problems = [...t.errors, ...failed]
          if (failed.length === t.nodes.length) throw new Error(problems.join('；'))
          if (problems.length) toast.error(`部分节点没有启动：${problems.join('；')}`)
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="删除这个备份计划？"
        description={removing && `${jobTitle(removing)}。已经产生的备份不会被删除。`}
        confirmLabel="删除"
        destructive
        typeToConfirm={removing?.id}
        onConfirm={async () => {
          const job = removing!
          await runTask(deleteBackupJob(job.id), {
            title: `删除备份计划 ${jobTitle(job)}`,
            invalidate: [backupJobKeys.all()],
          })
          if (opts.afterDelete) navigate(opts.afterDelete, { replace: true })
        }}
      />
    </>
  )

  return {
    canModify,
    create: () => setEditing({ open: true, id: null }),
    edit: (job) => setEditing({ open: true, id: job.id }),
    runNow: setRunning,
    remove: setRemoving,
    toggle: (job) => {
      const enable = !isJobEnabled(job)
      return runTask(updateBackupJob(job.id, { enabled: enable ? 1 : 0 }), {
        title: `${enable ? '启用' : '停用'}备份计划 ${jobTitle(job)}`,
        invalidate: [backupJobKeys.all()],
      }).catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
    },
    host,
  }
}
