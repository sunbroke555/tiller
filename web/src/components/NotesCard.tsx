import { useEffect, useState, type ReactNode } from 'react'
import { NotebookPen, Pencil } from 'lucide-react'

import { FormDialog } from '@/components/form'
import { GlassCard } from '@/components/GlassCard'
import { Markdown } from '@/components/Markdown'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface NotesCardProps {
  /** Markdown; empty/undefined shows the empty hint. */
  text: string | undefined
  /** Omit (or false) for read-only notes. */
  onSave?: ((text: string) => Promise<unknown>) | false
  title?: ReactNode
  /** Shown when there are no notes. */
  emptyHint?: string
  loading?: boolean
  className?: string
}

/**
 * Markdown notes (datacenter, node, guest, pool description): rendered
 * safely, edited in a sheet with a live preview. Shared by every area.
 */
export function NotesCard({ text, onSave, title = '备注', emptyHint = '还没有备注。', loading, className }: NotesCardProps) {
  const [open, setOpen] = useState(false)
  const value = text ?? ''
  return (
    <GlassCard className={cn('relative', className)}>
      <div className="mb-2 flex items-center gap-2">
        <NotebookPen className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-medium">{title}</h3>
        {onSave && (
          <Button variant="ghost" size="sm" className="ml-auto -mr-2 h-8 gap-1.5 text-muted-foreground" onClick={() => setOpen(true)} disabled={loading}>
            <Pencil className="size-3.5" /> 编辑
          </Button>
        )}
      </div>
      {loading ? (
        <div className="h-10" aria-busy="true" />
      ) : value.trim() ? (
        <Markdown source={value} className="max-h-[28rem] overflow-y-auto" />
      ) : (
        <p className="text-sm text-muted-foreground">
          {emptyHint}
          {onSave && (
            <>
              {' '}
              <button type="button" onClick={() => setOpen(true)} className="text-brand underline-offset-2 hover:underline">
                添加备注
              </button>
            </>
          )}
        </p>
      )}
      {onSave && <NotesEditor open={open} onOpenChange={setOpen} initial={value} onSave={onSave} title={title} />}
    </GlassCard>
  )
}

function NotesEditor({
  open,
  onOpenChange,
  initial,
  onSave,
  title,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initial: string
  onSave: (text: string) => Promise<unknown>
  title: ReactNode
}) {
  const [draft, setDraft] = useState(initial)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  useEffect(() => {
    if (open) {
      setDraft(initial)
      setMode('edit')
    }
  }, [open, initial])

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={<>编辑{title}</>}
      description="支持 Markdown：标题、列表、链接、代码、表格。"
      size="lg"
      submitDisabled={draft === initial}
      onSubmit={() => onSave(draft)}
    >
      <Tabs value={mode} onValueChange={(v) => setMode(v as 'edit' | 'preview')} className="mb-3">
        <TabsList>
          <TabsTrigger value="edit">编辑</TabsTrigger>
          <TabsTrigger value="preview">预览</TabsTrigger>
        </TabsList>
      </Tabs>
      {mode === 'edit' ? (
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="备注内容"
          rows={12}
          className="min-h-56 font-mono text-[13px] leading-relaxed"
          placeholder={'# 标题\n\n- 维护窗口：周六 02:00\n- 负责人：…'}
          autoFocus
        />
      ) : (
        <div className="min-h-56 rounded-xl border border-border p-3.5">
          {draft.trim() ? <Markdown source={draft} /> : <p className="text-sm text-muted-foreground">（空）</p>}
        </div>
      )}
    </FormDialog>
  )
}
