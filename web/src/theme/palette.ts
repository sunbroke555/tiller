import type { Accent, ResolvedTheme } from './prefs'

/** Swatch colours for the settings page; must match the --brand values in index.css. */
export const ACCENT_SWATCHES: Record<Accent, { label: string; dark: string; light: string }> = {
  indigo: { label: '靛蓝', dark: '#8b93ff', light: '#4f46e5' },
  blue: { label: '海蓝', dark: '#78b5ff', light: '#2563eb' },
  violet: { label: '紫藤', dark: '#b59aff', light: '#7c3aed' },
  teal: { label: '青绿', dark: '#2dd4bf', light: '#0f766e' },
  forest: { label: '松绿', dark: '#7bc9a4', light: '#2f6b4f' },
  orange: { label: '橙', dark: '#fb923c', light: '#c2410c' },
  rose: { label: '玫红', dark: '#fb7185', light: '#e11d48' },
  slate: { label: '石墨', dark: '#a8b4c4', light: '#475569' },
}

export const CLAY = '#d97757'

export function swatchColor(accent: Accent, theme: ResolvedTheme): string {
  if (theme === 'paper') return CLAY
  return ACCENT_SWATCHES[accent][theme === 'dark' ? 'dark' : 'light']
}
