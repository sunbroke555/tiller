import { useEffect, useState } from 'react'
import { Eye, NotebookPen, Pencil } from 'lucide-react'

import { nodeKeys, updateNodeNotes, useNodeConfig } from '@/api/node-summary'
import { usePermissions } from '@/api/permissions'
import { FieldTextarea, FormDialog, FormField } from '@/components/form'
import { GlassCard } from '@/components/GlassCard'
import { Markdown } from '@/components/Markdown'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

/** Node notes (Markdown, /nodes/{node}/config description) with an editor. */
export function NotesCard({ node, className }: { node: string; className?: string }) {
  const config = useNodeConfig(node)
  const canEdit = usePermissions().can({ privs: 'Sys.Modify' }, { kind: 'node', node })
  const [editing, setEditing] = useState(false)
  const text = config.data?.description ?? ''

  return (
    <GlassCard className={cn('flex min-w-0 flex-col gap-3', className)} role="region" aria-label="备注">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">备注</h2>
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            className="-my-1 -mr-2 pointer-coarse:h-11"
            onClick={() => setEditing(true)}
            disabled={config.isPending}
            aria-label="编辑备注"
          >
            <Pencil /> 编辑
          </Button>
        )}
      </div>
      {config.isPending ? (
        <div className="grid gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : config.isError ? (
        <p className="text-sm text-muted-foreground">无法读取备注：{errorMessage(config.error)}</p>
      ) : text.trim() ? (
        <div className="max-h-80 overflow-y-auto overscroll-contain">
          <Markdown source={text} />
        </div>
      ) : !canEdit ? (
        <p className="text-sm text-muted-foreground">还没有备注。</p>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.03] hover:text-foreground"
        >
          <NotebookPen className="size-5" aria-hidden />
          还没有备注，点击添加（支持 Markdown）
        </button>
      )}
      <NotesDialog node={node} open={editing} onOpenChange={setEditing} initial={text} digest={config.data?.digest} />
    </GlassCard>
  )
}

function NotesDialog({
  node,
  open,
  onOpenChange,
  initial,
  digest,
}: {
  node: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: string
  digest?: string
}) {
  const [value, setValue] = useState(initial)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  useEffect(() => {
    if (open) {
      setValue(initial)
      setMode('edit')
    }
  }, [open, initial])

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="编辑备注"
      description={`节点 ${node} 的备注，支持 Markdown。`}
      size="lg"
      submitDisabled={value === initial}
      headerExtra={
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={mode}
          onValueChange={(v) => (v === 'edit' || v === 'preview') && setMode(v)}
          aria-label="显示方式"
        >
          <ToggleGroupItem value="edit" className="h-8 px-2.5 text-xs pointer-coarse:h-10" aria-label="编辑">
            <Pencil className="size-3.5" /> 编辑
          </ToggleGroupItem>
          <ToggleGroupItem value="preview" className="h-8 px-2.5 text-xs pointer-coarse:h-10" aria-label="预览">
            <Eye className="size-3.5" /> 预览
          </ToggleGroupItem>
        </ToggleGroup>
      }
      onSubmit={() =>
        runTask(updateNodeNotes(node, value, digest), {
          title: '保存节点备注',
          invalidate: [nodeKeys.config(node)],
          syncSuccessMessage: '备注已保存',
        })
      }
    >
      {mode === 'edit' ? (
        <FormField label="备注" name="description">
          <FieldTextarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={12}
            className="min-h-64 font-mono text-[13px] leading-relaxed"
            placeholder={'# 标题\n\n- 机房位置、用途、联系人……'}
            spellCheck={false}
          />
        </FormField>
      ) : (
        <div className="min-h-64 rounded-xl border border-border/60 p-4">
          {value.trim() ? <Markdown source={value} /> : <p className="text-sm text-muted-foreground">（空）</p>}
        </div>
      )}
    </FormDialog>
  )
}
