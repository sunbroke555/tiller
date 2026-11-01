// Special-key bar for phones (and optional on desktop): keys a soft keyboard
// lacks. Buttons never take focus, so the on-screen keyboard stays open.

import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ClipboardPaste,
  Keyboard,
  KeyboardOff,
} from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import { FUNCTION_KEYS, type Modifiers, type SpecialKey } from './keys'

export interface KeyBarProps {
  /** noVNC consoles get Ctrl+Alt+Del. */
  mode: 'terminal' | 'vnc'
  modifiers: Modifiers
  onToggleModifier: (m: keyof Modifiers) => void
  onKey: (key: SpecialKey) => void
  /** A character with forced modifiers, e.g. ^C. */
  onChar: (ch: string, mods: Modifiers) => void
  onPaste: () => void
  onCtrlAltDel?: () => void
  onKeyboard: () => void
  keyboardOpen: boolean
  /** Landscape phone: tighter padding. */
  compact?: boolean
  className?: string
}

const REPEAT_DELAY = 380
const REPEAT_EVERY = 70

/** Keep focus where it is (the terminal / keyboard textarea). */
function keepFocus(e: PointerEvent) {
  e.preventDefault()
}

function Key({
  children,
  label,
  onPress,
  repeat,
  active,
  wide,
  className,
}: {
  children: ReactNode
  label: string
  onPress: () => void
  repeat?: boolean
  active?: boolean
  wide?: boolean
  className?: string
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const fired = useRef(false)
  const stop = () => {
    clearTimeout(timer.current)
    clearInterval(timer.current)
    timer.current = undefined
  }
  useEffect(() => stop, [])

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onPointerDown={(e) => {
        keepFocus(e)
        if (!repeat || e.button !== 0) return
        fired.current = true
        onPress()
        stop()
        timer.current = setTimeout(() => {
          timer.current = setInterval(onPress, REPEAT_EVERY)
        }, REPEAT_DELAY)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={() => {
        // Repeating keys already fired on pointer down; keyboard activation
        // (Enter/Space, detail 0) still goes through here.
        if (repeat && fired.current) {
          fired.current = false
          return
        }
        onPress()
      }}
      className={cn(
        'inline-flex h-10 shrink-0 select-none items-center justify-center gap-1 rounded-lg px-2.5 text-[13px] font-medium tracking-tight transition-[background-color,color,transform] active:scale-95 pointer-coarse:h-11',
        wide ? 'min-w-14' : 'min-w-10 pointer-coarse:min-w-11',
        active
          ? 'bg-primary text-primary-foreground shadow-[0_0_0_1px_var(--primary)]'
          : 'bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1] paper:bg-secondary paper:hover:bg-accent',
        className,
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-border" />
}

export function KeyBar({
  mode,
  modifiers,
  onToggleModifier,
  onKey,
  onChar,
  onPaste,
  onCtrlAltDel,
  onKeyboard,
  keyboardOpen,
  compact,
  className,
}: KeyBarProps) {
  const ctrlOnly: Modifiers = { ctrl: true, alt: false, shift: false }
  return (
    <div
      role="toolbar"
      aria-label="辅助按键"
      className={cn(
        'scrollbar-none flex items-center gap-1.5 overflow-x-auto overscroll-x-contain pr-6 pl-2',
        // Fade the right edge: there are more keys to scroll to.
        '[mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)]',
        compact ? 'py-1' : 'py-1.5',
        className,
      )}
    >
      <Key label={keyboardOpen ? '收起键盘' : '打开键盘'} onPress={onKeyboard} active={keyboardOpen}>
        {keyboardOpen ? <KeyboardOff className="size-[18px]" /> : <Keyboard className="size-[18px]" />}
      </Key>
      <Divider />
      <Key label="Esc" onPress={() => onKey('Escape')}>
        Esc
      </Key>
      <Key label="Tab" onPress={() => onKey('Tab')}>
        Tab
      </Key>
      <Key label="Ctrl" wide active={modifiers.ctrl} onPress={() => onToggleModifier('ctrl')}>
        Ctrl
      </Key>
      <Key label="Alt" wide active={modifiers.alt} onPress={() => onToggleModifier('alt')}>
        Alt
      </Key>
      <Divider />
      <Key label="左" repeat onPress={() => onKey('ArrowLeft')}>
        <ArrowLeft className="size-[18px]" />
      </Key>
      <Key label="上" repeat onPress={() => onKey('ArrowUp')}>
        <ArrowUp className="size-[18px]" />
      </Key>
      <Key label="下" repeat onPress={() => onKey('ArrowDown')}>
        <ArrowDown className="size-[18px]" />
      </Key>
      <Key label="右" repeat onPress={() => onKey('ArrowRight')}>
        <ArrowRight className="size-[18px]" />
      </Key>
      <Divider />
      <Key label="Ctrl+C" onPress={() => onChar('c', ctrlOnly)}>
        ^C
      </Key>
      <Key label="Ctrl+D" onPress={() => onChar('d', ctrlOnly)}>
        ^D
      </Key>
      <Key label="粘贴" wide onPress={onPaste}>
        <ClipboardPaste className="size-4" />
        粘贴
      </Key>
      {mode === 'vnc' && onCtrlAltDel && (
        <Key label="Ctrl+Alt+Del" onPress={onCtrlAltDel} className="px-3">
          Ctrl+Alt+Del
        </Key>
      )}
      <Divider />
      <Key label="Home" onPress={() => onKey('Home')}>
        Home
      </Key>
      <Key label="End" onPress={() => onKey('End')}>
        End
      </Key>
      <Key label="PgUp" repeat onPress={() => onKey('PageUp')}>
        PgUp
      </Key>
      <Key label="PgDn" repeat onPress={() => onKey('PageDown')}>
        PgDn
      </Key>
      <Key label="Del" repeat onPress={() => onKey('Delete')}>
        Del
      </Key>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="功能键 F1–F12"
            onPointerDown={keepFocus}
            className="inline-flex h-10 min-w-11 shrink-0 select-none items-center justify-center rounded-lg bg-foreground/[0.06] px-2.5 text-[13px] font-medium text-foreground hover:bg-foreground/[0.1] active:scale-95 pointer-coarse:h-11 paper:bg-secondary"
          >
            F1–12
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          className="w-auto p-2"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="功能键">
            {FUNCTION_KEYS.map((f) => (
              <Key key={f} label={f} onPress={() => onKey(f)}>
                {f}
              </Key>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
