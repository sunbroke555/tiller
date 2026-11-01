// Special keys for the mobile key bar: terminal escape sequences (xterm.js
// consoles) and X11 keysyms / DOM codes (noVNC consoles), plus the QEMU
// sendkey presets.

export const FUNCTION_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'] as const
export type FunctionKey = (typeof FUNCTION_KEYS)[number]

export type SpecialKey =
  | 'Escape'
  | 'Tab'
  | 'Enter'
  | 'Backspace'
  | 'Delete'
  | 'Insert'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | FunctionKey

export interface Modifiers {
  ctrl: boolean
  alt: boolean
  shift: boolean
}

export const NO_MODIFIERS: Modifiers = { ctrl: false, alt: false, shift: false }

export function hasModifiers(m: Modifiers): boolean {
  return m.ctrl || m.alt || m.shift
}

// ------------------------------------------------------------------ xterm

const ESC = '\x1b'

/** xterm modifier parameter: 1 + shift + 2·alt + 4·ctrl. */
function modParam(m: Modifiers): number {
  return 1 + (m.shift ? 1 : 0) + (m.alt ? 2 : 0) + (m.ctrl ? 4 : 0)
}

const CURSOR_FINAL: Partial<Record<SpecialKey, string>> = {
  ArrowUp: 'A',
  ArrowDown: 'B',
  ArrowRight: 'C',
  ArrowLeft: 'D',
  Home: 'H',
  End: 'F',
}

const TILDE_CODE: Partial<Record<SpecialKey, number>> = {
  Insert: 2,
  Delete: 3,
  PageUp: 5,
  PageDown: 6,
  F5: 15,
  F6: 17,
  F7: 18,
  F8: 19,
  F9: 20,
  F10: 21,
  F11: 23,
  F12: 24,
}

const SS3_FINAL: Partial<Record<SpecialKey, string>> = { F1: 'P', F2: 'Q', F3: 'R', F4: 'S' }

/**
 * The bytes a terminal sends for a special key, as xterm does.
 * `appCursor`: the application is in DECCKM mode (vim, less…), where
 * unmodified cursor keys send ESC O x instead of ESC [ x.
 */
export function terminalKeySequence(key: SpecialKey, mods: Modifiers = NO_MODIFIERS, appCursor = false): string {
  const m = modParam(mods)
  const cursor = CURSOR_FINAL[key]
  if (cursor) {
    if (m > 1) return `${ESC}[1;${m}${cursor}`
    return appCursor ? `${ESC}O${cursor}` : `${ESC}[${cursor}`
  }
  const tilde = TILDE_CODE[key]
  if (tilde !== undefined) return m > 1 ? `${ESC}[${tilde};${m}~` : `${ESC}[${tilde}~`
  const ss3 = SS3_FINAL[key]
  if (ss3) return m > 1 ? `${ESC}[1;${m}${ss3}` : `${ESC}O${ss3}`

  const altPrefix = mods.alt ? ESC : ''
  switch (key) {
    case 'Escape':
      return altPrefix + ESC
    case 'Tab':
      return mods.shift ? `${ESC}[Z` : altPrefix + '\t'
    case 'Enter':
      return altPrefix + '\r'
    case 'Backspace':
      return altPrefix + (mods.ctrl ? '\x08' : '\x7f')
    default:
      return ''
  }
}

/** Control character for Ctrl+<ch>, or null when the combination has none. */
export function ctrlChar(ch: string): string | null {
  if (ch.length !== 1) return null
  const c = ch.charCodeAt(0)
  if ((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a)) return String.fromCharCode(c & 0x1f)
  switch (ch) {
    case '@':
    case ' ':
    case '2':
      return '\x00'
    case '[':
    case '3':
      return '\x1b'
    case '\\':
    case '4':
      return '\x1c'
    case ']':
    case '5':
      return '\x1d'
    case '^':
    case '6':
      return '\x1e'
    case '_':
    case '-':
    case '7':
      return '\x1f'
    case '?':
    case '8':
      return '\x7f'
    default:
      return null
  }
}

/**
 * Apply sticky key-bar modifiers to what the (soft) keyboard typed. Only a
 * single typed character is combined; longer input (IME, paste) passes
 * through unchanged except for Alt's ESC prefix.
 */
