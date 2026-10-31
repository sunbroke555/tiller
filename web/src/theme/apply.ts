import { DEFAULT_PREFS, THEME_STORAGE_KEY, parsePrefs, type AppearancePrefs, type ThemeAttributes } from './prefs'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(DARK_QUERY).matches
}

export function watchSystemDark(onChange: (dark: boolean) => void): () => void {
  const mq = window.matchMedia?.(DARK_QUERY)
  if (!mq) return () => {}
  const listener = (e: MediaQueryListEvent) => onChange(e.matches)
  mq.addEventListener('change', listener)
  return () => mq.removeEventListener('change', listener)
}

/** Read preferences; storage can be missing or throw (private mode). */
export function loadPrefs(): AppearancePrefs {
  try {
    return parsePrefs(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(prefs: AppearancePrefs): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Not persisted, but still applied for this session.
  }
}

/** Write theme attributes to <html>. Mirrors the inline boot script. */
export function applyThemeAttributes(attrs: ThemeAttributes, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-theme', attrs.theme)
  root.setAttribute('data-accent', attrs.accent)
  root.setAttribute('data-glass', attrs.glass)
  root.setAttribute('data-density', attrs.density)
  root.classList.toggle('dark', attrs.dark)
  root.style.colorScheme = attrs.dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', attrs.themeColor)
}
