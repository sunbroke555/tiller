// Appearance preferences: pure data and logic, no DOM or React, so the same
// rules can be shared with the inline boot script (see boot.ts) and tests.

export const THEME_STORAGE_KEY = 'pve-web:appearance'

export const THEME_MODES = ['system', 'dark', 'light', 'paper'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

/** What is actually applied: `system` resolves to dark or light. */
export type ResolvedTheme = Exclude<ThemeMode, 'system'>

export const ACCENTS = ['indigo', 'teal', 'orange', 'rose'] as const
export type Accent = (typeof ACCENTS)[number]

export const DENSITIES = ['comfortable', 'compact'] as const
export type Density = (typeof DENSITIES)[number]

export interface AppearancePrefs {
  mode: ThemeMode
  /** Accent for the glass themes; paper always uses Clay. */
  accent: Accent
  /** Translucent blurred surfaces; off = solid cards (cheaper on old phones). */
  glass: boolean
  density: Density
}

export const DEFAULT_PREFS: AppearancePrefs = {
  mode: 'system',
  accent: 'indigo',
  glass: true,
  density: 'comfortable',
}

/** Browser chrome colour (meta theme-color) per resolved theme. */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: '#07080a',
  light: '#eceef3',
  paper: '#faf9f5',
}

function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback
}

/** Parse stored preferences, falling back field by field on anything invalid. */
export function parsePrefs(raw: string | null | undefined): AppearancePrefs {
  let data: unknown = null
  if (raw) {
    try {
      data = JSON.parse(raw)
    } catch {
      data = null
    }
  }
  const p = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return {
    mode: oneOf(THEME_MODES, p.mode, DEFAULT_PREFS.mode),
    accent: oneOf(ACCENTS, p.accent, DEFAULT_PREFS.accent),
    glass: typeof p.glass === 'boolean' ? p.glass : DEFAULT_PREFS.glass,
    density: oneOf(DENSITIES, p.density, DEFAULT_PREFS.density),
  }
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light'
  return mode
}

/** The attributes written to <html>; the CSS keys everything off these. */
export interface ThemeAttributes {
  theme: ResolvedTheme
  accent: Accent | 'clay'
  glass: 'on' | 'off'
  density: Density
  /** Adds the `dark` class used by Tailwind's dark: variant. */
  dark: boolean
  themeColor: string
}

export function themeAttributes(prefs: AppearancePrefs, prefersDark: boolean): ThemeAttributes {
  const theme = resolveTheme(prefs.mode, prefersDark)
  const paper = theme === 'paper'
  return {
    theme,
    accent: paper ? 'clay' : prefs.accent,
    glass: !paper && prefs.glass ? 'on' : 'off',
    density: prefs.density,
    dark: theme === 'dark',
    themeColor: THEME_COLORS[theme],
  }
}
