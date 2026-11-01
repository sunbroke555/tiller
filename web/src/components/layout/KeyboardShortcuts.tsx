import { useEffect, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router'

import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { useTheme } from '@/theme/ThemeProvider'
import type { ThemeMode } from '@/theme/prefs'

import { useCommandPalette } from './CommandPalette'

// ------------------------------------------------------------ open state

let helpOpen = false
const listeners = new Set<() => void>()
function setHelpOpen(open: boolean) {
  helpOpen = open
  listeners.forEach((l) => l())
}
/** Open the keyboard shortcut overview (from menus, the palette, "?"). */
export function openShortcutsHelp() {
  setHelpOpen(true)
}
function useHelpOpen() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => helpOpen,
    () => false,
  )
}

// -------------------------------------------------------------- bindings

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const MOD = isMac ? '⌘' : 'Ctrl'

/** "g" then a key: go to a page. */
export const GOTO: { key: string; to: string; label: string }[] = [
  { key: 'o', to: '/', label: '概览' },
  { key: 'd', to: '/datacenter', label: '数据中心' },
  { key: 's', to: '/storage', label: '存储' },
  { key: 't', to: '/tasks', label: '任务' },
  { key: 'p', to: '/pool', label: '资源池' },
  { key: 'h', to: '/shell', label: 'Shell' },
  { key: 'a', to: '/account', label: '我的账户' },
  { key: 'e', to: '/settings/appearance', label: '外观设置' },
]

const THEME_CYCLE: ThemeMode[] = ['dark', 'light', 'paper']

export const SHORTCUT_GROUPS: { title: string; items: { keys: string[][]; label: string }[] }[] = [
  {
    title: '通用',
    items: [
      { keys: [[MOD, 'K'], ['/']], label: '搜索资源、页面和操作' },
      { keys: [['?']], label: '显示快捷键' },
      { keys: [['Shift', 'T']], label: '切换主题（暗色 / 浅色 / 纸质）' },
      { keys: [['Esc']], label: '关闭对话框或面板' },
    ],
  },
  {
    title: '跳转',
    items: GOTO.map((g) => ({ keys: [['G', g.key.toUpperCase()]], label: g.label })),
  },
  {
    title: '搜索面板中',
    items: [
      { keys: [['↑'], ['↓']], label: '选择结果' },
      { keys: [['Enter']], label: '打开或执行' },
    ],
  },
]

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.closest?.('.xterm, [role="dialog"] input'))
}

/**
 * Global single-key shortcuts (the palette owns ⌘K and "/"). Ignored while
 * typing and while a dialog has focus; "g" waits 1.5 s for its second key.
 */
export function KeyboardShortcuts() {
  const navigate = useNavigate()
  const { open: paletteOpen } = useCommandPalette()
  const { prefs, resolved, setPrefs } = useTheme()
  const open = useHelpOpen()

  useEffect(() => {
    let pendingG = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || paletteOpen || isTypingTarget(e.target)) return
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') && !helpOpen) return
      const key = e.key
      if (pendingG && Date.now() - pendingG < 1500) {
        pendingG = 0
        const target = GOTO.find((g) => g.key === key.toLowerCase())
        if (target) {
          e.preventDefault()
          setHelpOpen(false)
          navigate(target.to)
        }
        return
      }
      if (key === 'g' && !e.shiftKey) {
        pendingG = Date.now()
        return
      }
      if (key === '?') {
        e.preventDefault()
        setHelpOpen(!helpOpen)
        return
      }
      if (key === 'T' && e.shiftKey) {
        e.preventDefault()
        const current = prefs.mode === 'system' ? resolved : prefs.mode
        const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length]!
        setPrefs({ mode: next })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, paletteOpen, prefs.mode, resolved, setPrefs])

  return (
    <ResponsiveDialog open={open} onOpenChange={setHelpOpen} title="键盘快捷键" description="在任意页面使用（输入文字时不生效）" size="md">
      <div className="grid gap-5 pb-2">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">{group.title}</h3>
            <ul className="divide-y divide-border/70 rounded-xl ring-1 ring-border ring-inset">
              {group.items.map((item) => (
                <li key={item.label} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                  <span>{item.label}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    {item.keys.map((combo, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="px-0.5">或</span>}
                        {combo.map((k) => (
                          <kbd
                            key={k}
                            className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-(--field) px-1.5 font-mono text-[11px] text-foreground shadow-[inset_0_-1px_0_var(--border)]"
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </ResponsiveDialog>
  )
}
