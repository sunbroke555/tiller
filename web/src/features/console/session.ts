// Contract between ConsoleScreen (chrome, key bar, menus) and the two lazily
// loaded console sessions (XtermSession, VncSession).

import type { Ref } from 'react'

import type { ConsoleTarget } from '@/api/console'

import type { Modifiers, SpecialKey } from './keys'

export type ConsolePhase = 'connecting' | 'connected' | 'closed' | 'failed'

export interface ConsoleState {
  phase: ConsolePhase
  /** Error or close reason, already user facing. */
  message?: string | undefined
}

export const PHASE_LABEL: Record<ConsolePhase, string> = {
  connecting: '连接中',
  connected: '已连接',
  closed: '已断开',
  failed: '连接失败',
}

export type VncScaleMode = 'fit' | 'native'

export interface ConsoleSessionHandle {
  /** A key from the key bar, combined with the given modifiers. */
  sendKey(key: SpecialKey, mods: Modifiers): void
  /** One character with modifiers, e.g. ("c", ctrl) for ^C. */
  sendChar(ch: string, mods: Modifiers): void
  /** Type or paste text. */
  sendText(text: string): void
  /** noVNC with clipboard=vnc: put text on the guest's clipboard instead of typing it. */
  setRemoteClipboard?(text: string): void
  /** Ctrl+Alt+Del (noVNC only). */
  sendCtrlAltDel?(): void
  /** Show/hide the on-screen keyboard; returns whether it is now shown. */
  toggleKeyboard(): boolean
  focus(): void
  /** xterm: selected text; noVNC: the last text the guest put on its clipboard. */
  copyText(): string
  /** Zoom (noVNC pinch zoom / xterm font size) by a step; 0 resets. */
  zoom(step: -1 | 0 | 1): void
}

export interface ConsoleSessionProps {
  target: ConsoleTarget
  /** QEMU serial port for xterm.js (serial0…). */
  serial?: string | undefined
  /** Sticky modifiers from the key bar, applied to the next typed key. */
  modifiers: Modifiers
  onModifiersUsed: () => void
  onStateChange: (state: ConsoleState) => void
  /** noVNC: fit to the area or show 1:1 with scrollbars. */
  scaleMode?: VncScaleMode
  /** The guest put text on its clipboard (noVNC with clipboard=vnc). */
  onRemoteClipboard?: (text: string) => void
  ref?: Ref<ConsoleSessionHandle>
  className?: string
}

/** Human readable message for a failed console API call or socket. */
export function describeConsoleError(e: unknown, fallback = '无法连接控制台'): string {
  if (e instanceof Error && e.message) {
    const m = e.message
    if (/not running/i.test(m)) return '客户机没有运行'
    if (/permission check failed|403/i.test(m)) return '没有打开控制台的权限（需要 VM.Console 或 Sys.Console）'
    return m
  }
  return fallback
}
