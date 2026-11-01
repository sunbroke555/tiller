import { useEffect, useState } from 'react'

import { FieldTextarea, FormDialog, FormField } from '@/components/form'
import { cn } from '@/lib/utils'

interface PasteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** noVNC types the text as key presses (US layout); xterm.js pastes it. */
  mode: 'terminal' | 'vnc'
  initialText?: string
  /** The guest has the VNC clipboard (vga clipboard=vnc): offer to set it instead of typing. */
  clipboard?: boolean
  onSend: (text: string, how: 'type' | 'clipboard') => void
}

/**
 * Fallback for "粘贴" when the browser does not let the page read the
 * clipboard (plain HTTP, iOS, permission denied): paste into a text box,
 * then send it to the console.
 */
export function PasteDialog({ open, onOpenChange, mode, initialText = '', clipboard, onSend }: PasteDialogProps) {
  const [text, setText] = useState(initialText)
  const [how, setHow] = useState<'type' | 'clipboard'>('type')
  useEffect(() => {
    if (open) setText(initialText)
  }, [open, initialText])
  const viaClipboard = mode === 'vnc' && clipboard && how === 'clipboard'

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="粘贴到控制台"
      description={
        viaClipboard
          ? '文字会写入客户机的剪贴板（需要客户机代理），再在客户机里粘贴。'
          : mode === 'vnc'
            ? '文字会按美式键盘逐个按键输入，只支持英文字符和符号。'
            : '长按下面的输入框粘贴，然后发送到终端。'
      }
      submitLabel="发送"
      submitDisabled={!text}
      onSubmit={() => onSend(text, viaClipboard ? 'clipboard' : 'type')}
      size="md"
    >
      {mode === 'vnc' && clipboard && (
        <div role="radiogroup" aria-label="粘贴方式" className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-foreground/[0.05] p-1 paper:bg-secondary">
          {(
            [
              ['type', '模拟按键输入'],
              ['clipboard', '写入客户机剪贴板'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={how === value}
              onClick={() => setHow(value)}
              className={cn(
                'h-9 rounded-lg text-sm font-medium transition-colors pointer-coarse:h-11',
                how === value
                  ? 'bg-background text-foreground shadow-sm ring-1 ring-border dark:bg-foreground/[0.12] dark:ring-0 paper:bg-card'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <FormField label="内容" name="text">
        <FieldTextarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          autoFocus
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="font-mono text-base md:text-sm"
          placeholder="在这里粘贴文字…"
        />
      </FormField>
    </FormDialog>
  )
}
