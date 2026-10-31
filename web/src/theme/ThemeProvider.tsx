import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { applyThemeAttributes, loadPrefs, savePrefs, systemPrefersDark, watchSystemDark } from './apply'
import { THEME_STORAGE_KEY, parsePrefs, themeAttributes, type AppearancePrefs, type ResolvedTheme } from './prefs'

interface ThemeContextValue {
  prefs: AppearancePrefs
  resolved: ResolvedTheme
  setPrefs: (patch: Partial<AppearancePrefs>) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<AppearancePrefs>(loadPrefs)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  useEffect(() => watchSystemDark(setSystemDark), [])

  // Another tab changed the appearance: follow it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) setPrefsState(parsePrefs(e.newValue))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const attrs = useMemo(() => themeAttributes(prefs, systemDark), [prefs, systemDark])
  useEffect(() => applyThemeAttributes(attrs), [attrs])

  const setPrefs = useCallback((patch: Partial<AppearancePrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch }
      savePrefs(next)
      return next
    })
  }, [])

  const value = useMemo(() => ({ prefs, resolved: attrs.theme, setPrefs }), [prefs, attrs.theme, setPrefs])
  return <ThemeContext value={value}>{children}</ThemeContext>
}

export function useTheme(): ThemeContextValue {
  const ctx = use(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