export function applyTerminalModifiers(data: string, mods: Modifiers): string {
  if (!mods.ctrl && !mods.alt) return data
  const single = [...data].length === 1
  let out = data
  if (mods.ctrl && single) out = ctrlChar(data) ?? data
  if (mods.alt) out = ESC + out
  return out
}

// ------------------------------------------------------------------- VNC

/** X11 keysyms (keysymdef.h). */
export const KEYSYM = {
  BackSpace: 0xff08,
  Tab: 0xff09,
  Return: 0xff0d,
  Escape: 0xff1b,
  Delete: 0xffff,
  Home: 0xff50,
  Left: 0xff51,
  Up: 0xff52,
  Right: 0xff53,
  Down: 0xff54,
  Page_Up: 0xff55,
  Page_Down: 0xff56,
  End: 0xff57,
  Insert: 0xff63,
  F1: 0xffbe,
  Shift_L: 0xffe1,
  Control_L: 0xffe3,
  Alt_L: 0xffe9,
  Super_L: 0xffeb,
} as const

/** A key as noVNC's sendKey wants it: keysym plus the DOM code (for QEMU scancodes). */
export interface VncKey {
  keysym: number
  code?: string | undefined
}

export interface VncKeyEvent extends VncKey {
  down: boolean
}

const SPECIAL_VNC: Record<Exclude<SpecialKey, FunctionKey>, VncKey> = {
  Escape: { keysym: KEYSYM.Escape, code: 'Escape' },
  Tab: { keysym: KEYSYM.Tab, code: 'Tab' },
  Enter: { keysym: KEYSYM.Return, code: 'Enter' },
  Backspace: { keysym: KEYSYM.BackSpace, code: 'Backspace' },
  Delete: { keysym: KEYSYM.Delete, code: 'Delete' },
  Insert: { keysym: KEYSYM.Insert, code: 'Insert' },
  Home: { keysym: KEYSYM.Home, code: 'Home' },
  End: { keysym: KEYSYM.End, code: 'End' },
  PageUp: { keysym: KEYSYM.Page_Up, code: 'PageUp' },
  PageDown: { keysym: KEYSYM.Page_Down, code: 'PageDown' },
  ArrowUp: { keysym: KEYSYM.Up, code: 'ArrowUp' },
  ArrowDown: { keysym: KEYSYM.Down, code: 'ArrowDown' },
  ArrowLeft: { keysym: KEYSYM.Left, code: 'ArrowLeft' },
  ArrowRight: { keysym: KEYSYM.Right, code: 'ArrowRight' },
}

export function vncSpecialKey(key: SpecialKey): VncKey {
  const fn = FUNCTION_KEYS.indexOf(key as FunctionKey)
  if (fn >= 0) return { keysym: KEYSYM.F1 + fn, code: key }
  return SPECIAL_VNC[key as Exclude<SpecialKey, FunctionKey>]
}

const MOD_KEYS = {
  ctrl: { keysym: KEYSYM.Control_L, code: 'ControlLeft' },
  alt: { keysym: KEYSYM.Alt_L, code: 'AltLeft' },
  shift: { keysym: KEYSYM.Shift_L, code: 'ShiftLeft' },
} as const

// US layout: which physical key (and Shift) produces a printable ASCII char.
const US_SHIFTED: Record<string, string> = {
  '!': 'Digit1',
  '@': 'Digit2',
  '#': 'Digit3',
  $: 'Digit4',
  '%': 'Digit5',
  '^': 'Digit6',
  '&': 'Digit7',
  '*': 'Digit8',
  '(': 'Digit9',
  ')': 'Digit0',
  _: 'Minus',
  '+': 'Equal',
  '{': 'BracketLeft',
  '}': 'BracketRight',
  '|': 'Backslash',
  ':': 'Semicolon',
  '"': 'Quote',
  '<': 'Comma',
  '>': 'Period',
  '?': 'Slash',
  '~': 'Backquote',
}

const US_PLAIN: Record<string, string> = {
  ' ': 'Space',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '`': 'Backquote',
}

