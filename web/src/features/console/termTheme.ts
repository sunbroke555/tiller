// xterm.js colour schemes matching the three app themes. The cursor and the
// selection follow the accent colour (read from --brand at runtime).

import type { ResolvedTheme } from '@/theme/prefs'

export interface TermPalette {
  background: string
  foreground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export const TERM_PALETTES: Record<ResolvedTheme, TermPalette> = {
  dark: {
    background: '#0c0d11',
    foreground: '#e4e5ea',
    black: '#1d1f26',
    red: '#f07178',
    green: '#86d993',
    yellow: '#f2c66d',
    blue: '#7aa2f7',
    magenta: '#c792ea',
    cyan: '#6fd3e0',
    white: '#d0d2d9',
    brightBlack: '#5f6371',
    brightRed: '#ff8f96',
    brightGreen: '#a3e8ae',
    brightYellow: '#ffd88a',
    brightBlue: '#9db9ff',
    brightMagenta: '#dcb2f5',
    brightCyan: '#98e6ef',
    brightWhite: '#ffffff',
  },
  light: {
    background: '#fbfbfd',
    foreground: '#1d2026',
    black: '#24292f',
    red: '#cf222e',
    green: '#1a7f37',
    yellow: '#9a6700',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#116329',
    brightYellow: '#7d4e00',
    brightBlue: '#218bff',
    brightMagenta: '#a475f9',
    brightCyan: '#3192aa',
    brightWhite: '#8c959f',
  },
  paper: {
    background: '#fffefb',
    foreground: '#1f1e1b',
    black: '#141413',
    red: '#b5412f',
    green: '#5a7a44',
    yellow: '#a06a12',
    blue: '#3f6390',
    magenta: '#87579b',
    cyan: '#36786f',
    white: '#86837a',
    brightBlack: '#6b6a62',
    brightRed: '#c6613f',
    brightGreen: '#6f8a55',
    brightYellow: '#b7832f',
    brightBlue: '#5a87b8',
    brightMagenta: '#9a73ad',
    brightCyan: '#4f9188',
    brightWhite: '#a8a59a',
  },
}

/** Background behind a VNC framebuffer (letterboxing), per theme. */
export const VNC_BACKGROUND: Record<ResolvedTheme, string> = {
  dark: '#0a0b0e',
  light: '#16181d',
  paper: '#22211e',
}

export function readBrandColor(fallback = '#8b93ff'): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()
  return v || fallback
}

/** #rrggbb + alpha → rgba(), for the selection colour. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1]!, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export function xtermTheme(theme: ResolvedTheme, brand = readBrandColor()) {
  const p = TERM_PALETTES[theme]
  return {
    ...p,
    cursor: brand,
    cursorAccent: p.background,
    selectionBackground: withAlpha(brand, theme === 'dark' ? 0.38 : 0.28),
    selectionInactiveBackground: withAlpha(brand, 0.18),
    scrollbarSliderBackground: theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(20,20,19,0.14)',
    scrollbarSliderHoverBackground: theme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(20,20,19,0.22)',
    scrollbarSliderActiveBackground: theme === 'dark' ? 'rgba(255,255,255,0.28)' : 'rgba(20,20,19,0.3)',
  }
}
