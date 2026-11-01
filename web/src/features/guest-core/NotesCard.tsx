import { useEffect, useState } from 'react'
import { NotebookPen, Pencil, Plus } from 'lucide-react'

import { updateGuestConfig, type GuestConfig } from '@/api/guest-core'
import type { GuestType } from '@/api/types'
import { FieldTextarea, FormDialog, FormField } from '@/components/form'
import { GlassCard } from '@/components/GlassCard'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { configUpdateParams } from '@/lib/propstring'

import { Markdown } from './markdown'
import { CardAction, CardTitle } from './parts'

interface NotesCardProps {
  node: string
  type: GuestType
  vmid: number
  name: string
  config: GuestConfig | undefined
  loading: boolean
}

/** Notes (config `description`, Markdown) with an editor sheet. */
export function NotesCard({ node, type, vmid, name, config, loading }: NotesCardProps) {
  const [open, setOpen] = useState(false)
  const notes = config?.description?.trim() ?? ''
  return (
    <GlassCard>
      <CardTitle
        title="备注"
        icon={NotebookPen}
        action={notes ? <CardAction label="编辑" icon={Pencil} onClick={() => setOpen(true)} /> : null}
      />
      {loading && !config ? (
        <div className="grid gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : notes ? (
        <div className="max-h-96 overflow-y-auto">
          <Markdown source={notes} />
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">还没有备注。可以记下用途、负责人、登录方式等，支持 Markdown。</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} className="pointer-coarse:h-11">
            <Plus /> 添加备注
          </Button>
        </div>
      )}
      <NotesDialog
        open={open}
        onOpenChange={setOpen}
        node={node}
        type={type}
        vmid={vmid}
        name={name}
        config={config}
      />
    </GlassCard>
  )
}

function NotesDialog({
  open,
  onOpenChange,
  node,
  type,
  vmid,
  name,
  config,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  node: string
  type: GuestType
  vmid: number
  name: string
  config: GuestConfig | undefined
}) {
  const [text, setText] = useState('')
  useEffect(() => {
    if (open) setText(config?.description ?? '')
    // Only when opening: keep what the user typed while the config refreshes.
  }, [open])

  const params = configUpdateParams(config, { description: text.trim() ? text : '' }, { digest: config?.digest })
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`编辑备注 · ${name}`}
      description="支持 Markdown：# 标题、- 列表、**粗体**、`代码`、[链接](https://…)。"
      size="lg"
      submitDisabled={!params}
      onSubmit={() =>
        runTask(updateGuestConfig(node, type, vmid, params!), { title: `更新 ${name} 的备注`, syncSuccessMessage: '备注已保存' })
      }
    >
      <FormField label="备注" name="description">
        <FieldTextarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          className="min-h-56 font-mono text-[13px] leading-relaxed"
          placeholder={'例如：\n# 用途\n内网 DNS 服务器\n\n- 负责人：张三'}
        />
      </FormField>
    </FormDialog>
  )
}