/** Keysym + US-layout code (+ whether Shift is needed) for one typed character. */
export function charToVncKey(ch: string): VncKey & { shift: boolean } {
  if (ch === '\n' || ch === '\r') return { ...SPECIAL_VNC.Enter, shift: false }
  if (ch === '\t') return { ...SPECIAL_VNC.Tab, shift: false }
  if (ch === '\b') return { ...SPECIAL_VNC.Backspace, shift: false }
  const cp = ch.codePointAt(0) ?? 0
  const keysym = cp < 0x100 ? cp : 0x1000000 | cp
  if (/^[a-z]$/.test(ch)) return { keysym, code: `Key${ch.toUpperCase()}`, shift: false }
  if (/^[A-Z]$/.test(ch)) return { keysym, code: `Key${ch}`, shift: true }
  if (/^[0-9]$/.test(ch)) return { keysym, code: `Digit${ch}`, shift: false }
  if (US_PLAIN[ch]) return { keysym, code: US_PLAIN[ch], shift: false }
  if (US_SHIFTED[ch]) return { keysym, code: US_SHIFTED[ch], shift: true }
  return { keysym, code: undefined, shift: false }
}

/** Press modifiers, tap the key, release in reverse order. */
export function vncComboEvents(key: VncKey, mods: Modifiers = NO_MODIFIERS): VncKeyEvent[] {
  const held = (['ctrl', 'alt', 'shift'] as const).filter((m) => mods[m]).map((m) => MOD_KEYS[m])
  return [
    ...held.map((k) => ({ ...k, down: true })),
    { ...key, down: true },
    { ...key, down: false },
    ...held.reverse().map((k) => ({ ...k, down: false })),
  ]
}

/** Key events that type `text` on a US keyboard ("\r\n" counts as one Enter). */
export function vncTextEvents(text: string, mods: Modifiers = NO_MODIFIERS): VncKeyEvent[] {
  const out: VncKeyEvent[] = []
  const chars = [...text.replace(/\r\n/g, '\n')]
  for (const ch of chars) {
    const k = charToVncKey(ch)
    out.push(...vncComboEvents({ keysym: k.keysym, code: k.code }, { ...mods, shift: mods.shift || k.shift }))
  }
  return out
}

/** Map a DOM KeyboardEvent.key from a hardware keyboard to our special keys. */
export function domKeyToSpecial(key: string): SpecialKey | null {
  switch (key) {
    case 'Escape':
    case 'Tab':
    case 'Enter':
    case 'Backspace':
    case 'Delete':
    case 'Insert':
    case 'Home':
    case 'End':
    case 'PageUp':
    case 'PageDown':
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
      return key
    default:
      return (FUNCTION_KEYS as readonly string[]).includes(key) ? (key as FunctionKey) : null
  }
}

// --------------------------------------------------------- QEMU sendkey

export interface SendKeyPreset {
  key: string
  label: string
  hint?: string
}

/** Common combinations for PUT …/sendkey (qemu key names joined by "-"). */
export const SENDKEY_PRESETS: SendKeyPreset[] = [
  { key: 'ctrl-alt-delete', label: 'Ctrl+Alt+Del', hint: '安全选项 / 重启' },
  { key: 'ctrl-alt-backspace', label: 'Ctrl+Alt+退格', hint: '结束 X 会话' },
  { key: 'alt-tab', label: 'Alt+Tab', hint: '切换窗口' },
  { key: 'alt-f4', label: 'Alt+F4', hint: '关闭窗口' },
  { key: 'meta_l', label: 'Win', hint: '开始菜单' },
  { key: 'meta_l-l', label: 'Win+L', hint: '锁定屏幕' },
]

/** Ctrl+Alt+F1…F7: switch Linux virtual terminals. */
export const SENDKEY_TTYS: SendKeyPreset[] = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
  key: `ctrl-alt-f${n}`,
  label: `F${n}`,
  hint: `Ctrl+Alt+F${n}`,
}))

/** QEMU key combination syntax: names of [a-z0-9_] joined by "-". */
export const QEMU_KEY_RE = /^[a-z0-9_]+(?:-[a-z0-9_]+)*$/

/** Normalize user input like "Ctrl + Alt + F2" to "ctrl-alt-f2"; null if invalid. */
export function normalizeQemuKey(input: string): string | null {
  const k = input
    .trim()
    .toLowerCase()
    .replace(/\s*\+\s*/g, '-')
    .replace(/\s+/g, '-')
    .replace(/\bdel\b/g, 'delete')
    .replace(/\bescape\b/g, 'esc')
    .replace(/\b(?:win|super|meta)\b/g, 'meta_l')
  return QEMU_KEY_RE.test(k) ? k : null
}
